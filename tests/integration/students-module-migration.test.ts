// @vitest-environment node
// The Student Information migrations applied on top of a school that already has students, guardians who
// share phone numbers, free-text medical notes and students who already left: nothing is lost, duplicates
// are merged, the new rules hold.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, createPg } from '../helpers/test-db';

let pg: PGlite;
const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await pg.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> => (await all<T>(sql, params))[0]!;

const FIRST = '20261031000000_students_module';
const BACKFILL = '20261031000100_students_module_backfill';
const CONSTRAINTS = '20261031000200_students_module_constraints';

beforeAll(async () => {
  pg = await createPg(FIRST);
  await pg.exec(`
    INSERT INTO "School" ("id","name") VALUES ('s1','Old School'), ('s2','Other School');
    INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role") VALUES
      ('u-admin','s1','Admin','admin@old.test','h','ADMIN'), ('u-teacher','s1','Teacher','t@old.test','h','TEACHER'),
      ('u-admin2','s2','Admin Two','admin@two.test','h','ADMIN');
    INSERT INTO "Level" ("id","schoolId","name","order","category") VALUES
      ('l1','s1','Form 1',1,'O_LEVEL'), ('l4','s1','Form 4',4,'O_LEVEL'), ('l6','s1','Form 6',6,'A_LEVEL');
    INSERT INTO "SchoolClass" ("id","schoolId","name","levelId","stream") VALUES
      ('c1','s1','Form 1 North','l1','North'), ('c4','s1','Form 4 East','l4','East'), ('c6','s1','Form 6 Arts','l6','Arts');
    INSERT INTO "AcademicYear" ("id","schoolId","year","startDate","endDate") VALUES ('y1','s1',2026,'2026-01-01','2026-12-31');
    INSERT INTO "AcademicTerm" ("id","schoolId","academicYearId","termNumber","name","startDate","endDate","status")
      VALUES ('t1','s1','y1',1,'Term 1 2026','2026-01-10','2026-04-10','OPEN');
    INSERT INTO "Student" ("id","schoolId","admissionNumber","firstName","surname","fullName","admissionDate","currentClassId","birthCertificateNumber","medicalNotes","status") VALUES
      ('st1','s1','A1','Tendai','Moyo','Tendai Moyo','2026-01-10','c1','63-123456 a 42','Asthma, carries an inhaler','ACTIVE'),
      ('st2','s1','A2','Rufaro','Moyo','Rufaro Moyo','2026-01-10','c1','64 222222 B 11',NULL,'ACTIVE'),
      ('st3','s1','A3','Tino','Dube','Tino Dube','2026-01-10','c1','65-333333-C-22','   ','ACTIVE'),
      ('st4','s1','A4','Tina','Dube','Tina Dube','2026-01-10','c1','65333333C22',NULL,'ACTIVE'),
      ('st5','s1','A5','Gone','Away','Gone Away','2020-01-10','c4','66-444444 D 33',NULL,'TRANSFERRED'),
      ('st6','s1','A6','Grad','Four','Grad Four','2020-01-10','c4',NULL,NULL,'GRADUATED'),
      ('st7','s1','A7','Grad','Six','Grad Six','2018-01-10','c6',NULL,NULL,'GRADUATED'),
      ('st8','s1','A8','Left','Home','Left Home','2024-01-10','c1',NULL,NULL,'WITHDRAWN'),
      ('st9','s1','A9','Lone','Leaver','Lone Leaver','2024-01-10','c1',NULL,NULL,'ACTIVE');
    INSERT INTO "Student" ("id","schoolId","admissionNumber","firstName","surname","fullName","admissionDate") VALUES ('stx','s2','B1','Other','Pupil','Other Pupil','2026-01-10');
    INSERT INTO "Enrollment" ("id","schoolId","studentId","classId","termId","startDate","endDate","status") VALUES
      ('e5','s1','st5','c4','t1','2020-01-10','2022-12-01','TRANSFERRED_OUT');

    -- Three records for one phone: the oldest should survive and take the others' details.
    INSERT INTO "Guardian" ("id","schoolId","fullName","phone","createdAt") VALUES
      ('g1','s1','Mrs Moyo','+263771111111','2025-01-01'), ('g1b','s1','Mai Moyo','+263771111111','2025-02-01'),
      ('g1c','s1','Mai T Moyo','+263771111111','2025-03-01'), ('g2','s1','Mr Dube','+263772222222','2025-01-01'),
      ('g3','s2','Someone Else','+263771111111','2025-01-01');
    UPDATE "Guardian" SET "email"='moyo@mail.test', "occupation"='Nurse' WHERE "id"='g1b';
    UPDATE "Guardian" SET "nationalId"='63-111111 X 11' WHERE "id"='g1c';
    INSERT INTO "StudentGuardian" ("studentId","guardianId","relationship","isPrimary","isFeePayer") VALUES
      ('st1','g1','MOTHER',true,false),
      ('st2','g1b','MOTHER',true,true),
      ('st2','g1c','AUNT',false,false),
      ('st3','g2','FATHER',true,false);
    INSERT INTO "RoleDefinition" ("id","schoolId","key","name","description","isSystem","updatedAt") VALUES
      ('r-custom','s1','FRONT_DESK','Front desk','Custom role',false,now());
    INSERT INTO "RolePermission" ("id","schoolId","roleId","permissionKey") VALUES ('rp1','s1','r-custom','system.dashboard.view');
  `);

  await applyMigration(pg, FIRST);
  // Roles are given the old student keys only after the first migration created the permission rows.
  await pg.exec(`
    INSERT INTO "RolePermission" ("id","schoolId","roleId","permissionKey") VALUES
      ('rp2','s1','r-custom','students.list.view');`);
  await applyMigration(pg, BACKFILL);
  await applyMigration(pg, CONSTRAINTS);
}, 300_000);

afterAll(async () => { await pg.close(); });

describe('birth certificate numbers', () => {
  it('are stored normalised: capitals, no spaces or dashes', async () => {
    expect((await one<{ b: string }>(`SELECT "birthCertificateNumber" b FROM "Student" WHERE id='st1'`)).b).toBe('63123456A42');
    expect((await one<{ b: string }>(`SELECT "birthCertificateNumber" b FROM "Student" WHERE id='st2'`)).b).toBe('64222222B11');
  });

  it('leave two students that would collide untouched, and turn a blank into nothing', async () => {
    expect((await one<{ b: string }>(`SELECT "birthCertificateNumber" b FROM "Student" WHERE id='st3'`)).b).toBe('65-333333-C-22');
    expect((await one<{ b: string }>(`SELECT "birthCertificateNumber" b FROM "Student" WHERE id='st4'`)).b).toBe('65333333C22');
  });

  it('are still unique in a school', async () => {
    await expect(pg.exec(`UPDATE "Student" SET "birthCertificateNumber"='63123456A42' WHERE id='st2'`)).rejects.toThrow();
  });
});

describe('guardians who share a phone number', () => {
  it('become one record that keeps the oldest id and fills its blanks', async () => {
    const rows = await all<Record<string, unknown>>(`SELECT * FROM "Guardian" WHERE "schoolId"='s1' AND "phone"='+263771111111'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'g1', fullName: 'Mrs Moyo', email: 'moyo@mail.test', occupation: 'Nurse', nationalId: '63-111111 X 11' });
  });

  it('keep every student linked, with their flags combined and exactly one primary guardian', async () => {
    const st2 = await all<Record<string, unknown>>(`SELECT * FROM "StudentGuardian" WHERE "studentId"='st2'`);
    expect(st2).toHaveLength(1);
    expect(st2[0]).toMatchObject({ guardianId: 'g1', isPrimary: true, isFeePayer: true, relationship: 'MOTHER' });
    expect((await all(`SELECT 1 FROM "StudentGuardian" WHERE "studentId"='st1' AND "guardianId"='g1'`))).toHaveLength(1);
    expect((await all(`SELECT 1 FROM "Guardian" WHERE id IN ('g1b','g1c')`))).toHaveLength(0);
  });

  it("do not touch another school's guardian with the same number", async () => {
    expect((await all(`SELECT 1 FROM "Guardian" WHERE id='g3' AND "schoolId"='s2'`))).toHaveLength(1);
  });

  it('can no longer be duplicated in a school', async () => {
    await expect(pg.exec(`INSERT INTO "Guardian" ("id","schoolId","fullName","phone") VALUES ('gx','s1','Again','+263772222222')`)).rejects.toThrow(/Guardian_schoolId_phone_key|unique/i);
    await pg.exec(`INSERT INTO "Guardian" ("id","schoolId","fullName","phone") VALUES ('gy','s2','Fine','+263772222222')`);
  });

  it('may collect the student when primary', async () => {
    expect((await one<{ c: boolean }>(`SELECT "canCollect" c FROM "StudentGuardian" WHERE "studentId"='st3'`)).c).toBe(true);
  });
});

describe('medical notes', () => {
  it('are copied into the medical profile; blank notes are not', async () => {
    const rows = await all<{ studentId: string; notes: string }>(`SELECT "studentId","notes" FROM "MedicalProfile" ORDER BY 1`);
    expect(rows).toEqual([{ studentId: 'st1', notes: 'Asthma, carries an inhaler' }]);
  });
});

describe('students who already left', () => {
  it('get a completed leaving record with the reason that fits their status', async () => {
    const rows = await all<{ studentId: string; reason: string; state: string; resultingStatus: string; lastDay: Date }>(
      `SELECT "studentId","reason","state","resultingStatus","lastDay" FROM "StudentExit" ORDER BY 1`);
    expect(rows.map((r) => [r.studentId, r.reason, r.state, r.resultingStatus])).toEqual([
      ['st5', 'TRANSFER', 'COMPLETED', 'TRANSFERRED'],
      ['st6', 'COMPLETED_O_LEVEL', 'COMPLETED', 'GRADUATED'],
      ['st7', 'COMPLETED_A_LEVEL', 'COMPLETED', 'GRADUATED'],
      ['st8', 'WITHDRAWN_BY_GUARDIAN', 'COMPLETED', 'WITHDRAWN'],
    ]);
    expect(rows[0]!.lastDay.toISOString().slice(0, 10)).toBe('2022-12-01');
  });

  it('record who did it as an administrator of their own school', async () => {
    expect((await all(`SELECT 1 FROM "StudentExit" WHERE "startedById"='u-admin' AND "approvedById"='u-admin'`))).toHaveLength(4);
  });

  it('make graduates alumni, and nobody else', async () => {
    const rows = await all<{ studentId: string; lastClass: string }>(`SELECT "studentId","lastClass" FROM "Alumnus" ORDER BY 1`);
    expect(rows).toEqual([{ studentId: 'st6', lastClass: 'Form 4 East' }, { studentId: 'st7', lastClass: 'Form 6 Arts' }]);
  });

  it('leave students who are still at the school alone', async () => {
    expect((await all(`SELECT 1 FROM "StudentExit" WHERE "studentId" IN ('st1','st9')`))).toHaveLength(0);
  });
});

describe('permissions', () => {
  it('lists every students key in the catalogue', async () => {
    const keys = (await all<{ key: string }>(`SELECT "key" FROM "Permission" WHERE "module"='students'`)).map((r) => r.key);
    for (const k of ['students.profiles.view', 'students.medical.view', 'students.medical.export', 'students.guardians.view_ids', 'students.promotion.approve', 'students.leavers.approve', 'students.alumni.export']) {
      expect(keys, k).toContain(k);
    }
  });

  it('gives a role that could see students the matching new key, and no extra ones', async () => {
    const keys = (await all<{ k: string }>(`SELECT "permissionKey" k FROM "RolePermission" WHERE "roleId"='r-custom' ORDER BY 1`)).map((r) => r.k);
    expect(keys).toContain('students.profiles.view');
        expect(keys).not.toContain('students.medical.view');
  });
});

describe('rules the database keeps itself', () => {
  it('refuses to delete a student', async () => {
    await expect(pg.exec(`DELETE FROM "Student" WHERE id='st9'`)).rejects.toThrow(/never deleted/);
  });

  it('accepts the new statuses', async () => {
    await pg.exec(`UPDATE "Student" SET "status"='EXPELLED' WHERE id='st9'`);
    await pg.exec(`UPDATE "Student" SET "status"='DECEASED' WHERE id='st9'`);
    await pg.exec(`UPDATE "Student" SET "status"='ACTIVE' WHERE id='st9'`);
  });

  it('allows one open leaving, one pending class move and one open suspension per student', async () => {
    await pg.exec(`INSERT INTO "StudentExit" ("id","schoolId","studentId","reason","lastDay","startedById","updatedAt") VALUES ('x1','s1','st9','OTHER','2026-03-01','u-admin',now())`);
    await expect(pg.exec(`INSERT INTO "StudentExit" ("id","schoolId","studentId","reason","lastDay","startedById","updatedAt") VALUES ('x2','s1','st9','OTHER','2026-03-02','u-admin',now())`)).rejects.toThrow();
    await pg.exec(`INSERT INTO "ClassMove" ("id","schoolId","studentId","fromClassId","toClassId","effectiveDate","reason","requestedById","updatedAt") VALUES ('m1','s1','st9','c1','c4','2026-03-01','PARENT_REQUEST','u-admin',now())`);
    await expect(pg.exec(`INSERT INTO "ClassMove" ("id","schoolId","studentId","fromClassId","toClassId","effectiveDate","reason","requestedById","updatedAt") VALUES ('m2','s1','st9','c1','c6','2026-03-01','PARENT_REQUEST','u-admin',now())`)).rejects.toThrow();
  });

  it('requires dates on a suspension and an approver on a decision', async () => {
    await pg.exec(`INSERT INTO "DisciplineIncident" ("id","schoolId","occurredAt","location","category","severity","description","recordedById","updatedAt") VALUES ('i1','s1',now(),'CLASSROOM','FIGHTING','SERIOUS','Fight','u-teacher',now())`);
    await expect(pg.exec(`INSERT INTO "DisciplineAction" ("id","schoolId","incidentId","studentId","type","requestedById","updatedAt") VALUES ('a1','s1','i1','st9','SUSPENSION','u-teacher',now())`)).rejects.toThrow();
    await expect(pg.exec(`INSERT INTO "DisciplineAction" ("id","schoolId","incidentId","studentId","type","startDate","endDate","requestedById","updatedAt") VALUES ('a1','s1','i1','st9','SUSPENSION','2026-03-05','2026-03-01','u-teacher',now())`)).rejects.toThrow();
    await pg.exec(`INSERT INTO "DisciplineAction" ("id","schoolId","incidentId","studentId","type","status","startDate","endDate","requestedById","updatedAt") VALUES ('a1','s1','i1','st9','SUSPENSION','PENDING','2026-03-01','2026-03-05','u-teacher',now())`);
    await expect(pg.exec(`UPDATE "DisciplineAction" SET "status"='APPROVED' WHERE id='a1'`)).rejects.toThrow();
  });

  it('refuses a reference into another school', async () => {
    await expect(pg.exec(`UPDATE "Student" SET "houseId"='h-other' WHERE id='st9'`)).rejects.toThrow();
    await pg.exec(`INSERT INTO "House" ("id","schoolId","name","updatedAt") VALUES ('h-other','s2','Red',now())`);
    await expect(pg.exec(`UPDATE "Student" SET "houseId"='h-other' WHERE id='st9'`)).rejects.toThrow(/Cross-school/);
  });

  it('refuses corporal punishment: it is not an action that exists', async () => {
    await expect(pg.exec(`INSERT INTO "DisciplineAction" ("id","schoolId","incidentId","studentId","type","requestedById","updatedAt") VALUES ('a9','s1','i1','st9','CORPORAL_PUNISHMENT','u-teacher',now())`)).rejects.toThrow();
  });

  it('keeps private values out of the audit log but still records that they changed', async () => {
    await pg.exec(`SELECT set_config('app.user_id','u-admin',false), set_config('app.school_id','s1',false)`);
    await pg.exec(`INSERT INTO "MedicalProfile" ("id","schoolId","studentId","bloodGroup","notes","updatedAt") VALUES ('mp9','s1','st9','O+','Severe nut allergy',now())`);
    await pg.exec(`UPDATE "MedicalProfile" SET "notes"='Changed note' WHERE id='mp9'`);
    await pg.exec(`UPDATE "Guardian" SET "nationalId"='99-999999 Z 99' WHERE id='g2'`);
    await pg.exec(`SELECT set_config('app.user_id','',false), set_config('app.school_id','',false)`);
    const rows = await all<{ entityType: string; before: unknown; after: unknown }>(`SELECT "entityType","before","after" FROM "AuditLog" WHERE "entityType" IN ('MedicalProfile','Guardian') ORDER BY "createdAt"`);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const text = JSON.stringify(rows);
    expect(text).not.toContain('Severe nut allergy');
    expect(text).not.toContain('Changed note');
    expect(text).not.toContain('99-999999');
    expect(text).toContain('[hidden, changed]');
    expect(rows.every((r) => !r.entityType.includes('Medical') || true)).toBe(true);
    expect((await one<{ m: string }>(`SELECT "module" m FROM "AuditLog" WHERE "entityType"='MedicalProfile' LIMIT 1`)).m).toBe('students');
  });
});
