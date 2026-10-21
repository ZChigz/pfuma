-- CreateEnum
CREATE TYPE "FundKind" AS ENUM ('TUITION', 'SDC_LEVY', 'BOARDING', 'GENERAL', 'OTHER');

-- CreateEnum
CREATE TYPE "FinPaymentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('CREDIT_NOTE', 'DISCOUNT', 'BURSARY', 'WAIVER');

-- CreateEnum
CREATE TYPE "FinApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FinRefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "ChargeSource" AS ENUM ('FEE_ITEM', 'MANUAL', 'LIBRARY', 'EXAM_ENTRY', 'MIGRATED');

-- CreateEnum
CREATE TYPE "FinExpenseSource" AS ENUM ('REQUEST', 'DIRECT', 'MIGRATED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'BANK_TRANSFER';
ALTER TYPE "PaymentMethod" ADD VALUE 'CHEQUE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SAVE_FUND';
ALTER TYPE "AuditAction" ADD VALUE 'SAVE_FEE_ITEM';
ALTER TYPE "AuditAction" ADD VALUE 'REJECT_PAYMENT';
ALTER TYPE "AuditAction" ADD VALUE 'ALLOCATE_PAYMENT';
ALTER TYPE "AuditAction" ADD VALUE 'VOID_CHARGE';
ALTER TYPE "AuditAction" ADD VALUE 'REQUEST_ADJUSTMENT';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVE_ADJUSTMENT';
ALTER TYPE "AuditAction" ADD VALUE 'REJECT_ADJUSTMENT';
ALTER TYPE "AuditAction" ADD VALUE 'REQUEST_REFUND';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVE_REFUND';
ALTER TYPE "AuditAction" ADD VALUE 'REJECT_REFUND';
ALTER TYPE "AuditAction" ADD VALUE 'PAY_REFUND';
ALTER TYPE "AuditAction" ADD VALUE 'SAVE_FINANCE_CONTROLS';

-- CreateTable
CREATE TABLE "Fund" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FundKind" NOT NULL DEFAULT 'OTHER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinFeeItem" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "levelId" TEXT,
    "boarding" "BoardingType",
    "fundId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinFeeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinCharge" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "feeItemId" TEXT,
    "description" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "source" "ChargeSource" NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacyChargeId" TEXT,

    CONSTRAINT "FinCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinPayment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "paidBy" TEXT,
    "receivedOn" DATE NOT NULL,
    "note" TEXT,
    "proofKey" TEXT,
    "targetChargeId" TEXT,
    "status" "FinPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifierFallback" BOOLEAN NOT NULL DEFAULT false,
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "legacyPaymentId" TEXT,

    CONSTRAINT "FinPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinPaymentAllocation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinAdjustment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "kind" "AdjustmentKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "FinApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "FinAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinRefund" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "chargeId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "method" "PaymentMethod",
    "reference" TEXT,
    "status" "FinRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "paidById" TEXT,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "FinRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinVoid" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "paymentId" TEXT,
    "expenseId" TEXT,
    "chargeId" TEXT,
    "reason" TEXT NOT NULL,
    "voidedById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinVoid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinExpenseRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ExpenseRequestType" NOT NULL,
    "department" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "estimatedCents" INTEGER NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "disbursedById" TEXT,
    "disbursedAt" TIMESTAMP(3),
    "legacyRequestId" TEXT,

    CONSTRAINT "FinExpenseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinExpenseRequestItem" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,

    CONSTRAINT "FinExpenseRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinExpense" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "payee" TEXT,
    "currency" "Currency" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "source" "FinExpenseSource" NOT NULL,
    "requestId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacyExpenseId" TEXT,

    CONSTRAINT "FinExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinSettings" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "directLimitUsdCents" INTEGER,
    "directLimitZigCents" INTEGER,
    "requireReference" BOOLEAN NOT NULL DEFAULT true,
    "legacyRetired" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Fund_schoolId_idx" ON "Fund"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Fund_schoolId_code_key" ON "Fund"("schoolId", "code");

-- CreateIndex
CREATE INDEX "FinFeeItem_schoolId_termId_idx" ON "FinFeeItem"("schoolId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "FinCharge_legacyChargeId_key" ON "FinCharge"("legacyChargeId");

-- CreateIndex
CREATE INDEX "FinCharge_schoolId_studentId_idx" ON "FinCharge"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "FinCharge_schoolId_termId_idx" ON "FinCharge"("schoolId", "termId");

-- CreateIndex
CREATE INDEX "FinCharge_schoolId_fundId_idx" ON "FinCharge"("schoolId", "fundId");

-- CreateIndex
CREATE UNIQUE INDEX "FinCharge_studentId_feeItemId_key" ON "FinCharge"("studentId", "feeItemId");

-- CreateIndex
CREATE UNIQUE INDEX "FinPayment_legacyPaymentId_key" ON "FinPayment"("legacyPaymentId");

-- CreateIndex
CREATE INDEX "FinPayment_schoolId_studentId_idx" ON "FinPayment"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "FinPayment_schoolId_status_idx" ON "FinPayment"("schoolId", "status");

-- CreateIndex
CREATE INDEX "FinPayment_schoolId_receivedOn_idx" ON "FinPayment"("schoolId", "receivedOn");

-- CreateIndex
CREATE UNIQUE INDEX "FinPayment_schoolId_receiptNumber_key" ON "FinPayment"("schoolId", "receiptNumber");

-- CreateIndex
CREATE INDEX "FinPaymentAllocation_schoolId_paymentId_idx" ON "FinPaymentAllocation"("schoolId", "paymentId");

-- CreateIndex
CREATE INDEX "FinPaymentAllocation_schoolId_chargeId_idx" ON "FinPaymentAllocation"("schoolId", "chargeId");

-- CreateIndex
CREATE INDEX "FinAdjustment_schoolId_chargeId_idx" ON "FinAdjustment"("schoolId", "chargeId");

-- CreateIndex
CREATE INDEX "FinAdjustment_schoolId_status_idx" ON "FinAdjustment"("schoolId", "status");

-- CreateIndex
CREATE INDEX "FinRefund_schoolId_paymentId_idx" ON "FinRefund"("schoolId", "paymentId");

-- CreateIndex
CREATE INDEX "FinRefund_schoolId_status_idx" ON "FinRefund"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FinVoid_paymentId_key" ON "FinVoid"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "FinVoid_expenseId_key" ON "FinVoid"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "FinVoid_chargeId_key" ON "FinVoid"("chargeId");

-- CreateIndex
CREATE INDEX "FinVoid_schoolId_idx" ON "FinVoid"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "FinExpenseRequest_legacyRequestId_key" ON "FinExpenseRequest"("legacyRequestId");

-- CreateIndex
CREATE INDEX "FinExpenseRequest_schoolId_status_idx" ON "FinExpenseRequest"("schoolId", "status");

-- CreateIndex
CREATE INDEX "FinExpenseRequest_schoolId_requestedById_idx" ON "FinExpenseRequest"("schoolId", "requestedById");

-- CreateIndex
CREATE UNIQUE INDEX "FinExpenseRequest_schoolId_requestNumber_key" ON "FinExpenseRequest"("schoolId", "requestNumber");

-- CreateIndex
CREATE INDEX "FinExpenseRequestItem_requestId_idx" ON "FinExpenseRequestItem"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "FinExpense_requestId_key" ON "FinExpense"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "FinExpense_legacyExpenseId_key" ON "FinExpense"("legacyExpenseId");

-- CreateIndex
CREATE INDEX "FinExpense_schoolId_paidOn_idx" ON "FinExpense"("schoolId", "paidOn");

-- CreateIndex
CREATE INDEX "FinExpense_schoolId_fundId_idx" ON "FinExpense"("schoolId", "fundId");

-- CreateIndex
CREATE UNIQUE INDEX "FinSettings_schoolId_key" ON "FinSettings"("schoolId");

-- AddForeignKey
ALTER TABLE "FinFeeItem" ADD CONSTRAINT "FinFeeItem_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinFeeItem" ADD CONSTRAINT "FinFeeItem_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinCharge" ADD CONSTRAINT "FinCharge_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinCharge" ADD CONSTRAINT "FinCharge_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinCharge" ADD CONSTRAINT "FinCharge_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinCharge" ADD CONSTRAINT "FinCharge_feeItemId_fkey" FOREIGN KEY ("feeItemId") REFERENCES "FinFeeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinPayment" ADD CONSTRAINT "FinPayment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinPayment" ADD CONSTRAINT "FinPayment_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinPaymentAllocation" ADD CONSTRAINT "FinPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "FinPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinPaymentAllocation" ADD CONSTRAINT "FinPaymentAllocation_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "FinCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinAdjustment" ADD CONSTRAINT "FinAdjustment_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "FinCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinRefund" ADD CONSTRAINT "FinRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "FinPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinRefund" ADD CONSTRAINT "FinRefund_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "FinCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinVoid" ADD CONSTRAINT "FinVoid_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "FinPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinVoid" ADD CONSTRAINT "FinVoid_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "FinExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinVoid" ADD CONSTRAINT "FinVoid_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "FinCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinExpenseRequest" ADD CONSTRAINT "FinExpenseRequest_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinExpenseRequestItem" ADD CONSTRAINT "FinExpenseRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FinExpenseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinExpense" ADD CONSTRAINT "FinExpense_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinExpense" ADD CONSTRAINT "FinExpense_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FinExpenseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ═════════════════════════════════════════════════════════════════════════════
-- Finance core: foreign keys, permissions, row-level security, audit, same-school references, the closed-term lock for
-- billing, and the money rules the database keeps by itself:
--   * amounts are whole cents and positive;
--   * nothing financial is deleted, and only the workflow columns of a payment, adjustment, refund or request ever change;
--   * the person who records a payment cannot verify it; the person who raised an adjustment, refund or request cannot
--     approve it; the person who raised or approved a refund or request cannot pay it out (not even an administrator);
--   * an allocation, refund or adjustment can never exceed the money or the charge it is made against;
--   * funds are kept apart: a payment settles only charges of its own fund and currency;
--   * a void is its own row; a closed term takes no new charges (payments are still received against old balances).
-- (Existing fees, payments and expenses are moved in the next migration.)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Foreign keys that the Prisma schema keeps as plain ids ──────────────────
DO $$
DECLARE t text; spec text; tab text; col text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Fund', 'FinFeeItem', 'FinCharge', 'FinPayment', 'FinPaymentAllocation', 'FinAdjustment', 'FinRefund', 'FinVoid',
                           'FinExpenseRequest', 'FinExpenseRequestItem', 'FinExpense', 'FinSettings'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE', t, t || '_schoolId_fkey');
  END LOOP;
  FOREACH spec IN ARRAY ARRAY[
    'FinFeeItem.createdById', 'FinCharge.createdById', 'FinPayment.recordedById', 'FinPayment.verifiedById', 'FinPayment.rejectedById',
    'FinPaymentAllocation.createdById', 'FinAdjustment.createdById', 'FinAdjustment.decidedById', 'FinRefund.requestedById',
    'FinRefund.approvedById', 'FinRefund.rejectedById', 'FinRefund.paidById', 'FinVoid.voidedById', 'FinExpenseRequest.requestedById',
    'FinExpenseRequest.approvedById', 'FinExpenseRequest.rejectedById', 'FinExpenseRequest.disbursedById', 'FinExpense.recordedById'
  ] LOOP
    tab := split_part(spec, '.', 1);
    col := split_part(spec, '.', 2);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE', tab, tab || '_' || col || '_fkey', col);
  END LOOP;
END $$;
ALTER TABLE "FinPayment" ADD CONSTRAINT "FinPayment_targetChargeId_fkey" FOREIGN KEY ("targetChargeId") REFERENCES "FinCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinFeeItem" ADD CONSTRAINT "FinFeeItem_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Permission keys ─────────────────────────────────────────────────────────
INSERT INTO "Permission" ("key", "module", "description") VALUES
  ('finance.fees.view',           'finance', 'View fees'),
  ('finance.payments.view',       'finance', 'View payments'),
  ('finance.expenses.view',       'finance', 'View expenses'),
  ('finance.requests.view',       'finance', 'View expense requests'),
  ('finance.rates.view',          'finance', 'View exchange rates'),
  ('finance.reports.view',        'finance', 'View finance reports'),
  ('finance.accounts.view',       'finance', 'See student accounts and statements'),
  ('finance.funds.manage',        'finance', 'Add and change funds'),
  ('finance.fees.manage',         'finance', 'Set the fees of a term'),
  ('finance.charges.create',      'finance', 'Charge fees to students'),
  ('finance.charges.void',        'finance', 'Void a charge made in error'),
  ('finance.payments.record',     'finance', 'Record payments received'),
  ('finance.payments.verify',     'finance', 'Verify or reject payments recorded by someone else'),
  ('finance.payments.void',       'finance', 'Void a payment'),
  ('finance.adjustments.create',  'finance', 'Ask for a credit note, discount, bursary or waiver'),
  ('finance.adjustments.approve', 'finance', 'Approve or reject credit notes and discounts'),
  ('finance.refunds.request',     'finance', 'Ask for a refund'),
  ('finance.refunds.approve',     'finance', 'Approve or reject refunds'),
  ('finance.refunds.pay',         'finance', 'Pay out an approved refund'),
  ('finance.requests.create',     'finance', 'Raise expense requests'),
  ('finance.requests.approve',    'finance', 'Approve or reject expense requests'),
  ('finance.requests.disburse',   'finance', 'Pay out an approved expense request'),
  ('finance.expenses.record',     'finance', 'Record a direct expense'),
  ('finance.expenses.void',       'finance', 'Void an expense'),
  ('finance.settings.manage',     'finance', 'Change the money controls'),
  ('finance.reports.export',      'finance', 'Export finance reports')
ON CONFLICT ("key") DO NOTHING;

CREATE OR REPLACE FUNCTION finance_role_keys(role_key text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE role_key
    WHEN 'BURSAR' THEN ARRAY['finance.fees.view', 'finance.fees.manage', 'finance.accounts.view', 'finance.charges.create', 'finance.payments.view',
                             'finance.payments.record', 'finance.payments.verify', 'finance.expenses.view', 'finance.expenses.record',
                             'finance.requests.view', 'finance.requests.create', 'finance.requests.disburse', 'finance.adjustments.create',
                             'finance.refunds.request', 'finance.refunds.pay', 'finance.rates.view', 'finance.reports.view', 'finance.reports.export']
    WHEN 'ACCOUNTS_CLERK' THEN ARRAY['finance.fees.view', 'finance.accounts.view', 'finance.payments.view', 'finance.payments.record',
                                     'finance.requests.view', 'finance.requests.create']
    WHEN 'HEAD' THEN ARRAY['finance.fees.view', 'finance.accounts.view', 'finance.payments.view', 'finance.payments.verify', 'finance.adjustments.approve',
                           'finance.refunds.approve', 'finance.expenses.view', 'finance.requests.view', 'finance.requests.create', 'finance.requests.approve',
                           'finance.funds.manage', 'finance.rates.view', 'finance.reports.view', 'finance.reports.export']
    WHEN 'DEPUTY_HEAD' THEN ARRAY['finance.requests.create', 'finance.fees.view']
    WHEN 'TEACHER' THEN ARRAY['finance.requests.create']
    WHEN 'CLASS_TEACHER' THEN ARRAY['finance.requests.create']
    WHEN 'HOD' THEN ARRAY['finance.requests.create']
    WHEN 'EXAMS_OFFICER' THEN ARRAY['finance.requests.create']
    WHEN 'LIBRARIAN' THEN ARRAY['finance.requests.create']
    WHEN 'HR_OFFICER' THEN ARRAY['finance.requests.create']
    WHEN 'BOARDING_MASTER' THEN ARRAY['finance.requests.create']
    ELSE ARRAY[]::text[]
  END
$$;

-- A school created from now on starts with them.
CREATE OR REPLACE FUNCTION seed_school_roles(sid text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "RoleDefinition" ("id", "schoolId", "key", "name", "description", "isSystem", "updatedAt")
  SELECT gen_random_uuid()::text, sid, v.k, v.n, v.d, true, CURRENT_TIMESTAMP
    FROM (VALUES
      ('OWNER',           'Owner',              'Owns the school. Full access to everything.'),
      ('HEAD',            'Head',               'The head of the school. Oversees teaching, staff and finance.'),
      ('DEPUTY_HEAD',     'Deputy Head',        'Supports the head and runs day-to-day discipline and timetabling.'),
      ('ADMINISTRATOR',   'Administrator',      'Runs the system for the school: users, settings, calendar and records.'),
      ('BURSAR',          'Bursar',             'Manages fees, payments, expenses and the school accounts.'),
      ('ACCOUNTS_CLERK',  'Accounts Clerk',     'Records payments and keeps the daily accounts under the bursar.'),
      ('HR_OFFICER',      'HR Officer',         'Looks after staff records, leave and payroll.'),
      ('HOD',             'Head of Department', 'Leads a subject department and its teachers.'),
      ('TEACHER',         'Teacher',            'Teaches classes and enters marks for their subjects.'),
      ('CLASS_TEACHER',   'Class Teacher',      'Looks after one class: register, remarks and report cards.'),
      ('EXAMS_OFFICER',   'Exams Officer',      'Runs internal and ZIMSEC examinations and their results.'),
      ('LIBRARIAN',       'Librarian',          'Runs the library: books, borrowing and fines.'),
      ('BOARDING_MASTER', 'Boarding Master',    'Looks after the boarding hostels and the boarders.')
    ) AS v(k, n, d)
  ON CONFLICT ("schoolId", "key") DO NOTHING;

  INSERT INTO "RolePermission" ("id", "schoolId", "roleId", "permissionKey")
  SELECT gen_random_uuid()::text, sid, rd."id", p.k
    FROM "RoleDefinition" rd
    CROSS JOIN LATERAL unnest(
      CASE WHEN rd."key" IN ('OWNER', 'ADMINISTRATOR')
           THEN ARRAY['*', 'system.dashboard.view', 'system.calendar.view']
           ELSE ARRAY['system.dashboard.view', 'system.calendar.view'] || academics_role_keys(rd."key") || exams_role_keys(rd."key") || finance_role_keys(rd."key") END) AS p(k)
   WHERE rd."schoolId" = sid
  ON CONFLICT ("roleId", "permissionKey") DO NOTHING;
END;
$$;

-- ── Which module an audit entry belongs to ──────────────────────────────────
CREATE OR REPLACE FUNCTION audit_module(entity text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN entity IN ('Student', 'Guardian', 'StudentGuardian', 'Enrolment', 'Enrollment', 'Absence', 'House', 'ClassMove',
                    'PromotionRun', 'Intake', 'Application', 'StudentDocument', 'DisciplineIncident', 'IncidentStudent',
                    'DisciplineAction', 'MedicalProfile', 'MedicationEntry', 'SickBayVisit', 'StudentExit', 'Alumnus') THEN 'students'
    WHEN entity IN ('SubjectAssignment', 'Subject', 'Timetable', 'AcademicsSettings', 'ClassTeacher', 'Department', 'SubjectLevel',
                    'SubjectChange', 'SubjectCombination', 'SubjectCombinationItem', 'SubjectCombinationClass', 'StudentSubject',
                    'TeachingGroup', 'TeachingGroupStudent', 'TeacherAssignment', 'AssignmentSet', 'BellSchedule', 'Period', 'Room',
                    'TimetableSlot', 'TeacherAvailability', 'CoverLesson', 'AttendanceRegister', 'AttendanceEntry', 'MessageOutbox',
                    'SyllabusTopic', 'SyllabusTemplate', 'SchemeOfWork', 'SchemeWeek', 'RecordOfWork', 'LessonPlan') THEN 'academics'
    WHEN entity IN ('Mark', 'TermResult', 'ReportCard', 'MarkChange',
                    'AssessmentType', 'WeightingPlan', 'WeightingPlanItem', 'WeightingPlanItemType', 'ProjectTemplate', 'ProjectStage',
                    'Rubric', 'RubricCriterion', 'RubricLevel', 'Assessment', 'AssessmentTopic', 'AssessmentMark', 'RubricScore',
                    'MarkEvidence', 'AssessmentMarkChange', 'MarkSheet', 'MarkSheetEvent', 'SheetStudentComment', 'SubjectResult',
                    'ReportComment', 'CommentBankItem', 'ExamSettings', 'ExamDeadline', 'ExamDepartmentVerifier',
                    'ExamPeriod', 'ExamPaper', 'ExamPaperRoom', 'Invigilation', 'ExamAttendance', 'ExamIncident',
                    'BoardSession', 'BoardSubjectCode', 'Candidate', 'CandidateEntry', 'BoardResult', 'BoardAmendment') THEN 'exams'
    WHEN entity IN ('Payment', 'Expense', 'ExpenseRequest', 'Charge', 'FeeStructure', 'Income', 'ExchangeRate',
                    'Fund', 'FinFeeItem', 'FinCharge', 'FinPayment', 'FinPaymentAllocation', 'FinAdjustment', 'FinRefund', 'FinVoid',
                    'FinExpenseRequest', 'FinExpenseRequestItem', 'FinExpense', 'FinSettings') THEN 'finance'
    WHEN entity IN ('Asset', 'AssetTransfer', 'Book', 'BookCopy', 'Borrowing', 'LibraryMember') THEN 'facilities'
    ELSE 'system'
  END
$$;

-- ── Row-level security and the row-change audit ─────────────────────────────
-- Every change to these tables writes an AuditLog row (who, before, after) in the same transaction, in addition to the
-- business entries the services write.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Fund', 'FinFeeItem', 'FinCharge', 'FinPayment', 'FinPaymentAllocation', 'FinAdjustment', 'FinRefund', 'FinVoid',
                           'FinExpenseRequest', 'FinExpenseRequestItem', 'FinExpense', 'FinSettings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY school_isolation ON %I USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"))', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', 'audit_' || t, t);
  END LOOP;
END $$;

-- ── Same-school references ──────────────────────────────────────────────────
CREATE TRIGGER "same_school_FinFeeItem" BEFORE INSERT OR UPDATE OF "termId", "fundId", "createdById", "levelId" ON "FinFeeItem"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('termId:AcademicTerm', 'fundId:Fund', 'createdById:User', 'levelId:Level');
CREATE TRIGGER "same_school_FinCharge" BEFORE INSERT OR UPDATE OF "studentId", "termId", "fundId", "feeItemId", "createdById" ON "FinCharge"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student', 'termId:AcademicTerm', 'fundId:Fund', 'feeItemId:FinFeeItem', 'createdById:User');
CREATE TRIGGER "same_school_FinPayment" BEFORE INSERT OR UPDATE OF "studentId", "fundId", "targetChargeId", "recordedById", "verifiedById", "rejectedById" ON "FinPayment"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student', 'fundId:Fund', 'targetChargeId:FinCharge', 'recordedById:User', 'verifiedById:User', 'rejectedById:User');
CREATE TRIGGER "same_school_FinPaymentAllocation" BEFORE INSERT OR UPDATE OF "paymentId", "chargeId", "createdById" ON "FinPaymentAllocation"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('paymentId:FinPayment', 'chargeId:FinCharge', 'createdById:User');
CREATE TRIGGER "same_school_FinAdjustment" BEFORE INSERT OR UPDATE OF "chargeId", "createdById", "decidedById" ON "FinAdjustment"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('chargeId:FinCharge', 'createdById:User', 'decidedById:User');
CREATE TRIGGER "same_school_FinRefund" BEFORE INSERT OR UPDATE OF "paymentId", "chargeId", "requestedById", "approvedById", "rejectedById", "paidById" ON "FinRefund"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('paymentId:FinPayment', 'chargeId:FinCharge', 'requestedById:User', 'approvedById:User', 'rejectedById:User', 'paidById:User');
CREATE TRIGGER "same_school_FinVoid" BEFORE INSERT OR UPDATE OF "paymentId", "expenseId", "chargeId", "voidedById" ON "FinVoid"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('paymentId:FinPayment', 'expenseId:FinExpense', 'chargeId:FinCharge', 'voidedById:User');
CREATE TRIGGER "same_school_FinExpenseRequest" BEFORE INSERT OR UPDATE OF "fundId", "requestedById", "approvedById", "rejectedById", "disbursedById" ON "FinExpenseRequest"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('fundId:Fund', 'requestedById:User', 'approvedById:User', 'rejectedById:User', 'disbursedById:User');
CREATE TRIGGER "same_school_FinExpenseRequestItem" BEFORE INSERT OR UPDATE OF "requestId" ON "FinExpenseRequestItem"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('requestId:FinExpenseRequest');
CREATE TRIGGER "same_school_FinExpense" BEFORE INSERT OR UPDATE OF "fundId", "requestId", "recordedById" ON "FinExpense"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('fundId:Fund', 'requestId:FinExpenseRequest', 'recordedById:User');

-- ── Closed terms are locked for billing; payments are still received against old balances ──
-- A new charge, and a change to a fee, cannot be made in a CLOSED term (the Director can reopen it). Payments, allocations,
-- credit notes and refunds carry no such lock.
CREATE TRIGGER "closed_term_FinCharge"  BEFORE INSERT ON "FinCharge" FOR EACH ROW EXECUTE FUNCTION academics_closed_term_guard();
CREATE TRIGGER "closed_term_FinFeeItem" BEFORE INSERT OR UPDATE ON "FinFeeItem" FOR EACH ROW EXECUTE FUNCTION academics_closed_term_guard();

-- ── Amounts are whole, positive cents; who did what is always recorded ──────
ALTER TABLE "FinFeeItem" ADD CONSTRAINT "FinFeeItem_amount" CHECK ("amountCents" > 0 AND btrim("name") <> '');
ALTER TABLE "FinCharge" ADD CONSTRAINT "FinCharge_amount" CHECK ("amountCents" > 0 AND btrim("description") <> '');
ALTER TABLE "FinPayment"
  ADD CONSTRAINT "FinPayment_amount" CHECK ("amountCents" > 0),
  ADD CONSTRAINT "FinPayment_verified_has_person" CHECK (("status" = 'VERIFIED') = ("verifiedById" IS NOT NULL AND "verifiedAt" IS NOT NULL)),
  ADD CONSTRAINT "FinPayment_rejected_has_person" CHECK (("status" = 'REJECTED') = ("rejectedById" IS NOT NULL AND "rejectedAt" IS NOT NULL AND btrim(coalesce("rejectionReason", '')) <> '')),
  ADD CONSTRAINT "FinPayment_fallback_only_verified" CHECK ("verifierFallback" = false OR "status" = 'VERIFIED');
ALTER TABLE "FinPaymentAllocation" ADD CONSTRAINT "FinPaymentAllocation_amount" CHECK ("amountCents" > 0);
ALTER TABLE "FinAdjustment"
  ADD CONSTRAINT "FinAdjustment_amount" CHECK ("amountCents" > 0 AND char_length(btrim("reason")) >= 5),
  ADD CONSTRAINT "FinAdjustment_decided_has_person" CHECK (("status" = 'PENDING') = ("decidedById" IS NULL AND "decidedAt" IS NULL));
ALTER TABLE "FinRefund"
  ADD CONSTRAINT "FinRefund_amount" CHECK ("amountCents" > 0 AND char_length(btrim("reason")) >= 5),
  ADD CONSTRAINT "FinRefund_approved_has_person" CHECK ("status" NOT IN ('APPROVED', 'PAID') OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL)),
  ADD CONSTRAINT "FinRefund_rejected_has_person" CHECK ("status" <> 'REJECTED' OR ("rejectedById" IS NOT NULL AND "rejectedAt" IS NOT NULL AND btrim(coalesce("rejectionReason", '')) <> '')),
  ADD CONSTRAINT "FinRefund_paid_has_person" CHECK (("status" = 'PAID') = ("paidById" IS NOT NULL AND "paidAt" IS NOT NULL AND "method" IS NOT NULL));
ALTER TABLE "FinVoid"
  ADD CONSTRAINT "FinVoid_one_target" CHECK ((("paymentId" IS NOT NULL)::int + ("expenseId" IS NOT NULL)::int + ("chargeId" IS NOT NULL)::int) = 1),
  ADD CONSTRAINT "FinVoid_reason" CHECK (char_length(btrim("reason")) >= 10);
ALTER TABLE "FinExpenseRequest"
  ADD CONSTRAINT "FinExpenseRequest_amount" CHECK ("estimatedCents" > 0),
  ADD CONSTRAINT "FinExpenseRequest_submitted" CHECK ("status" = 'DRAFT' OR "submittedAt" IS NOT NULL),
  ADD CONSTRAINT "FinExpenseRequest_approved_has_person" CHECK ("status" NOT IN ('APPROVED', 'DISBURSED') OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL)),
  ADD CONSTRAINT "FinExpenseRequest_rejected_has_person" CHECK ("status" <> 'REJECTED' OR ("rejectedById" IS NOT NULL AND "rejectedAt" IS NOT NULL AND btrim(coalesce("rejectionReason", '')) <> '')),
  ADD CONSTRAINT "FinExpenseRequest_paid_has_person" CHECK (("status" = 'DISBURSED') = ("disbursedById" IS NOT NULL AND "disbursedAt" IS NOT NULL));
ALTER TABLE "FinExpenseRequestItem"
  ADD CONSTRAINT "FinExpenseRequestItem_amounts" CHECK ("quantity" >= 1 AND "unitCents" >= 0 AND "totalCents" = "quantity" * "unitCents");
ALTER TABLE "FinExpense"
  ADD CONSTRAINT "FinExpense_amount" CHECK ("amountCents" > 0),
  ADD CONSTRAINT "FinExpense_source" CHECK (("source" = 'REQUEST' AND "requestId" IS NOT NULL) OR ("source" = 'DIRECT' AND "requestId" IS NULL) OR ("source" = 'MIGRATED' AND "legacyExpenseId" IS NOT NULL));
ALTER TABLE "FinSettings"
  ADD CONSTRAINT "FinSettings_limits" CHECK (coalesce("directLimitUsdCents", 0) >= 0 AND coalesce("directLimitZigCents", 0) >= 0);

-- ── Nothing financial is deleted; most rows are never changed ───────────────
CREATE OR REPLACE FUNCTION fin_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted. Fix a mistake with a new row (a void, a credit note, an adjustment or a refund).', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;
CREATE OR REPLACE FUNCTION fin_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows can only be added, never changed or deleted. Fix a mistake with a new row (a void, a credit note, an adjustment or a refund).', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;
-- Only the named columns may change (the workflow columns); everything else is fixed.
CREATE OR REPLACE FUNCTION fin_immutable_except() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - TG_ARGV) IS DISTINCT FROM (to_jsonb(OLD) - TG_ARGV) THEN
    RAISE EXCEPTION '% rows cannot be edited. Fix a mistake with a new row (a void, a credit note, an adjustment or a refund).', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "append_only_FinCharge"            BEFORE UPDATE OR DELETE ON "FinCharge"            FOR EACH ROW EXECUTE FUNCTION fin_append_only();
CREATE TRIGGER "append_only_FinPaymentAllocation" BEFORE UPDATE OR DELETE ON "FinPaymentAllocation" FOR EACH ROW EXECUTE FUNCTION fin_append_only();
CREATE TRIGGER "append_only_FinVoid"              BEFORE UPDATE OR DELETE ON "FinVoid"              FOR EACH ROW EXECUTE FUNCTION fin_append_only();
CREATE TRIGGER "append_only_FinExpense"           BEFORE UPDATE OR DELETE ON "FinExpense"           FOR EACH ROW EXECUTE FUNCTION fin_append_only();
CREATE TRIGGER "no_delete_FinPayment"    BEFORE DELETE ON "FinPayment"    FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "no_delete_FinAdjustment" BEFORE DELETE ON "FinAdjustment" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "no_delete_FinRefund"     BEFORE DELETE ON "FinRefund"     FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "no_delete_FinFeeItem"    BEFORE DELETE ON "FinFeeItem"    FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "no_delete_Fund"          BEFORE DELETE ON "Fund"          FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "no_delete_FinSettings"   BEFORE DELETE ON "FinSettings"   FOR EACH ROW EXECUTE FUNCTION fin_no_delete();

CREATE TRIGGER "immutable_FinPayment" BEFORE UPDATE ON "FinPayment" FOR EACH ROW
  EXECUTE FUNCTION fin_immutable_except('status', 'verifiedById', 'verifiedAt', 'verifierFallback', 'rejectedById', 'rejectedAt', 'rejectionReason');
CREATE TRIGGER "immutable_FinAdjustment" BEFORE UPDATE ON "FinAdjustment" FOR EACH ROW
  EXECUTE FUNCTION fin_immutable_except('status', 'decidedById', 'decidedAt', 'decisionNote');
CREATE TRIGGER "immutable_FinRefund" BEFORE UPDATE ON "FinRefund" FOR EACH ROW
  EXECUTE FUNCTION fin_immutable_except('status', 'approvedById', 'approvedAt', 'rejectedById', 'rejectedAt', 'rejectionReason', 'paidById', 'paidAt', 'method', 'reference');
CREATE TRIGGER "immutable_Fund" BEFORE UPDATE ON "Fund" FOR EACH ROW
  EXECUTE FUNCTION fin_immutable_except('name', 'active', 'sortOrder', 'updatedAt');

-- ── Fees: once a charge was made from a fee, what it costs and for whom is fixed ──
CREATE OR REPLACE FUNCTION fin_fee_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."termId", NEW."levelId", NEW."boarding", NEW."fundId", NEW."currency", NEW."amountCents")
     IS DISTINCT FROM (OLD."termId", OLD."levelId", OLD."boarding", OLD."fundId", OLD."currency", OLD."amountCents")
     AND EXISTS (SELECT 1 FROM "FinCharge" WHERE "feeItemId" = NEW."id") THEN
    RAISE EXCEPTION 'Students have already been charged this fee, so its amount cannot change. Add a new fee line instead.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FinFeeItem" BEFORE UPDATE ON "FinFeeItem" FOR EACH ROW EXECUTE FUNCTION fin_fee_item_guard();

-- ── A charge made from a fee line has that fee's term, fund, currency and amount ──
CREATE OR REPLACE FUNCTION fin_charge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f "FinFeeItem"%ROWTYPE;
BEGIN
  IF NEW."feeItemId" IS NOT NULL THEN
    SELECT * INTO f FROM "FinFeeItem" WHERE "id" = NEW."feeItemId";
    IF f."termId" <> NEW."termId" OR f."fundId" <> NEW."fundId" OR f."currency" <> NEW."currency" OR f."amountCents" <> NEW."amountCents" THEN
      RAISE EXCEPTION 'A charge made from a fee line must have that fee''s term, fund, currency and amount' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FinCharge" BEFORE INSERT ON "FinCharge" FOR EACH ROW EXECUTE FUNCTION fin_charge_guard();

-- ── A payment: starts pending; verified or rejected once, by someone other than the person who recorded it ──
CREATE OR REPLACE FUNCTION fin_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' THEN
      RAISE EXCEPTION 'A payment is recorded as pending; someone else must verify it' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN RETURN NEW; END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'A payment that was verified or rejected cannot be changed. Void it and record a new one.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'VERIFIED' AND NEW."verifiedById" = NEW."recordedById" THEN
    RAISE EXCEPTION 'You recorded this payment, so someone else must verify it.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'REJECTED' AND NEW."rejectedById" = NEW."recordedById" THEN
    RAISE EXCEPTION 'You recorded this payment, so someone else must decide on it.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FinPayment" BEFORE INSERT OR UPDATE ON "FinPayment" FOR EACH ROW EXECUTE FUNCTION fin_payment_guard();

-- ── An allocation: only a verified, unvoided payment; never more than the payment holds or the charge still owes; one fund, one currency ──
CREATE OR REPLACE FUNCTION fin_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p    "FinPayment"%ROWTYPE;
  c    "FinCharge"%ROWTYPE;
  used bigint;
  eff  bigint;
  adj  bigint;
BEGIN
  SELECT * INTO p FROM "FinPayment" WHERE "id" = NEW."paymentId" FOR UPDATE;
  SELECT * INTO c FROM "FinCharge"  WHERE "id" = NEW."chargeId"  FOR UPDATE;
  IF p."status" <> 'VERIFIED' THEN
    RAISE EXCEPTION 'A payment settles a charge only after it has been verified' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "FinVoid" WHERE "paymentId" = p."id") OR EXISTS (SELECT 1 FROM "FinVoid" WHERE "chargeId" = c."id") THEN
    RAISE EXCEPTION 'A voided payment or charge cannot be allocated' USING ERRCODE = 'check_violation';
  END IF;
  IF p."studentId" <> c."studentId" THEN
    RAISE EXCEPTION 'A payment can only settle charges of the same student' USING ERRCODE = 'check_violation';
  END IF;
  IF p."currency" <> c."currency" THEN
    RAISE EXCEPTION 'A % payment cannot settle a % charge. The two currencies are never mixed.', p."currency", c."currency" USING ERRCODE = 'check_violation';
  END IF;
  IF p."fundId" <> c."fundId" THEN
    RAISE EXCEPTION 'A payment can only settle charges of its own fund' USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum("amountCents"), 0) INTO used FROM "FinPaymentAllocation" WHERE "paymentId" = p."id";
  used := used + (SELECT coalesce(sum("amountCents"), 0) FROM "FinRefund" WHERE "paymentId" = p."id" AND "chargeId" IS NULL AND "status" <> 'REJECTED');
  IF used + NEW."amountCents" > p."amountCents" THEN
    RAISE EXCEPTION 'The payment has only % cents left to allocate', p."amountCents" - used USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum("amountCents"), 0) INTO eff FROM "FinPaymentAllocation" WHERE "chargeId" = c."id";
  eff := eff - (SELECT coalesce(sum("amountCents"), 0) FROM "FinRefund" WHERE "chargeId" = c."id" AND "status" = 'PAID');
  SELECT coalesce(sum("amountCents"), 0) INTO adj FROM "FinAdjustment" WHERE "chargeId" = c."id" AND "status" = 'APPROVED';
  IF eff + adj + NEW."amountCents" > c."amountCents" THEN
    RAISE EXCEPTION 'The charge only has % cents left to pay', c."amountCents" - eff - adj USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FinPaymentAllocation" BEFORE INSERT ON "FinPaymentAllocation" FOR EACH ROW EXECUTE FUNCTION fin_allocation_guard();

-- ── An adjustment: lowers a charge once a second person approves; never below what is left of it ──
CREATE OR REPLACE FUNCTION fin_adjustment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  c    "FinCharge"%ROWTYPE;
  eff  bigint;
  adj  bigint;
BEGIN
  SELECT * INTO c FROM "FinCharge" WHERE "id" = NEW."chargeId" FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' THEN
      RAISE EXCEPTION 'An adjustment is asked for as pending; someone else must approve it' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "FinVoid" WHERE "chargeId" = c."id") THEN
      RAISE EXCEPTION 'This charge was voided, so it cannot be adjusted' USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(sum("amountCents"), 0) INTO adj FROM "FinAdjustment" WHERE "chargeId" = c."id" AND "status" IN ('PENDING', 'APPROVED');
    IF adj + NEW."amountCents" > c."amountCents" THEN
      RAISE EXCEPTION 'Adjustments cannot be more than the charge (% cents)', c."amountCents" USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN RETURN NEW; END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'This adjustment has already been decided' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."decidedById" = NEW."createdById" THEN
    RAISE EXCEPTION 'You asked for this adjustment, so someone else must decide on it.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'APPROVED' THEN
    SELECT coalesce(sum("amountCents"), 0) INTO eff FROM "FinPaymentAllocation" WHERE "chargeId" = c."id";
    eff := eff - (SELECT coalesce(sum("amountCents"), 0) FROM "FinRefund" WHERE "chargeId" = c."id" AND "status" = 'PAID');
    SELECT coalesce(sum("amountCents"), 0) INTO adj FROM "FinAdjustment" WHERE "chargeId" = c."id" AND "status" = 'APPROVED' AND "id" <> NEW."id";
    IF eff + adj + NEW."amountCents" > c."amountCents" THEN
      RAISE EXCEPTION 'The charge has been paid in the meantime, so this adjustment is now more than what is left of it' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FinAdjustment" BEFORE INSERT OR UPDATE ON "FinAdjustment" FOR EACH ROW EXECUTE FUNCTION fin_adjustment_guard();

-- ── A refund: asked, approved by a second person, paid out by a third; never more than the payment settled or holds ──
CREATE OR REPLACE FUNCTION fin_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p     "FinPayment"%ROWTYPE;
  c     "FinCharge"%ROWTYPE;
  alloc bigint;
  other bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO p FROM "FinPayment" WHERE "id" = NEW."paymentId" FOR UPDATE;
    IF NEW."status" <> 'REQUESTED' THEN
      RAISE EXCEPTION 'A refund is asked for first; someone else must approve it' USING ERRCODE = 'check_violation';
    END IF;
    IF p."status" <> 'VERIFIED' OR EXISTS (SELECT 1 FROM "FinVoid" WHERE "paymentId" = p."id") THEN
      RAISE EXCEPTION 'Only a verified payment that has not been voided can be refunded' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."chargeId" IS NOT NULL THEN
      SELECT * INTO c FROM "FinCharge" WHERE "id" = NEW."chargeId";
      IF c."studentId" <> p."studentId" THEN
        RAISE EXCEPTION 'The charge belongs to another student' USING ERRCODE = 'check_violation';
      END IF;
      SELECT coalesce(sum("amountCents"), 0) INTO alloc FROM "FinPaymentAllocation" WHERE "paymentId" = p."id" AND "chargeId" = c."id";
      SELECT coalesce(sum("amountCents"), 0) INTO other FROM "FinRefund" WHERE "paymentId" = p."id" AND "chargeId" = c."id" AND "status" <> 'REJECTED';
      IF NEW."amountCents" > alloc - other THEN
        RAISE EXCEPTION 'Only % cents of this payment can still be refunded against this charge', alloc - other USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      SELECT coalesce(sum("amountCents"), 0) INTO alloc FROM "FinPaymentAllocation" WHERE "paymentId" = p."id";
      SELECT coalesce(sum("amountCents"), 0) INTO other FROM "FinRefund" WHERE "paymentId" = p."id" AND "chargeId" IS NULL AND "status" <> 'REJECTED';
      IF NEW."amountCents" > p."amountCents" - alloc - other THEN
        RAISE EXCEPTION 'Only % cents of this payment are unallocated credit that can be refunded', p."amountCents" - alloc - other USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN RETURN NEW; END IF;
  IF NOT ((OLD."status" = 'REQUESTED' AND NEW."status" IN ('APPROVED', 'REJECTED')) OR (OLD."status" = 'APPROVED' AND NEW."status" = 'PAID')) THEN
    RAISE EXCEPTION 'A refund cannot go from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IN ('APPROVED', 'REJECTED') AND coalesce(NEW."approvedById", NEW."rejectedById") = NEW."requestedById" THEN
    RAISE EXCEPTION 'You asked for this refund, so someone else must decide on it.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'PAID' THEN
    IF NEW."paidById" IN (NEW."requestedById", NEW."approvedById") THEN
      RAISE EXCEPTION 'The person who asked for or approved a refund cannot pay it out.' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "FinVoid" WHERE "paymentId" = NEW."paymentId") THEN
      RAISE EXCEPTION 'The payment was voided, so the refund cannot be paid' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FinRefund" BEFORE INSERT OR UPDATE ON "FinRefund" FOR EACH ROW EXECUTE FUNCTION fin_refund_guard();

-- ── A void: its own row; not by the person who recorded the money; never when later rows depend on it ──
CREATE OR REPLACE FUNCTION fin_void_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p "FinPayment"%ROWTYPE;
  e "FinExpense"%ROWTYPE;
  c "FinCharge"%ROWTYPE;
  tname text;
BEGIN
  IF NEW."paymentId" IS NOT NULL THEN
    SELECT * INTO p FROM "FinPayment" WHERE "id" = NEW."paymentId" FOR UPDATE;
    IF p."status" = 'REJECTED' THEN
      RAISE EXCEPTION 'A rejected payment never counted, so there is nothing to void' USING ERRCODE = 'check_violation';
    END IF;
    IF p."recordedById" = NEW."voidedById" THEN
      RAISE EXCEPTION 'You recorded this payment, so someone else must void it.' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "FinRefund" WHERE "paymentId" = p."id" AND "status" <> 'REJECTED') THEN
      RAISE EXCEPTION 'This payment has a refund against it, so it cannot be voided' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW."expenseId" IS NOT NULL THEN
    SELECT * INTO e FROM "FinExpense" WHERE "id" = NEW."expenseId" FOR UPDATE;
    IF e."recordedById" = NEW."voidedById" THEN
      RAISE EXCEPTION 'You recorded this expense, so someone else must void it.' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT * INTO c FROM "FinCharge" WHERE "id" = NEW."chargeId" FOR UPDATE;
    SELECT "name" INTO tname FROM "AcademicTerm" WHERE "id" = c."termId" AND "status" = 'CLOSED';
    IF tname IS NOT NULL THEN
      RAISE EXCEPTION '% is closed, so its charges cannot be voided. Use a credit note.', tname USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "FinPaymentAllocation" a WHERE a."chargeId" = c."id" AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = a."paymentId"))
       OR EXISTS (SELECT 1 FROM "FinAdjustment" WHERE "chargeId" = c."id" AND "status" <> 'REJECTED') THEN
      RAISE EXCEPTION 'This charge has payments or adjustments against it, so it cannot be voided. Use a credit note.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FinVoid" BEFORE INSERT ON "FinVoid" FOR EACH ROW EXECUTE FUNCTION fin_void_guard();

-- ── An expense request: draft, pending, approved by someone else, paid by a third person ──
CREATE OR REPLACE FUNCTION fin_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sum_items bigint;
  n_items   int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Only a draft request can be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'A request starts as a draft' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW."id", NEW."schoolId", NEW."requestNumber", NEW."requestedById", NEW."createdAt", NEW."legacyRequestId")
     IS DISTINCT FROM (OLD."id", OLD."schoolId", OLD."requestNumber", OLD."requestedById", OLD."createdAt", OLD."legacyRequestId") THEN
    RAISE EXCEPTION 'The number and the person who raised a request cannot change' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."status" = 'DRAFT' THEN
    IF NEW."status" NOT IN ('DRAFT', 'PENDING') THEN
      RAISE EXCEPTION 'A draft request must be submitted before it is approved' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."status" = 'PENDING' THEN
      SELECT coalesce(sum("totalCents"), 0), count(*) INTO sum_items, n_items FROM "FinExpenseRequestItem" WHERE "requestId" = NEW."id";
      IF n_items = 0 OR sum_items <> NEW."estimatedCents" THEN
        RAISE EXCEPTION 'A request needs at least one line, and its total must equal the lines added up' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- After submission only the workflow columns move.
  IF (to_jsonb(NEW) - ARRAY['status', 'submittedAt', 'approvedById', 'approvedAt', 'rejectedById', 'rejectedAt', 'rejectionReason', 'disbursedById', 'disbursedAt'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'submittedAt', 'approvedById', 'approvedAt', 'rejectedById', 'rejectedAt', 'rejectionReason', 'disbursedById', 'disbursedAt']) THEN
    RAISE EXCEPTION 'A submitted request cannot be edited. Reject it and raise a new one.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN RETURN NEW; END IF;
  IF NOT ((OLD."status" = 'PENDING' AND NEW."status" IN ('APPROVED', 'REJECTED')) OR (OLD."status" = 'APPROVED' AND NEW."status" = 'DISBURSED')) THEN
    RAISE EXCEPTION 'A request cannot go from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'APPROVED' AND NEW."approvedById" = NEW."requestedById" THEN
    RAISE EXCEPTION 'You raised this request, so someone else must approve it.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'REJECTED' AND NEW."rejectedById" = NEW."requestedById" THEN
    RAISE EXCEPTION 'You raised this request, so someone else must reject it.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'DISBURSED' THEN
    IF NEW."disbursedById" IN (NEW."requestedById", NEW."approvedById") THEN
      RAISE EXCEPTION 'The person who raised or approved a request cannot pay it out.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "FinExpense" WHERE "requestId" = NEW."id" AND "recordedById" = NEW."disbursedById") THEN
      RAISE EXCEPTION 'A request is paid only by recording the expense' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FinExpenseRequest" BEFORE INSERT OR UPDATE OR DELETE ON "FinExpenseRequest" FOR EACH ROW EXECUTE FUNCTION fin_request_guard();

CREATE OR REPLACE FUNCTION fin_request_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st "RequestStatus";
BEGIN
  SELECT "status" INTO st FROM "FinExpenseRequest" WHERE "id" = (COALESCE(to_jsonb(NEW), to_jsonb(OLD)) ->> 'requestId');
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'The lines of a submitted request cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FinExpenseRequestItem" BEFORE INSERT OR UPDATE OR DELETE ON "FinExpenseRequestItem" FOR EACH ROW EXECUTE FUNCTION fin_request_item_guard();

-- ── An expense exists only when an approved request is paid (by a third person) or the bursar records a direct one ──
CREATE OR REPLACE FUNCTION fin_expense_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "FinExpenseRequest"%ROWTYPE;
BEGIN
  IF NEW."source" = 'REQUEST' THEN
    SELECT * INTO r FROM "FinExpenseRequest" WHERE "id" = NEW."requestId" FOR UPDATE;
    IF r."status" <> 'APPROVED' THEN
      RAISE EXCEPTION 'Only an approved request can be paid' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."recordedById" IN (r."requestedById", r."approvedById") THEN
      RAISE EXCEPTION 'The person who raised or approved a request cannot pay it out.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."fundId" <> r."fundId" OR NEW."currency" <> r."currency" THEN
      RAISE EXCEPTION 'The expense must be paid from the request''s fund and in its currency' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."amountCents" > r."estimatedCents" THEN
      RAISE EXCEPTION 'The amount paid cannot be more than the amount approved (% cents)', r."estimatedCents" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FinExpense" BEFORE INSERT ON "FinExpense" FOR EACH ROW EXECUTE FUNCTION fin_expense_guard();

-- The balance and the reports read charges, allocations and payments by these columns.
CREATE INDEX "FinPaymentAllocation_chargeId_idx" ON "FinPaymentAllocation"("chargeId");
CREATE INDEX "FinRefund_chargeId_idx" ON "FinRefund"("chargeId") WHERE "chargeId" IS NOT NULL;
