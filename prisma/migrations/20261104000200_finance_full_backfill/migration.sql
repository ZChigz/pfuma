-- Finance, part 2 — step 3 (data). Idempotent; nobody gains access to anything outside the module and no money changes.
--
--  1. Every school gets the three extra funds (Building levy, Exams, Other), the school's list of fee items, and the expense categories.
--  2. Fee lines made before fee structures existed are gathered into one APPROVED structure (version 1) per term, so billing and
--     the fee schedule work for them. Their charges and lines point at the fee item of the same name (else "Other").
--  3. Every payment gets an acknowledgement number (its existing receipt number) and a code for the receipt's QR check.
--  4. Roles that exist get the new keys; the Head no longer starts with the right to approve refunds (the Owner approves them).
--  5. Receipt numbers now come from a counter per school, year and book; it starts where the old counter stopped.
-- Part 1's data is not touched except for the columns named above. No person is acting in a migration, so the row-change audit writes nothing.

-- 1 ─────────────────────────────────────────────────────────────────────────
INSERT INTO "Fund" ("id", "schoolId", "code", "name", "kind", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, s."id", v."code", v."name", v."kind"::"FundKind", v."sortOrder", CURRENT_TIMESTAMP
  FROM "School" s
  CROSS JOIN (VALUES ('BUILDING', 'Building levy', 'BUILDING', 4), ('EXAMS', 'Exams', 'EXAMS', 5), ('OTHER', 'Other', 'OTHER', 6)) AS v("code", "name", "kind", "sortOrder")
ON CONFLICT ("schoolId", "code") DO NOTHING;

INSERT INTO "FeeItem" ("id", "schoolId", "name", "fundId", "recurring", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, s."id", v."name", f."id", v."recurring", v."sortOrder", CURRENT_TIMESTAMP
  FROM "School" s
  CROSS JOIN (VALUES
    ('Tuition', 'TUITION', true, 0), ('SDC levy', 'SDC', true, 1), ('Boarding fee', 'BOARDING', true, 2), ('Building levy', 'BUILDING', true, 3),
    ('Sports levy', 'GENERAL', true, 4), ('Library levy', 'GENERAL', true, 5), ('Computer / ICT levy', 'GENERAL', true, 6), ('Exam fee', 'EXAMS', false, 7),
    ('Uniform', 'GENERAL', false, 8), ('Transport', 'GENERAL', false, 9), ('Trips', 'GENERAL', false, 10), ('Library fine', 'GENERAL', false, 11), ('Other', 'OTHER', false, 12)
  ) AS v("name", "fundCode", "recurring", "sortOrder")
  JOIN "Fund" f ON f."schoolId" = s."id" AND f."code" = v."fundCode"
ON CONFLICT ("schoolId", "name") DO NOTHING;

INSERT INTO "ExpenseCategory" ("id", "schoolId", "name", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, s."id", v."name", v."sortOrder", CURRENT_TIMESTAMP
  FROM "School" s
  CROSS JOIN (VALUES ('Stationery', 0), ('Teaching materials', 1), ('Food and catering', 2), ('Maintenance and repairs', 3), ('Utilities', 4), ('Transport and fuel', 5),
                     ('Sports', 6), ('Staff welfare', 7), ('Exams', 8), ('Cleaning', 9), ('Security', 10), ('Bank charges', 11), ('Salaries', 12), ('Other', 13)) AS v("name", "sortOrder")
ON CONFLICT ("schoolId", "name") DO NOTHING;

-- 2 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "FinFeeStructure" DISABLE TRIGGER "guard_FinFeeStructure";
ALTER TABLE "FinFeeStructure" DISABLE TRIGGER "closed_term_FinFeeStructure";
ALTER TABLE "FinFeeItem" DISABLE TRIGGER "guard_line_FinFeeItem";
ALTER TABLE "FinFeeItem" DISABLE TRIGGER "closed_term_FinFeeItem";
ALTER TABLE "FinCharge" DISABLE TRIGGER "append_only_FinCharge";
ALTER TABLE "FinPayment" DISABLE TRIGGER "immutable_FinPayment";

INSERT INTO "FinFeeStructure" ("id", "schoolId", "termId", "version", "status", "note", "createdById", "submittedById", "submittedAt", "approvedById", "approvedAt", "billedAt", "updatedAt")
SELECT gen_random_uuid()::text, d."schoolId", d."termId", 1, 'APPROVED', 'Fee lines set before fee structures existed', d."creator", d."creator", d."at", d."creator", d."at",
       CASE WHEN EXISTS (SELECT 1 FROM "FinCharge" c WHERE c."termId" = d."termId" AND c."feeItemId" IS NOT NULL) THEN d."at" END, CURRENT_TIMESTAMP
  FROM (SELECT f."schoolId", f."termId", min(f."createdById") AS creator, min(f."createdAt") AS at FROM "FinFeeItem" f WHERE f."structureId" IS NULL GROUP BY 1, 2) d
 WHERE NOT EXISTS (SELECT 1 FROM "FinFeeStructure" x WHERE x."termId" = d."termId");

UPDATE "FinFeeItem" f
   SET "structureId" = (SELECT x."id" FROM "FinFeeStructure" x WHERE x."termId" = f."termId" ORDER BY x."version" LIMIT 1),
       "catalogItemId" = COALESCE(
         (SELECT i."id" FROM "FeeItem" i WHERE i."schoolId" = f."schoolId" AND lower(i."name") = lower(f."name") LIMIT 1),
         (SELECT i."id" FROM "FeeItem" i WHERE i."schoolId" = f."schoolId" AND i."fundId" = f."fundId" ORDER BY i."sortOrder" LIMIT 1),
         (SELECT i."id" FROM "FeeItem" i WHERE i."schoolId" = f."schoolId" AND i."name" = 'Other')),
       "levelIds" = CASE WHEN f."levelId" IS NULL THEN ARRAY[]::text[] ELSE ARRAY[f."levelId"] END
 WHERE f."structureId" IS NULL;

UPDATE "FinCharge" c SET "catalogItemId" = f."catalogItemId" FROM "FinFeeItem" f WHERE c."feeItemId" = f."id" AND c."catalogItemId" IS NULL;

-- 3 ─────────────────────────────────────────────────────────────────────────
UPDATE "FinPayment" SET "ackNumber" = COALESCE("receiptNumber", 'ACK-' || "id") WHERE "ackNumber" = '';
UPDATE "FinPayment" SET "verifyCode" = upper(substr(md5("id" || random()::text), 1, 10)) WHERE "verifyCode" = '';

ALTER TABLE "FinFeeStructure" ENABLE TRIGGER "guard_FinFeeStructure";
ALTER TABLE "FinFeeStructure" ENABLE TRIGGER "closed_term_FinFeeStructure";
ALTER TABLE "FinFeeItem" ENABLE TRIGGER "guard_line_FinFeeItem";
ALTER TABLE "FinFeeItem" ENABLE TRIGGER "closed_term_FinFeeItem";
ALTER TABLE "FinCharge" ENABLE TRIGGER "append_only_FinCharge";
ALTER TABLE "FinPayment" ENABLE TRIGGER "immutable_FinPayment";

-- 4 ─────────────────────────────────────────────────────────────────────────
INSERT INTO "RolePermission" ("id", "schoolId", "roleId", "permissionKey", "updatedAt")
SELECT gen_random_uuid()::text, rd."schoolId", rd."id", k, CURRENT_TIMESTAMP
  FROM "RoleDefinition" rd CROSS JOIN LATERAL unnest(finance_role_keys(rd."key")) AS k
ON CONFLICT ("roleId", "permissionKey") DO NOTHING;

DELETE FROM "RolePermission" rp USING "RoleDefinition" rd
 WHERE rp."roleId" = rd."id" AND rd."key" = 'HEAD' AND rd."isSystem" AND rp."permissionKey" = 'finance.refunds.approve';

-- 5 ─────────────────────────────────────────────────────────────────────────
INSERT INTO "ReceiptSequence" ("id", "schoolId", "year", "prefix", "nextNumber")
SELECT gen_random_uuid()::text, s."id", extract(year FROM now())::int, 'RCP', greatest(s."receiptNextNumber", 1)
  FROM "School" s
ON CONFLICT ("schoolId", "year", "prefix") DO NOTHING;
