-- Finance core — step 2 of 2 (data). Idempotent; nobody gains access to anything outside the module and no money is lost or created.
--
--  1. Roles that already exist get the keys of the module (a school created later gets them from seed_school_roles).
--  2. Every school gets its four funds (Tuition, SDC levy, Boarding, General) and its money controls.
--  3. The older accounting tables are carried into the new ones, in whole cents:
--       fee structures -> fee lines            charges  -> charges           payments -> payments (+ voids)
--       expense requests -> requests (+ lines) expenses -> expenses (+ voids)
--     A fee, charge or payment goes to the fund its label names (SDC / levy -> SDC levy, board / hostel -> Boarding, else Tuition);
--     expenses go to General.
--  4. Verified, unvoided payments are allocated to charges of the same student, currency and fund, oldest charge first, so each
--     student's balance in the new module equals what the older screens showed. Money paid beyond the charges of its fund stays
--     as unallocated credit; the older screens showed it as a negative balance. A NOTICE says how many students that touches.
-- The older tables are not touched. From this migration on the older accounting screens stop writing (lib/finance/legacy-guard.ts),
-- so the two never disagree. No person is acting in a migration, so the row-change audit writes nothing here.
-- A ZiG payment of a USD fee keeps its fee-currency amount; the ZiG tendered and the rate are copied into its note.

-- 1 ─────────────────────────────────────────────────────────────────────────
INSERT INTO "RolePermission" ("id", "schoolId", "roleId", "permissionKey", "updatedAt")
SELECT gen_random_uuid()::text, rd."schoolId", rd."id", k, CURRENT_TIMESTAMP
  FROM "RoleDefinition" rd CROSS JOIN LATERAL unnest(finance_role_keys(rd."key")) AS k
ON CONFLICT ("roleId", "permissionKey") DO NOTHING;

-- 2 ─────────────────────────────────────────────────────────────────────────
INSERT INTO "Fund" ("id", "schoolId", "code", "name", "kind", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, s."id", v."code", v."name", v."kind"::"FundKind", v."sortOrder", CURRENT_TIMESTAMP
  FROM "School" s
  CROSS JOIN (VALUES ('TUITION', 'Tuition', 'TUITION', 0), ('SDC', 'SDC levy', 'SDC_LEVY', 1), ('BOARDING', 'Boarding', 'BOARDING', 2), ('GENERAL', 'General', 'GENERAL', 3))
         AS v("code", "name", "kind", "sortOrder")
ON CONFLICT ("schoolId", "code") DO NOTHING;

INSERT INTO "FinSettings" ("id", "schoolId", "legacyRetired", "updatedAt")
SELECT gen_random_uuid()::text, s."id", true, CURRENT_TIMESTAMP FROM "School" s
ON CONFLICT ("schoolId") DO NOTHING;

-- 3 ─────────────────────────────────────────────────────────────────────────
-- History has to be carried in: closed terms, payments that are already verified, requests that are already paid.
ALTER TABLE "FinFeeItem" DISABLE TRIGGER "closed_term_FinFeeItem";
ALTER TABLE "FinCharge" DISABLE TRIGGER "closed_term_FinCharge";
ALTER TABLE "FinCharge" DISABLE TRIGGER "guard_FinCharge";
ALTER TABLE "FinPayment" DISABLE TRIGGER "guard_FinPayment";
ALTER TABLE "FinPaymentAllocation" DISABLE TRIGGER "guard_FinPaymentAllocation";
ALTER TABLE "FinVoid" DISABLE TRIGGER "guard_FinVoid";
ALTER TABLE "FinExpenseRequest" DISABLE TRIGGER "guard_FinExpenseRequest";
ALTER TABLE "FinExpenseRequestItem" DISABLE TRIGGER "guard_FinExpenseRequestItem";
ALTER TABLE "FinExpense" DISABLE TRIGGER "guard_FinExpense";

-- The person who stands in for "who made it" where the older tables did not record one: a director, else an administrator, else the first user.
CREATE TEMP TABLE fin_owner AS
SELECT DISTINCT ON (u."schoolId") u."schoolId", u."id" AS user_id
  FROM "User" u
 WHERE u."isSupport" = false
 ORDER BY u."schoolId", (u."role" = 'DIRECTOR') DESC, (u."role" = 'ADMIN') DESC, u."createdAt", u."id";

-- Which fund a label belongs to.
CREATE OR REPLACE FUNCTION fin_fund_code(label text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN label ~* '(sdc|levy|development)' THEN 'SDC'
    WHEN label ~* '(board|hostel|dorm)' THEN 'BOARDING'
    ELSE 'TUITION'
  END
$$;

-- Fee lines.
INSERT INTO "FinFeeItem" ("id", "schoolId", "termId", "levelId", "fundId", "name", "currency", "amountCents", "createdById", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, f."schoolId", f."termId", f."levelId", fu."id", f."label", f."currency", round(f."amount" * 100)::int, o.user_id, f."createdAt", CURRENT_TIMESTAMP
  FROM "FeeStructure" f
  JOIN fin_owner o ON o."schoolId" = f."schoolId"
  JOIN "Fund" fu ON fu."schoolId" = f."schoolId" AND fu."code" = fin_fund_code(f."label")
 WHERE f."amount" > 0
   AND NOT EXISTS (SELECT 1 FROM "FinFeeItem" x WHERE x."schoolId" = f."schoolId" AND x."termId" = f."termId" AND x."name" = f."label" AND x."levelId" IS NOT DISTINCT FROM f."levelId" AND x."currency" = f."currency");

-- Charges.
INSERT INTO "FinCharge" ("id", "schoolId", "studentId", "termId", "fundId", "description", "currency", "amountCents", "source", "createdAt", "legacyChargeId")
SELECT gen_random_uuid()::text, c."schoolId", c."studentId", c."termId", fu."id", c."label", c."currency", round(c."amount" * 100)::int, 'MIGRATED', c."issuedAt", c."id"
  FROM "Charge" c
  JOIN "Fund" fu ON fu."schoolId" = c."schoolId" AND fu."code" = fin_fund_code(c."label")
 WHERE c."amount" > 0
ON CONFLICT ("legacyChargeId") DO NOTHING;

-- Payments. A payment goes to the fund of the first charge whose label matches its fee label, else the fund its label names.
INSERT INTO "FinPayment" ("id", "schoolId", "studentId", "fundId", "receiptNumber", "currency", "amountCents", "method", "reference", "receivedOn", "note", "proofKey",
                          "status", "recordedById", "recordedAt", "verifiedById", "verifiedAt", "legacyPaymentId")
SELECT gen_random_uuid()::text, p."schoolId", p."studentId", fu."id",
       'LEG-' || lpad((row_number() OVER (PARTITION BY p."schoolId" ORDER BY p."recordedAt", p."id"))::text, 6, '0'),
       p."currency", round(p."amount" * 100)::int, p."method", p."reference", (p."recordedAt" AT TIME ZONE 'Africa/Harare')::date,
       trim(both ' ' from concat_ws('. ', p."feeLabel",
            CASE WHEN p."paidInZig" THEN 'Paid in ZiG ' || p."zigAmountPaid" || ' at ' || p."exchangeRateUsed" || ' ZiG to the dollar' END)),
       p."popKey",
       CASE WHEN p."verifiedBy" IS NOT NULL THEN 'VERIFIED' ELSE 'PENDING' END::"FinPaymentStatus",
       p."recordedBy", p."recordedAt",
       p."verifiedBy", CASE WHEN p."verifiedBy" IS NOT NULL THEN COALESCE(p."verifiedAt", p."recordedAt") END,
       p."id"
  FROM "Payment" p
  JOIN "Fund" fu ON fu."schoolId" = p."schoolId" AND fu."code" = fin_fund_code(p."feeLabel")
 WHERE p."amount" > 0
ON CONFLICT ("legacyPaymentId") DO NOTHING;

-- Voided payments get a void row; a payment that was never verified is voided as pending.
INSERT INTO "FinVoid" ("id", "schoolId", "paymentId", "reason", "voidedById", "voidedAt")
SELECT gen_random_uuid()::text, p."schoolId", fp."id", 'Voided before the Finance module (the reason was not recorded)', COALESCE(p."voidedBy", p."recordedBy"), COALESCE(p."voidedAt", p."recordedAt")
  FROM "Payment" p
  JOIN "FinPayment" fp ON fp."legacyPaymentId" = p."id"
 WHERE p."status" = 'VOIDED'
   AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = fp."id");

-- 4 ─────────────────────────────────────────────────────────────────────────
-- Oldest charge first: each charge covers the stretch [before, before + amount) of the student's running total, each verified payment
-- the stretch [before, before + amount) of their running payments; where the stretches overlap, that part of the payment settles that charge.
INSERT INTO "FinPaymentAllocation" ("id", "schoolId", "paymentId", "chargeId", "amountCents", "createdById")
WITH ch AS (
  SELECT c."id", c."schoolId", c."studentId", c."currency", c."fundId", c."amountCents",
         sum(c."amountCents") OVER w - c."amountCents" AS s, sum(c."amountCents") OVER w AS e
    FROM "FinCharge" c
    JOIN "AcademicTerm" t ON t."id" = c."termId"
   WHERE c."legacyChargeId" IS NOT NULL
  WINDOW w AS (PARTITION BY c."studentId", c."currency", c."fundId" ORDER BY t."startDate", c."createdAt", c."id")
), pa AS (
  SELECT p."id", p."schoolId", p."studentId", p."currency", p."fundId", p."recordedById",
         sum(p."amountCents") OVER w - p."amountCents" AS s, sum(p."amountCents") OVER w AS e
    FROM "FinPayment" p
   WHERE p."legacyPaymentId" IS NOT NULL AND p."status" = 'VERIFIED'
     AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = p."id")
  WINDOW w AS (PARTITION BY p."studentId", p."currency", p."fundId" ORDER BY p."recordedAt", p."id")
)
SELECT gen_random_uuid()::text, ch."schoolId", pa."id", ch."id", (least(ch.e, pa.e) - greatest(ch.s, pa.s))::int, pa."recordedById"
  FROM ch
  JOIN pa ON pa."studentId" = ch."studentId" AND pa."currency" = ch."currency" AND pa."fundId" = ch."fundId"
 WHERE least(ch.e, pa.e) > greatest(ch.s, pa.s)
   AND NOT EXISTS (SELECT 1 FROM "FinPaymentAllocation" x WHERE x."paymentId" = pa."id" AND x."chargeId" = ch."id");

DO $$
DECLARE credit int; fund_mismatch int;
BEGIN
  SELECT count(DISTINCT p."studentId") INTO credit
    FROM "FinPayment" p
   WHERE p."legacyPaymentId" IS NOT NULL AND p."status" = 'VERIFIED' AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = p."id")
     AND p."amountCents" > COALESCE((SELECT sum(a."amountCents") FROM "FinPaymentAllocation" a WHERE a."paymentId" = p."id"), 0);
  IF credit > 0 THEN RAISE NOTICE '% student(s) paid more than the charges of the fund named by the payment label; the rest stays as unallocated credit', credit; END IF;
END $$;

-- Expense requests, with their lines. Everything goes to the General fund.
INSERT INTO "FinExpenseRequest" ("id", "schoolId", "requestNumber", "title", "type", "department", "justification", "fundId", "currency", "estimatedCents", "status",
                                 "requestedById", "createdAt", "submittedAt", "approvedById", "approvedAt", "rejectedById", "rejectedAt", "rejectionReason",
                                 "disbursedById", "disbursedAt", "legacyRequestId")
SELECT gen_random_uuid()::text, r."schoolId", r."requestNumber", r."title", r."type", r."department", r."justification", fu."id", r."currency",
       GREATEST(round(r."estimatedTotal" * 100)::int, 1), r."status", r."requestedById", r."createdAt",
       CASE WHEN r."status" <> 'DRAFT' THEN r."requestedAt" END,
       CASE WHEN r."status" IN ('APPROVED', 'DISBURSED') THEN COALESCE(r."approvedById", r."requestedById") END,
       CASE WHEN r."status" IN ('APPROVED', 'DISBURSED') THEN COALESCE(r."approvedAt", r."requestedAt") END,
       CASE WHEN r."status" = 'REJECTED' THEN COALESCE(r."rejectedById", r."approvedById", r."requestedById") END,
       CASE WHEN r."status" = 'REJECTED' THEN COALESCE(r."rejectedAt", r."requestedAt") END,
       CASE WHEN r."status" = 'REJECTED' THEN COALESCE(NULLIF(btrim(r."rejectionReason"), ''), 'Rejected (the reason was not recorded)') END,
       CASE WHEN r."status" = 'DISBURSED' THEN COALESCE(r."disbursedById", r."approvedById", r."requestedById") END,
       CASE WHEN r."status" = 'DISBURSED' THEN COALESCE(r."disbursedAt", r."approvedAt", r."requestedAt") END,
       r."id"
  FROM "ExpenseRequest" r
  JOIN "Fund" fu ON fu."schoolId" = r."schoolId" AND fu."code" = 'GENERAL'
ON CONFLICT ("legacyRequestId") DO NOTHING;

INSERT INTO "FinExpenseRequestItem" ("id", "schoolId", "requestId", "description", "quantity", "unitCents", "totalCents")
SELECT gen_random_uuid()::text, fr."schoolId", fr."id", i."description", GREATEST(i."quantity", 1), round(i."unitPrice" * 100)::int, GREATEST(i."quantity", 1) * round(i."unitPrice" * 100)::int
  FROM "ExpenseRequestItem" i
  JOIN "FinExpenseRequest" fr ON fr."legacyRequestId" = i."requestId"
 WHERE NOT EXISTS (SELECT 1 FROM "FinExpenseRequestItem" x WHERE x."requestId" = fr."id");

-- Expenses (voided ones keep their void row).
INSERT INTO "FinExpense" ("id", "schoolId", "fundId", "category", "description", "currency", "amountCents", "paidOn", "method", "source", "requestId", "recordedById", "createdAt", "legacyExpenseId")
SELECT gen_random_uuid()::text, e."schoolId", fu."id", e."category", COALESCE(NULLIF(btrim(e."note"), ''), e."category"), e."currency", round(e."amount" * 100)::int,
       e."spentOn"::date, COALESCE(r."paymentMethod", 'CASH'), 'MIGRATED', fr."id", e."recordedBy", e."createdAt", e."id"
  FROM "Expense" e
  JOIN "Fund" fu ON fu."schoolId" = e."schoolId" AND fu."code" = 'GENERAL'
  LEFT JOIN "ExpenseRequest" r ON r."id" = e."expenseRequestId"
  LEFT JOIN "FinExpenseRequest" fr ON fr."legacyRequestId" = r."id"
 WHERE e."amount" > 0
ON CONFLICT ("legacyExpenseId") DO NOTHING;

INSERT INTO "FinVoid" ("id", "schoolId", "expenseId", "reason", "voidedById", "voidedAt")
SELECT gen_random_uuid()::text, e."schoolId", fe."id", 'Voided before the Finance module (the reason was not recorded)', COALESCE(e."voidedBy", e."recordedBy"), e."createdAt"
  FROM "Expense" e
  JOIN "FinExpense" fe ON fe."legacyExpenseId" = e."id"
 WHERE e."status" = 'VOIDED' AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."expenseId" = fe."id");

ALTER TABLE "FinFeeItem" ENABLE TRIGGER "closed_term_FinFeeItem";
ALTER TABLE "FinCharge" ENABLE TRIGGER "closed_term_FinCharge";
ALTER TABLE "FinCharge" ENABLE TRIGGER "guard_FinCharge";
ALTER TABLE "FinPayment" ENABLE TRIGGER "guard_FinPayment";
ALTER TABLE "FinPaymentAllocation" ENABLE TRIGGER "guard_FinPaymentAllocation";
ALTER TABLE "FinVoid" ENABLE TRIGGER "guard_FinVoid";
ALTER TABLE "FinExpenseRequest" ENABLE TRIGGER "guard_FinExpenseRequest";
ALTER TABLE "FinExpenseRequestItem" ENABLE TRIGGER "guard_FinExpenseRequestItem";
ALTER TABLE "FinExpense" ENABLE TRIGGER "guard_FinExpense";

DROP FUNCTION fin_fund_code(text);
DROP TABLE fin_owner;
