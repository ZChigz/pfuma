-- Data migration for the settings tabs. Idempotent; nothing is deleted or changed in meaning.
--  * Stream list: every distinct, non-blank stream already used by a class (compared ignoring
--    capitals; the spelling of the earliest class is kept).
--  * Receipt format: a school that had chosen a receipt prefix, e.g. RCT, keeps the numbers it
--    expected: RCT-{000000} gives RCT-000001. The old prefix column stays.
--  * Admission numbers keep the format they have always had (STU2026 0001): the new columns'
--    defaults are exactly that.
--  * Grading: no rows are moved. A school's existing school-wide set keeps grading as before and
--    is what the Grading tab shows until a scale is saved for a category.
INSERT INTO "Stream" ("id", "schoolId", "name")
SELECT gen_random_uuid()::text, d."schoolId", d."stream"
  FROM (
    SELECT DISTINCT ON ("schoolId", lower(btrim("stream"))) "schoolId", btrim("stream") AS "stream"
      FROM "SchoolClass"
     WHERE btrim("stream") <> '' AND char_length(btrim("stream")) <= 30
     ORDER BY "schoolId", lower(btrim("stream")), "createdAt"
  ) d
 WHERE NOT EXISTS (SELECT 1 FROM "Stream" x WHERE x."schoolId" = d."schoolId" AND lower(x."name") = lower(d."stream"));

UPDATE "School"
   SET "receiptFormat" = "receiptPrefix" || '-{000000}'
 WHERE "receiptFormat" IS NULL AND "receiptPrefix" IS NOT NULL AND "receiptPrefix" ~ '^[A-Z0-9]{1,8}$';
