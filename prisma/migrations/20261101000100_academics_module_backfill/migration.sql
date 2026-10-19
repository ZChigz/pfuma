-- Academics module — step 2 of 2 (data). Idempotent; nobody gains or loses access to anything they use today.
--
--  1. Every existing subject gets a short name and a department ("General", which the school then renames or splits).
--  2. Every existing subject is offered at every form of its school, as core or elective like its old type said.
--  3. Every existing subject assignment (marks entry) becomes a teacher assignment for the whole of its term.
--  4. Today's class teachers become the class teacher of the OPEN term, with the CLASS_TEACHER role scoped to the class.
--  5. The students of each class take the subjects their class has a teacher for in the open term.
--  6. Teachers and class teachers get the own-class keys of Academics (a school created later gets them from seed_school_roles).
-- No person is acting in a migration, so the row-change audit writes nothing here.

-- 1 ─────────────────────────────────────────────────────────────────────────
INSERT INTO "Department" ("id", "schoolId", "name", "updatedAt")
SELECT gen_random_uuid()::text, s."schoolId", 'General', CURRENT_TIMESTAMP
  FROM (SELECT DISTINCT "schoolId" FROM "Subject" WHERE "departmentId" IS NULL) s
ON CONFLICT ("schoolId", "name") DO NOTHING;

UPDATE "Subject" sub SET "departmentId" = d."id"
  FROM "Department" d
 WHERE sub."departmentId" IS NULL AND d."schoolId" = sub."schoolId" AND d."name" = 'General';

UPDATE "Subject" SET "shortName" = left("name", 14) WHERE "shortName" IS NULL;

-- 2 ─────────────────────────────────────────────────────────────────────────
INSERT INTO "SubjectLevel" ("id", "schoolId", "subjectId", "levelId", "type", "updatedAt")
SELECT gen_random_uuid()::text, sub."schoolId", sub."id", l."id", sub."type", CURRENT_TIMESTAMP
  FROM "Subject" sub JOIN "Level" l ON l."schoolId" = sub."schoolId" AND l."active"
ON CONFLICT ("subjectId", "levelId") DO NOTHING;

-- 3 ─────────────────────────────────────────────────────────────────────────
-- A closed term is read-only for everyone, but history still has to be carried over into it.
ALTER TABLE "TeacherAssignment" DISABLE TRIGGER "closed_term_TeacherAssignment";
INSERT INTO "TeacherAssignment" ("id", "schoolId", "termId", "teacherId", "subjectId", "classId", "periodsPerWeek", "doublesPerWeek", "startDate", "status", "updatedAt")
SELECT gen_random_uuid()::text, sa."schoolId", sa."termId", sa."teacherId", sa."subjectId", sa."classId", 4, 0, t."startDate", 'ACTIVE', CURRENT_TIMESTAMP
  FROM "SubjectAssignment" sa JOIN "AcademicTerm" t ON t."id" = sa."termId"
 WHERE NOT EXISTS (
   SELECT 1 FROM "TeacherAssignment" ta
    WHERE ta."termId" = sa."termId" AND ta."subjectId" = sa."subjectId" AND ta."classId" = sa."classId" AND ta."status" = 'ACTIVE');
ALTER TABLE "TeacherAssignment" ENABLE TRIGGER "closed_term_TeacherAssignment";

-- 4 ─────────────────────────────────────────────────────────────────────────
INSERT INTO "ClassTeacher" ("id", "schoolId", "classId", "termId", "userId", "updatedAt")
SELECT gen_random_uuid()::text, c."schoolId", c."id", t."id", c."classTeacherId", CURRENT_TIMESTAMP
  FROM "SchoolClass" c JOIN "AcademicTerm" t ON t."schoolId" = c."schoolId" AND t."status" = 'OPEN'
 WHERE c."classTeacherId" IS NOT NULL
ON CONFLICT ("classId", "termId") DO NOTHING;

INSERT INTO "UserRole" ("id", "schoolId", "userId", "roleId", "scopeType", "scopeId", "updatedAt")
SELECT gen_random_uuid()::text, c."schoolId", c."classTeacherId", rd."id", 'CLASS', c."id", CURRENT_TIMESTAMP
  FROM "SchoolClass" c JOIN "RoleDefinition" rd ON rd."schoolId" = c."schoolId" AND rd."key" = 'CLASS_TEACHER'
 WHERE c."classTeacherId" IS NOT NULL
ON CONFLICT ("userId", "roleId", "scopeType", "scopeId") DO NOTHING;

-- 5 ─────────────────────────────────────────────────────────────────────────
INSERT INTO "StudentSubject" ("id", "schoolId", "studentId", "subjectId", "termId", "source", "updatedAt")
SELECT gen_random_uuid()::text, e."schoolId", e."studentId", ta."subjectId", e."termId",
       CASE WHEN sl."type" = 'ELECTIVE' THEN 'CHOSEN'::"StudentSubjectSource" ELSE 'CORE'::"StudentSubjectSource" END, CURRENT_TIMESTAMP
  FROM "Enrollment" e
  JOIN "AcademicTerm" t ON t."id" = e."termId" AND t."status" = 'OPEN'
  JOIN "SchoolClass" c ON c."id" = e."classId"
  JOIN "TeacherAssignment" ta ON ta."classId" = e."classId" AND ta."termId" = e."termId" AND ta."status" = 'ACTIVE'
  LEFT JOIN "SubjectLevel" sl ON sl."subjectId" = ta."subjectId" AND sl."levelId" = c."levelId"
 WHERE e."status" = 'ACTIVE'
ON CONFLICT ("studentId", "subjectId", "termId") DO NOTHING;

-- 6 ─────────────────────────────────────────────────────────────────────────
INSERT INTO "RolePermission" ("id", "schoolId", "roleId", "permissionKey", "updatedAt")
SELECT gen_random_uuid()::text, rd."schoolId", rd."id", k, CURRENT_TIMESTAMP
  FROM "RoleDefinition" rd CROSS JOIN LATERAL unnest(academics_role_keys(rd."key")) AS k
ON CONFLICT ("roleId", "permissionKey") DO NOTHING;
