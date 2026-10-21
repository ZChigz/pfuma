-- CreateEnum
CREATE TYPE "FinFeeStructureStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "SponsorType" AS ENUM ('BEAM', 'CHURCH', 'NGO', 'COMPANY', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "AwardStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ENDED');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstalmentStatus" AS ENUM ('DUE', 'PAID', 'MISSED');

-- CreateEnum
CREATE TYPE "CashUpStatus" AS ENUM ('OPEN', 'SUBMITTED', 'CONFIRMED', 'SIGNED_OFF');

-- CreateEnum
CREATE TYPE "BankLineStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

-- CreateEnum
CREATE TYPE "PettyKind" AS ENUM ('TOPUP', 'EXPENSE');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('READY', 'PAID');

-- CreateEnum
CREATE TYPE "StatutoryType" AS ENUM ('PAYE', 'NSSA', 'ZIMDEF', 'AIDS_LEVY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.



-- AlterEnum

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.



-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.



-- AlterEnum

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.



-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.



-- DropForeignKey
ALTER TABLE "FinPayment" DROP CONSTRAINT "FinPayment_fundId_fkey";

-- AlterTable
ALTER TABLE "Fund" ADD COLUMN     "bankAccount" TEXT,
ADD COLUMN     "receiptPrefix" TEXT;

-- AlterTable
ALTER TABLE "FinFeeItem" ADD COLUMN     "catalogItemId" TEXT,
ADD COLUMN     "classIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "combinationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "levelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "structureId" TEXT;

-- AlterTable
ALTER TABLE "FinCharge" ADD COLUMN     "billingRunId" TEXT,
ADD COLUMN     "catalogItemId" TEXT,
ADD COLUMN     "dueDate" DATE;

-- AlterTable
ALTER TABLE "FinPayment" ADD COLUMN     "ackNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "backdateReason" TEXT,
ADD COLUMN     "exchangeRateId" TEXT,
ADD COLUMN     "guardianId" TEXT,
ADD COLUMN     "paidInZig" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paynowRef" TEXT,
ADD COLUMN     "verifyCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "zigAmountCents" INTEGER,
ALTER COLUMN "fundId" DROP NOT NULL,
ALTER COLUMN "receiptNumber" DROP NOT NULL;

-- AlterTable
ALTER TABLE "FinAdjustment" ADD COLUMN     "percentBps" INTEGER,
ADD COLUMN     "ruleId" TEXT;

-- AlterTable
ALTER TABLE "FinRefund" ADD COLUMN     "reasonKind" TEXT NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "FinExpenseRequest" ADD COLUMN     "approvedCeilingCents" INTEGER,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "firstApprovedAt" TIMESTAMP(3),
ADD COLUMN     "firstApprovedById" TEXT,
ADD COLUMN     "neededBy" DATE,
ADD COLUMN     "overrunApprovedById" TEXT,
ADD COLUMN     "overrunCents" INTEGER,
ADD COLUMN     "quoteKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "FinExpense" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "payrollRunId" TEXT,
ADD COLUMN     "receiptKey" TEXT,
ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "FinSettings" ADD COLUMN     "allocationMode" TEXT NOT NULL DEFAULT 'OLDEST_FUND',
ADD COLUMN     "applyCreditAtBilling" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "arrearsSmsTemplate" TEXT NOT NULL DEFAULT 'Dear {guardian}, {student} owes {amount} in school fees. Please pay at the school office or online. Thank you.',
ADD COLUMN     "autoBillOnAdmission" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "cashToleranceCents" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "headLimitUsdCents" INTEGER,
ADD COLUMN     "headLimitZigCents" INTEGER,
ADD COLUMN     "overrunPercent" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "paynowEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paynowId" TEXT,
ADD COLUMN     "paynowKey" TEXT,
ADD COLUMN     "proofAboveUsdCents" INTEGER,
ADD COLUMN     "proofAboveZigCents" INTEGER,
ADD COLUMN     "prorateAdmission" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quotesAboveUsdCents" INTEGER,
ADD COLUMN     "quotesAboveZigCents" INTEGER,
ADD COLUMN     "quotesRequired" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "receiptRequiredAboveUsdCents" INTEGER,
ADD COLUMN     "receiptRequiredAboveZigCents" INTEGER,
ADD COLUMN     "reminderLeadDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "siblingApprovedById" TEXT,
ADD COLUMN     "siblingItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "siblingPct2Bps" INTEGER,
ADD COLUMN     "siblingPct3Bps" INTEGER,
ADD COLUMN     "siblingSetById" TEXT,
ADD COLUMN     "staleRateDays" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "FeeItem" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinFeeStructure" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "FinFeeStructureStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "billedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinFeeStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingRun" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "runById" TEXT NOT NULL,
    "charged" INTEGER NOT NULL DEFAULT 0,
    "skippedCharged" INTEGER NOT NULL DEFAULT 0,
    "skippedInactive" INTEGER NOT NULL DEFAULT 0,
    "awardsCents" JSONB,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountRule" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" "AdjustmentKind" NOT NULL,
    "amountCents" INTEGER,
    "percentBps" INTEGER,
    "currency" "Currency",
    "catalogItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "termFromId" TEXT NOT NULL,
    "termToId" TEXT,
    "standing" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "status" "FinApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "studentId" TEXT,
    "guardianId" TEXT,
    "termId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sponsor" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SponsorType" NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sponsor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorAward" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "catalogItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "percentBps" INTEGER,
    "amountCents" INTEGER,
    "currency" "Currency" NOT NULL,
    "termFromId" TEXT NOT NULL,
    "termToId" TEXT,
    "reference" TEXT,
    "status" "AwardStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SponsorAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorCharge" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "awardId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "adjustmentId" TEXT,
    "termId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SponsorCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorPayment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "receivedOn" DATE NOT NULL,
    "receiptNumber" TEXT,
    "ackNumber" TEXT NOT NULL,
    "proofKey" TEXT,
    "status" "FinPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "SponsorPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorPaymentAllocation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "sponsorChargeId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SponsorPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransfer" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fromStudentId" TEXT NOT NULL,
    "toStudentId" TEXT NOT NULL,
    "fromPaymentId" TEXT NOT NULL,
    "toPaymentId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentPlan" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "studentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currency" "Currency" NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "notes" TEXT,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentPlanInstalment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "InstalmentStatus" NOT NULL DEFAULT 'DUE',
    "paidAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "missedAlertAt" TIMESTAMP(3),

    CONSTRAINT "PaymentPlanInstalment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashUp" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "expectedUsdCents" INTEGER NOT NULL DEFAULT 0,
    "expectedZigCents" INTEGER NOT NULL DEFAULT 0,
    "countedUsdCents" INTEGER NOT NULL DEFAULT 0,
    "countedZigCents" INTEGER NOT NULL DEFAULT 0,
    "differenceUsdCents" INTEGER NOT NULL DEFAULT 0,
    "differenceZigCents" INTEGER NOT NULL DEFAULT 0,
    "explanation" TEXT,
    "status" "CashUpStatus" NOT NULL DEFAULT 'OPEN',
    "submittedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "signedOffById" TEXT,
    "signedOffAt" TIMESTAMP(3),
    "depositRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankMapping" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "periodFrom" DATE,
    "periodTo" DATE,
    "fileName" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reference" TEXT,
    "description" TEXT,
    "status" "BankLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedPaymentId" TEXT,
    "matchedSponsorPaymentId" TEXT,
    "matchedDepositRef" TEXT,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "phone" TEXT,
    "bankDetails" TEXT,
    "ecocash" TEXT,
    "taxNumber" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCashFloat" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "custodianId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "expenseLimitCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PettyCashFloat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCashEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "floatId" TEXT NOT NULL,
    "kind" "PettyKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" TEXT,
    "receiptKey" TEXT,
    "date" DATE NOT NULL,
    "byId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PettyCashEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "preparedById" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'READY',
    "paidById" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employee" TEXT NOT NULL,
    "employeeRef" TEXT,
    "currency" "Currency" NOT NULL,
    "netCents" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "account" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "reference" TEXT,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatutoryPayment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "type" "StatutoryType" NOT NULL,
    "period" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "reference" TEXT,
    "payrollRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatutoryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptSequence" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ReceiptSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaynowAttempt" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "guardianId" TEXT,
    "reference" TEXT NOT NULL,
    "pollUrl" TEXT,
    "currency" "Currency" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaynowAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeeItem_schoolId_idx" ON "FeeItem"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeItem_schoolId_name_key" ON "FeeItem"("schoolId", "name");

-- CreateIndex
CREATE INDEX "FinFeeStructure_schoolId_termId_idx" ON "FinFeeStructure"("schoolId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "FinFeeStructure_termId_version_key" ON "FinFeeStructure"("termId", "version");

-- CreateIndex
CREATE INDEX "BillingRun_schoolId_termId_idx" ON "BillingRun"("schoolId", "termId");

-- CreateIndex
CREATE INDEX "DiscountRule_schoolId_studentId_idx" ON "DiscountRule"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "DiscountRule_schoolId_status_idx" ON "DiscountRule"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Invoice_schoolId_termId_idx" ON "Invoice"("schoolId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_schoolId_number_key" ON "Invoice"("schoolId", "number");

-- CreateIndex
CREATE INDEX "Sponsor_schoolId_idx" ON "Sponsor"("schoolId");

-- CreateIndex
CREATE INDEX "SponsorAward_schoolId_studentId_idx" ON "SponsorAward"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "SponsorAward_schoolId_sponsorId_idx" ON "SponsorAward"("schoolId", "sponsorId");

-- CreateIndex
CREATE INDEX "SponsorCharge_schoolId_sponsorId_idx" ON "SponsorCharge"("schoolId", "sponsorId");

-- CreateIndex
CREATE UNIQUE INDEX "SponsorCharge_awardId_chargeId_key" ON "SponsorCharge"("awardId", "chargeId");

-- CreateIndex
CREATE INDEX "SponsorPayment_schoolId_sponsorId_idx" ON "SponsorPayment"("schoolId", "sponsorId");

-- CreateIndex
CREATE UNIQUE INDEX "SponsorPayment_schoolId_receiptNumber_key" ON "SponsorPayment"("schoolId", "receiptNumber");

-- CreateIndex
CREATE INDEX "SponsorPaymentAllocation_schoolId_paymentId_idx" ON "SponsorPaymentAllocation"("schoolId", "paymentId");

-- CreateIndex
CREATE INDEX "SponsorPaymentAllocation_schoolId_sponsorChargeId_idx" ON "SponsorPaymentAllocation"("schoolId", "sponsorChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransfer_toPaymentId_key" ON "CreditTransfer"("toPaymentId");

-- CreateIndex
CREATE INDEX "CreditTransfer_schoolId_fromPaymentId_idx" ON "CreditTransfer"("schoolId", "fromPaymentId");

-- CreateIndex
CREATE INDEX "PaymentPlan_schoolId_guardianId_idx" ON "PaymentPlan"("schoolId", "guardianId");

-- CreateIndex
CREATE INDEX "PaymentPlanInstalment_schoolId_dueDate_idx" ON "PaymentPlanInstalment"("schoolId", "dueDate");

-- CreateIndex
CREATE INDEX "CashUp_schoolId_date_idx" ON "CashUp"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CashUp_schoolId_userId_date_key" ON "CashUp"("schoolId", "userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BankMapping_schoolId_bank_key" ON "BankMapping"("schoolId", "bank");

-- CreateIndex
CREATE INDEX "BankStatement_schoolId_idx" ON "BankStatement"("schoolId");

-- CreateIndex
CREATE INDEX "BankStatementLine_schoolId_statementId_idx" ON "BankStatementLine"("schoolId", "statementId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_schoolId_name_key" ON "Supplier"("schoolId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_schoolId_name_key" ON "ExpenseCategory"("schoolId", "name");

-- CreateIndex
CREATE INDEX "Budget_schoolId_termId_idx" ON "Budget"("schoolId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_termId_fundId_categoryId_currency_key" ON "Budget"("termId", "fundId", "categoryId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashFloat_custodianId_currency_key" ON "PettyCashFloat"("custodianId", "currency");

-- CreateIndex
CREATE INDEX "PettyCashEntry_schoolId_floatId_idx" ON "PettyCashEntry"("schoolId", "floatId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_schoolId_period_key" ON "PayrollRun"("schoolId", "period");

-- CreateIndex
CREATE INDEX "PayrollLine_runId_idx" ON "PayrollLine"("runId");

-- CreateIndex
CREATE INDEX "StatutoryPayment_schoolId_dueDate_idx" ON "StatutoryPayment"("schoolId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptSequence_schoolId_year_prefix_key" ON "ReceiptSequence"("schoolId", "year", "prefix");

-- CreateIndex
CREATE UNIQUE INDEX "PaynowAttempt_reference_key" ON "PaynowAttempt"("reference");

-- CreateIndex
CREATE INDEX "PaynowAttempt_schoolId_studentId_idx" ON "PaynowAttempt"("schoolId", "studentId");

-- AddForeignKey
ALTER TABLE "FinFeeItem" ADD CONSTRAINT "FinFeeItem_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "FinFeeStructure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinPayment" ADD CONSTRAINT "FinPayment_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRun" ADD CONSTRAINT "BillingRun_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "FinFeeStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorAward" ADD CONSTRAINT "SponsorAward_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "Sponsor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorCharge" ADD CONSTRAINT "SponsorCharge_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "Sponsor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorPayment" ADD CONSTRAINT "SponsorPayment_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "Sponsor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorPaymentAllocation" ADD CONSTRAINT "SponsorPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "SponsorPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorPaymentAllocation" ADD CONSTRAINT "SponsorPaymentAllocation_sponsorChargeId_fkey" FOREIGN KEY ("sponsorChargeId") REFERENCES "SponsorCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlanInstalment" ADD CONSTRAINT "PaymentPlanInstalment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PaymentPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashEntry" ADD CONSTRAINT "PettyCashEntry_floatId_fkey" FOREIGN KEY ("floatId") REFERENCES "PettyCashFloat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;




-- ═════════════════════════════════════════════════════════════════════════════
-- Finance, part 2: fee setup and billing, discounts, sponsors, receipts and the ZiG rule, credit transfers, payment plans, cash-ups,
-- bank reconciliation, suppliers/budgets/petty cash, payroll hand-over. Keys, security and the money rules the database keeps itself.
-- Part 1 (20261103000000_finance_core) is not changed; functions it made are replaced where the rules grew.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Plain-id foreign keys, row-level security, row-change audit, same-school references ─────────────────
CREATE TEMP TABLE p2_tables (t text PRIMARY KEY, audited boolean NOT NULL DEFAULT true);
INSERT INTO p2_tables (t, audited) VALUES
  ('FeeItem', true), ('FinFeeStructure', true), ('BillingRun', true), ('DiscountRule', true), ('Invoice', true), ('Sponsor', true), ('SponsorAward', true),
  ('SponsorCharge', true), ('SponsorPayment', true), ('SponsorPaymentAllocation', true), ('CreditTransfer', true), ('PaymentPlan', true), ('PaymentPlanInstalment', true),
  ('CashUp', true), ('BankMapping', true), ('BankStatement', true), ('BankStatementLine', false), ('Supplier', true), ('ExpenseCategory', true), ('Budget', true),
  ('PettyCashFloat', true), ('PettyCashEntry', true), ('PayrollRun', true), ('PayrollLine', true), ('StatutoryPayment', true), ('ReceiptSequence', false), ('PaynowAttempt', false);

-- 'Table|col:Referenced,col:Referenced': every one becomes a foreign key and a same-school check.
CREATE TEMP TABLE p2_refs (spec text);
INSERT INTO p2_refs VALUES
  ('FeeItem|fundId:Fund'),
  ('FinFeeItem|catalogItemId:FeeItem'),
  ('FinCharge|catalogItemId:FeeItem,billingRunId:BillingRun'),
  ('FinFeeStructure|termId:AcademicTerm,createdById:User,submittedById:User,approvedById:User'),
  ('BillingRun|termId:AcademicTerm,structureId:FinFeeStructure,runById:User'),
  ('DiscountRule|studentId:Student,termFromId:AcademicTerm,termToId:AcademicTerm,createdById:User,decidedById:User'),
  ('FinAdjustment|ruleId:DiscountRule'),
  ('Invoice|studentId:Student,guardianId:Guardian,termId:AcademicTerm,createdById:User'),
  ('SponsorAward|sponsorId:Sponsor,studentId:Student,termFromId:AcademicTerm,termToId:AcademicTerm,createdById:User,approvedById:User,cancelledById:User'),
  ('SponsorCharge|sponsorId:Sponsor,awardId:SponsorAward,studentId:Student,chargeId:FinCharge,adjustmentId:FinAdjustment,termId:AcademicTerm,fundId:Fund'),
  ('SponsorPayment|sponsorId:Sponsor,recordedById:User,verifiedById:User,rejectedById:User,voidedById:User'),
  ('SponsorPaymentAllocation|paymentId:SponsorPayment,sponsorChargeId:SponsorCharge,createdById:User'),
  ('CreditTransfer|fromStudentId:Student,toStudentId:Student,fromPaymentId:FinPayment,toPaymentId:FinPayment,createdById:User'),
  ('PaymentPlan|guardianId:Guardian,createdById:User,approvedById:User'),
  ('PaymentPlanInstalment|planId:PaymentPlan'),
  ('CashUp|userId:User,confirmedById:User,signedOffById:User'),
  ('BankStatement|uploadedById:User'),
  ('BankStatementLine|statementId:BankStatement,matchedPaymentId:FinPayment,matchedSponsorPaymentId:SponsorPayment'),
  ('Budget|termId:AcademicTerm,fundId:Fund,categoryId:ExpenseCategory'),
  ('PettyCashFloat|custodianId:User'),
  ('PettyCashEntry|floatId:PettyCashFloat,categoryId:ExpenseCategory,byId:User'),
  ('PayrollRun|preparedById:User,approvedById:User,paidById:User'),
  ('PayrollLine|runId:PayrollRun'),
  ('StatutoryPayment|paidById:User,payrollRunId:PayrollRun'),
  ('PaynowAttempt|studentId:Student,guardianId:Guardian,paymentId:FinPayment'),
  ('FinPayment|guardianId:Guardian,exchangeRateId:ExchangeRate'),
  ('FinExpenseRequest|supplierId:Supplier,firstApprovedById:User,overrunApprovedById:User,cancelledById:User'),
  ('FinExpense|supplierId:Supplier,categoryId:ExpenseCategory,payrollRunId:PayrollRun'),
  ('FinSettings|siblingSetById:User,siblingApprovedById:User');

DO $$
DECLARE r record; item text; col text; ref text; args text; cols text; fk text;
BEGIN
  FOR r IN SELECT t, audited FROM p2_tables LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE', r.t, r.t || '_schoolId_fkey');
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.t);
    EXECUTE format('CREATE POLICY school_isolation ON %I USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"))', r.t);
    IF r.audited THEN
      EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', 'audit_' || r.t, r.t);
    END IF;
  END LOOP;
  FOR r IN SELECT split_part(spec, '|', 1) AS t, split_part(spec, '|', 2) AS pairs FROM p2_refs LOOP
    args := ''; cols := '';
    FOREACH item IN ARRAY string_to_array(r.pairs, ',') LOOP
      col := split_part(item, ':', 1); ref := split_part(item, ':', 2);
      -- Prisma already made the foreign keys of the relations it knows; make the rest.
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.t || '_' || col || '_fkey') THEN
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I("id") ON DELETE RESTRICT ON UPDATE CASCADE', r.t, r.t || '_' || col || '_fkey', col, ref);
      END IF;
      args := args || CASE WHEN args = '' THEN '' ELSE ', ' END || quote_literal(item);
      cols := cols || CASE WHEN cols = '' THEN '' ELSE ', ' END || quote_ident(col);
    END LOOP;
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %s ON %I FOR EACH ROW EXECUTE FUNCTION check_same_school(%s)', 'same_school2_' || r.t, cols, r.t, args);
  END LOOP;
END $$;

-- The Paynow key is a secret: the row-change audit leaves it out.
DROP TRIGGER "audit_FinSettings" ON "FinSettings";
CREATE TRIGGER "audit_FinSettings" AFTER INSERT OR UPDATE OR DELETE ON "FinSettings" FOR EACH ROW EXECUTE FUNCTION audit_row_change('paynowKey');

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
                    'FinExpenseRequest', 'FinExpenseRequestItem', 'FinExpense', 'FinSettings',
                    'FeeItem', 'FinFeeStructure', 'BillingRun', 'DiscountRule', 'Invoice', 'Sponsor', 'SponsorAward', 'SponsorCharge', 'SponsorPayment',
                    'SponsorPaymentAllocation', 'CreditTransfer', 'PaymentPlan', 'PaymentPlanInstalment', 'CashUp', 'BankMapping', 'BankStatement',
                    'BankStatementLine', 'Supplier', 'ExpenseCategory', 'Budget', 'PettyCashFloat', 'PettyCashEntry', 'PayrollRun', 'PayrollLine',
                    'StatutoryPayment', 'ReceiptSequence', 'PaynowAttempt') THEN 'finance'
    WHEN entity IN ('Asset', 'AssetTransfer', 'Book', 'BookCopy', 'Borrowing', 'LibraryMember') THEN 'facilities'
    ELSE 'system'
  END
$$;

-- ── Permission keys and who starts with them ────────────────────────────────
INSERT INTO "Permission" ("key", "module", "description") VALUES
  ('finance.dashboard.view',     'finance', 'See the finance dashboard'),
  ('finance.fees.approve',       'finance', 'Approve a term''s fee structure'),
  ('finance.billing.run',        'finance', 'Run term billing'),
  ('finance.sponsors.manage',    'finance', 'Manage sponsors and their awards'),
  ('finance.awards.approve',     'finance', 'Approve sponsor awards'),
  ('finance.payments.allocate',  'finance', 'Change how a payment is allocated'),
  ('finance.credit.transfer',    'finance', 'Move credit to a brother or sister'),
  ('finance.statements.view',    'finance', 'See statements and the finance tab of a student'),
  ('finance.arrears.flag',       'finance', 'See the small fees-outstanding marker for the own class'),
  ('finance.plans.manage',       'finance', 'Record payment plans'),
  ('finance.plans.approve',      'finance', 'Approve payment plans longer than a term'),
  ('finance.expenses.manage',    'finance', 'Manage expenses, categories and petty cash'),
  ('finance.suppliers.manage',   'finance', 'Manage suppliers'),
  ('finance.budgets.manage',     'finance', 'Set budgets'),
  ('finance.rates.manage',       'finance', 'Set exchange rates'),
  ('finance.cashup.submit',      'finance', 'Submit the daily cash-up'),
  ('finance.cashup.confirm',     'finance', 'Confirm cash-ups and bank the cash'),
  ('finance.cashup.signoff',     'finance', 'Sign off the day'),
  ('finance.bank.reconcile',     'finance', 'Reconcile bank statements'),
  ('finance.payroll.pay',        'finance', 'Pay approved payroll runs')
ON CONFLICT ("key") DO NOTHING;

CREATE OR REPLACE FUNCTION finance_role_keys(role_key text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE role_key
    WHEN 'BURSAR' THEN ARRAY['finance.dashboard.view', 'finance.fees.view', 'finance.fees.manage', 'finance.billing.run', 'finance.accounts.view', 'finance.charges.create',
                             'finance.adjustments.create', 'finance.sponsors.manage', 'finance.payments.view', 'finance.payments.record', 'finance.payments.verify',
                             'finance.payments.allocate', 'finance.refunds.request', 'finance.refunds.pay', 'finance.credit.transfer', 'finance.statements.view',
                             'finance.plans.manage', 'finance.expenses.view', 'finance.expenses.record', 'finance.expenses.manage', 'finance.suppliers.manage',
                             'finance.budgets.manage', 'finance.requests.view', 'finance.requests.create', 'finance.requests.disburse', 'finance.rates.view',
                             'finance.rates.manage', 'finance.cashup.confirm', 'finance.bank.reconcile', 'finance.reports.view', 'finance.reports.export', 'finance.payroll.pay']
    WHEN 'ACCOUNTS_CLERK' THEN ARRAY['finance.fees.view', 'finance.accounts.view', 'finance.payments.view', 'finance.payments.record', 'finance.statements.view',
                                     'finance.cashup.submit', 'finance.requests.view', 'finance.requests.create']
    WHEN 'HEAD' THEN ARRAY['finance.dashboard.view', 'finance.fees.view', 'finance.fees.approve', 'finance.accounts.view', 'finance.payments.view', 'finance.payments.verify',
                           'finance.adjustments.approve', 'finance.awards.approve', 'finance.plans.approve', 'finance.statements.view', 'finance.expenses.view',
                           'finance.requests.view', 'finance.requests.create', 'finance.requests.approve', 'finance.funds.manage', 'finance.rates.view',
                           'finance.cashup.signoff', 'finance.reports.view', 'finance.reports.export']
    WHEN 'DEPUTY_HEAD' THEN ARRAY['finance.requests.create', 'finance.fees.view']
    WHEN 'CLASS_TEACHER' THEN ARRAY['finance.requests.create', 'finance.arrears.flag']
    WHEN 'TEACHER' THEN ARRAY['finance.requests.create']
    WHEN 'HOD' THEN ARRAY['finance.requests.create']
    WHEN 'EXAMS_OFFICER' THEN ARRAY['finance.requests.create']
    WHEN 'LIBRARIAN' THEN ARRAY['finance.requests.create']
    WHEN 'HR_OFFICER' THEN ARRAY['finance.requests.create']
    WHEN 'BOARDING_MASTER' THEN ARRAY['finance.requests.create']
    ELSE ARRAY[]::text[]
  END
$$;

-- ── Payments: cash is received at once, the rest waits; the official receipt number comes with verification ─────────
ALTER TABLE "FinPayment" ALTER COLUMN "receiptNumber" DROP NOT NULL;
ALTER TABLE "FinPayment" ALTER COLUMN "fundId" DROP NOT NULL;
ALTER TABLE "FinPayment" DROP CONSTRAINT "FinPayment_fallback_only_verified";
ALTER TABLE "FinPayment" ADD CONSTRAINT "FinPayment_fallback_only_verified" CHECK ("verifierFallback" = false OR "status" = 'VERIFIED');
ALTER TABLE "FinPayment" ADD CONSTRAINT "FinPayment_zig" CHECK (
  ("paidInZig" = false AND "zigAmountCents" IS NULL AND "exchangeRateId" IS NULL)
  OR ("paidInZig" = true AND "currency" = 'USD' AND "zigAmountCents" > 0 AND "exchangeRateId" IS NOT NULL));
ALTER TABLE "FinPayment" ADD CONSTRAINT "FinPayment_verified_has_receipt" CHECK ("status" <> 'VERIFIED' OR "receiptNumber" IS NOT NULL);
ALTER TABLE "FinPayment" ADD CONSTRAINT "FinPayment_received_has_receipt" CHECK ("status" <> 'RECEIVED' OR "receiptNumber" IS NOT NULL);
-- The same method and reference cannot be recorded twice (a rejected payment frees its reference; older imported rows are left alone).
CREATE UNIQUE INDEX "FinPayment_method_reference_once" ON "FinPayment"("schoolId", "method", lower("reference"))
  WHERE "reference" IS NOT NULL AND "status" <> 'REJECTED' AND "legacyPaymentId" IS NULL;

DROP TRIGGER "immutable_FinPayment" ON "FinPayment";
CREATE TRIGGER "immutable_FinPayment" BEFORE UPDATE ON "FinPayment" FOR EACH ROW
  EXECUTE FUNCTION fin_immutable_except('status', 'receiptNumber', 'verifiedById', 'verifiedAt', 'verifierFallback', 'rejectedById', 'rejectedAt', 'rejectionReason');

CREATE OR REPLACE FUNCTION fin_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" NOT IN ('PENDING', 'RECEIVED') THEN
      RAISE EXCEPTION 'A payment is recorded as received or waiting; someone else must verify it' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."receiptNumber" IS NOT NULL AND NEW."receiptNumber" IS DISTINCT FROM OLD."receiptNumber" THEN
    RAISE EXCEPTION 'A receipt number never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    IF NEW."receiptNumber" IS DISTINCT FROM OLD."receiptNumber" THEN
      RAISE EXCEPTION 'The official receipt number is issued when the payment is verified' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" NOT IN ('PENDING', 'RECEIVED') THEN
    RAISE EXCEPTION 'A payment that was verified or rejected cannot be changed. Void it and record a new one.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'VERIFIED' AND NEW."verifiedById" = NEW."recordedById"
     AND NOT (NEW."method" = 'PAYNOW' AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = NEW."recordedById" AND u."isSupport")) THEN
    RAISE EXCEPTION 'You recorded this payment, so someone else must verify it.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'REJECTED' AND NEW."rejectedById" = NEW."recordedById" THEN
    RAISE EXCEPTION 'You recorded this payment, so someone else must decide on it.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" NOT IN ('VERIFIED', 'REJECTED') THEN
    RAISE EXCEPTION 'A payment goes from received or waiting to verified or rejected' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Credit a verified payment has given to another learner (a transfer whose receiving payment still stands).
CREATE OR REPLACE FUNCTION fin_transfer_out(pid text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(t."amountCents"), 0)::bigint FROM "CreditTransfer" t JOIN "FinPayment" r ON r."id" = t."toPaymentId"
   WHERE t."fromPaymentId" = pid AND r."status" <> 'REJECTED' AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = r."id")
$$;

-- ── An allocation: a verified, unvoided payment; one currency; its fund if it names one; its own learner or, for a family payment, a child of the fee payer ──
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
  IF p."studentId" <> c."studentId" AND NOT (p."guardianId" IS NOT NULL AND EXISTS (
       SELECT 1 FROM "StudentGuardian" sg WHERE sg."guardianId" = p."guardianId" AND sg."studentId" = c."studentId")) THEN
    RAISE EXCEPTION 'A payment can only settle charges of the same student (or, for a family payment, a child of the same fee payer)' USING ERRCODE = 'check_violation';
  END IF;
  IF p."currency" <> c."currency" THEN
    RAISE EXCEPTION 'A % payment cannot settle a % charge. The two currencies are never mixed.', p."currency", c."currency" USING ERRCODE = 'check_violation';
  END IF;
  IF p."fundId" IS NOT NULL AND p."fundId" <> c."fundId" THEN
    RAISE EXCEPTION 'A payment for one fund can only settle charges of that fund' USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum("amountCents"), 0) INTO used FROM "FinPaymentAllocation" WHERE "paymentId" = p."id";
  used := used + (SELECT coalesce(sum("amountCents"), 0) FROM "FinRefund" WHERE "paymentId" = p."id" AND "chargeId" IS NULL AND "status" <> 'REJECTED') + fin_transfer_out(p."id");
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

-- ── A refund: as before, but a family payment may be refunded against a brother's or sister's charge, and transferred credit is not refundable twice ──
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
      IF c."studentId" <> p."studentId" AND NOT (p."guardianId" IS NOT NULL AND EXISTS (
           SELECT 1 FROM "StudentGuardian" sg WHERE sg."guardianId" = p."guardianId" AND sg."studentId" = c."studentId")) THEN
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
      other := other + fin_transfer_out(p."id");
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

-- ── Credit moved to a brother or sister: from a verified payment's unallocated credit, to a payment (method CREDIT_TRANSFER) that someone else verifies ──
CREATE OR REPLACE FUNCTION fin_credit_transfer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE src "FinPayment"%ROWTYPE; dst "FinPayment"%ROWTYPE; alloc bigint; others bigint;
BEGIN
  SELECT * INTO src FROM "FinPayment" WHERE "id" = NEW."fromPaymentId" FOR UPDATE;
  SELECT * INTO dst FROM "FinPayment" WHERE "id" = NEW."toPaymentId";
  IF src."status" <> 'VERIFIED' OR EXISTS (SELECT 1 FROM "FinVoid" WHERE "paymentId" = src."id") THEN
    RAISE EXCEPTION 'Only credit from a verified payment can be moved' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."fromStudentId" = NEW."toStudentId" OR src."studentId" <> NEW."fromStudentId" OR dst."studentId" <> NEW."toStudentId" THEN
    RAISE EXCEPTION 'Credit moves from one learner to another' USING ERRCODE = 'check_violation';
  END IF;
  IF dst."method" <> 'CREDIT_TRANSFER' OR dst."currency" <> src."currency" OR dst."amountCents" <> NEW."amountCents" OR NEW."currency" <> src."currency" THEN
    RAISE EXCEPTION 'The receiving payment must be a credit transfer of the same amount and currency' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "StudentGuardian" a JOIN "StudentGuardian" b ON a."guardianId" = b."guardianId"
                  WHERE a."studentId" = NEW."fromStudentId" AND b."studentId" = NEW."toStudentId" AND (a."isFeePayer" OR a."isPrimary")) THEN
    RAISE EXCEPTION 'Credit can only be moved between learners with the same fee payer' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum("amountCents"), 0) INTO alloc FROM "FinPaymentAllocation" WHERE "paymentId" = src."id";
  SELECT coalesce(sum("amountCents"), 0) INTO others FROM "FinRefund" WHERE "paymentId" = src."id" AND "chargeId" IS NULL AND "status" <> 'REJECTED';
  others := others + fin_transfer_out(src."id");
  IF NEW."amountCents" > src."amountCents" - alloc - others THEN
    RAISE EXCEPTION 'That is more credit than the payment holds' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_CreditTransfer" BEFORE INSERT ON "CreditTransfer" FOR EACH ROW EXECUTE FUNCTION fin_credit_transfer_guard();
CREATE TRIGGER "append_only_CreditTransfer" BEFORE UPDATE OR DELETE ON "CreditTransfer" FOR EACH ROW EXECUTE FUNCTION fin_append_only();
ALTER TABLE "CreditTransfer" ADD CONSTRAINT "CreditTransfer_amount" CHECK ("amountCents" > 0 AND char_length(btrim("reason")) >= 5);

-- ── Fee setup: a structure moves draft → submitted → approved; its lines are frozen once it leaves draft ──────────────
ALTER TABLE "FeeItem" ADD CONSTRAINT "FeeItem_name" CHECK (btrim("name") <> '');
CREATE TRIGGER "no_delete_FeeItem" BEFORE DELETE ON "FeeItem" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "closed_term_FinFeeStructure" BEFORE INSERT ON "FinFeeStructure" FOR EACH ROW EXECUTE FUNCTION academics_closed_term_guard();
CREATE UNIQUE INDEX "FinFeeStructure_one_approved" ON "FinFeeStructure"("termId") WHERE "status" = 'APPROVED';
ALTER TABLE "FinFeeStructure"
  ADD CONSTRAINT "FinFeeStructure_version" CHECK ("version" >= 1),
  ADD CONSTRAINT "FinFeeStructure_approved_has_person" CHECK ("status" NOT IN ('APPROVED', 'SUPERSEDED') OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL)),
  ADD CONSTRAINT "FinFeeStructure_submitted_has_person" CHECK ("status" = 'DRAFT' OR ("submittedById" IS NOT NULL AND "submittedAt" IS NOT NULL));

CREATE OR REPLACE FUNCTION fin_structure_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'Only a draft fee structure can be deleted' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN RAISE EXCEPTION 'A fee structure starts as a draft' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW."id", NEW."schoolId", NEW."termId", NEW."version", NEW."createdById", NEW."createdAt")
     IS DISTINCT FROM (OLD."id", OLD."schoolId", OLD."termId", OLD."version", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'The term, version and author of a fee structure never change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."billedAt" IS NOT NULL AND NEW."billedAt" IS DISTINCT FROM OLD."billedAt" THEN
    RAISE EXCEPTION 'A fee structure has been billed once' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    IF OLD."status" <> 'DRAFT' AND NEW."note" IS DISTINCT FROM OLD."note" THEN
      RAISE EXCEPTION 'A submitted fee structure cannot be edited. Make a new version.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ((OLD."status" = 'DRAFT' AND NEW."status" = 'SUBMITTED') OR (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('DRAFT', 'APPROVED'))
          OR (OLD."status" = 'APPROVED' AND NEW."status" = 'SUPERSEDED')) THEN
    RAISE EXCEPTION 'A fee structure cannot go from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'APPROVED' AND NEW."approvedById" IN (NEW."createdById", NEW."submittedById") THEN
    RAISE EXCEPTION 'You prepared this fee structure, so someone else must approve it.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FinFeeStructure" BEFORE INSERT OR UPDATE OR DELETE ON "FinFeeStructure" FOR EACH ROW EXECUTE FUNCTION fin_structure_guard();

DROP TRIGGER "no_delete_FinFeeItem" ON "FinFeeItem";
CREATE OR REPLACE FUNCTION fin_fee_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid text := COALESCE(to_jsonb(NEW) ->> 'structureId', to_jsonb(OLD) ->> 'structureId'); st "FinFeeStructureStatus";
BEGIN
  IF sid IS NULL THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'FinFeeItem rows are never deleted. Switch the line off instead.' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  SELECT "status" INTO st FROM "FinFeeStructure" WHERE "id" = sid;
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'The lines of a submitted or approved fee structure cannot be changed. Make a new version.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_line_FinFeeItem" BEFORE INSERT OR UPDATE OR DELETE ON "FinFeeItem" FOR EACH ROW EXECUTE FUNCTION fin_fee_line_guard();

CREATE TRIGGER "append_only_BillingRun" BEFORE UPDATE OR DELETE ON "BillingRun" FOR EACH ROW EXECUTE FUNCTION fin_append_only();
CREATE TRIGGER "append_only_Invoice" BEFORE UPDATE OR DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION fin_append_only();

-- ── Discounts and awards: asked for by one person, approved by another ─────────────────────────
ALTER TABLE "DiscountRule"
  ADD CONSTRAINT "DiscountRule_amount" CHECK (("amountCents" IS NOT NULL)::int + ("percentBps" IS NOT NULL)::int = 1 AND coalesce("amountCents", 1) > 0 AND coalesce("percentBps", 1) BETWEEN 1 AND 10000),
  ADD CONSTRAINT "DiscountRule_currency" CHECK ("amountCents" IS NULL OR "currency" IS NOT NULL),
  ADD CONSTRAINT "DiscountRule_reason" CHECK (char_length(btrim("reason")) >= 5),
  ADD CONSTRAINT "DiscountRule_decided_has_person" CHECK (("status" = 'PENDING') = ("decidedById" IS NULL AND "decidedAt" IS NULL));
CREATE TRIGGER "no_delete_DiscountRule" BEFORE DELETE ON "DiscountRule" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "immutable_DiscountRule" BEFORE UPDATE ON "DiscountRule" FOR EACH ROW EXECUTE FUNCTION fin_immutable_except('status', 'decidedById', 'decidedAt', 'decisionNote', 'termToId');
CREATE OR REPLACE FUNCTION fin_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
-- Shared by discount rules and sponsor awards: they start pending, and the person who made one cannot decide on it.
DECLARE decider text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING' THEN RAISE EXCEPTION 'It is asked for as pending; someone else must approve it' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN RETURN NEW; END IF;
  IF OLD."status" = 'PENDING' THEN
    decider := COALESCE(to_jsonb(NEW) ->> 'decidedById', to_jsonb(NEW) ->> 'approvedById');
    IF decider = NEW."createdById" THEN RAISE EXCEPTION 'You asked for this, so someone else must decide on it.' USING ERRCODE = 'check_violation'; END IF;
    IF NEW."status" NOT IN ('APPROVED', 'REJECTED') THEN RAISE EXCEPTION 'It must be approved or rejected first' USING ERRCODE = 'check_violation'; END IF;
  ELSIF OLD."status" = 'APPROVED' THEN
    IF NEW."status" NOT IN ('CANCELLED', 'ENDED') THEN RAISE EXCEPTION 'An approved item can only be ended or cancelled' USING ERRCODE = 'check_violation'; END IF;
  ELSE
    RAISE EXCEPTION 'It has already been decided' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_DiscountRule" BEFORE INSERT OR UPDATE ON "DiscountRule" FOR EACH ROW EXECUTE FUNCTION fin_decision_guard();

-- ── Sponsors ───────────────────────────────────────────────────────────────
ALTER TABLE "Sponsor" ADD CONSTRAINT "Sponsor_name" CHECK (btrim("name") <> '');
CREATE TRIGGER "no_delete_Sponsor" BEFORE DELETE ON "Sponsor" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
ALTER TABLE "SponsorAward"
  ADD CONSTRAINT "SponsorAward_amount" CHECK (("amountCents" IS NOT NULL)::int + ("percentBps" IS NOT NULL)::int = 1 AND coalesce("amountCents", 1) > 0 AND coalesce("percentBps", 1) BETWEEN 1 AND 10000),
  ADD CONSTRAINT "SponsorAward_approved_has_person" CHECK ("status" NOT IN ('APPROVED', 'CANCELLED', 'ENDED') OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL)),
  ADD CONSTRAINT "SponsorAward_cancelled_has_reason" CHECK ("status" <> 'CANCELLED' OR ("cancelledById" IS NOT NULL AND char_length(btrim(coalesce("cancelReason", ''))) >= 5));
CREATE TRIGGER "no_delete_SponsorAward" BEFORE DELETE ON "SponsorAward" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "immutable_SponsorAward" BEFORE UPDATE ON "SponsorAward" FOR EACH ROW EXECUTE FUNCTION fin_immutable_except('status', 'approvedById', 'approvedAt', 'cancelledById', 'cancelledAt', 'cancelReason', 'termToId');
CREATE TRIGGER "guard_SponsorAward" BEFORE INSERT OR UPDATE ON "SponsorAward" FOR EACH ROW EXECUTE FUNCTION fin_decision_guard();

ALTER TABLE "SponsorCharge" ADD CONSTRAINT "SponsorCharge_amount" CHECK ("amountCents" > 0);
CREATE TRIGGER "no_delete_SponsorCharge" BEFORE DELETE ON "SponsorCharge" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "immutable_SponsorCharge" BEFORE UPDATE ON "SponsorCharge" FOR EACH ROW EXECUTE FUNCTION fin_immutable_except('cancelled');

-- Sponsor money follows the same rules as a parent's: recorded by one person, verified by another, receipt number at verification.
ALTER TABLE "SponsorPayment"
  ADD CONSTRAINT "SponsorPayment_amount" CHECK ("amountCents" > 0),
  ADD CONSTRAINT "SponsorPayment_verified_has_person" CHECK (("status" = 'VERIFIED') = ("verifiedById" IS NOT NULL AND "verifiedAt" IS NOT NULL)),
  ADD CONSTRAINT "SponsorPayment_rejected_has_person" CHECK (("status" = 'REJECTED') = ("rejectedById" IS NOT NULL AND "rejectedAt" IS NOT NULL AND btrim(coalesce("rejectionReason", '')) <> '')),
  ADD CONSTRAINT "SponsorPayment_verified_has_receipt" CHECK ("status" <> 'VERIFIED' OR "receiptNumber" IS NOT NULL),
  ADD CONSTRAINT "SponsorPayment_void" CHECK (("voidedById" IS NULL) = ("voidedAt" IS NULL) AND ("voidedById" IS NULL OR char_length(btrim(coalesce("voidReason", ''))) >= 10));
CREATE TRIGGER "no_delete_SponsorPayment" BEFORE DELETE ON "SponsorPayment" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "immutable_SponsorPayment" BEFORE UPDATE ON "SponsorPayment" FOR EACH ROW
  EXECUTE FUNCTION fin_immutable_except('status', 'receiptNumber', 'verifiedById', 'verifiedAt', 'rejectedById', 'rejectedAt', 'rejectionReason', 'voidedById', 'voidedAt', 'voidReason');
CREATE OR REPLACE FUNCTION fin_sponsor_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" NOT IN ('PENDING', 'RECEIVED') THEN RAISE EXCEPTION 'A payment is recorded as received or waiting' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF OLD."voidedById" IS NOT NULL THEN RAISE EXCEPTION 'A voided payment cannot change' USING ERRCODE = 'check_violation'; END IF;
  IF NEW."voidedById" IS NOT NULL AND OLD."voidedById" IS NULL THEN
    IF NEW."voidedById" = NEW."recordedById" THEN RAISE EXCEPTION 'You recorded this payment, so someone else must void it.' USING ERRCODE = 'check_violation'; END IF;
    IF EXISTS (SELECT 1 FROM "SponsorPaymentAllocation" WHERE "paymentId" = NEW."id") THEN RAISE EXCEPTION 'The payment has been allocated; nothing is voided silently' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF OLD."receiptNumber" IS NOT NULL AND NEW."receiptNumber" IS DISTINCT FROM OLD."receiptNumber" THEN RAISE EXCEPTION 'A receipt number never changes' USING ERRCODE = 'check_violation'; END IF;
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN RETURN NEW; END IF;
  IF OLD."status" NOT IN ('PENDING', 'RECEIVED') OR NEW."status" NOT IN ('VERIFIED', 'REJECTED') THEN RAISE EXCEPTION 'A payment goes from received or waiting to verified or rejected' USING ERRCODE = 'check_violation'; END IF;
  IF NEW."status" = 'VERIFIED' AND NEW."verifiedById" = NEW."recordedById" THEN RAISE EXCEPTION 'You recorded this payment, so someone else must verify it.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW."status" = 'REJECTED' AND NEW."rejectedById" = NEW."recordedById" THEN RAISE EXCEPTION 'You recorded this payment, so someone else must decide on it.' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_SponsorPayment" BEFORE INSERT OR UPDATE ON "SponsorPayment" FOR EACH ROW EXECUTE FUNCTION fin_sponsor_payment_guard();

ALTER TABLE "SponsorPaymentAllocation" ADD CONSTRAINT "SponsorPaymentAllocation_amount" CHECK ("amountCents" > 0);
CREATE TRIGGER "append_only_SponsorPaymentAllocation" BEFORE UPDATE OR DELETE ON "SponsorPaymentAllocation" FOR EACH ROW EXECUTE FUNCTION fin_append_only();
CREATE OR REPLACE FUNCTION fin_sponsor_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "SponsorPayment"%ROWTYPE; c "SponsorCharge"%ROWTYPE; used bigint; got bigint;
BEGIN
  SELECT * INTO p FROM "SponsorPayment" WHERE "id" = NEW."paymentId" FOR UPDATE;
  SELECT * INTO c FROM "SponsorCharge" WHERE "id" = NEW."sponsorChargeId" FOR UPDATE;
  IF p."status" <> 'VERIFIED' OR p."voidedById" IS NOT NULL THEN RAISE EXCEPTION 'A sponsor payment is allocated only after it has been verified, and never when voided' USING ERRCODE = 'check_violation'; END IF;
  IF p."sponsorId" <> c."sponsorId" THEN RAISE EXCEPTION 'The payment and the charge are of different sponsors' USING ERRCODE = 'check_violation'; END IF;
  IF p."currency" <> c."currency" THEN RAISE EXCEPTION 'The two currencies are never mixed' USING ERRCODE = 'check_violation'; END IF;
  IF c."cancelled" THEN RAISE EXCEPTION 'That award was cancelled' USING ERRCODE = 'check_violation'; END IF;
  SELECT coalesce(sum("amountCents"), 0) INTO used FROM "SponsorPaymentAllocation" WHERE "paymentId" = p."id";
  IF used + NEW."amountCents" > p."amountCents" THEN RAISE EXCEPTION 'The payment has only % cents left to allocate', p."amountCents" - used USING ERRCODE = 'check_violation'; END IF;
  SELECT coalesce(sum(a."amountCents"), 0) INTO got FROM "SponsorPaymentAllocation" a JOIN "SponsorPayment" sp ON sp."id" = a."paymentId" WHERE a."sponsorChargeId" = c."id" AND sp."voidedById" IS NULL;
  IF got + NEW."amountCents" > c."amountCents" THEN RAISE EXCEPTION 'The sponsor owes only % cents on that charge', c."amountCents" - got USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_SponsorPaymentAllocation" BEFORE INSERT ON "SponsorPaymentAllocation" FOR EACH ROW EXECUTE FUNCTION fin_sponsor_allocation_guard();

-- ── Payment plans, instalments ──────────────────────────────────────────────
ALTER TABLE "PaymentPlan"
  ADD CONSTRAINT "PaymentPlan_total" CHECK ("totalCents" > 0),
  ADD CONSTRAINT "PaymentPlan_approver" CHECK ("approvedById" IS NULL OR "approvedById" <> "createdById");
ALTER TABLE "PaymentPlanInstalment" ADD CONSTRAINT "PaymentPlanInstalment_amount" CHECK ("amountCents" > 0);
CREATE TRIGGER "no_delete_PaymentPlan" BEFORE DELETE ON "PaymentPlan" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "no_delete_PaymentPlanInstalment" BEFORE DELETE ON "PaymentPlanInstalment" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "immutable_PaymentPlan" BEFORE UPDATE ON "PaymentPlan" FOR EACH ROW EXECUTE FUNCTION fin_immutable_except('status', 'approvedById', 'approvedAt', 'notes');
CREATE TRIGGER "immutable_PaymentPlanInstalment" BEFORE UPDATE ON "PaymentPlanInstalment" FOR EACH ROW EXECUTE FUNCTION fin_immutable_except('status', 'paidAt', 'reminderSentAt', 'missedAlertAt');

-- ── The daily cash-up: the clerk submits, the bursar confirms, the Head signs off; a difference needs a written reason ──
ALTER TABLE "CashUp"
  ADD CONSTRAINT "CashUp_counts" CHECK ("expectedUsdCents" >= 0 AND "expectedZigCents" >= 0 AND "countedUsdCents" >= 0 AND "countedZigCents" >= 0),
  ADD CONSTRAINT "CashUp_difference" CHECK ("differenceUsdCents" = "countedUsdCents" - "expectedUsdCents" AND "differenceZigCents" = "countedZigCents" - "expectedZigCents");
CREATE TRIGGER "no_delete_CashUp" BEFORE DELETE ON "CashUp" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE OR REPLACE FUNCTION fin_cashup_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tol int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'OPEN' THEN RAISE EXCEPTION 'A cash-up starts open' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" IN ('CONFIRMED', 'SIGNED_OFF') AND (NEW."countedUsdCents", NEW."countedZigCents", NEW."expectedUsdCents", NEW."expectedZigCents", NEW."explanation")
     IS DISTINCT FROM (OLD."countedUsdCents", OLD."countedZigCents", OLD."expectedUsdCents", OLD."expectedZigCents", OLD."explanation") THEN
    RAISE EXCEPTION 'A confirmed cash-up cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN RETURN NEW; END IF;
  IF NOT ((OLD."status" = 'OPEN' AND NEW."status" = 'SUBMITTED') OR (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('CONFIRMED', 'OPEN')) OR (OLD."status" = 'CONFIRMED' AND NEW."status" = 'SIGNED_OFF')) THEN
    RAISE EXCEPTION 'A cash-up cannot go from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'SUBMITTED' THEN
    SELECT coalesce((SELECT "cashToleranceCents" FROM "FinSettings" WHERE "schoolId" = NEW."schoolId"), 100) INTO tol;
    IF (abs(NEW."differenceUsdCents") > tol OR abs(NEW."differenceZigCents") > tol) AND char_length(btrim(coalesce(NEW."explanation", ''))) < 5 THEN
      RAISE EXCEPTION 'The count is out by more than allowed. Write down why.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."status" = 'CONFIRMED' AND (NEW."confirmedById" IS NULL OR NEW."confirmedById" = NEW."userId") THEN
    RAISE EXCEPTION 'The clerk who counted the cash cannot confirm it.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'SIGNED_OFF' AND (NEW."signedOffById" IS NULL OR NEW."signedOffById" IN (NEW."userId", NEW."confirmedById")) THEN
    RAISE EXCEPTION 'The day is signed off by someone who neither counted nor confirmed the cash.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_CashUp" BEFORE INSERT OR UPDATE ON "CashUp" FOR EACH ROW EXECUTE FUNCTION fin_cashup_guard();
CREATE TRIGGER "immutable_CashUp" BEFORE UPDATE ON "CashUp" FOR EACH ROW EXECUTE FUNCTION fin_immutable_except(
  'status', 'expectedUsdCents', 'expectedZigCents', 'countedUsdCents', 'countedZigCents', 'differenceUsdCents', 'differenceZigCents', 'explanation',
  'submittedAt', 'confirmedById', 'confirmedAt', 'signedOffById', 'signedOffAt', 'depositRef');

-- ── Bank statements ─────────────────────────────────────────────────────────
CREATE TRIGGER "append_only_BankStatement" BEFORE UPDATE OR DELETE ON "BankStatement" FOR EACH ROW EXECUTE FUNCTION fin_append_only();
CREATE TRIGGER "no_delete_BankStatementLine" BEFORE DELETE ON "BankStatementLine" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "immutable_BankStatementLine" BEFORE UPDATE ON "BankStatementLine" FOR EACH ROW EXECUTE FUNCTION fin_immutable_except('status', 'matchedPaymentId', 'matchedSponsorPaymentId', 'matchedDepositRef');
CREATE INDEX "BankStatementLine_reference_idx" ON "BankStatementLine"("schoolId", lower("reference"));

-- ── Suppliers, categories, budgets, petty cash ──────────────────────────────
CREATE TRIGGER "no_delete_Supplier" BEFORE DELETE ON "Supplier" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "no_delete_ExpenseCategory" BEFORE DELETE ON "ExpenseCategory" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_amount" CHECK ("amountCents" >= 0);
ALTER TABLE "PettyCashFloat" ADD CONSTRAINT "PettyCashFloat_limit" CHECK ("expenseLimitCents" > 0);
ALTER TABLE "PettyCashEntry" ADD CONSTRAINT "PettyCashEntry_amount" CHECK ("amountCents" > 0 AND btrim("description") <> '');
CREATE TRIGGER "append_only_PettyCashEntry" BEFORE UPDATE OR DELETE ON "PettyCashEntry" FOR EACH ROW EXECUTE FUNCTION fin_append_only();
CREATE OR REPLACE FUNCTION fin_petty_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f "PettyCashFloat"%ROWTYPE; bal bigint;
BEGIN
  SELECT * INTO f FROM "PettyCashFloat" WHERE "id" = NEW."floatId" FOR UPDATE;
  IF NEW."kind" = 'EXPENSE' THEN
    IF NEW."amountCents" > f."expenseLimitCents" THEN RAISE EXCEPTION 'A petty cash expense is at most % cents. Use an expense request for more.', f."expenseLimitCents" USING ERRCODE = 'check_violation'; END IF;
    SELECT coalesce(sum(CASE WHEN "kind" = 'TOPUP' THEN "amountCents" ELSE -"amountCents" END), 0) INTO bal FROM "PettyCashEntry" WHERE "floatId" = f."id";
    IF NEW."amountCents" > bal THEN RAISE EXCEPTION 'The float holds only % cents', bal USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_PettyCashEntry" BEFORE INSERT ON "PettyCashEntry" FOR EACH ROW EXECUTE FUNCTION fin_petty_guard();

-- ── Payroll hand-over: HR prepares, the Owner approves, Finance pays (never the person who prepared it) ──────────────
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_people" CHECK ("approvedById" <> "preparedById" AND ("paidById" IS NULL OR "paidById" <> "preparedById")),
  ADD CONSTRAINT "PayrollRun_paid" CHECK (("status" = 'PAID') = ("paidById" IS NOT NULL AND "paidAt" IS NOT NULL));
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_net" CHECK ("netCents" > 0);
ALTER TABLE "StatutoryPayment" ADD CONSTRAINT "StatutoryPayment_amount" CHECK ("amountCents" > 0);
CREATE TRIGGER "no_delete_PayrollRun" BEFORE DELETE ON "PayrollRun" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "no_delete_PayrollLine" BEFORE DELETE ON "PayrollLine" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "no_delete_StatutoryPayment" BEFORE DELETE ON "StatutoryPayment" FOR EACH ROW EXECUTE FUNCTION fin_no_delete();
CREATE TRIGGER "immutable_PayrollRun" BEFORE UPDATE ON "PayrollRun" FOR EACH ROW EXECUTE FUNCTION fin_immutable_except('status', 'paidById', 'paidAt');
CREATE TRIGGER "immutable_PayrollLine" BEFORE UPDATE ON "PayrollLine" FOR EACH ROW EXECUTE FUNCTION fin_immutable_except('paid', 'reference');
CREATE TRIGGER "immutable_StatutoryPayment" BEFORE UPDATE ON "StatutoryPayment" FOR EACH ROW EXECUTE FUNCTION fin_immutable_except('paidAt', 'paidById', 'reference');

-- ── Purchase requests: the Head's limit, a second approval above it, cancelling, and the approved ceiling for the payment ──
CREATE OR REPLACE FUNCTION fin_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sum_items bigint;
  n_items   int;
  wf text[] := ARRAY['status', 'submittedAt', 'firstApprovedById', 'firstApprovedAt', 'approvedById', 'approvedAt', 'rejectedById', 'rejectedAt', 'rejectionReason',
                     'disbursedById', 'disbursedAt', 'approvedCeilingCents', 'overrunCents', 'overrunApprovedById', 'cancelledById', 'cancelledAt'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'Only a draft request can be deleted' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN RAISE EXCEPTION 'A request starts as a draft' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;

  IF (NEW."id", NEW."schoolId", NEW."requestNumber", NEW."requestedById", NEW."createdAt", NEW."legacyRequestId")
     IS DISTINCT FROM (OLD."id", OLD."schoolId", OLD."requestNumber", OLD."requestedById", OLD."createdAt", OLD."legacyRequestId") THEN
    RAISE EXCEPTION 'The number and the person who raised a request cannot change' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."status" = 'DRAFT' THEN
    IF NEW."status" NOT IN ('DRAFT', 'PENDING') THEN RAISE EXCEPTION 'A draft request must be submitted before it is approved' USING ERRCODE = 'check_violation'; END IF;
    IF NEW."status" = 'PENDING' THEN
      SELECT coalesce(sum("totalCents"), 0), count(*) INTO sum_items, n_items FROM "FinExpenseRequestItem" WHERE "requestId" = NEW."id";
      IF n_items = 0 OR sum_items <> NEW."estimatedCents" THEN
        RAISE EXCEPTION 'A request needs at least one line, and its total must equal the lines added up' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - wf) IS DISTINCT FROM (to_jsonb(OLD) - wf) THEN
    RAISE EXCEPTION 'A submitted request cannot be edited. Reject it and raise a new one.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."firstApprovedById" IS NOT NULL AND NEW."firstApprovedById" = NEW."requestedById" THEN
    RAISE EXCEPTION 'You raised this request, so someone else must approve it.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."overrunApprovedById" IS NOT NULL AND NEW."overrunApprovedById" IN (NEW."requestedById", NEW."disbursedById") THEN
    RAISE EXCEPTION 'The extra amount is approved by someone who neither raised nor paid the request.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN RETURN NEW; END IF;
  IF NOT ((OLD."status" = 'PENDING' AND NEW."status" IN ('APPROVED', 'REJECTED', 'CANCELLED')) OR (OLD."status" = 'APPROVED' AND NEW."status" = 'DISBURSED')) THEN
    RAISE EXCEPTION 'A request cannot go from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'APPROVED' THEN
    IF NEW."approvedById" = NEW."requestedById" THEN RAISE EXCEPTION 'You raised this request, so someone else must approve it.' USING ERRCODE = 'check_violation'; END IF;
    IF NEW."firstApprovedById" IS NOT NULL AND NEW."firstApprovedById" = NEW."approvedById" THEN
      RAISE EXCEPTION 'The second approval must come from a different person than the first.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."status" = 'REJECTED' AND NEW."rejectedById" = NEW."requestedById" THEN
    RAISE EXCEPTION 'You raised this request, so someone else must reject it.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'CANCELLED' AND NEW."cancelledById" IS DISTINCT FROM NEW."requestedById" THEN
    RAISE EXCEPTION 'Only the person who raised a request can cancel it' USING ERRCODE = 'check_violation';
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
ALTER TABLE "FinExpenseRequest" DROP CONSTRAINT "FinExpenseRequest_paid_has_person";
ALTER TABLE "FinExpenseRequest" ADD CONSTRAINT "FinExpenseRequest_paid_has_person" CHECK (("status" = 'DISBURSED') = ("disbursedById" IS NOT NULL AND "disbursedAt" IS NOT NULL));
ALTER TABLE "FinExpenseRequest" DROP CONSTRAINT "FinExpenseRequest_submitted";
ALTER TABLE "FinExpenseRequest" ADD CONSTRAINT "FinExpenseRequest_submitted" CHECK ("status" IN ('DRAFT', 'CANCELLED') OR "submittedAt" IS NOT NULL);

CREATE OR REPLACE FUNCTION fin_expense_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "FinExpenseRequest"%ROWTYPE;
BEGIN
  IF NEW."source" = 'REQUEST' THEN
    SELECT * INTO r FROM "FinExpenseRequest" WHERE "id" = NEW."requestId" FOR UPDATE;
    IF r."status" <> 'APPROVED' THEN RAISE EXCEPTION 'Only an approved request can be paid' USING ERRCODE = 'check_violation'; END IF;
    IF NEW."recordedById" IN (r."requestedById", r."approvedById") THEN
      RAISE EXCEPTION 'The person who raised or approved a request cannot pay it out.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."fundId" <> r."fundId" OR NEW."currency" <> r."currency" THEN
      RAISE EXCEPTION 'The expense must be paid from the request''s fund and in its currency' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."amountCents" > COALESCE(r."approvedCeilingCents", r."estimatedCents") THEN
      RAISE EXCEPTION 'The amount paid cannot be more than the amount approved (% cents)', COALESCE(r."approvedCeilingCents", r."estimatedCents") USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Voiding: a payment is voided by the Owner (permission), never by the person who recorded it; a sponsor award with money allocated is not voided ──
-- (the permission is checked in the service; the recorder rule stays in fin_void_guard)

-- ── Fee lines: eligibility by several forms, classes and subject combinations ──
ALTER TABLE "FinFeeItem" ADD CONSTRAINT "FinFeeItem_audience" CHECK (cardinality("levelIds") >= 0);

-- ── A charge made from a fee line has that line's term, fund and currency; a term bill has its amount, a pro-rated or difference charge no more ──
CREATE OR REPLACE FUNCTION fin_charge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f "FinFeeItem"%ROWTYPE;
BEGIN
  IF NEW."feeItemId" IS NOT NULL THEN
    SELECT * INTO f FROM "FinFeeItem" WHERE "id" = NEW."feeItemId";
    IF f."termId" <> NEW."termId" OR f."fundId" <> NEW."fundId" OR f."currency" <> NEW."currency" THEN
      RAISE EXCEPTION 'A charge made from a fee line must have that fee''s term, fund and currency' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."source" IN ('FEE_ITEM', 'MIGRATED') AND f."amountCents" <> NEW."amountCents" THEN
      RAISE EXCEPTION 'A term charge made from a fee line has that fee''s amount' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."amountCents" > f."amountCents" THEN
      RAISE EXCEPTION 'A charge cannot be more than the fee line it is made from' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
