// @vitest-environment node
// Dashboard charts, lists and empty states against a real database.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { PERMISSION_KEYS } from '@/lib/access-core';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let C: SeededSchool; // classes, no students
let prisma: typeof import('@/lib/prisma').prisma;

const day = 864e5;
const dbOf = async (s: SeededSchool) => (await import('@/lib/scoped-db')).getScopedDb(s.schoolId, s.users.ADMIN.id);
const termOf = (id: string) => prisma.academicTerm.findUniqueOrThrow({ where: { id } });
const userOf = (s: SeededSchool) => ({ id: s.users.ADMIN.id, schoolId: s.schoolId, role: 'ADMIN' as const, grants: [...PERMISSION_KEYS] });
const html = async (el: unknown) => renderToStaticMarkup((await el) as never);

async function addStudent(s: SeededSchool, n: number, gender: 'M' | 'F' | null, classId: string, termId: string) {
  const st = await prisma.student.create({
    data: { schoolId: s.schoolId, admissionNumber: `Y${s.schoolId.slice(-4)}${n}`, firstName: 'S', surname: `${n}`, fullName: `S ${n}`, gender, admissionDate: new Date('2026-01-10'), currentClassId: classId },
  });
  await prisma.enrollment.create({ data: { schoolId: s.schoolId, studentId: st.id, classId, termId, startDate: new Date('2026-01-10') } });
}

beforeAll(async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  C = await seedSchool(prisma, 'School C');
  // C: remove the seeded enrolments so it has classes but nobody in them.
  await prisma.enrollment.deleteMany({ where: { schoolId: C.schoolId } });

  const form2 = await prisma.level.create({ data: { schoolId: A.schoolId, name: 'Form 2', order: 2, category: 'O_LEVEL' } });
  const south = await prisma.schoolClass.create({ data: { schoolId: A.schoolId, name: 'Form 2 South', levelId: form2.id, stream: 'South', capacity: 3 } });
  await prisma.schoolClass.update({ where: { id: A.classId }, data: { capacity: 4 } });
  for (let i = 0; i < 4; i++) await addStudent(A, i, i % 2 ? 'F' : 'M', A.classId, A.termId);   // + seeded boy = 5 in Form 1 North (cap 4)
  for (let i = 10; i < 12; i++) await addStudent(A, i, 'F', south.id, A.termId);              // 2 in Form 2 South (cap 3)
  await addStudent(B, 50, 'M', B.classId, B.termId);
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('enrolment and class-size charts', () => {
  it('count boys and girls per form and each class against its capacity', async () => {
    const { loadChartData } = await import('@/lib/system/charts');
    const d = await loadChartData(await dbOf(A), A.schoolId, await termOf(A.termId));
    expect(d.students).toBe(7);
    expect(d.forms.map((f) => [f.name, f.boys, f.girls, f.total])).toEqual([['Form 1', 3, 2, 5], ['Form 2', 0, 2, 2]]);
    expect(d.classes.map((c) => [c.name, c.count, c.capacity])).toEqual([['Form 1 North', 5, 4], ['Form 2 South', 2, 3]]);
  });

  it("never include another school's students", async () => {
    const { loadChartData } = await import('@/lib/system/charts');
    const b = await loadChartData(await dbOf(B), B.schoolId, await termOf(B.termId));
    expect(b.students).toBe(2);
    // School A's client asked about school B's term sees none of B's enrolments.
    expect((await loadChartData(await dbOf(A), A.schoolId, await termOf(B.termId))).students).toBe(0);
  });

  it('are drawn for the administrator, with the over-capacity class flagged', async () => {
    const { EnrolmentChart } = await import('@/components/system/charts/EnrolmentChart');
    const { ClassSizeChart } = await import('@/components/system/charts/ClassSizeChart');
    const term = await termOf(A.termId);
    const e = await html(EnrolmentChart({ user: userOf(A), term }));
    expect(e).toContain('Enrolment by form');
    expect(e).toContain('Form 1: 5 students, 3 boys and 2 girls');
    const c = await html(ClassSizeChart({ user: userOf(A), term }));
    expect(c).toContain('▲ 1 over');
    expect(c.indexOf('Form 1 North')).toBeLessThan(c.indexOf('Form 2 South')); // biggest first
  });

  it('are left out when their module is off or the viewer lacks the permission', async () => {
    const { EnrolmentChart } = await import('@/components/system/charts/EnrolmentChart');
    const { ClassSizeChart } = await import('@/components/system/charts/ClassSizeChart');
    const term = await termOf(A.termId);
    expect(await EnrolmentChart({ user: { ...userOf(A), disabledModules: ['students'] }, term })).toBeNull();
    expect(await ClassSizeChart({ user: { ...userOf(A), disabledModules: ['academics'] }, term })).toBeNull();
    expect(await EnrolmentChart({ user: { ...userOf(A), role: 'TEACHER', grants: [] }, term })).toBeNull();
  });

  it('show an empty state with a link to the setup step, never an empty chart', async () => {
    const { EnrolmentChart } = await import('@/components/system/charts/EnrolmentChart');
    const { ClassSizeChart } = await import('@/components/system/charts/ClassSizeChart');
    const { StudentsCard } = await import('@/components/system/cards/StudentsCard');
    const { ClassesCard } = await import('@/components/system/cards/ClassesCard');
    const term = await termOf(C.termId);

    // C has a class and a term but no students.
    const e = await html(EnrolmentChart({ user: userOf(C), term }));
    expect(e).toContain('No students are enrolled in this term yet.');
    expect(e).toContain('href="/students/import"');
    expect(e).not.toContain('View as table');
    const c = await html(ClassSizeChart({ user: userOf(C), term }));
    expect(c).toContain('Import students');
    const s = await html(StudentsCard({ user: userOf(C), term }));
    expect(s).toContain('—');
    expect(s).toContain('Import students');
    const k = await html(ClassesCard({ user: userOf(C), term }));
    expect(k).toContain('No students enrolled in this term yet');
    expect(k).not.toContain('Average class size');

    // A school with no classes at all.
    await prisma.schoolClass.updateMany({ where: { schoolId: C.schoolId }, data: { active: false } });
    const none = await html(ClassSizeChart({ user: userOf(C), term }));
    expect(none).toContain('No classes have been created yet.');
    expect(none).toContain('href="/admin/classes"');
    expect(await html(ClassesCard({ user: userOf(C), term }))).toContain('Create classes');

    // No term at all.
    expect(await html(EnrolmentChart({ user: userOf(C), term: null }))).toContain('href="/admin/academic"');
    expect(await html(StudentsCard({ user: userOf(C), term: null }))).toContain('href="/admin/academic"');
  });

  it('hides the Import link from someone who may not import', async () => {
    const { EnrolmentChart } = await import('@/components/system/charts/EnrolmentChart');
    const { ClassSizeChart } = await import('@/components/system/charts/ClassSizeChart');
    await prisma.schoolClass.updateMany({ where: { schoolId: C.schoolId }, data: { active: true } });
    const grants = ['students.list.view', 'academics.classes.view'];
    const user = { id: 'h', schoolId: C.schoolId, role: 'HEAD' as const, grants };
    const term = await termOf(C.termId);
    for (const out of [await html(EnrolmentChart({ user, term })), await html(ClassSizeChart({ user, term }))]) {
      expect(out).toContain('No students are enrolled');
      expect(out).not.toContain('Import students');
    }
  });
});

describe('upcoming events', () => {
  it('lists the next five from today, soonest first, including one that is on now', async () => {
    const { loadUpcomingEvents } = await import('@/lib/system/upcoming');
    const mk = (title: string, startOff: number, endOff: number, s = A) => prisma.calendarEvent.create({
      data: { schoolId: s.schoolId, title, startDate: new Date(Date.now() + startOff * day), endDate: new Date(Date.now() + endOff * day), createdById: s.users.ADMIN.id },
    });
    await mk('Past', -10, -9);
    await mk('On now', -1, 2);
    for (let i = 1; i <= 6; i++) await mk(`Future ${i}`, i * 3, i * 3);
    await mk('B only', 1, 1, B);
    const events = (await loadUpcomingEvents(await dbOf(A), A.users.ADMIN)).filter((e) => !e.preloaded);
    expect(events.map((e) => e.title)).toEqual(['On now', 'Future 1', 'Future 2', 'Future 3', 'Future 4']);
    expect((await loadUpcomingEvents(await dbOf(B), B.users.ADMIN)).filter((e) => !e.preloaded).map((e) => e.title)).toEqual(['B only']);
  });

  it('shows an empty state with a link to add one', async () => {
    const { UpcomingEvents } = await import('@/components/system/lists/Lists');
    // Mark the holiday years as loaded (and nothing in them), as if the administrator had deleted every holiday.
    const y = new Date().getUTCFullYear();
    await prisma.calendarHolidayYear.createMany({ data: [y, y + 1, y + 2].map((year) => ({ schoolId: C.schoolId, year })) });
    const out = await html(UpcomingEvents({ user: userOf(C) }));
    expect(out).toContain('Nothing is coming up');
    expect(out).toContain('href="/system/calendar?new=1"');
    const readOnly = await html(UpcomingEvents({ user: { id: 'h', schoolId: C.schoolId, role: 'HEAD', grants: ['system.calendar.view'] } }));
    expect(readOnly).toContain('href="/system/calendar"');
    expect(readOnly).not.toContain('new=1');
  });
});

describe('recent activity', () => {
  it('turns the audit log into sentences, folds a 42-student import into one line, and stays inside the school', async () => {
    const { loadFeed } = await import('@/lib/system/activity');
    const actor = A.users.HEAD;
    const base = Date.now() - 2 * 3600_000;
    await prisma.auditLog.createMany({
      data: Array.from({ length: 42 }, (_, i) => ({ schoolId: A.schoolId, actorId: actor.id, action: 'ADMIT_STUDENT' as const, entityType: 'Student', entityId: `s${i}`, createdAt: new Date(base - i * 1000) })),
    });
    await prisma.auditLog.create({ data: { schoolId: A.schoolId, actorId: A.users.ADMIN.id, action: 'CREATE_USER', entityType: 'User', entityId: 'u', detail: 'Rudo Chari (TEACHER)', createdAt: new Date(base + 60_000) } });
    await prisma.auditLog.create({ data: { schoolId: B.schoolId, actorId: B.users.ADMIN.id, action: 'CREATE_USER', entityType: 'User', entityId: 'u', detail: 'B secret person', createdAt: new Date() } });
    await prisma.auditLog.create({ data: { schoolId: A.schoolId, actorId: actor.id, action: 'DATA_UPDATE', entityType: 'User', entityId: 'u', createdAt: new Date() } });

    const feed = await loadFeed(await dbOf(A), A.schoolId, { id: A.users.ADMIN.id, schoolId: A.schoolId, role: 'ADMIN' as never, grants: [...PERMISSION_KEYS] });
    const first = feed.map((f) => f.text);
    expect(first).toContain('School A HEAD added 42 students'.replace('School A HEAD', 'S. HEAD'));
    expect(first.some((x) => x.includes('B secret person'))).toBe(false);
    expect(first.some((x) => /data update/i.test(x))).toBe(false);
    expect(feed.length).toBeLessThanOrEqual(10);
    expect(feed[0].when.getTime()).toBeGreaterThanOrEqual(feed[feed.length - 1].when.getTime());
  });

  it('is drawn with relative times, and only for people who may see the audit log', async () => {
    const { RecentActivity } = await import('@/components/system/lists/Lists');
    const out = await html(RecentActivity({ user: userOf(A) }));
    expect(out).toContain('added 42 students');
    expect(out).toContain('hours ago');
    expect(out).toContain('href="/system/audit-log"');
    expect(await RecentActivity({ user: { id: 'x', schoolId: A.schoolId, role: 'TEACHER' } })).toBeNull();
  });

  it('shows an empty state for a school with no activity', async () => {
    const { RecentActivity } = await import('@/components/system/lists/Lists');
    const fresh = await prisma.school.create({ data: { name: 'Fresh' } });
    const out = await html(RecentActivity({ user: { id: 'x', schoolId: fresh.id, role: 'ADMIN', grants: [...PERMISSION_KEYS] } }));
    expect(out).toContain('Nothing has been done yet');
  });
});

describe('the dashboard page', () => {
  it('puts quick actions, cards, charts and lists on one screen', async () => {
    const { isValidElement } = await import('react');
    const { session } = await import('../helpers/session');
    session.current = { ...A.users.ADMIN };
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
    for (const n of ['QuickActions', 'StudentsCard', 'StaffCard', 'TermCard', 'ClassesCard', 'EnrolmentChart', 'ClassSizeChart', 'UpcomingEvents', 'RecentActivity']) expect(found).toContain(n);
  });
});
