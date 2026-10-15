-- Data migration for Dashboard & System. Idempotent; moves nothing, loses nothing.
--  * Every existing school gets an ACTIVE subscription with no end date and no student
--    limit, so nothing stops working the day this ships.
--  * All modules stay on (no SchoolModule rows means on).
--  * Existing schools keep their data; the new profile columns are NULL or defaults.
INSERT INTO "Subscription" ("id", "schoolId", "plan", "status", "startsAt", "endsAt", "studentLimit", "updatedAt")
SELECT gen_random_uuid()::text, s."id", 'STANDARD', 'ACTIVE', s."createdAt", NULL, NULL, CURRENT_TIMESTAMP
  FROM "School" s
 WHERE NOT EXISTS (SELECT 1 FROM "Subscription" x WHERE x."schoolId" = s."id");
