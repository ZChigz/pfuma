-- Part 1 — step 1 of 3: EXPAND
-- Adds levels, academic years/terms, enrollments and guardians, plus the new
-- foreign-key columns, all nullable so existing rows stay valid. Nothing is
-- dropped: legacy columns (grade, term strings, parentName/parentPhone, active,
-- currentTerm, …) are kept until the contract migration, after the backfill has
-- copied their data and no code reads them. Their NOT NULL constraints are
-- relaxed because the new code no longer writes them.

-- CreateEnum
CREATE TYPE "LevelCategory" AS ENUM ('O_LEVEL', 'A_LEVEL');
CREATE TYPE "TermStatus" AS ENUM ('PLANNED', 'OPEN', 'CLOSED');
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'PROMOTED', 'REPEATED', 'TRANSFERRED_OUT', 'WITHDRAWN', 'GRADUATED');
CREATE TYPE "GuardianRelationship" AS ENUM ('FATHER', 'MOTHER', 'UNCLE', 'AUNT', 'GRANDPARENT', 'SIBLING', 'GUARDIAN', 'OTHER');

-- AlterEnum (new audit actions; not used until later migrations/code)
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_ACADEMIC_YEAR';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_ACADEMIC_TERM';
ALTER TYPE "AuditAction" ADD VALUE 'OPEN_TERM';
ALTER TYPE "AuditAction" ADD VALUE 'CLOSE_TERM';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIT_STUDENT';
ALTER TYPE "AuditAction" ADD VALUE 'TRANSFER_CLASS';
ALTER TYPE "AuditAction" ADD VALUE 'PROMOTE_STUDENT';
ALTER TYPE "AuditAction" ADD VALUE 'REPEAT_STUDENT';
ALTER TYPE "AuditAction" ADD VALUE 'TRANSFER_OUT_STUDENT';
ALTER TYPE "AuditAction" ADD VALUE 'WITHDRAW_STUDENT';
ALTER TYPE "AuditAction" ADD VALUE 'GRADUATE_STUDENT';
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_GUARDIAN';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_GUARDIAN';
ALTER TYPE "AuditAction" ADD VALUE 'LINK_GUARDIAN';
ALTER TYPE "AuditAction" ADD VALUE 'UNLINK_GUARDIAN';
ALTER TYPE "AuditAction" ADD VALUE 'SET_PRIMARY_GUARDIAN';

-- New tables ------------------------------------------------------------------

CREATE TABLE "Level" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "category" "LevelCategory" NOT NULL,
    CONSTRAINT "Level_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcademicYear" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AcademicYear_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcademicTerm" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "termNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "TermStatus" NOT NULL DEFAULT 'PLANNED',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AcademicTerm_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AcademicTerm_termNumber_check" CHECK ("termNumber" BETWEEN 1 AND 3)
);

CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Guardian" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "altPhone" TEXT,
    "email" TEXT,
    "nationalId" TEXT,
    "address" TEXT,
    "occupation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Guardian_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentGuardian" (
    "studentId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "relationship" "GuardianRelationship" NOT NULL,
    "relationshipNote" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isFeePayer" BOOLEAN NOT NULL DEFAULT false,
    "canReceiveSms" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentGuardian_pkey" PRIMARY KEY ("studentId", "guardianId")
);

-- New columns on existing tables (nullable until the backfill) ----------------

ALTER TABLE "SchoolClass"
    ADD COLUMN "levelId"  TEXT,
    ADD COLUMN "stream"   TEXT,
    ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 45;

ALTER TABLE "Student"
    ADD COLUMN "admissionNumber" TEXT,
    ADD COLUMN "admissionDate"   DATE,
    ADD COLUMN "currentClassId"  TEXT;

ALTER TABLE "FeeStructure"      ADD COLUMN "levelId" TEXT, ADD COLUMN "termId" TEXT;
ALTER TABLE "Charge"            ADD COLUMN "termId" TEXT;
ALTER TABLE "SubjectAssignment" ADD COLUMN "termId" TEXT;
ALTER TABLE "Mark"              ADD COLUMN "termId" TEXT;
ALTER TABLE "TermResult"        ADD COLUMN "termId" TEXT;

-- Legacy columns: keep the data, stop requiring it ----------------------------

ALTER TABLE "SchoolClass"       ALTER COLUMN "grade"       DROP NOT NULL;
ALTER TABLE "Student"           ALTER COLUMN "grade"       DROP NOT NULL,
                                ALTER COLUMN "parentName"  DROP NOT NULL,
                                ALTER COLUMN "parentPhone" DROP NOT NULL;
ALTER TABLE "FeeStructure"      ALTER COLUMN "grade"       DROP NOT NULL,
                                ALTER COLUMN "term"        DROP NOT NULL;
ALTER TABLE "Charge"            ALTER COLUMN "term"        DROP NOT NULL;
ALTER TABLE "SubjectAssignment" ALTER COLUMN "term"        DROP NOT NULL;
ALTER TABLE "Mark"              ALTER COLUMN "term"        DROP NOT NULL;
ALTER TABLE "TermResult"        ALTER COLUMN "term"        DROP NOT NULL;

-- Non-unique indexes and foreign keys (safe on empty/nullable columns) --------

CREATE INDEX "Level_schoolId_idx" ON "Level"("schoolId");
CREATE INDEX "AcademicYear_schoolId_idx" ON "AcademicYear"("schoolId");
CREATE INDEX "AcademicTerm_schoolId_idx" ON "AcademicTerm"("schoolId");
CREATE INDEX "AcademicTerm_schoolId_status_idx" ON "AcademicTerm"("schoolId", "status");
CREATE INDEX "Enrollment_schoolId_idx" ON "Enrollment"("schoolId");
CREATE INDEX "Enrollment_termId_classId_idx" ON "Enrollment"("termId", "classId");
CREATE INDEX "Guardian_schoolId_idx" ON "Guardian"("schoolId");
CREATE INDEX "Guardian_schoolId_phone_idx" ON "Guardian"("schoolId", "phone");
CREATE INDEX "StudentGuardian_guardianId_idx" ON "StudentGuardian"("guardianId");
CREATE INDEX "Student_schoolId_currentClassId_idx" ON "Student"("schoolId", "currentClassId");
CREATE INDEX "FeeStructure_termId_idx" ON "FeeStructure"("termId");
CREATE INDEX "Charge_termId_idx" ON "Charge"("termId");
CREATE INDEX "SubjectAssignment_termId_idx" ON "SubjectAssignment"("termId");
CREATE INDEX "Mark_termId_idx" ON "Mark"("termId");
CREATE INDEX "TermResult_termId_idx" ON "TermResult"("termId");

ALTER TABLE "Level" ADD CONSTRAINT "Level_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcademicYear" ADD CONSTRAINT "AcademicYear_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcademicTerm" ADD CONSTRAINT "AcademicTerm_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcademicTerm" ADD CONSTRAINT "AcademicTerm_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcademicTerm" ADD CONSTRAINT "AcademicTerm_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Guardian" ADD CONSTRAINT "Guardian_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentGuardian" ADD CONSTRAINT "StudentGuardian_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentGuardian" ADD CONSTRAINT "StudentGuardian_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Student" ADD CONSTRAINT "Student_currentClassId_fkey" FOREIGN KEY ("currentClassId") REFERENCES "SchoolClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FeeStructure" ADD CONSTRAINT "FeeStructure_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FeeStructure" ADD CONSTRAINT "FeeStructure_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubjectAssignment" ADD CONSTRAINT "SubjectAssignment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TermResult" ADD CONSTRAINT "TermResult_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
