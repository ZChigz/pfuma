-- Calendar page: event types, times, audience, location, repeats, preloaded public holidays.
--
-- Data: existing events keep every value. The old type HOLIDAY is renamed in place to
-- PUBLIC_HOLIDAY (so no row changes meaning), and each new column is defaulted:
-- all-day, no times, no repeat, audience all staff. Nothing needs a separate backfill.

ALTER TYPE "CalendarEventKind" RENAME VALUE 'HOLIDAY' TO 'PUBLIC_HOLIDAY';
ALTER TYPE "CalendarEventKind" ADD VALUE 'CULTURAL';
ALTER TYPE "CalendarEventKind" ADD VALUE 'VISITING_DAY';
ALTER TYPE "CalendarEventKind" ADD VALUE 'PRIZE_GIVING';

CREATE TYPE "CalendarRepeat" AS ENUM ('NONE', 'WEEKLY', 'MONTHLY', 'YEARLY');
CREATE TYPE "CalendarAudience" AS ENUM ('ALL_STAFF', 'FORMS', 'CLASSES', 'BOARDERS');

ALTER TABLE "CalendarEvent"
  ADD COLUMN "allDay"           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "startTime"        TEXT,
  ADD COLUMN "endTime"          TEXT,
  ADD COLUMN "location"         TEXT,
  ADD COLUMN "repeat"           "CalendarRepeat" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "repeatUntil"      DATE,
  ADD COLUMN "audience"         "CalendarAudience" NOT NULL DEFAULT 'ALL_STAFF',
  ADD COLUMN "audienceLevelIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "audienceClassIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "autoKey"          TEXT;

ALTER TABLE "CalendarEvent"
  ADD CONSTRAINT "CalendarEvent_title_length"  CHECK (char_length("title") BETWEEN 1 AND 120),
  ADD CONSTRAINT "CalendarEvent_time_format"   CHECK (("startTime" IS NULL OR "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND ("endTime" IS NULL OR "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')),
  ADD CONSTRAINT "CalendarEvent_timed_needs_times" CHECK ("allDay" OR ("startTime" IS NOT NULL AND "endTime" IS NOT NULL)),
  ADD CONSTRAINT "CalendarEvent_end_time_after_start" CHECK ("startDate" <> "endDate" OR "allDay" OR "endTime" >= "startTime"),
  ADD CONSTRAINT "CalendarEvent_repeat_needs_end" CHECK ("repeat" = 'NONE' OR "repeatUntil" IS NOT NULL),
  ADD CONSTRAINT "CalendarEvent_repeat_end_after_start" CHECK ("repeatUntil" IS NULL OR "repeatUntil" >= "startDate"),
  ADD CONSTRAINT "CalendarEvent_audience_ids" CHECK (
    ("audience" = 'FORMS' AND cardinality("audienceLevelIds") > 0 AND cardinality("audienceClassIds") = 0) OR
    ("audience" = 'CLASSES' AND cardinality("audienceClassIds") > 0 AND cardinality("audienceLevelIds") = 0) OR
    ("audience" IN ('ALL_STAFF', 'BOARDERS') AND cardinality("audienceLevelIds") = 0 AND cardinality("audienceClassIds") = 0)
  );

CREATE UNIQUE INDEX "CalendarEvent_schoolId_autoKey_key" ON "CalendarEvent"("schoolId", "autoKey");

CREATE TABLE "CalendarHolidayYear" (
    "id"       TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "year"     INTEGER NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarHolidayYear_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CalendarHolidayYear_schoolId_year_key" ON "CalendarHolidayYear"("schoolId", "year");
ALTER TABLE "CalendarHolidayYear" ADD CONSTRAINT "CalendarHolidayYear_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarHolidayYear" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarHolidayYear" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "CalendarHolidayYear" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
CREATE TRIGGER "audit_CalendarHolidayYear" AFTER INSERT OR UPDATE OR DELETE ON "CalendarHolidayYear"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
