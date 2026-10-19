// @vitest-environment node
// The Academics migrations applied on top of a school that already has subjects, marks assignments and class teachers: they
// carry over into the new tables without losing anything, nobody gains or loses access to what they use today, the
// backfill can run twice, and a school created afterwards starts with the right keys.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, createPg } from '../helpers/test-db';

let pg: PGlite;
const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await pg.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> => (await all<T>(sql, params))[0]!;
const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: string }>(`SELECT count(*)::text AS n FROM (${sql}) x`, params)).n);

const FIRST = '20261101000000_academics_module';
const BACKFILL = '20261101000100_academics_module_backfill';

beforeAll(async () => {
  pg = await createPg(FIRST);
  await pg.exec(`
    INSERT INTO "School" ("id","name") VALUES ('s1','Old School'), ('s2','Other School');
    INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role") VALUES
      ('u-admin','s1','Admin','admin@old.test','h','ADMIN'), ('u-teacher','s1','Mrs Teacher','t@old.test','h','TEACHER'), ('u-ct','s1','Mr Class','ct@old.test','h','TEACHER'),
      ('u-t2','s2','Other Teacher','t2@two.test','h','TEACHER');
    INSERT INTO "Level" ("id","schoolId","name","order","category","active") VALUES
      ('l1','s1','Form 1',1,'O_LEVEL',true), ('l2','s1','Form 2',2,'O_LEVEL',true), ('l5','s1','Form 5',5,'A_LEVEL',false), ('x1','s2','Form 1',1,'O_LEVEL',true);
    INSERT INTO "SchoolClass" ("id","schoolId","name","levelId","stream","classTeacherId") VALUES
      ('c1','s1','Form 1 North','l1','North','u-ct'), ('c2','s1','Form 2 East','l2','East',NULL), ('xc','s2','Form 1 North','x1','North',NULL);
    INSERT INTO "AcademicYear" ("id","schoolId","year","startDate","endDate") VALUES ('y1','s1',2026,'2026-01-01','2026-12-31'), ('xy','s2',2026,'2026-01-01','2026-12-31');
    INSERT INTO "AcademicTerm" ("id","schoolId","academicYearId","termNumber","name","startDate","endDate","status") VALUES
      ('t1','s1','y1',1,'Term 1 2026','2026-01-10','2026-04-10','CLOSED'),
      ('t2','s1','y1',2,'Term 2 2026','2026-05-01','2026-08-01','OPEN'),
      ('xt','s2','xy',1,'Term 1 2026','2026-01-10','2026-04-10','OPEN');
    INSERT INTO "Subject" ("id","schoolId","name","code","type") VALUES
      ('sub1','s1','Mathematics','MATH','CORE'), ('sub2','s1','Geography','GEO','ELECTIVE'), ('sub3','s1','Combined Science and Heritage Studies','CSH','CORE'), ('xsub','s2','English','ENG','CORE');
    INSERT INTO "SubjectAssignment" ("id","schoolId","teacherId","subjectId","classId","termId") VALUES
      ('sa1','s1','u-teacher','sub1','c1','t2'), ('sa2','s1','u-teacher','sub2','c1','t2'), ('sa3','s1','u-teacher','sub1','c1','t1'), ('xsa','s2','u-t2','xsub','xc','xt');
    INSERT INTO "Student" ("id","schoolId","admissionNumber","firstName","surname","fullName","admissionDate","currentClassId","status") VALUES
      ('st1','s1','A1','Tendai','Moyo','Tendai Moyo','2026-01-10','c1','ACTIVE'), ('st2','s1','A2','Rufaro','Dube','Rufaro Dube','2026-01-10','c1','ACTIVE'),
      ('st3','s1','A3','Gone','Away','Gone Away','2026-01-10','c1','TRANSFERRED'), ('st4','s1','A4','Tino','Ncube','Tino Ncube','2026-01-10','c2','ACTIVE'),
      ('xst','s2','B1','Other','Pupil','Other Pupil','2026-01-10','xc','ACTIVE');
    INSERT INTO "Enrollment" ("id","schoolId","studentId","classId","termId","startDate","status") VALUES
      ('e1','s1','st1','c1','t2','2026-05-01','ACTIVE'), ('e2','s1','st2','c1','t2','2026-05-01','ACTIVE'), ('e3','s1','st3','c1','t2','2026-05-01','TRANSFERRED_OUT'),
      ('e4','s1','st4','c2','t2','2026-05-01','ACTIVE'), ('e5','s1','st1','c1','t1','2026-01-10','ACTIVE'), ('xe','s2','xst','xc','xt','2026-01-10','ACTIVE');
  `);
  await applyMigration(pg, FIRST);
  await applyMigration(pg, BACKFILL);
}, 120_000);

afterAll(async () => {
  await pg.close();
});

describe('permissions', () => {
  it('adds the 21 keys of the brief', async () => {
    expect(await count(`SELECT 1 FROM "Permission" WHERE "key" LIKE 'academics.%'`)).toBe(21);
    expect(await count(`SELECT 1 FROM "Permission" WHERE "key" = 'academics.allocation.view'`)).toBe(0);
  });

  it('gives teachers and class teachers their own-class keys in a school that already existed, and nobody else anything new', async () => {
    const keysOf = async (school: string, role: string) =>
      (await all<{ permissionKey: string }>(`SELECT rp."permissionKey" FROM "RolePermission" rp JOIN "RoleDefinition" r ON r."id" = rp."roleId" WHERE r."schoolId" = $1 AND r."key" = $2 AND rp."permissionKey" LIKE 'academics.%' ORDER BY 1`, [school, role])).map((r) => r.permissionKey);
    for (const school of ['s1', 's2']) {
      expect(await keysOf(school, 'TEACHER')).toEqual(['academics.assignments.view', 'academics.attendance.mark', 'academics.classes.view', 'academics.schemes.edit', 'academics.schemes.view', 'academics.subjects.view', 'academics.timetable.view']);
      expect(await keysOf(school, 'CLASS_TEACHER')).toEqual(['academics.attendance.mark', 'academics.attendance.view', 'academics.classes.view', 'academics.subjects.view', 'academics.timetable.view']);
      for (const role of ['BURSAR', 'LIBRARIAN', 'DEPUTY_HEAD', 'HOD']) expect(await keysOf(school, role), role).toEqual([]);
    }
    expect(await keysOf('s1', 'OWNER')).toEqual([]); // through "*"
  });

  it('gives a school created afterwards the same keys', async () => {
    await pg.exec(`INSERT INTO "School" ("id","name") VALUES ('s3','New School')`);
    const rows = await all<{ key: string; n: string }>(`SELECT r."key", count(*)::text AS n FROM "RolePermission" rp JOIN "RoleDefinition" r ON r."id" = rp."roleId" WHERE r."schoolId" = 's3' AND rp."permissionKey" LIKE 'academics.%' GROUP BY 1 ORDER BY 1`);
    expect(Object.fromEntries(rows.map((r) => [r.key, Number(r.n)]))).toEqual({ CLASS_TEACHER: 5, TEACHER: 7 });
  });
});

describe('subjects', () => {
  it('get a department, a short name and the forms they were offered in', async () => {
    const subs = await all<{ code: string; shortName: string; department: string; examBoard: string; colour: string }>(
      `SELECT s."code", s."shortName", d."name" AS department, s."examBoard", s."colour" FROM "Subject" s JOIN "Department" d ON d."id" = s."departmentId" WHERE s."schoolId" = 's1' ORDER BY 1`);
    expect(subs.map((s) => [s.code, s.shortName, s.department])).toEqual([['CSH', 'Combined Scien', 'General'], ['GEO', 'Geography', 'General'], ['MATH', 'Mathematics', 'General']]);
    expect(subs.every((s) => s.examBoard === 'ZIMSEC' && /^#/.test(s.colour))).toBe(true);
    // Offered in every active form of the school, as core or elective like the old type said; the switched-off Form 5 is left out.
    const levels = await all<{ code: string; level: string; type: string }>(`SELECT s."code", l."name" AS level, sl."type" FROM "SubjectLevel" sl JOIN "Subject" s ON s."id" = sl."subjectId" JOIN "Level" l ON l."id" = sl."levelId" WHERE s."schoolId" = 's1' ORDER BY 1, 2`);
    expect(levels).toHaveLength(6);
    expect(levels.filter((l) => l.code === 'GEO').every((l) => l.type === 'ELECTIVE')).toBe(true);
    expect(levels.filter((l) => l.code === 'MATH').every((l) => l.type === 'CORE')).toBe(true);
    expect(levels.some((l) => l.level === 'Form 5')).toBe(false);
  });

  it('are kept apart between schools', async () => {
    expect(await count(`SELECT 1 FROM "Department" WHERE "schoolId" = 's2'`)).toBe(1);
    const x = await one<{ department: string }>(`SELECT d."name" AS department FROM "Subject" s JOIN "Department" d ON d."id" = s."departmentId" WHERE s."id" = 'xsub'`);
    expect(x.department).toBe('General');
    expect(await count(`SELECT 1 FROM "Subject" s JOIN "Department" d ON d."id" = s."departmentId" WHERE s."schoolId" <> d."schoolId"`)).toBe(0);
  });
});

describe('teacher assignments', () => {
  it('come from the marks assignments, for the whole term, in open and closed terms alike', async () => {
    const rows = await all<{ teacherId: string; termId: string; classId: string; periodsPerWeek: number; startDate: Date; status: string; endDate: Date | null }>(
      `SELECT "teacherId","termId","classId","periodsPerWeek","startDate","status","endDate" FROM "TeacherAssignment" WHERE "schoolId" = 's1' ORDER BY "termId", "subjectId"`);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'ACTIVE' && r.endDate === null && r.periodsPerWeek === 4)).toBe(true);
    expect(rows.find((r) => r.termId === 't1')!.startDate.toISOString().slice(0, 10)).toBe('2026-01-10');
    expect(rows.find((r) => r.termId === 't2')!.startDate.toISOString().slice(0, 10)).toBe('2026-05-01');
    // The marks pages keep working: their rows are untouched.
    expect(await count(`SELECT 1 FROM "SubjectAssignment"`)).toBe(4);
  });
});

describe('class teachers', () => {
  it('become the class teacher of the open term with the role scoped to the class', async () => {
    const ct = await all<{ classId: string; termId: string; userId: string }>(`SELECT "classId","termId","userId" FROM "ClassTeacher"`);
    expect(ct).toEqual([{ classId: 'c1', termId: 't2', userId: 'u-ct' }]);
    const roles = await all<{ key: string; scopeType: string; scopeId: string }>(`SELECT r."key", ur."scopeType", ur."scopeId" FROM "UserRole" ur JOIN "RoleDefinition" r ON r."id" = ur."roleId" WHERE ur."userId" = 'u-ct' ORDER BY 1`);
    expect(roles).toEqual([{ key: 'CLASS_TEACHER', scopeType: 'CLASS', scopeId: 'c1' }, { key: 'TEACHER', scopeType: 'SCHOOL', scopeId: '' }]);
  });
});

describe("students' subjects", () => {
  it('are the subjects their class has a teacher for in the open term, for students who are in the class', async () => {
    const rows = await all<{ studentId: string; code: string; source: string }>(`SELECT ss."studentId", s."code", ss."source" FROM "StudentSubject" ss JOIN "Subject" s ON s."id" = ss."subjectId" WHERE ss."schoolId" = 's1' ORDER BY 1, 2`);
    expect(rows).toEqual([
      { studentId: 'st1', code: 'GEO', source: 'CHOSEN' }, { studentId: 'st1', code: 'MATH', source: 'CORE' },
      { studentId: 'st2', code: 'GEO', source: 'CHOSEN' }, { studentId: 'st2', code: 'MATH', source: 'CORE' },
    ]);
    // The other school got its own, and nothing crossed over.
    expect(await count(`SELECT 1 FROM "StudentSubject" WHERE "schoolId" = 's2'`)).toBe(1);
  });
});

describe('running it again', () => {
  it('changes nothing', async () => {
    const snapshot = async () => ({
      depts: await count(`SELECT 1 FROM "Department"`), levels: await count(`SELECT 1 FROM "SubjectLevel"`), assignments: await count(`SELECT 1 FROM "TeacherAssignment"`),
      teachers: await count(`SELECT 1 FROM "ClassTeacher"`), roles: await count(`SELECT 1 FROM "UserRole"`), subjects: await count(`SELECT 1 FROM "StudentSubject"`), grants: await count(`SELECT 1 FROM "RolePermission"`),
    });
    const before = await snapshot();
    await applyMigration(pg, BACKFILL);
    expect(await snapshot()).toEqual(before);
  });
});

describe('the rules the database keeps by itself', () => {
  it('refuses an assignment for a class and a group at once, a clash, and a change in a closed term', async () => {
    await expect(pg.exec(`INSERT INTO "TeacherAssignment" ("id","schoolId","termId","teacherId","subjectId","periodsPerWeek","startDate","updatedAt") VALUES ('bad1','s1','t2','u-teacher','sub3',3,'2026-05-01',now())`)).rejects.toThrow(/TeacherAssignment_class_or_group/);
    await expect(pg.exec(`INSERT INTO "TeacherAssignment" ("id","schoolId","termId","teacherId","subjectId","classId","periodsPerWeek","startDate","updatedAt") VALUES ('bad2','s1','t2','u-ct','sub1','c1',3,'2026-05-01',now())`)).rejects.toThrow(/TeacherAssignment_one_active_per_class/);
    await expect(pg.exec(`INSERT INTO "TeacherAssignment" ("id","schoolId","termId","teacherId","subjectId","classId","periodsPerWeek","startDate","updatedAt") VALUES ('bad3','s1','t1','u-ct','sub3','c1',3,'2026-01-10',now())`)).rejects.toThrow(/Term 1 2026 is closed/);
    await expect(pg.exec(`INSERT INTO "TeacherAssignment" ("id","schoolId","termId","teacherId","subjectId","classId","periodsPerWeek","startDate","updatedAt") VALUES ('bad4','s1','t2','u-t2','sub3','c1',3,'2026-05-01',now())`)).rejects.toThrow(/Cross-school reference/);
  });
});
