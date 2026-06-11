-- CreateEnum
CREATE TYPE "MarkStatus" AS ENUM ('DRAFT', 'VERIFIED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "AssignmentMarkStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'VERIFIED', 'PUBLISHED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'VERIFY_MARKS';
ALTER TYPE "AuditAction" ADD VALUE 'UNVERIFY_MARKS';

-- AlterTable
ALTER TABLE "Mark" ADD COLUMN     "status" "MarkStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SubjectAssignment" ADD COLUMN     "marksStatus" "AssignmentMarkStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "marksVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "marksVerifiedById" TEXT;

-- AddForeignKey
ALTER TABLE "SubjectAssignment" ADD CONSTRAINT "SubjectAssignment_marksVerifiedById_fkey" FOREIGN KEY ("marksVerifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
