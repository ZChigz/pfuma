// @vitest-environment node
// The Examinations migrations applied on top of a school that already has marks from the first results screens: the marks
// carry over into the new structure without being lost or changed, statuses and grades are kept, the old tables are not
// touched, the backfill can run twice, and roles get the module's keys.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, createPg } from '../helpers/test-db';

let pg: PGlite;
const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await pg.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> => (await all<T>(sql, params))[0]!;
const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: string }>(`SELECT count(*)::text AS n FROM (${sql}) x`, params)).n);

const FIRST = '20261102000000_exams_core';
const BACKFILL = '20261102000100_exams_core_backfill';

beforeAll(async () => {
  pg = await createPg(FIRST);
  await pg.exec(`
    INSERT INTO "School" ("id","name") VALUES ('s1','Old School'), ('s2','Other School');
    INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role") VALUES
      ('u-head','s1','The Head','head@old.test','h','HEAD'), ('u-teacher','s1','Mrs Teacher','t@old.test','h','TEACHER'), ('u-t2','s2','Other Teacher','t2@two.test','h','TEACHER');
    INSERT INTO "Level" ("id","schoolId","name","order","category") VALUES ('l1','s1','Form 1',1,'O_LEVEL'), ('x1','s2','Form 1',1,'O_LEVEL');
    INSERT INTO "SchoolClass" ("id","schoolId","name","levelId","stream") VALUES ('c1','s1','Form 1 North','l1','North'), ('xc','s2','Form 1 North','x1','North');
    INSERT INTO "AcademicYear" ("id","schoolId","year","startDate","endDate") VALUES ('y1','s1',2026,'2026-01-01','2026-12-31'), ('xy','s2',2026,'2026-01-01','2026-12-31');
    INSERT INTO "AcademicTerm" ("id","schoolId","academicYearId","termNumber","name","startDate","endDate","status") VALUES
      ('t1','s1','y1',1,'Term 1 2026','2026-01-10','2026-04-10','PLANNED'), ('t2','s1','y1',2,'Term 2 2026','2026-05-01','2026-08-01','OPEN'), ('xt','s2','xy',1,'Term 1 2026','2026-01-10','2026-04-10','OPEN');
    INSERT INTO "Subject" ("id","schoolId","name","code","maxMark") VALUES ('sub1','s1','Mathematics','MATH',100), ('sub2','s1','Geography','GEO',50), ('xsub','s2','English','ENG',100);
    INSERT INTO "SubjectAssignment" ("id","schoolId","teacherId","subjectId","classId","termId","marksStatus","marksVerifiedById","marksVerifiedAt") VALUES
      ('sa1','s1','u-teacher','sub1','c1','t2','IN_PROGRESS',NULL,NULL),
      ('sa2','s1','u-teacher','sub2','c1','t2','VERIFIED','u-head','2026-07-01'),
      ('sa3','s1','u-teacher','sub1','c1','t1','PUBLISHED','u-teacher','2026-03-01'),
      ('xsa','s2','u-t2','xsub','xc','xt','NOT_STARTED',NULL,NULL);
    INSERT INTO "TeacherAssignment" ("id","schoolId","termId","teacherId","subjectId","classId","periodsPerWeek","startDate","updatedAt") VALUES
      ('ta1','s1','t2','u-teacher','sub1','c1',4,'2026-05-01',now()), ('ta2','s1','t2','u-teacher','sub2','c1',4,'2026-05-01',now()),
      ('ta3','s1','t1','u-teacher','sub1','c1',4,'2026-01-10',now()), ('xta','s2','xt','u-t2','xsub','xc',4,'2026-01-10',now());
    INSERT INTO "Student" ("id","schoolId","admissionNumber","firstName","surname","fullName","admissionDate","currentClassId") VALUES
      ('st1','s1','A1','Tendai','Moyo','Tendai Moyo','2026-01-10','c1'), ('st2','s1','A2','Rufaro','Dube','Rufaro Dube','2026-01-10','c1'),
      ('st3','s1','A3','Tino','Ncube','Tino Ncube','2026-01-10','c1'), ('st4','s1','A4','No','Class','No Class','2026-01-10',NULL), ('xst','s2','B1','Other','Pupil','Other Pupil','2026-01-10','xc');
    INSERT INTO "Enrollment" ("id","schoolId","studentId","classId","termId","startDate") VALUES
      ('e1','s1','st1','c1','t2','2026-05-01'), ('e2','s1','st2','c1','t2','2026-05-01'), ('e3','s1','st3','c1','t2','2026-05-01'),
      ('e5','s1','st1','c1','t1','2026-01-10'), ('xe','s2','xst','c1'::text,'xt','2026-01-10');
  `.replace(`'xe','s2','xst','c1'::text,`, `'xe','s2','xst','xc',`));
  await pg.exec(`
    INSERT INTO "Mark" ("id","schoolId","studentId","subjectId","termId","rawMark","percentage","letterGrade","status","excused","enteredBy") VALUES
      ('m1','s1','st1','sub1','t2',60,60,'B','DRAFT',false,'u-teacher'),
      ('m2','s1','st2','sub1','t2',0,0,NULL,'ABSENT',false,'u-teacher'),
      ('m3','s1','st3','sub1','t2',0,0,NULL,'EXEMPT',false,'u-teacher'),
      ('m4','s1','st1','sub2','t2',40,80,'A','VERIFIED',false,'u-teacher'),
      ('m5','s1','st2','sub2','t2',0,0,NULL,'ABSENT',true,'u-teacher'),
      ('m6','s1','st3','sub2','t2',25,50,'C','VERIFIED',false,'u-teacher'),
      ('m7','s1','st1','sub1','t1',55,55,'C','PUBLISHED',false,'u-teacher'),
      ('m8','s1','st4','sub1','t2',70,70,'B','DRAFT',false,'u-teacher'),
      ('xm','s2','xst','xsub','xt',44,44,'D','DRAFT',false,'u-t2');
    UPDATE "AcademicTerm" SET "status" = 'CLOSED' WHERE "id" = 't1';
    INSERT INTO "TermResult" ("id","schoolId","studentId","termId","totalMarks","percentage","published","publishedAt") VALUES ('tr1','s1','st1','t1',55,55,true,'2026-04-01');
  `);
  await applyMigration(pg, FIRST);
  await applyMigration(pg, BACKFILL);
}, 180_000);

afterAll(async () => {
  await pg.close();
});

describe('roles and types', () => {
  it('give roles that already exist the keys of the module, and nobody else anything', async () => {
    const keysOf = async (school: string, role: string) =>
      (await all<{ permissionKey: string }>(`SELECT rp."permissionKey" FROM "RolePermission" rp JOIN "RoleDefinition" r ON r."id" = rp."roleId" WHERE r."schoolId" = $1 AND r."key" = $2 AND rp."permissionKey" LIKE 'exams.%' ORDER BY 1`, [school, role])).map((r) => r.permissionKey);
    for (const school of ['s1', 's2']) {
      expect(await keysOf(school, 'TEACHER')).toEqual(['exams.analytics.view', 'exams.assessments.create', 'exams.comments.subject', 'exams.marks.enter', 'exams.marks.submit']);
      expect(await keysOf(school, 'HOD')).toContain('exams.marks.verify');
      expect(await keysOf(school, 'HOD')).not.toContain('exams.marks.unlock');
      expect(await keysOf(school, 'HEAD')).toEqual(expect.arrayContaining(['exams.marks.unlock', 'exams.results.publish', 'exams.results.unpublish', 'exams.comments.head']));
      expect(await keysOf(school, 'BURSAR')).toEqual([]);
      expect(await keysOf(school, 'LIBRARIAN')).toEqual([]);
    }
    expect(await count(`SELECT 1 FROM "Permission" WHERE "key" LIKE 'exams.%'`)).toBeGreaterThanOrEqual(24);
  });

  it('gives a school created afterwards the same keys', async () => {
    await pg.exec(`INSERT INTO "School" ("id","name") VALUES ('s3','New School')`);
    const rows = await all<{ key: string; n: string }>(`SELECT r."key", count(*)::text AS n FROM "RolePermission" rp JOIN "RoleDefinition" r ON r."id" = rp."roleId" WHERE r."schoolId" = 's3' AND rp."permissionKey" LIKE 'exams.%' GROUP BY 1 ORDER BY 1`);
    expect(rows.find((r) => r.key === 'TEACHER')!.n).toBe('5');
    expect(rows.find((r) => r.key === 'EXAMS_OFFICER')).toBeTruthy();
  });

  it('gives every school the eight assessment types, the exams marked as set for every class', async () => {
    for (const school of ['s1', 's2']) {
      const types = await all<{ name: string; commonExam: boolean; isProject: boolean }>(`SELECT "name","commonExam","isProject" FROM "AssessmentType" WHERE "schoolId" = $1 ORDER BY "sortOrder"`, [school]);
      expect(types.map((x) => x.name)).toEqual(['Class test', 'Assignment', 'Practical', 'Mid-term test', 'End-of-term exam', 'Mock exam', 'School-based project', 'Other']);
      expect(types.filter((x) => x.commonExam).map((x) => x.name)).toEqual(['End-of-term exam', 'Mock exam']);
    }
  });
});

describe('old marks', () => {
  it('become marks of one imported assessment per assignment, with the subject maximum', async () => {
    const a = await all<{ assignmentId: string; maxMark: string; type: string }>(
      `SELECT a."assignmentId", a."maxMark"::text, t."name" AS type FROM "Assessment" a JOIN "AssessmentType" t ON t."id" = a."typeId" WHERE a."title" = 'Term mark (imported)' AND a."schoolId" = 's1' ORDER BY 1`);
    expect(a.map((x) => [x.assignmentId, Number(x.maxMark), x.type])).toEqual([['ta1', 100, 'Other'], ['ta2', 50, 'Other'], ['ta3', 100, 'Other']]);
    expect(await count(`SELECT 1 FROM "Assessment" WHERE "schoolId" = 's2'`)).toBe(1);
  });

  it('keep each score, absence and exemption', async () => {
    const m = await all<{ studentId: string; assignmentId: string; value: string | null; code: string | null }>(
      `SELECT "studentId","assignmentId","value"::text,"code" FROM "AssessmentMark" WHERE "schoolId" = 's1' ORDER BY "assignmentId","studentId"`);
    expect(m.map((x) => [x.assignmentId, x.studentId, x.value === null ? null : Number(x.value), x.code])).toEqual([
      ['ta1', 'st1', 60, null], ['ta1', 'st2', null, 'AB'], ['ta1', 'st3', null, 'EX'],
      ['ta2', 'st1', 40, null], ['ta2', 'st2', null, 'AB_EXCUSED'], ['ta2', 'st3', 25, null],
      ['ta3', 'st1', 55, null],
    ]);
  });

  it('leave a mark with no class in its term only in the old table, and lose nothing', async () => {
    expect(await count(`SELECT 1 FROM "Mark"`)).toBe(9);
    expect(await count(`SELECT 1 FROM "Mark" WHERE "id" = 'm8'`)).toBe(1);
    expect(await count(`SELECT 1 FROM "AssessmentMark" WHERE "studentId" = 'st4'`)).toBe(0);
    // The old marks are untouched.
    expect((await one<{ rawMark: string; status: string }>(`SELECT "rawMark"::text, "status" FROM "Mark" WHERE "id" = 'm4'`))).toMatchObject({ rawMark: '40.00', status: 'VERIFIED' });
  });

  it('keep the status of the old assignment on the mark sheet', async () => {
    const s = await all<{ assignmentId: string; status: string; verifiedById: string | null }>(`SELECT "assignmentId","status","verifiedById" FROM "MarkSheet" WHERE "schoolId" = 's1' ORDER BY 1`);
    expect(s.map((x) => [x.assignmentId, x.status])).toEqual([['ta1', 'IN_PROGRESS'], ['ta2', 'VERIFIED'], ['ta3', 'PUBLISHED']]);
    expect(s.find((x) => x.assignmentId === 'ta2')!.verifiedById).toBe('u-head');
    // Verified by the teacher themselves in the old screens: kept as recorded.
    expect(s.find((x) => x.assignmentId === 'ta3')!.verifiedById).toBe('u-teacher');
  });

  it('make a plan "Imported marks" (Other, 100%) for each term and level, so results can be calculated', async () => {
    const p = await all<{ termId: string; weight: string; type: string }>(
      `SELECT p."termId", i."weight"::text, t."name" AS type FROM "WeightingPlan" p JOIN "WeightingPlanItem" i ON i."planId" = p."id" JOIN "WeightingPlanItemType" w ON w."itemId" = i."id" JOIN "AssessmentType" t ON t."id" = w."typeId" WHERE p."schoolId" = 's1' ORDER BY 1`);
    expect(p.map((x) => [x.termId, Number(x.weight), x.type])).toEqual([['t1', 100, 'Other'], ['t2', 100, 'Other']]);
  });

  it('give verified and published marks a subject result, published ones as published with the grade they were given', async () => {
    const r = await all<{ studentId: string; subjectId: string; termId: string; termMark: string; roundedMark: number; grade: string | null; published: boolean }>(
      `SELECT "studentId","subjectId","termId","termMark"::text,"roundedMark","grade","published" FROM "SubjectResult" WHERE "schoolId" = 's1' ORDER BY "termId","subjectId","studentId"`);
    expect(r.map((x) => [x.termId, x.subjectId, x.studentId, Number(x.termMark), x.grade, x.published])).toEqual([
      ['t1', 'sub1', 'st1', 55, 'C', true],
      ['t2', 'sub2', 'st1', 80, 'A', false],
      ['t2', 'sub2', 'st3', 50, 'C', false],
    ]);
  });

  it('give older overall results their class', async () => {
    expect((await one<{ classId: string }>(`SELECT "classId" FROM "TermResult" WHERE "id" = 'tr1'`)).classId).toBe('c1');
  });

  it('keep schools apart', async () => {
    expect(await count(`SELECT 1 FROM "AssessmentMark" mk JOIN "Assessment" a ON a."id" = mk."assessmentId" WHERE a."schoolId" <> mk."schoolId"`)).toBe(0);
    expect(await count(`SELECT 1 FROM "MarkSheet" ms JOIN "TeacherAssignment" ta ON ta."id" = ms."assignmentId" WHERE ta."schoolId" <> ms."schoolId"`)).toBe(0);
  });

  it('can run twice without changing anything', async () => {
    const before = [await count(`SELECT 1 FROM "AssessmentMark"`), await count(`SELECT 1 FROM "Assessment"`), await count(`SELECT 1 FROM "MarkSheet"`), await count(`SELECT 1 FROM "SubjectResult"`), await count(`SELECT 1 FROM "WeightingPlan"`), await count(`SELECT 1 FROM "AssessmentType" WHERE "schoolId" IN ('s1', 's2')`), await count(`SELECT 1 FROM "RolePermission"`)];
    await applyMigration(pg, BACKFILL);
    const after = [await count(`SELECT 1 FROM "AssessmentMark"`), await count(`SELECT 1 FROM "Assessment"`), await count(`SELECT 1 FROM "MarkSheet"`), await count(`SELECT 1 FROM "SubjectResult"`), await count(`SELECT 1 FROM "WeightingPlan"`), await count(`SELECT 1 FROM "AssessmentType" WHERE "schoolId" IN ('s1', 's2')`), await count(`SELECT 1 FROM "RolePermission"`)];
    expect(after).toEqual(before);
  });

  it('leave the triggers on afterwards: a locked sheet still refuses marks, and marks are still never deleted', async () => {
    await expect(pg.exec(`UPDATE "AssessmentMark" SET "value" = 41 WHERE "assignmentId" = 'ta2' AND "studentId" = 'st1'`)).rejects.toThrow(/closed|locked/);
    await expect(pg.exec(`DELETE FROM "AssessmentMark" WHERE "assignmentId" = 'ta1'`)).rejects.toThrow(/never deleted/);
  });
});
