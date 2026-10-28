// @vitest-environment node
// The Facilities overview and reports against a real PostgreSQL: each person sees only the parts their permissions reach, a part the school
// has switched off is left out, figures count only the person's own school, and the sick bay report is counts only.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, userWithRoles, type SeededSchool } from '../helpers/seed';
import { actorOf } from '../helpers/academics';
import { addStudent } from '../helpers/students';
import { fails } from '../helpers/finance';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

type Actor = Awaited<ReturnType<typeof actorOf>>;
let t: TestDb;
let prisma: typeof import('@/lib/prisma').prisma;
let ov: typeof import('@/lib/facilities/overview');
let A: SeededSchool; let B: SeededSchool;
let op: Actor; let opB: Actor; let librarian: Actor; let plain: Actor;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  ov = await import('@/lib/facilities/overview');
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  const libU = await userWithRoles(prisma, A, ['LIBRARIAN'], 'lib');
  const plainU = await userWithRoles(prisma, A, ['TEACHER'], 'plain');
  [op, opB, librarian, plain] = await Promise.all([actorOf(prisma, A.operator!.id), actorOf(prisma, B.operator!.id), actorOf(prisma, libU.id), actorOf(prisma, plainU.id)]);
  const kid = await addStudent(prisma, A, { firstName: 'Sam', surname: 'Sick', gender: 'M', boarding: 'BOARDER' });
  await prisma.facSickBayVisit.create({ data: { schoolId: A.schoolId, studentId: kid.id, visitedAt: new Date(), complaint: 'FEVER', complaintNote: 'Secret detail', outcome: 'BACK_TO_CLASS', recordedById: op.id } });
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('overview', () => {
  it('shows every part to someone who holds them all, and only the library to a librarian', async () => {
    const all = await ov.facilitiesOverview(op);
    expect(all.cards.map((c) => c.part).sort()).toEqual(['assets', 'exeats', 'hostel', 'inventory', 'library', 'sickbay', 'transport', 'tuckshop']);
    expect(all.cards.find((c) => c.part === 'sickbay')!.figures.find((f) => f.label === 'Visits today')!.value).toBe('1');
    const lib = await ov.facilitiesOverview(librarian);
    expect(lib.cards.map((c) => c.part)).toEqual(['library']);
    await fails(ov.facilitiesOverview(plain), 403);
  });

  it('leaves out a part the school has switched off, and counts only its own school', async () => {
    await prisma.schoolModule.create({ data: { schoolId: A.schoolId, module: 'facilities.transport', enabled: false } });
    const all = await ov.facilitiesOverview(op);
    expect(all.cards.some((c) => c.part === 'transport')).toBe(false);
    expect(all.hidden).toBe(1);
    const other = await ov.facilitiesOverview(opB);
    expect(other.cards.find((c) => c.part === 'sickbay')!.figures.find((f) => f.label === 'Visits today')!.value).toBe('0');
  });
});

describe('reports', () => {
  it('gives sick bay counts only, never a name or a complaint note', async () => {
    const r = await ov.facilitiesReport(op);
    const sick = r.sections.find((s) => s.part === 'sickbay')!;
    expect(sick.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(sick)).not.toMatch(/Sam|Secret detail/);
    expect(r.sections.some((s) => s.part === 'transport')).toBe(false);
  });

  it('shows a librarian the library only, and nothing for another school', async () => {
    expect((await ov.facilitiesReport(librarian)).sections.map((s) => s.part)).toEqual(['library']);
    const other = await ov.facilitiesReport(opB);
    expect(other.sections.find((s) => s.part === 'sickbay')!.rows).toEqual([]);
    await fails(ov.facilitiesReport(plain), 403);
  });
});
