-- Examinations core — step 2 of 2 (data). Idempotent; nobody gains access to anything outside the module and nothing is lost.
--
--  1. Roles that already exist get the keys of the module (a school created later gets them from seed_school_roles).
--  2. Every school gets the eight assessment types.
--  3. The marks of the first results screens (Mark: one score per student, subject and term) are carried into the new
--     structure: each teacher assignment that has marks gets a mark sheet and one assessment, "Term mark (imported)", of
--     the type Other with the subject's maximum mark; each old mark becomes a mark of that assessment (a score, AB or EX),
--     and a plan "Imported marks" (Other, 100%) is made for any term and level that has none.
--  4. Old VERIFIED and PUBLISHED marks give their sheet the same status, and a subject result (published for PUBLISHED marks).
--  5. Older overall results get the class they belong to.
-- The old tables are not touched, so the first results screens keep working. Marks that cannot be matched to a teacher
-- assignment (the student had no class in that term, or nobody teaches the subject to it) stay only in the old table; a
-- NOTICE says how many. No person is acting in a migration, so the row-change audit writes nothing here.

-- 1 ─────────────────────────────────────────────────────────────────────────
INSERT INTO "RolePermission" ("id", "schoolId", "roleId", "permissionKey", "updatedAt")
SELECT gen_random_uuid()::text, rd."schoolId", rd."id", k, CURRENT_TIMESTAMP
  FROM "RoleDefinition" rd CROSS JOIN LATERAL unnest(exams_role_keys(rd."key")) AS k
ON CONFLICT ("roleId", "permissionKey") DO NOTHING;

-- 2 ─────────────────────────────────────────────────────────────────────────
INSERT INTO "AssessmentType" ("id", "schoolId", "name", "isProject", "commonExam", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, s."id", v."name", v."isProject", v."commonExam", v."sortOrder", CURRENT_TIMESTAMP
  FROM "School" s
  CROSS JOIN (VALUES
    ('Class test',           false, false, 0), ('Assignment',     false, false, 1), ('Practical',  false, false, 2), ('Mid-term test', false, false, 3),
    ('End-of-term exam',     false, true,  4), ('Mock exam',      false, true,  5), ('School-based project', true, false, 6), ('Other', false, false, 7)
  ) AS v("name", "isProject", "commonExam", "sortOrder")
 WHERE NOT EXISTS (SELECT 1 FROM "AssessmentType" t WHERE t."schoolId" = s."id")
ON CONFLICT ("schoolId", "name") DO NOTHING;

-- 3 ─────────────────────────────────────────────────────────────────────────
-- A closed term is read-only and a sheet is locked, but history has to be carried into them.
ALTER TABLE "Assessment" DISABLE TRIGGER "closed_term_Assessment";
ALTER TABLE "MarkSheet" DISABLE TRIGGER "closed_term_MarkSheet";
ALTER TABLE "MarkSheet" DISABLE TRIGGER "no_self_verify_MarkSheet";
ALTER TABLE "WeightingPlan" DISABLE TRIGGER "closed_term_WeightingPlan";
ALTER TABLE "SubjectResult" DISABLE TRIGGER "closed_term_SubjectResult";
ALTER TABLE "AssessmentMark" DISABLE TRIGGER "guard_AssessmentMark";

-- Which teacher assignment each old mark belongs to: the one for the student's class in that term, else for a teaching group they are in.
DROP TABLE IF EXISTS exams_legacy_marks;
CREATE TEMP TABLE exams_legacy_marks AS
SELECT m."id" AS mark_id, m."schoolId", m."studentId", m."subjectId", m."termId", m."rawMark", m."percentage", m."letterGrade", m."status", m."excused",
       m."enteredBy", m."enteredAt", e."classId", c."levelId",
       COALESCE(
         (SELECT ta."id" FROM "TeacherAssignment" ta WHERE ta."termId" = m."termId" AND ta."subjectId" = m."subjectId" AND ta."classId" = e."classId" AND ta."status" = 'ACTIVE' LIMIT 1),
         (SELECT ta."id" FROM "TeacherAssignment" ta JOIN "TeachingGroupStudent" g ON g."groupId" = ta."groupId" AND g."studentId" = m."studentId"
           WHERE ta."termId" = m."termId" AND ta."subjectId" = m."subjectId" AND ta."status" = 'ACTIVE' LIMIT 1)
       ) AS assignment_id
  FROM "Mark" m
  JOIN "Enrollment" e ON e."studentId" = m."studentId" AND e."termId" = m."termId"
  JOIN "SchoolClass" c ON c."id" = e."classId";

DO $$
DECLARE unmatched int;
BEGIN
  SELECT count(*) INTO unmatched FROM "Mark" m WHERE NOT EXISTS (SELECT 1 FROM exams_legacy_marks x WHERE x.mark_id = m."id" AND x.assignment_id IS NOT NULL);
  IF unmatched > 0 THEN RAISE NOTICE '% old mark(s) could not be matched to a teacher assignment and stay in the old table only', unmatched; END IF;
END $$;

-- A sheet for every assignment that has old marks, with the status the old assignment had.
INSERT INTO "MarkSheet" ("id", "schoolId", "assignmentId", "termId", "status", "firstSubmittedAt", "submittedAt", "submittedById", "verifiedById", "verifiedAt", "updatedAt")
SELECT gen_random_uuid()::text, ta."schoolId", ta."id", ta."termId",
       CASE sa."marksStatus" WHEN 'PUBLISHED' THEN 'PUBLISHED' WHEN 'VERIFIED' THEN 'VERIFIED' WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS' ELSE 'IN_PROGRESS' END::"MarkSheetStatus",
       CASE WHEN sa."marksStatus" IN ('VERIFIED', 'PUBLISHED') THEN COALESCE(sa."marksVerifiedAt", CURRENT_TIMESTAMP) END,
       CASE WHEN sa."marksStatus" IN ('VERIFIED', 'PUBLISHED') THEN COALESCE(sa."marksVerifiedAt", CURRENT_TIMESTAMP) END,
       CASE WHEN sa."marksStatus" IN ('VERIFIED', 'PUBLISHED') THEN ta."teacherId" END,
       -- The old screens let a teacher verify, and did not always record who; the teacher is recorded when nobody was.
       CASE WHEN sa."marksStatus" IN ('VERIFIED', 'PUBLISHED') THEN COALESCE(sa."marksVerifiedById", ta."teacherId") END,
       CASE WHEN sa."marksStatus" IN ('VERIFIED', 'PUBLISHED') THEN COALESCE(sa."marksVerifiedAt", CURRENT_TIMESTAMP) END,
       CURRENT_TIMESTAMP
  FROM (SELECT DISTINCT assignment_id FROM exams_legacy_marks WHERE assignment_id IS NOT NULL) x
  JOIN "TeacherAssignment" ta ON ta."id" = x.assignment_id
  LEFT JOIN "SubjectAssignment" sa ON sa."termId" = ta."termId" AND sa."subjectId" = ta."subjectId" AND sa."classId" = ta."classId"
 WHERE NOT EXISTS (SELECT 1 FROM "MarkSheet" ms WHERE ms."assignmentId" = ta."id" AND ms."termId" = ta."termId");

-- A plan for each term and level that has imported marks and no plan yet: the imported mark is the whole term mark.
INSERT INTO "WeightingPlan" ("id", "schoolId", "termId", "levelId", "name", "updatedAt")
SELECT gen_random_uuid()::text, d."schoolId", d."termId", d."levelId", 'Imported marks', CURRENT_TIMESTAMP
  FROM (SELECT DISTINCT "schoolId", "termId", "levelId" FROM exams_legacy_marks WHERE assignment_id IS NOT NULL) d
 WHERE NOT EXISTS (SELECT 1 FROM "WeightingPlan" p WHERE p."termId" = d."termId" AND p."levelId" = d."levelId" AND p."subjectId" IS NULL);

INSERT INTO "WeightingPlanItem" ("id", "schoolId", "planId", "label", "weight", "combineRule", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, p."schoolId", p."id", 'Term mark', 100, 'AVERAGE', 0, CURRENT_TIMESTAMP
  FROM "WeightingPlan" p
 WHERE p."name" = 'Imported marks' AND NOT EXISTS (SELECT 1 FROM "WeightingPlanItem" i WHERE i."planId" = p."id");

INSERT INTO "WeightingPlanItemType" ("id", "schoolId", "itemId", "typeId", "updatedAt")
SELECT gen_random_uuid()::text, i."schoolId", i."id", t."id", CURRENT_TIMESTAMP
  FROM "WeightingPlanItem" i
  JOIN "WeightingPlan" p ON p."id" = i."planId" AND p."name" = 'Imported marks'
  JOIN "AssessmentType" t ON t."schoolId" = i."schoolId" AND t."name" = 'Other'
 WHERE NOT EXISTS (SELECT 1 FROM "WeightingPlanItemType" w WHERE w."itemId" = i."id");

-- One imported assessment per assignment.
INSERT INTO "Assessment" ("id", "schoolId", "termId", "assignmentId", "levelId", "subjectId", "typeId", "title", "maxMark", "countsToTerm", "updatedAt")
SELECT gen_random_uuid()::text, ta."schoolId", ta."termId", ta."id", d."levelId", ta."subjectId", t."id", 'Term mark (imported)',
       GREATEST(s."maxMark", 1), true, CURRENT_TIMESTAMP
  FROM (SELECT DISTINCT assignment_id, "levelId" FROM exams_legacy_marks WHERE assignment_id IS NOT NULL) d
  JOIN "TeacherAssignment" ta ON ta."id" = d.assignment_id
  JOIN "Subject" s ON s."id" = ta."subjectId"
  JOIN "AssessmentType" t ON t."schoolId" = ta."schoolId" AND t."name" = 'Other'
 WHERE NOT EXISTS (SELECT 1 FROM "Assessment" a WHERE a."assignmentId" = ta."id" AND a."title" = 'Term mark (imported)');

-- Each old mark becomes a mark of its assignment's imported assessment.
INSERT INTO "AssessmentMark" ("id", "schoolId", "assessmentId", "assignmentId", "studentId", "value", "code", "enteredById", "clientChangedAt", "updatedAt")
SELECT gen_random_uuid()::text, x."schoolId", a."id", x.assignment_id, x."studentId",
       CASE WHEN x."status" IN ('ABSENT', 'EXEMPT') THEN NULL ELSE LEAST(x."rawMark", a."maxMark") END,
       CASE WHEN x."status" = 'ABSENT' AND x."excused" THEN 'AB_EXCUSED' WHEN x."status" = 'ABSENT' THEN 'AB' WHEN x."status" = 'EXEMPT' THEN 'EX' END::"MarkCode",
       x."enteredBy", x."enteredAt", CURRENT_TIMESTAMP
  FROM exams_legacy_marks x
  JOIN "Assessment" a ON a."assignmentId" = x.assignment_id AND a."title" = 'Term mark (imported)'
 WHERE x.assignment_id IS NOT NULL
ON CONFLICT ("assessmentId", "studentId") WHERE "stageId" IS NULL DO NOTHING;

-- 4 ─────────────────────────────────────────────────────────────────────────
-- Subject results for marks that were already verified or published (the grade stays as it was published).
INSERT INTO "SubjectResult" ("id", "schoolId", "studentId", "subjectId", "termId", "classId", "levelId", "assignmentId", "termMark", "roundedMark", "grade",
                             "typeScores", "published", "publishedAt", "calculatedAt", "updatedAt")
SELECT gen_random_uuid()::text, x."schoolId", x."studentId", x."subjectId", x."termId", x."classId", x."levelId", x.assignment_id,
       p.pct, LEAST(100, GREATEST(0, floor(p.pct + 0.5)))::int, x."letterGrade",
       jsonb_build_array(jsonb_build_object('label', 'Term mark', 'score', p.pct, 'weight', 100)),
       x."status" = 'PUBLISHED', CASE WHEN x."status" = 'PUBLISHED' THEN COALESCE(tr."publishedAt", CURRENT_TIMESTAMP) END, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM exams_legacy_marks x
  JOIN "Subject" s ON s."id" = x."subjectId"
  LEFT JOIN "TermResult" tr ON tr."studentId" = x."studentId" AND tr."termId" = x."termId"
  CROSS JOIN LATERAL (SELECT CASE WHEN x."status" = 'ABSENT' THEN 0 ELSE round(LEAST(100, GREATEST(0, x."rawMark" / NULLIF(GREATEST(s."maxMark", 1), 0) * 100)), 2) END AS pct) p
 WHERE x.assignment_id IS NOT NULL AND x."status" IN ('VERIFIED', 'PUBLISHED', 'ABSENT') AND NOT (x."status" = 'ABSENT' AND x."excused")
   AND EXISTS (SELECT 1 FROM "MarkSheet" ms WHERE ms."assignmentId" = x.assignment_id AND ms."status" IN ('VERIFIED', 'PUBLISHED'))
ON CONFLICT ("studentId", "subjectId", "termId") DO NOTHING;

-- 5 ─────────────────────────────────────────────────────────────────────────
UPDATE "TermResult" tr SET "classId" = e."classId"
  FROM "Enrollment" e
 WHERE tr."classId" IS NULL AND e."studentId" = tr."studentId" AND e."termId" = tr."termId";

ALTER TABLE "Assessment" ENABLE TRIGGER "closed_term_Assessment";
ALTER TABLE "MarkSheet" ENABLE TRIGGER "closed_term_MarkSheet";
ALTER TABLE "MarkSheet" ENABLE TRIGGER "no_self_verify_MarkSheet";
ALTER TABLE "WeightingPlan" ENABLE TRIGGER "closed_term_WeightingPlan";
ALTER TABLE "SubjectResult" ENABLE TRIGGER "closed_term_SubjectResult";
ALTER TABLE "AssessmentMark" ENABLE TRIGGER "guard_AssessmentMark";

DROP TABLE IF EXISTS exams_legacy_marks;
