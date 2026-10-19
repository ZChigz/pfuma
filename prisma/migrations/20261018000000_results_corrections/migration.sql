-- Part 4.1 — corrections after publishing.
-- * Mark.firstVerifiedAt: remembers that a mark was verified once, even after the
--   Head unlocks it, so later changes can require a reason.
-- * MarkChange: history of every change made after first verification.
-- * Audit actions for reopening a closed term and changing a verified mark.

ALTER TYPE "AuditAction" ADD VALUE 'REOPEN_TERM';
ALTER TYPE "AuditAction" ADD VALUE 'CHANGE_MARK';

ALTER TABLE "Mark" ADD COLUMN "firstVerifiedAt" TIMESTAMP(3);
-- Marks verified or published before this change count as verified once.
UPDATE "Mark" SET "firstVerifiedAt" = COALESCE("verifiedAt", "enteredAt")
 WHERE "status" IN ('VERIFIED', 'PUBLISHED');

CREATE TABLE "MarkChange" (
    "id"          TEXT NOT NULL,
    "schoolId"    TEXT NOT NULL,
    "markId"      TEXT NOT NULL,
    "oldRawMark"  DECIMAL(14,2) NOT NULL,
    "newRawMark"  DECIMAL(14,2) NOT NULL,
    "changedById" TEXT NOT NULL,
    "reason"      TEXT NOT NULL,
    "changedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarkChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MarkChange_schoolId_idx" ON "MarkChange"("schoolId");
CREATE INDEX "MarkChange_markId_idx" ON "MarkChange"("markId");
ALTER TABLE "MarkChange" ADD CONSTRAINT "MarkChange_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarkChange" ADD CONSTRAINT "MarkChange_markId_fkey" FOREIGN KEY ("markId") REFERENCES "Mark"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarkChange" ADD CONSTRAINT "MarkChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Same protections as the other school-owned tables (see 20261017000200).
ALTER TABLE "MarkChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarkChange" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "MarkChange" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
CREATE TRIGGER "same_school_MarkChange" BEFORE INSERT OR UPDATE OF "markId", "changedById" ON "MarkChange"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('markId:Mark', 'changedById:User');
-- The history cannot be rewritten.
CREATE TRIGGER "mark_change_no_change" BEFORE UPDATE OR DELETE ON "MarkChange"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
