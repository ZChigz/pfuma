-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "exchangeRateUsed" DECIMAL(14,2),
ADD COLUMN     "paidInZig" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "zigAmountPaid" DECIMAL(14,2);
