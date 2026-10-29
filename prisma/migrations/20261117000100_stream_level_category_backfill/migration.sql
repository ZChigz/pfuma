-- A stream that only Form 5-6 classes use (compared ignoring case and spaces) is an A Level
-- stream. One used by both, or by no class, stays O Level. Nothing else changes.
UPDATE "Stream" s
   SET "category" = 'A_LEVEL'
 WHERE EXISTS (
         SELECT 1 FROM "SchoolClass" c JOIN "Level" l ON l."id" = c."levelId"
          WHERE c."schoolId" = s."schoolId" AND lower(btrim(c."stream")) = lower(s."name") AND l."category" = 'A_LEVEL')
   AND NOT EXISTS (
         SELECT 1 FROM "SchoolClass" c JOIN "Level" l ON l."id" = c."levelId"
          WHERE c."schoolId" = s."schoolId" AND lower(btrim(c."stream")) = lower(s."name") AND l."category" = 'O_LEVEL');
