-- DropForeignKey
ALTER TABLE "SubjectAssignment" DROP CONSTRAINT "SubjectAssignment_classId_fkey";

-- DropIndex
DROP INDEX "SubjectAssignment_schoolId_classId_idx";

-- AlterTable
ALTER TABLE "Subject" DROP COLUMN "grade",
ALTER COLUMN "maxMark" SET DEFAULT 100,
ALTER COLUMN "type" SET DEFAULT 'CORE';

-- AlterTable
ALTER TABLE "SubjectAssignment" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "classId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Subject_schoolId_code_key" ON "Subject"("schoolId", "code");

-- CreateIndex
CREATE INDEX "SubjectAssignment_teacherId_schoolId_idx" ON "SubjectAssignment"("teacherId", "schoolId");

-- AddForeignKey
ALTER TABLE "SubjectAssignment" ADD CONSTRAINT "SubjectAssignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
