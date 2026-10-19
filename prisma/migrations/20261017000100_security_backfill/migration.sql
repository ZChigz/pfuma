-- Security hardening — step 2 of 3: BACKFILL (all-or-nothing, listed in RETRYABLE)
-- 1. Existing parent-portal links keep working but are stored only as a SHA-256
--    hash; the plaintext column is then emptied.
-- 2. Each hashed link expires at the end of the school's current academic year
--    (or one year from now when that has already passed / none is defined).
--    Links issued before this change were not generated from 32 random bytes,
--    so staff should regenerate them when convenient.

UPDATE "Student" AS s
SET "portalTokenHash"      = encode(sha256(convert_to(s."portalToken", 'UTF8')), 'hex'),
    "portalTokenCreatedAt" = s."createdAt",
    "portalTokenExpiresAt" = COALESCE(
      (SELECT (y."endDate")::timestamp + interval '23 hours 59 minutes'
         FROM "AcademicYear" y
        WHERE y."schoolId" = s."schoolId"
          AND y."startDate" <= CURRENT_DATE AND y."endDate" >= CURRENT_DATE
        ORDER BY y."endDate" DESC LIMIT 1),
      now() + interval '1 year')
WHERE s."portalToken" IS NOT NULL
  AND s."portalTokenHash" IS NULL;

UPDATE "Student" SET "portalToken" = NULL WHERE "portalToken" IS NOT NULL;
