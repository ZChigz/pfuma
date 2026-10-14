-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('M', 'F');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'TRANSFERRED', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_SCHOOL_SETTINGS';

-- AlterTable
ALTER TABLE "School" ADD COLUMN "maxClassSize" INTEGER NOT NULL DEFAULT 45;

-- AlterTable
ALTER TABLE "Student"
  ADD COLUMN "studentNumber"          TEXT,
  ADD COLUMN "firstName"              TEXT,
  ADD COLUMN "surname"                TEXT,
  ADD COLUMN "gender"                 "Gender",
  ADD COLUMN "dateOfBirth"            DATE,
  ADD COLUMN "enrollmentYear"         INTEGER,
  ADD COLUMN "guardianRelationship"   TEXT,
  ADD COLUMN "houseNumber"            TEXT,
  ADD COLUMN "suburb"                 TEXT,
  ADD COLUMN "city"                   TEXT,
  ADD COLUMN "address"                TEXT,
  ADD COLUMN "status"                 "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "birthCertificateNumber" TEXT,
  ADD COLUMN "previousSchool"         TEXT,
  ADD COLUMN "secondGuardianPhone"    TEXT,
  ADD COLUMN "medicalNotes"           TEXT,
  ADD COLUMN "photoUrl"               TEXT;

-- Existing inactive students have no recorded reason; treat them as withdrawn.
UPDATE "Student" SET "status" = 'WITHDRAWN' WHERE "active" = false;

-- CreateIndex
CREATE UNIQUE INDEX "Student_schoolId_studentNumber_key" ON "Student"("schoolId", "studentNumber");

-- CreateIndex
CREATE INDEX "Student_schoolId_surname_firstName_idx" ON "Student"("schoolId", "surname", "firstName");
