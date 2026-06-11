-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CREATE_USER';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_USER';
ALTER TYPE "AuditAction" ADD VALUE 'RESET_PASSWORD';
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_CLASS';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_CLASS';
ALTER TYPE "AuditAction" ADD VALUE 'MOVE_STUDENT';
ALTER TYPE "AuditAction" ADD VALUE 'BULK_APPLY_FEES';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ADMIN';

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "classId" TEXT;

-- AlterTable
ALTER TABLE "SubjectAssignment" ADD COLUMN     "classId" TEXT;

-- CreateTable
CREATE TABLE "SchoolClass" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "section" TEXT,
    "classTeacherId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolClass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolClass_schoolId_idx" ON "SchoolClass"("schoolId");

-- CreateIndex
CREATE INDEX "SchoolClass_schoolId_grade_idx" ON "SchoolClass"("schoolId", "grade");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolClass_schoolId_name_key" ON "SchoolClass"("schoolId", "name");

-- CreateIndex
CREATE INDEX "Student_schoolId_classId_idx" ON "Student"("schoolId", "classId");

-- CreateIndex
CREATE INDEX "SubjectAssignment_schoolId_classId_idx" ON "SubjectAssignment"("schoolId", "classId");

-- AddForeignKey
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_classTeacherId_fkey" FOREIGN KEY ("classTeacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectAssignment" ADD CONSTRAINT "SubjectAssignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;
