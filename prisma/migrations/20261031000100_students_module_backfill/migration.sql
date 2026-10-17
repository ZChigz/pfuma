-- Student Information module — step 2 of 3 (data). Idempotent; nobody gains or loses access and no student is lost.
--
--  1. Birth certificate numbers are stored normalised: capitals, no spaces or dashes (63-123456 A 42 → 63123456A42).
--     A number that would collide with another student's once normalised is left as it was.
--  2. Guardians who share a phone number in one school become ONE guardian record. The oldest record
--     survives, fills its blanks from the others, and every student link moves to it (flags are combined,
--     so nobody loses their primary guardian or fee payer). The duplicates are then removed.
--  3. The primary guardian of each student may collect the student (the new flag defaults to off).
--  4. Free-text medical notes are copied into the new medical profile (the old column is left, no longer read).
--  5. Students who already left (Transferred, Withdrawn, Graduated) get a completed leaving record,
--     and graduates an alumni record, so the leavers and alumni lists are not empty.
--  6. A role that could see students keeps doing so under the new key (students.profiles.view).
-- The row-change audit does nothing here because no person is acting (migrations are not logged).

-- 1 ─────────────────────────────────────────────────────────────────────────
WITH n AS (
  SELECT "id", "schoolId", "birthCertificateNumber" AS cur,
         NULLIF(upper(regexp_replace("birthCertificateNumber", '[[:space:]-]', '', 'g')), '') AS norm
    FROM "Student" WHERE "birthCertificateNumber" IS NOT NULL
), c AS (
  SELECT n.*,
         count(*) OVER (PARTITION BY n."schoolId", n.norm) AS same_norm,
         EXISTS (SELECT 1 FROM "Student" o WHERE o."schoolId" = n."schoolId" AND o."birthCertificateNumber" = n.norm AND o."id" <> n."id") AS taken
    FROM n
)
UPDATE "Student" s SET "birthCertificateNumber" = c.norm
  FROM c
 WHERE s."id" = c."id" AND c.norm IS DISTINCT FROM c.cur
   AND (c.norm IS NULL OR (c.same_norm = 1 AND NOT c.taken));

-- 2 ─────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE guardian_merge ON COMMIT DROP AS
SELECT g."id" AS dup_id, k.keep_id
  FROM "Guardian" g
  JOIN (SELECT DISTINCT ON ("schoolId", "phone") "schoolId", "phone", "id" AS keep_id
          FROM "Guardian" ORDER BY "schoolId", "phone", "createdAt", "id") k
    ON k."schoolId" = g."schoolId" AND k."phone" = g."phone"
 WHERE g."id" <> k.keep_id;

UPDATE "Guardian" k SET
  "altPhone"   = COALESCE(k."altPhone",   (SELECT d."altPhone"   FROM "Guardian" d JOIN guardian_merge m ON m.dup_id = d."id" WHERE m.keep_id = k."id" AND d."altPhone"   IS NOT NULL ORDER BY d."createdAt" LIMIT 1)),
  "email"      = COALESCE(k."email",      (SELECT d."email"      FROM "Guardian" d JOIN guardian_merge m ON m.dup_id = d."id" WHERE m.keep_id = k."id" AND d."email"      IS NOT NULL ORDER BY d."createdAt" LIMIT 1)),
  "nationalId" = COALESCE(k."nationalId", (SELECT d."nationalId" FROM "Guardian" d JOIN guardian_merge m ON m.dup_id = d."id" WHERE m.keep_id = k."id" AND d."nationalId" IS NOT NULL ORDER BY d."createdAt" LIMIT 1)),
  "address"    = COALESCE(k."address",    (SELECT d."address"    FROM "Guardian" d JOIN guardian_merge m ON m.dup_id = d."id" WHERE m.keep_id = k."id" AND d."address"    IS NOT NULL ORDER BY d."createdAt" LIMIT 1)),
  "occupation" = COALESCE(k."occupation", (SELECT d."occupation" FROM "Guardian" d JOIN guardian_merge m ON m.dup_id = d."id" WHERE m.keep_id = k."id" AND d."occupation" IS NOT NULL ORDER BY d."createdAt" LIMIT 1))
 WHERE k."id" IN (SELECT keep_id FROM guardian_merge);

-- One row per (student, surviving guardian) with the flags of every link that is being merged into it.
CREATE TEMP TABLE link_merge ON COMMIT DROP AS
SELECT sg."studentId", m.keep_id AS "guardianId",
       (array_agg(sg."relationship" ORDER BY sg."createdAt"))[1] AS "relationship",
       (array_agg(sg."relationshipNote" ORDER BY sg."createdAt"))[1] AS "relationshipNote",
       bool_or(sg."isPrimary") AS "isPrimary", bool_or(sg."isFeePayer") AS "isFeePayer", bool_or(sg."canReceiveSms") AS "canReceiveSms",
       min(sg."createdAt") AS "createdAt"
  FROM "StudentGuardian" sg JOIN guardian_merge m ON m.dup_id = sg."guardianId"
 GROUP BY sg."studentId", m.keep_id;

DELETE FROM "StudentGuardian" WHERE "guardianId" IN (SELECT dup_id FROM guardian_merge);

INSERT INTO "StudentGuardian" ("studentId", "guardianId", "relationship", "relationshipNote", "isPrimary", "isFeePayer", "canReceiveSms", "createdAt", "updatedAt")
SELECT "studentId", "guardianId", "relationship", "relationshipNote", "isPrimary", "isFeePayer", "canReceiveSms", "createdAt", CURRENT_TIMESTAMP FROM link_merge
ON CONFLICT ("studentId", "guardianId") DO UPDATE SET
  "isPrimary"     = "StudentGuardian"."isPrimary"     OR EXCLUDED."isPrimary",
  "isFeePayer"    = "StudentGuardian"."isFeePayer"    OR EXCLUDED."isFeePayer",
  "canReceiveSms" = "StudentGuardian"."canReceiveSms" OR EXCLUDED."canReceiveSms",
  "updatedAt"     = CURRENT_TIMESTAMP;

DELETE FROM "Guardian" WHERE "id" IN (SELECT dup_id FROM guardian_merge);

-- 3 ─────────────────────────────────────────────────────────────────────────
UPDATE "StudentGuardian" SET "canCollect" = true WHERE "isPrimary" AND NOT "canCollect";

-- 4 ─────────────────────────────────────────────────────────────────────────
INSERT INTO "MedicalProfile" ("id", "schoolId", "studentId", "notes", "updatedAt")
SELECT gen_random_uuid()::text, s."schoolId", s."id", btrim(s."medicalNotes"), CURRENT_TIMESTAMP
  FROM "Student" s
 WHERE s."medicalNotes" IS NOT NULL AND btrim(s."medicalNotes") <> ''
   AND NOT EXISTS (SELECT 1 FROM "MedicalProfile" m WHERE m."studentId" = s."id");

-- 5 ─────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE leaver ON COMMIT DROP AS
SELECT s."id" AS student_id, s."schoolId", s."status",
       COALESCE((SELECT max(e."endDate") FROM "Enrollment" e WHERE e."studentId" = s."id"),
                (SELECT max(e."startDate") FROM "Enrollment" e WHERE e."studentId" = s."id"),
                s."admissionDate")::date AS last_day,
       COALESCE(s."currentClassId", (SELECT e."classId" FROM "Enrollment" e WHERE e."studentId" = s."id" ORDER BY e."startDate" DESC LIMIT 1)) AS class_id,
       (SELECT u."id" FROM "User" u WHERE u."schoolId" = s."schoolId" ORDER BY (u."role" IN ('DIRECTOR', 'ADMIN')) DESC, u."createdAt" LIMIT 1) AS actor_id
  FROM "Student" s
 WHERE s."status" IN ('TRANSFERRED', 'WITHDRAWN', 'GRADUATED')
   AND NOT EXISTS (SELECT 1 FROM "StudentExit" x WHERE x."studentId" = s."id");

INSERT INTO "StudentExit" ("id", "schoolId", "studentId", "reason", "reasonNote", "state", "lastDay", "clearance", "overrideReason",
                           "startedById", "approvedById", "approvedAt", "completedAt", "resultingStatus", "lastClassId", "updatedAt")
SELECT gen_random_uuid()::text, l."schoolId", l.student_id,
       CASE l."status"
         WHEN 'TRANSFERRED' THEN 'TRANSFER'
         WHEN 'WITHDRAWN'   THEN 'WITHDRAWN_BY_GUARDIAN'
         ELSE CASE WHEN COALESCE((SELECT lv."order" FROM "SchoolClass" c JOIN "Level" lv ON lv."id" = c."levelId" WHERE c."id" = l.class_id), 4) >= 5
                   THEN 'COMPLETED_A_LEVEL' ELSE 'COMPLETED_O_LEVEL' END
       END::"ExitReason",
       'Recorded before the leaving process existed', 'COMPLETED', l.last_day, '[]'::jsonb, 'Recorded before the leaving process existed',
       l.actor_id, l.actor_id, l.last_day, l.last_day, l."status", l.class_id, CURRENT_TIMESTAMP
  FROM leaver l WHERE l.actor_id IS NOT NULL;

INSERT INTO "Alumnus" ("id", "schoolId", "studentId", "yearLeft", "lastClass", "updatedAt")
SELECT gen_random_uuid()::text, l."schoolId", l.student_id, extract(year FROM l.last_day)::int,
       (SELECT c."name" FROM "SchoolClass" c WHERE c."id" = l.class_id), CURRENT_TIMESTAMP
  FROM leaver l
 WHERE l."status" = 'GRADUATED'
   AND NOT EXISTS (SELECT 1 FROM "Alumnus" a WHERE a."studentId" = l.student_id);

-- 6 ─────────────────────────────────────────────────────────────────────────
INSERT INTO "RolePermission" ("id", "schoolId", "roleId", "permissionKey", "updatedAt")
SELECT gen_random_uuid()::text, rp."schoolId", rp."roleId",
       'students.profiles.view',
       CURRENT_TIMESTAMP
  FROM "RolePermission" rp
 WHERE rp."permissionKey" = 'students.list.view'
ON CONFLICT ("roleId", "permissionKey") DO NOTHING;
