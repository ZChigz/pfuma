-- Dashboard setup checklist: province, ZIMSEC centre number, receipt numbering,
-- and a switch to keep the checklist on the dashboard once it is complete.
-- Every column is nullable or has a default, so existing schools keep working and
-- simply see the matching checklist steps as not done yet. No rows need moving.
ALTER TABLE "School"
  ADD COLUMN "province"             TEXT,
  ADD COLUMN "zimsecCentreNumber"   TEXT,
  ADD COLUMN "receiptPrefix"        TEXT,
  ADD COLUMN "receiptNextNumber"    INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "setupChecklistPinned" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "School_receiptNextNumber_positive" CHECK ("receiptNextNumber" >= 1);
