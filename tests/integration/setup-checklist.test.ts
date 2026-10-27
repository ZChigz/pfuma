// @vitest-environment node
// The dashboard setup checklist, run against a real database: the facts come only
// from the caller's school, steps flip as the school is set up, and the new settings
// fields are validated, audited and kept apart between schools.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { PERMISSION_KEYS } from '@/lib/access-core';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

const PROFILE = { name: 'School A', schoolType: 'GOVERNMENT', boarding: 'DAY', studentGender: 'CO_ED', district: 'Chinhoyi', physicalAddress: '1 Main Street, Chinhoyi' };
const FINANCE = { currencyUsdEnabled: true, currencyZigEnabled: false, defaultCurrency: 'USD', receiptFormat: 'RCP-{YEAR}-{000000}', receiptNextNumber: 1, invoiceFormat: 'INV-{YEAR}-{000000}', invoiceNextNumber: 1 };
const saveProfile = (extra: object, as = A.users.ADMIN) => call('system/settings/profile', 'PATCH', { as, body: { ...PROFILE, ...extra } });
const saveDefaults = (extra: object, as = A.users.ADMIN) => call('system/settings/defaults', 'PATCH', { as, body: extra });
const saveFinance = (extra: object, as = A.users.ADMIN) => call('system/settings/finance', 'PATCH', { as, body: { ...FINANCE, ...extra } });

beforeAll(async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

async function stepsFor(school: SeededSchool) {
  const { loadSetupFacts, evaluateSetup } = await import('@/lib/system/setup-checklist');
  const { getScopedDb } = await import('@/lib/scoped-db');
  const db = getScopedDb(school.schoolId, school.users.ADMIN.id);
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: school.termId } });
  const steps = evaluateSetup(await loadSetupFacts(db, school.schoolId, term));
  return Object.fromEntries(steps.map((s) => [s.key, s.done])) as Record<string, boolean>;
}

describe('setup checklist facts', () => {
  it('starts with what the seeded school really has', async () => {
    // Seed: a class, a grade boundary, a student, six users and one open term of a one-term year.
    expect(await stepsFor(A)).toEqual({ profile: false, terms: false, classes: true, grading: true, money: false, staff: true, students: true, calendar: false });
  });

  it('flips each step as the school is set up, and only for that school', async () => {
    for (const n of [2, 3]) {
      await prisma.academicTerm.create({
        data: { schoolId: A.schoolId, academicYearId: A.yearId, termNumber: n, name: `Term ${n} 2026`, startDate: new Date(`2026-0${n * 2}-01`), endDate: new Date(`2026-0${n * 2}-28`), status: 'PLANNED' },
      });
    }
    expect((await stepsFor(A)).terms).toBe(true);
    expect((await stepsFor(B)).terms).toBe(false);

    const r = await saveProfile({ province: 'Harare', zimsecCentreNumber: '140123', logoUrl: 'https://utfs.io/f/a.png' });
    expect(r.status).toBe(200);
    expect(r.json.data.school).toMatchObject({ province: 'Harare', zimsecCentreNumber: '140123' });
    const d = await saveFinance({});
    expect(d.status).toBe(200);
    expect(d.json.data.school).toMatchObject({ receiptFormat: 'RCP-{YEAR}-{000000}', receiptNextNumber: 1, currencyZigEnabled: false, setupChecklistPinned: false });
    const done = await stepsFor(A);
    expect(done.profile).toBe(true);
    expect(done.money).toBe(true);
    expect((await stepsFor(B)).profile).toBe(false);

    await call('system/calendar', 'POST', { as: A.users.ADMIN, body: { title: 'Sports day', kind: 'SPORTS', startDate: '2026-06-10', endDate: '2026-06-10' } });
    expect((await stepsFor(A)).calendar).toBe(true);
    expect((await stepsFor(B)).calendar).toBe(false);
  });

  it('counts an event outside the term as not enough', async () => {
    await prisma.calendarEvent.deleteMany({ where: { schoolId: A.schoolId } });
    await call('system/calendar', 'POST', { as: A.users.ADMIN, body: { title: 'Next year', kind: 'OTHER', startDate: '2027-03-01', endDate: '2027-03-01', acknowledged: true } });
    expect((await stepsFor(A)).calendar).toBe(false);
  });

  it('wants one more active user than the admin, and ignores deactivated ones', async () => {
    await prisma.user.updateMany({ where: { schoolId: B.schoolId, id: { not: B.users.ADMIN.id } }, data: { active: false } });
    expect((await stepsFor(B)).staff).toBe(false);
    await prisma.user.update({ where: { id: B.users.TEACHER.id }, data: { active: true } });
    expect((await stepsFor(B)).staff).toBe(true);
  });

  it('wants an exchange rate when the default currency is ZiG', async () => {
    await saveFinance({ currencyZigEnabled: true, defaultCurrency: 'ZIG' });
    expect((await stepsFor(A)).money).toBe(false);
    await prisma.exchangeRate.create({ data: { schoolId: A.schoolId, usdToZig: 27, setBy: A.users.BURSAR.id } });
    expect((await stepsFor(A)).money).toBe(true);
  });
});

describe('new school settings fields', () => {
  it('rejects a bad province, centre number, prefix or receipt number', async () => {
    for (const bad of [{ province: 'Narnia' }, { zimsecCentreNumber: '!!' }]) expect((await saveProfile(bad)).status, JSON.stringify(bad)).toBe(422);
    for (const bad of [{ receiptFormat: 'NO COUNTER' }, { receiptNextNumber: 0 }]) expect((await saveFinance(bad)).status, JSON.stringify(bad)).toBe(422);
    for (const bad of [{ maxClassSize: 0 }, {}]) expect((await saveDefaults(bad)).status, JSON.stringify(bad)).toBe(422);
  });

  it('pins and unpins the checklist, audited, without touching other schools', async () => {
    const n = await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'UPDATE_SCHOOL_SETTINGS' } });
    const pin = await saveDefaults({ setupChecklistPinned: true });
    expect(pin.json.data.school.setupChecklistPinned).toBe(true);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'UPDATE_SCHOOL_SETTINGS' }, orderBy: { createdAt: 'desc' } });
    expect(entry.before).toMatchObject({ setupChecklistPinned: false });
    expect(entry.after).toMatchObject({ setupChecklistPinned: true });
    expect(entry.detail).toContain('setupChecklistPinned');
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'UPDATE_SCHOOL_SETTINGS' } })).toBe(n + 1);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: B.schoolId } })).setupChecklistPinned).toBe(false);

    // Leaving the field out keeps it as it was.
    const keep = await saveDefaults({ maxClassSize: 45 });
    expect(keep.json.data.school.setupChecklistPinned).toBe(true);
    const off = await saveDefaults({ setupChecklistPinned: false });
    expect(off.json.data.school.setupChecklistPinned).toBe(false);
  });

  it('is only for people who may see settings and set up the school', async () => {
    const { can } = await import('@/lib/access-core');
    expect(can({ id: 'x', schoolId: 's', role: 'ADMIN', grants: [...PERMISSION_KEYS] }, 'system.settings.edit')).toBe(true);
    for (const role of ['HEAD', 'BURSAR', 'TEACHER', 'LIBRARIAN'] as const) expect(can({ id: 'x', schoolId: 's', role, grants: ['system.dashboard.view', 'system.calendar.view'] }, 'system.settings.edit')).toBe(false);
    expect((await saveDefaults({ setupChecklistPinned: true }, A.users.TEACHER)).status).toBe(403);
    expect((await saveProfile({}, A.users.TEACHER)).status).toBe(403);
  });

  it('the dashboard page shows the checklist while steps are open and hides it when all are done', async () => {
    const { session } = await import('../helpers/session');
    const { isValidElement } = await import('react');
    const hasChecklist = async () => {
      session.current = { ...A.users.ADMIN };
      const mod = await import('@/app/(dashboard)/system/dashboard/page');
      const found = (node: unknown): boolean => {
        if (!node || typeof node !== 'object') return false;
        if (Array.isArray(node)) return node.some(found);
        if (!isValidElement(node)) return false;
        const el = node as { type: unknown; props: { children?: unknown } };
        return (typeof el.type === 'function' && (el.type as { name: string }).name === 'SetupChecklist') || found(el.props.children);
      };
      return found(await mod.default());
    };
    expect(await hasChecklist()).toBe(true);   // A still has open steps
    // Finish everything for A.
    await prisma.calendarEvent.create({ data: { schoolId: A.schoolId, title: 'Term dates', startDate: new Date('2026-03-01'), endDate: new Date('2026-03-01'), createdById: A.users.ADMIN.id } });
    await saveProfile({ province: 'Harare', zimsecCentreNumber: '140123', logoUrl: 'https://utfs.io/f/a.png' });
    await saveFinance({});
    await saveDefaults({ setupChecklistPinned: false });
    expect(await hasChecklist()).toBe(false);
    await saveDefaults({ setupChecklistPinned: true });
    expect(await hasChecklist()).toBe(true);   // reopened from Settings
  });
});
