-- Part 4.2 / 4.3 — absences, exemptions, fair averages, pass grade, O Level ranking.

ALTER TYPE "MarkStatus" ADD VALUE 'ABSENT';
ALTER TYPE "MarkStatus" ADD VALUE 'EXEMPT';
ALTER TYPE "AuditAction" ADD VALUE 'EXCUSE_ABSENCE';

CREATE TYPE "RankingMode" AS ENUM ('AVERAGE', 'PASSES_THEN_AVERAGE');

ALTER TABLE "School"
  ADD COLUMN "passGrade"     TEXT NOT NULL DEFAULT 'C',
  ADD COLUMN "oLevelRanking" "RankingMode" NOT NULL DEFAULT 'AVERAGE';

ALTER TABLE "Mark"
  ADD COLUMN "absenceReason" TEXT,
  ADD COLUMN "excused"       BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "TermResult"
  ADD COLUMN "subjectsTaken"     INTEGER,
  ADD COLUMN "averagePercentage" DECIMAL(14,2),
  ADD COLUMN "subjectsPassed"    INTEGER;

-- Results published before this change: the new columns start from the old ones
-- (subjectsPassed stays empty until the class is published again).
UPDATE "TermResult"
   SET "subjectsTaken" = "subjectsSat", "averagePercentage" = "percentage";
