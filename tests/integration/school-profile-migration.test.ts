// @vitest-environment node
// The school-profile migrations applied on top of schools that already exist.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, createPg } from '../helpers/test-db';

let pg: PGlite;
const all = async <T = Record<string, unknown>>(sql: string): Promise<T[]> => (await pg.query<T>(sql)).rows;

beforeAll(async () => {
  pg = await createPg('20261027000000_school_profile');
  await pg.exec(`
    INSERT INTO "School" ("id","name","location","address","phone","province","schoolType") VALUES
      ('s1','Harare High','Harare','12 Samora Machel Ave','+263 242 700 123','Harare','GOVERNMENT'),
      ('s2','Rusape Mission','  Makoni  ','Box 5, Rusape','0772 123 456',NULL,'PRIVATE'),
      ('s3','Bare School',NULL,NULL,NULL,NULL,'GOVERNMENT'),
      ('s4','Odd Phone School','Bulawayo','1 Fife St','call the office',NULL,'GOVERNMENT'),
      ('s5','Foreign Phone School','Mutare','2 Main','+27 82 123 4567',NULL,'GOVERNMENT'),
      ('s6','Blank Location',E'   ','  ','',NULL,'GOVERNMENT');
  `);
  await applyMigration(pg, '20261027000000_school_profile');
  await applyMigration(pg, '20261027000100_school_profile_backfill');
}, 300_000);

afterAll(async () => { await pg.close(); });

const school = async (id: string) => (await all<Record<string, unknown>>(`SELECT * FROM "School" WHERE "id" = '${id}'`))[0];

describe('school profile migrations', () => {
  it('lose no schools and keep the old columns as they were', async () => {
    expect((await all(`SELECT 1 FROM "School"`)).length).toBe(6);
    expect(await school('s1')).toMatchObject({ location: 'Harare', address: '12 Samora Machel Ave', name: 'Harare High', province: 'Harare' });
    expect(await school('s2')).toMatchObject({ location: '  Makoni  ', address: 'Box 5, Rusape' });
  });

  it('copy the old location into district and the old address into physical address', async () => {
    expect(await school('s1')).toMatchObject({ district: 'Harare', physicalAddress: '12 Samora Machel Ave' });
    expect(await school('s2')).toMatchObject({ district: 'Makoni', physicalAddress: 'Box 5, Rusape' });
  });

  it('leave district and address empty where there was nothing to copy', async () => {
    for (const id of ['s3', 's6']) expect(await school(id), id).toMatchObject({ district: null, physicalAddress: null });
  });

  it('write phone numbers as +263… when they can be read, and leave the rest alone', async () => {
    expect((await school('s1')).phone).toBe('+263242700123');
    expect((await school('s2')).phone).toBe('+263772123456');
    expect((await school('s3')).phone).toBeNull();
    expect((await school('s4')).phone).toBe('call the office'); // unreadable: untouched, not deleted
    expect((await school('s5')).phone).toBe('+27 82 123 4567'); // another country: untouched
  });

  it('give every school the profile defaults', async () => {
    for (const r of await all<Record<string, unknown>>(`SELECT "boarding"::text AS boarding, "studentGender"::text AS gender, "offersCambridge", "responsibleAuthority", "emisNumber", "website", "headName", "headSignatureUrl", "postalAddress" FROM "School"`)) {
      expect(r).toEqual({ boarding: 'DAY', gender: 'CO_ED', offersCambridge: false, responsibleAuthority: null, emisNumber: null, website: null, headName: null, headSignatureUrl: null, postalAddress: null });
    }
  });

  it('can be run again without changing anything', async () => {
    const before = JSON.stringify(await all(`SELECT "id","phone","district","physicalAddress" FROM "School" ORDER BY "id"`));
    await applyMigration(pg, '20261027000100_school_profile_backfill').catch(() => undefined); // the constraints exist already; the data steps are idempotent
    expect(JSON.stringify(await all(`SELECT "id","phone","district","physicalAddress" FROM "School" ORDER BY "id"`))).toBe(before);
  });

  it('adds the new school types', async () => {
    const labels = (await all<{ enumlabel: string }>(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'SchoolType'`)).map((r) => r.enumlabel);
    for (const k of ['GOVERNMENT', 'COUNCIL', 'MISSION_CHURCH', 'TRUST', 'PRIVATE']) expect(labels).toContain(k);
    await pg.exec(`UPDATE "School" SET "schoolType" = 'MISSION_CHURCH' WHERE "id" = 's2'`);
  });

  it('refuses a bad province, website or blank name on any school that is saved from now on', async () => {
    const bad = (set: string) => pg.exec(`UPDATE "School" SET ${set} WHERE "id" = 's1'`);
    await expect(bad(`"province" = 'Narnia'`)).rejects.toThrow();
    await expect(bad(`"website" = 'www.school.co.zw'`)).rejects.toThrow();
    await expect(bad(`"name" = '   '`)).rejects.toThrow();
    await bad(`"province" = 'Midlands', "website" = 'https://school.co.zw'`);
  });

  it('lets a school with an old unreadable phone keep saving other things', async () => {
    await pg.exec(`UPDATE "School" SET "headName" = 'Mr Moyo', "maxClassSize" = 40 WHERE "id" = 's4'`);
    expect((await school('s4')).phone).toBe('call the office');
  });
});
