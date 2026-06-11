-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'DISBURSED');

-- CreateEnum
CREATE TYPE "ExpenseRequestType" AS ENUM ('PURCHASE_ORDER', 'UTILITY_BILL', 'FUEL', 'SALARY_ADVANCE', 'MAINTENANCE', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CREATE_EXPENSE_REQUEST';
ALTER TYPE "AuditAction" ADD VALUE 'SUBMIT_EXPENSE_REQUEST';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVE_EXPENSE_REQUEST';
ALTER TYPE "AuditAction" ADD VALUE 'REJECT_EXPENSE_REQUEST';
ALTER TYPE "AuditAction" ADD VALUE 'DISBURSE_EXPENSE_REQUEST';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "expenseRequestId" TEXT;

-- CreateTable
CREATE TABLE "ExpenseRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ExpenseRequestType" NOT NULL,
    "department" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "estimatedTotal" DECIMAL(14,2) NOT NULL,
    "actualTotal" DECIMAL(14,2),
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "disbursedById" TEXT,
    "disbursedAt" TIMESTAMP(3),
    "disbursementNote" TEXT,
    "paymentMethod" "PaymentMethod",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ExpenseRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseRequest_schoolId_idx" ON "ExpenseRequest"("schoolId");

-- CreateIndex
CREATE INDEX "ExpenseRequest_schoolId_status_idx" ON "ExpenseRequest"("schoolId", "status");

-- CreateIndex
CREATE INDEX "ExpenseRequest_requestedById_idx" ON "ExpenseRequest"("requestedById");

-- CreateIndex
CREATE INDEX "ExpenseRequestItem_requestId_idx" ON "ExpenseRequestItem"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_expenseRequestId_key" ON "Expense"("expenseRequestId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_expenseRequestId_fkey" FOREIGN KEY ("expenseRequestId") REFERENCES "ExpenseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRequest" ADD CONSTRAINT "ExpenseRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRequest" ADD CONSTRAINT "ExpenseRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRequest" ADD CONSTRAINT "ExpenseRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRequest" ADD CONSTRAINT "ExpenseRequest_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRequest" ADD CONSTRAINT "ExpenseRequest_disbursedById_fkey" FOREIGN KEY ("disbursedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRequestItem" ADD CONSTRAINT "ExpenseRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ExpenseRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

