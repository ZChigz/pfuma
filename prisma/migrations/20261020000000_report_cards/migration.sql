-- Part 4.4 / 4.5 / 4.6 — class size, grade boundaries per level and term,
-- grade snapshots, report-card content.

ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_GRADE_BOUNDARIES';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_REPORT_CARD';

-- 4.5 Boundaries per level and per term (both optional; null = applies to all).
ALTER TABLE "GradeBoundary" ADD COLUMN "levelId" TEXT, ADD COLUMN "termId" TEXT;
CREATE INDEX "GradeBoundary_schoolId_levelId_termId_idx" ON "GradeBoundary"("schoolId", "levelId", "termId");
ALTER TABLE "GradeBoundary" ADD CONSTRAINT "GradeBoundary_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GradeBoundary" ADD CONSTRAINT "GradeBoundary_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TRIGGER "same_school_GradeBoundary" BEFORE INSERT OR UPDATE OF "levelId", "termId" ON "GradeBoundary"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('levelId:Level', 'termId:AcademicTerm');

-- Boundary used for each mark's letter grade. Existing grades get the range of the
-- school boundary with the same letter.
ALTER TABLE "Mark" ADD COLUMN "gradeMinPercent" DECIMAL(14,2), ADD COLUMN "gradeMaxPercent" DECIMAL(14,2);
UPDATE "Mark" m
   SET "gradeMinPercent" = gb."minPercent", "gradeMaxPercent" = gb."maxPercent"
  FROM "GradeBoundary" gb
 WHERE gb."schoolId" = m."schoolId" AND gb."levelId" IS NULL AND gb."termId" IS NULL
   AND gb."letterGrade" = m."letterGrade" AND m."letterGrade" IS NOT NULL;

-- 4.4 / 4.6 TermResult
ALTER TABLE "TermResult"
  ADD COLUMN "classSize"          INTEGER,
  ADD COLUMN "letterGrade"        TEXT,
  ADD COLUMN "classTeacherRemark" TEXT,
  ADD COLUMN "daysPresent"        INTEGER,
  ADD COLUMN "daysAbsent"         INTEGER,
  ADD COLUMN "nextTermStartDate"  DATE;

-- Published results: class size = students in the class that term; the overall
-- grade is frozen from the boundaries in force today, so later edits cannot change it.
UPDATE "TermResult" tr
   SET "classSize" = (
     SELECT count(*) FROM "Enrollment" e2
      WHERE e2."termId" = tr."termId"
        AND e2."status" IN ('ACTIVE', 'PROMOTED', 'REPEATED', 'GRADUATED')
        AND e2."classId" = (SELECT e."classId" FROM "Enrollment" e WHERE e."studentId" = tr."studentId" AND e."termId" = tr."termId"));
UPDATE "TermResult" tr
   SET "letterGrade" = (
     SELECT gb."letterGrade" FROM "GradeBoundary" gb
      WHERE gb."schoolId" = tr."schoolId" AND gb."levelId" IS NULL AND gb."termId" IS NULL
        AND tr."percentage" >= gb."minPercent"
      ORDER BY gb."minPercent" DESC LIMIT 1)
 WHERE tr."published";
-- Next term start date for existing results.
UPDATE "TermResult" tr
   SET "nextTermStartDate" = (
     SELECT n."startDate" FROM "AcademicTerm" t JOIN "AcademicTerm" n ON n."schoolId" = t."schoolId" AND n."startDate" > t."startDate"
      WHERE t."id" = tr."termId" ORDER BY n."startDate" ASC LIMIT 1);
