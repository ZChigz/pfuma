-- Part 1 — step 3 of 3: CONSTRAINTS
-- Runs after the backfill has filled every new column.

ALTER TABLE "SchoolClass"       ALTER COLUMN "levelId" SET NOT NULL,
                                ALTER COLUMN "stream"  SET NOT NULL;
ALTER TABLE "Student"           ALTER COLUMN "admissionNumber" SET NOT NULL,
                                ALTER COLUMN "admissionDate"   SET NOT NULL,
                                ALTER COLUMN "firstName"       SET NOT NULL,
                                ALTER COLUMN "surname"         SET NOT NULL;
ALTER TABLE "FeeStructure"      ALTER COLUMN "termId" SET NOT NULL;
ALTER TABLE "Charge"            ALTER COLUMN "termId" SET NOT NULL;
ALTER TABLE "SubjectAssignment" ALTER COLUMN "termId" SET NOT NULL;
ALTER TABLE "Mark"              ALTER COLUMN "termId" SET NOT NULL;
ALTER TABLE "TermResult"        ALTER COLUMN "termId" SET NOT NULL;

CREATE UNIQUE INDEX "Level_schoolId_name_key" ON "Level"("schoolId", "name");
CREATE UNIQUE INDEX "Level_schoolId_order_key" ON "Level"("schoolId", "order");
CREATE UNIQUE INDEX "AcademicYear_schoolId_year_key" ON "AcademicYear"("schoolId", "year");
CREATE UNIQUE INDEX "AcademicTerm_academicYearId_termNumber_key" ON "AcademicTerm"("academicYearId", "termNumber");
CREATE UNIQUE INDEX "Enrollment_studentId_termId_key" ON "Enrollment"("studentId", "termId");
CREATE UNIQUE INDEX "SchoolClass_schoolId_levelId_stream_key" ON "SchoolClass"("schoolId", "levelId", "stream");
CREATE UNIQUE INDEX "Student_schoolId_admissionNumber_key" ON "Student"("schoolId", "admissionNumber");
CREATE UNIQUE INDEX "Student_schoolId_birthCertificateNumber_key" ON "Student"("schoolId", "birthCertificateNumber");
CREATE UNIQUE INDEX "SubjectAssignment_subjectId_classId_termId_key" ON "SubjectAssignment"("subjectId", "classId", "termId");
CREATE UNIQUE INDEX "Mark_studentId_subjectId_termId_key" ON "Mark"("studentId", "subjectId", "termId");
CREATE UNIQUE INDEX "TermResult_studentId_termId_key" ON "TermResult"("studentId", "termId");

-- Rules Prisma cannot express in schema.prisma (keep these when generating
-- future migrations):
-- only one OPEN term per school …
CREATE UNIQUE INDEX "AcademicTerm_one_open_per_school" ON "AcademicTerm"("schoolId") WHERE "status" = 'OPEN';
-- … and at most one primary guardian per student.
CREATE UNIQUE INDEX "StudentGuardian_one_primary_per_student" ON "StudentGuardian"("studentId") WHERE "isPrimary";
