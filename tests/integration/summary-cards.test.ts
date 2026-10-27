// @vitest-environment node
// Dashboard summary cards against a real database.
import { isValidElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { PERMISSION_KEYS } from '@/lib/access-core';

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  auth: (await import('../helpers/session')).mockAuth,
}));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
let term2Id: string;
let classBId: string;

const db = async (s: SeededSchool) => (await import('@/lib/scoped-db')).getScopedDb(s.schoolId, s.users.ADMIN.id);
const termOf = (id: string) => prisma.academicTerm.findUniqueOrThrow({ where: { id } });

async function addStudent(s: SeededSchool, n: number, gender: 'M' | 'F' | null, classId: string, termId: string, status: 'ACTIVE' | 'WITHDRAWN' | 'PROMOTED' = 'ACTIVE') {
  const st = await prisma.student.create({
    data: { schoolId: s.schoolId, admissionNumber: `X${s.schoolId.slice(-4)}${n}`, firstName: 'S', surname: `${n}`, fullName: `S ${n}`, gender, admissionDate: new Date('2026-01-10'), currentClassId: classId },
  });
  await prisma.enrollment.create({ data: { schoolId: s.schoolId, studentId: st.id, classId, termId, startDate: new Date('2026-01-10'), status } });
}

beforeAll(async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');

  // School A, term 1: seeded boy (class 1) + 2 more boys, 3 girls, 1 unrecorded, 1 withdrawn girl → 7 active.
  const term2 = await prisma.academicTerm.create({
    data: { schoolId: A.schoolId, academicYearId: A.yearId, termNumber: 2, name: 'Term 2 2026', startDate: new Date('2026-05-01'), endDate: new Date('2026-08-20'), status: 'PLANNED' },
  });
  term2Id = term2.id;
  await prisma.schoolClass.update({ where: { id: A.classId }, data: { capacity: 5 } });
  const second = await prisma.schoolClass.create({ data: { schoolId: A.schoolId, name: 'Form 1 South', levelId: A.levelId, stream: 'South', capacity: 40 } });
  const inactive = await prisma.schoolClass.create({ data: { schoolId: A.schoolId, name: 'Old class', levelId: A.levelId, stream: 'Old', capacity: 1, active: false } });
  for (let i = 0; i < 2; i++) await addStudent(A, i, 'M', A.classId, A.termId);          // class 1: 3 boys so far
  for (let i = 2; i < 5; i++) await addStudent(A, i, 'F', A.classId, A.termId);          // class 1: 6 in total → over capacity 5
  await addStudent(A, 5, null, second.id, A.termId);                                      // class 2: 1 unrecorded
  await addStudent(A, 6, 'F', second.id, A.termId, 'WITHDRAWN');                          // not counted
  await addStudent(A, 7, 'F', inactive.id, A.termId);                                     // inactive class: counted as a student, not as a class
  await addStudent(A, 8, 'F', second.id, term2Id);                                        // only in term 2

  // School B has its own, different, numbers.
  classBId = B.classId;
  for (let i = 0; i < 4; i++) await addStudent(B, 100 + i, 'M', B.classId, B.termId);
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('students card', () => {
  it('counts active students in the term with a boys / girls split', async () => {
    const { loadStudentSummary } = await import('@/lib/system/summary');
    const s = await loadStudentSummary(await db(A), A.schoolId, await termOf(A.termId));
    // seeded boy + 2 boys; 3 girls + 1 girl in the inactive class; 1 unrecorded (+ 0). Withdrawn girl excluded.
    expect(s.total).toBe(8);
    expect(s.boys).toBe(3);
    expect(s.girls).toBe(4);
    expect(s.unrecorded).toBe(1);
    expect(s.boys + s.girls + s.unrecorded).toBe(s.total);
  });

  it('follows the selected term', async () => {
    const { loadStudentSummary } = await import('@/lib/system/summary');
    expect(await loadStudentSummary(await db(A), A.schoolId, await termOf(term2Id))).toEqual({ total: 1, boys: 0, girls: 1, unrecorded: 0 });
  });

  it('only counts its own school', async () => {
    const { loadStudentSummary } = await import('@/lib/system/summary');
    expect((await loadStudentSummary(await db(B), B.schoolId, await termOf(B.termId))).total).toBe(5); // seeded + 4
    // Asking school A's client about school B's term finds nothing of B's.
    expect((await loadStudentSummary(await db(A), A.schoolId, await termOf(B.termId))).total).toBe(0);
  });
});

describe('classes card', () => {
  it('counts active classes, averages their size and flags those over capacity', async () => {
    const { loadClassSummary } = await import('@/lib/system/summary');
    const c = await loadClassSummary(await db(A), A.schoolId, await termOf(A.termId));
    // Form 1 North: seeded + 5 = 6 (capacity 5, over); Form 1 South: 1 active (withdrawn excluded). Inactive class ignored.
    expect(c.classes).toBe(2);
    expect(c.averageSize).toBe(3.5);
    expect(c.overCapacity).toBe(1);
  });

  it('follows the selected term and keeps schools apart', async () => {
    const { loadClassSummary } = await import('@/lib/system/summary');
    const c2 = await loadClassSummary(await db(A), A.schoolId, await termOf(term2Id));
    expect(c2).toEqual({ classes: 2, averageSize: 0.5, overCapacity: 0 });
    const cb = await loadClassSummary(await db(B), B.schoolId, await termOf(B.termId));
    expect(cb.classes).toBe(1);
    expect(cb.averageSize).toBe(5);
    expect(classBId).toBeTruthy();
  });
});

describe('staff card and last login', () => {
  it('signing in records lastLoginAt, and a wrong password does not', async () => {
    const { authorizeCredentials } = await import('@/lib/auth');
    const u = A.users.HEAD;
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).lastLoginAt).toBeNull();
    expect(await authorizeCredentials({ email: u.email, password: 'wrong-wrong-1' })).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).lastLoginAt).toBeNull();
    const ok = await authorizeCredentials({ email: u.email, password: 'Correct-horse-1' });
    expect(ok?.id).toBe(u.id);
    const at = (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).lastLoginAt!;
    expect(Math.abs(at.getTime() - Date.now())).toBeLessThan(10_000);
  });

  it('counts active staff and those who signed in during the last 7 days', async () => {
    const { loadStaffSummary } = await import('@/lib/system/summary');
    const day = 864e5;
    await prisma.user.update({ where: { id: A.users.BURSAR.id }, data: { lastLoginAt: new Date(Date.now() - 3 * day) } });
    await prisma.user.update({ where: { id: A.users.TEACHER.id }, data: { lastLoginAt: new Date(Date.now() - 8 * day) } });
    await prisma.user.update({ where: { id: A.users.LIBRARIAN.id }, data: { lastLoginAt: new Date(), active: false } });
    const s = await loadStaffSummary(await db(A), A.schoolId);
    expect(s.active).toBe(5);
    expect(s.loggedInThisWeek).toBe(2); // head (just now) and bursar (3 days); teacher too old, librarian inactive
    const b = await loadStaffSummary(await db(B), B.schoolId);
    expect(b).toEqual({ active: 6, loggedInThisWeek: 0 });
  });
});

describe('the cards on the dashboard', () => {
  const names = async (sessionUser: SeededSchool['users']['ADMIN']) => {
    const { session } = await import('../helpers/session');
    session.current = { ...sessionUser };
    const mod = await import('@/app/(dashboard)/system/dashboard/page');
    const found: string[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (!isValidElement(node)) return;
      const el = node as { type: unknown; props: { children?: unknown } };
      if (typeof el.type === 'function') found.push((el.type as { name: string }).name);
      walk(el.props.children);
    };
    walk(await mod.default());
    return found;
  };

  it('has the four cards, each its own component', async () => {
    const found = await names(A.users.ADMIN);
    for (const c of ['StudentsCard', 'StaffCard', 'TermCard', 'ClassesCard']) expect(found).toContain(c);
  });

  it('a card whose module is off renders nothing, while the others stay', async () => {
    const { StudentsCard } = await import('@/components/system/cards/StudentsCard');
    const { StaffCard } = await import('@/components/system/cards/StaffCard');
    const { ClassesCard } = await import('@/components/system/cards/ClassesCard');
    const { TermCard } = await import('@/components/system/cards/TermCard');
    const term = await termOf(A.termId);
    const admin = { id: A.users.ADMIN.id, schoolId: A.schoolId, role: 'ADMIN' as const, grants: [...PERMISSION_KEYS] };

    expect(await StudentsCard({ user: { ...admin, disabledModules: ['students'] }, term })).toBeNull();
    expect(await StaffCard({ user: { ...admin, disabledModules: ['hr'] } })).toBeNull();
    expect(await ClassesCard({ user: { ...admin, disabledModules: ['academics'] }, term })).toBeNull();
    expect(TermCard({ user: { ...admin, disabledModules: ['students', 'hr', 'academics'] }, term })).not.toBeNull();
    expect(await StudentsCard({ user: admin, term })).not.toBeNull();
  });

  it('shows nothing to a role without the permission', async () => {
    const { StudentsCard } = await import('@/components/system/cards/StudentsCard');
    expect(await StudentsCard({ user: { id: 'x', schoolId: A.schoolId, role: 'TEACHER' }, term: await termOf(A.termId) })).toBeNull();
  });

  it('cards cope with a school that has no term yet', async () => {
    const { StudentsCard } = await import('@/components/system/cards/StudentsCard');
    const { ClassesCard } = await import('@/components/system/cards/ClassesCard');
    const { TermCard } = await import('@/components/system/cards/TermCard');
    const admin = { id: A.users.ADMIN.id, schoolId: A.schoolId, role: 'ADMIN' as const, grants: [...PERMISSION_KEYS] };
    expect(await StudentsCard({ user: admin, term: null })).not.toBeNull();
    expect(await ClassesCard({ user: admin, term: null })).not.toBeNull();
    expect(TermCard({ user: admin, term: null })).not.toBeNull();
  });
});
