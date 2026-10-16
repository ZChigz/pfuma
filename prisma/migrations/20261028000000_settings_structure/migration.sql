-- Settings tabs 2 to 6: forms on/off, the stream list, grading scales per level category with
-- points and remarks, currencies, receipt / invoice / admission number formats.
-- Everything is added with a default that keeps today's behaviour; the next migration fills
-- the new tables and columns from the data schools already have.

ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_FORMS';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_STREAMS';
ALTER TYPE "AuditAction" ADD VALUE 'ARCHIVE_CLASS';
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_CLASS';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_GRADING';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_FINANCE_SETTINGS';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_NUMBERING';

-- Forms
ALTER TABLE "Level" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- Streams
CREATE TABLE "Stream" (
    "id"        TEXT NOT NULL,
    "schoolId"  TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Stream_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Stream_name_not_blank" CHECK (btrim("name") <> '' AND char_length("name") <= 30)
);
CREATE UNIQUE INDEX "Stream_schoolId_name_key" ON "Stream"("schoolId", "name");
-- "north" and "North" are the same stream.
CREATE UNIQUE INDEX "Stream_schoolId_lower_name_key" ON "Stream"("schoolId", lower("name"));
CREATE INDEX "Stream_schoolId_idx" ON "Stream"("schoolId");
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stream" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Stream" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Stream" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
CREATE TRIGGER "audit_Stream" AFTER INSERT OR UPDATE OR DELETE ON "Stream"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- Grading: a scale per level category, with points and a remark per grade
ALTER TABLE "GradeBoundary"
  ADD COLUMN "category" "LevelCategory",
  ADD COLUMN "points"   INTEGER,
  ADD COLUMN "remark"   TEXT,
  ADD CONSTRAINT "GradeBoundary_points_not_negative" CHECK ("points" IS NULL OR "points" >= 0),
  -- A category scale belongs to the whole school: no level, no term.
  ADD CONSTRAINT "GradeBoundary_category_is_school_wide" CHECK ("category" IS NULL OR ("levelId" IS NULL AND "termId" IS NULL));
CREATE INDEX "GradeBoundary_schoolId_category_idx" ON "GradeBoundary"("schoolId", "category");

-- Finance basics and numbering
ALTER TABLE "School"
  ADD COLUMN "currencyUsdEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "currencyZigEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "receiptFormat"      TEXT,
  ADD COLUMN "invoiceFormat"      TEXT,
  ADD COLUMN "invoiceNextNumber"  INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "schoolCode"         TEXT NOT NULL DEFAULT 'STU',
  ADD COLUMN "admissionFormat"    TEXT NOT NULL DEFAULT '{SCHOOLCODE}{YEAR}{0000}',
  ADD CONSTRAINT "School_invoiceNextNumber_positive" CHECK ("invoiceNextNumber" >= 1),
  ADD CONSTRAINT "School_one_currency_on" CHECK ("currencyUsdEnabled" OR "currencyZigEnabled"),
  -- The currency shown first must be one that is switched on.
  ADD CONSTRAINT "School_default_currency_on" CHECK (("defaultCurrency" = 'USD' AND "currencyUsdEnabled") OR ("defaultCurrency" = 'ZIG' AND "currencyZigEnabled")),
  ADD CONSTRAINT "School_schoolCode_format" CHECK ("schoolCode" ~ '^[A-Z0-9]{1,8}$'),
  ADD CONSTRAINT "School_admissionFormat_has_counter" CHECK ("admissionFormat" ~ '\{0+\}');
