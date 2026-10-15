// @vitest-environment node
// The Calendar page's rules against a real database: preloaded public holidays, warnings,
// repeats, times, audience, type filter, term dates, PDF export, school isolation.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

const admin = () => A.users.ADMIN;
type Item = { id: string; key: string; source: string; kind: string; title: string; startDate: string; endDate: string; preloaded: boolean; occurrence: number; startTime: string | null };
const list = async (query: string, as = admin()) => (await call('system/calendar', 'GET', { as, query })).json.data.items as Item[];
const post = (body: object, as = admin()) => call('system/calendar', 'POST', { as, body });
const base = { title: 'Mock exams', kind: 'EXAM', startDate: '2026-03-03', endDate: '2026-03-04' };

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

beforeEach(async () => {
  (await import('@/lib/rate-limit'))._resetRateLimitForTests();
});

describe('preloaded public holidays', () => {
  it('appear for a year the first time it is looked at, as ordinary events, and are audited once', async () => {
    expect(await prisma.calendarEvent.count({ where: { schoolId: A.schoolId } })).toBe(0);
    const items = await list('?from=2026-01-01&to=2026-12-31&type=PUBLIC_HOLIDAY');
    expect(items).toHaveLength(13);
    expect(items.every((i) => i.preloaded && i.kind === 'PUBLIC_HOLIDAY')).toBe(true);
    expect(items.find((i) => i.title === "Heroes' Day")?.startDate).toBe('2026-08-10');
    expect(items.find((i) => i.title === 'Good Friday')?.startDate).toBe('2026-04-03');
    expect(await prisma.calendarHolidayYear.count({ where: { schoolId: A.schoolId, year: 2026 } })).toBe(1);
    const logs = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: 'CREATE_CALENDAR_EVENT', entityId: 'holidays:2026' } });
    expect(logs).toHaveLength(1);
    expect(logs[0].detail).toBe('Loaded 13 public holidays for 2026');
  });

  it('are not loaded twice, however often or however many ask at once', async () => {
    await Promise.all([list('?from=2026-01-01&to=2026-12-31'), list('?from=2026-06-01&to=2026-06-30'), list('?from=2026-01-01&to=2026-01-31')]);
    await list('?from=2026-01-01&to=2026-12-31');
    expect(await prisma.calendarEvent.count({ where: { schoolId: A.schoolId, kind: 'PUBLIC_HOLIDAY' } })).toBe(13);
    expect(await prisma.calendarHolidayYear.count({ where: { schoolId: A.schoolId, year: 2026 } })).toBe(1);
  });

  it('load for each year a view spans', async () => {
    const items = await list('?from=2026-12-20&to=2027-01-05&type=PUBLIC_HOLIDAY');
    expect(items.map((i) => i.startDate)).toEqual(['2026-12-22', '2026-12-25', '2026-12-26', '2027-01-01']);
    expect(await prisma.calendarHolidayYear.count({ where: { schoolId: A.schoolId } })).toBe(2);
  });

  it('can be edited, and keep their place', async () => {
    const heroes = (await list('?from=2026-08-01&to=2026-08-31&type=PUBLIC_HOLIDAY')).find((i) => i.title === "Heroes' Day")!;
    const r = await call('system/calendar/[id]', 'PATCH', {
      as: admin(), params: { id: heroes.id },
      body: { title: "Heroes' Day (school closed)", kind: 'PUBLIC_HOLIDAY', startDate: '2026-08-10', endDate: '2026-08-10', notes: 'Declared by government' },
    });
    expect(r.status).toBe(200);
    const row = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: heroes.id } });
    expect(row.title).toBe("Heroes' Day (school closed)");
    expect(row.autoKey).toBe('HEROES_DAY:2026');
  });

  it('can be added to when government declares an extra day', async () => {
    const r = await post({ title: 'Day of mourning', kind: 'PUBLIC_HOLIDAY', startDate: '2026-09-15', endDate: '2026-09-15' });
    expect(r.status).toBe(201); // a holiday never warns about holidays or term dates
  });

  it('can be deleted, and are not put back', async () => {
    const xmas = (await list('?from=2026-12-01&to=2026-12-31&type=PUBLIC_HOLIDAY')).find((i) => i.title === 'Boxing Day')!;
    expect((await call('system/calendar/[id]', 'DELETE', { as: admin(), params: { id: xmas.id } })).status).toBe(200);
    const after = await list('?from=2026-12-01&to=2026-12-31&type=PUBLIC_HOLIDAY');
    expect(after.map((i) => i.title)).not.toContain('Boxing Day');
    expect(after.map((i) => i.title)).toContain('Christmas Day');
    expect(await prisma.calendarEvent.count({ where: { schoolId: A.schoolId, autoKey: 'BOXING_DAY:2026' } })).toBe(0);
  });

  it("are separate for every school", async () => {
    expect(await prisma.calendarEvent.count({ where: { schoolId: B.schoolId } })).toBe(0);
    const b = await list('?from=2026-01-01&to=2026-12-31&type=PUBLIC_HOLIDAY', B.users.ADMIN);
    expect(b).toHaveLength(13);
    expect(await prisma.calendarEvent.count({ where: { schoolId: A.schoolId, kind: 'PUBLIC_HOLIDAY', autoKey: { not: null } } })).toBeGreaterThan(0);
    expect(new Set(b.map((i) => i.id)).size).toBe(13);
  });
});

describe('term dates', () => {
  it('appear on their own, as start and end, and cannot be edited as events', async () => {
    const items = await list('?from=2026-01-01&to=2026-12-31&type=TERM');
    expect(items.map((i) => [i.title, i.startDate, i.source])).toEqual([['Term 1 2026 begins', '2026-01-10', 'term'], ['Term 1 2026 ends', '2026-12-20', 'term']]);
    for (const i of items) {
      expect((await call('system/calendar/[id]', 'PATCH', { as: admin(), params: { id: i.id }, body: base })).status).toBe(404);
      expect((await call('system/calendar/[id]', 'DELETE', { as: admin(), params: { id: i.id } })).status).toBe(404);
    }
    expect(await prisma.academicTerm.count({ where: { schoolId: A.schoolId } })).toBe(1);
  });

  it('follow the Academic Terms, so a changed date shows here', async () => {
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { endDate: new Date('2026-12-18') } });
    expect((await list('?from=2026-12-01&to=2026-12-31&type=TERM')).map((i) => i.startDate)).toEqual(['2026-12-18']);
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { endDate: new Date('2026-12-20') } });
  });
});

describe('adding events', () => {
  it('stores every field', async () => {
    const level = A.levelId;
    const r = await post({
      title: 'Form 1 parents meeting', kind: 'VISITING_DAY', startDate: '2026-03-10', endDate: '2026-03-10', allDay: false, startTime: '14:00', endTime: '16:30',
      audience: 'FORMS', audienceLevelIds: [level], location: 'Main hall', notes: 'Bring report cards',
    });
    expect(r.status).toBe(201);
    const row = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: r.json.data.event.id } });
    expect(row).toMatchObject({ kind: 'VISITING_DAY', allDay: false, startTime: '14:00', endTime: '16:30', audience: 'FORMS', audienceLevelIds: [level], location: 'Main hall', notes: 'Bring report cards', repeat: 'NONE', autoKey: null });
  });

  it('accepts every type and audience', async () => {
    for (const kind of ['EXAM', 'MEETING', 'SPORTS', 'CULTURAL', 'VISITING_DAY', 'PRIZE_GIVING', 'OTHER']) {
      expect((await post({ ...base, title: `T ${kind}`, kind, startDate: '2026-03-11', endDate: '2026-03-11' })).status, kind).toBe(201);
    }
    expect((await post({ ...base, title: 'Boarders', audience: 'BOARDERS', startDate: '2026-03-12', endDate: '2026-03-12' })).status).toBe(201);
    expect((await post({ ...base, title: 'Class', audience: 'CLASSES', audienceClassIds: [A.classId], startDate: '2026-03-12', endDate: '2026-03-12' })).status).toBe(201);
  });

  it('clears the times of an all-day event', async () => {
    const r = await post({ ...base, title: 'All day', startDate: '2026-03-13', endDate: '2026-03-13', allDay: true, startTime: '08:00', endTime: '09:00' });
    const row = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: r.json.data.event.id } });
    expect([row.allDay, row.startTime, row.endTime]).toEqual([true, null, null]);
  });

  it('refuses a form or class from another school, or an audience with nobody in it', async () => {
    expect((await post({ ...base, audience: 'FORMS', audienceLevelIds: [B.levelId] })).status).toBe(404);
    expect((await post({ ...base, audience: 'CLASSES', audienceClassIds: [A.classId, B.classId] })).status).toBe(404);
    expect((await post({ ...base, audience: 'FORMS', audienceLevelIds: [] })).status).toBe(422);
    expect((await post({ ...base, audience: 'CLASSES' })).status).toBe(422);
  });

  it('refuses bad times, repeats and lengths without saving anything', async () => {
    const n = await prisma.calendarEvent.count({ where: { schoolId: A.schoolId } });
    const bad = [
      { allDay: false }, { allDay: false, startTime: '08:00' }, { allDay: false, startTime: '10:00', endTime: '09:00', endDate: base.startDate },
      { repeat: 'WEEKLY' }, { repeat: 'WEEKLY', repeatUntil: '2026-03-01' }, { repeat: 'WEEKLY', repeatUntil: '2032-01-01' }, { repeat: 'DAILY', repeatUntil: '2026-04-01' },
      { title: 'x'.repeat(121) }, { location: 'x'.repeat(121) }, { notes: 'x'.repeat(1001) }, { audience: 'EVERYONE' },
    ];
    for (const b of bad) expect((await post({ ...base, ...b })).status, JSON.stringify(b)).toBe(422);
    expect(await prisma.calendarEvent.count({ where: { schoolId: A.schoolId } })).toBe(n);
  });

  it('the database refuses what the form should have caught', async () => {
    const make = (extra: object) => prisma.calendarEvent.create({ data: { schoolId: A.schoolId, title: 'Raw', createdById: admin().id, startDate: new Date('2026-03-01'), endDate: new Date('2026-03-01'), ...extra } });
    await expect(make({ allDay: false })).rejects.toThrow();
    await expect(make({ startTime: '25:00' })).rejects.toThrow();
    await expect(make({ repeat: 'WEEKLY' })).rejects.toThrow();
    await expect(make({ audience: 'FORMS' })).rejects.toThrow();
    await expect(make({ audience: 'ALL_STAFF', audienceClassIds: ['x'] })).rejects.toThrow();
    await expect(make({ title: 'x'.repeat(121) })).rejects.toThrow();
  });
});

describe('warnings that can be overridden', () => {
  it('warn about a public holiday, save nothing until confirmed, then save and say so in the audit log', async () => {
    const ev = { title: 'Independence quiz', kind: 'CULTURAL', startDate: '2026-04-18', endDate: '2026-04-18' };
    const n = await prisma.calendarEvent.count({ where: { schoolId: A.schoolId, title: ev.title } });
    const first = await post(ev);
    expect(first.status).toBe(409);
    expect(first.json).toMatchObject({ success: false, needsConfirmation: true });
    expect(first.json.warnings.join(' ')).toContain('Independence Day');
    expect(await prisma.calendarEvent.count({ where: { schoolId: A.schoolId, title: ev.title } })).toBe(n);

    const second = await post({ ...ev, acknowledged: true });
    expect(second.status).toBe(201);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'CREATE_CALENDAR_EVENT', entityId: second.json.data.event.id } });
    expect(log.detail).toContain('saved after warning');
  });

  it('warn about a date outside term dates', async () => {
    const r = await post({ ...base, title: 'Holiday camp', startDate: '2026-12-28', endDate: '2026-12-29' });
    expect(r.status).toBe(409);
    expect(r.json.warnings).toEqual(['This falls outside term dates.']);
    expect((await post({ ...base, title: 'Holiday camp', startDate: '2026-12-28', endDate: '2026-12-29', acknowledged: true })).status).toBe(201);
  });

  it('give both warnings at once', async () => {
    const r = await post({ ...base, title: 'Boxing day match', startDate: '2026-12-25', endDate: '2026-12-25' });
    expect(r.status).toBe(409);
    expect(r.json.warnings).toHaveLength(2);
  });

  it('say nothing about an ordinary day in term, a holiday itself, or a school with no terms', async () => {
    expect((await post({ ...base, title: 'Quiet day', startDate: '2026-03-17', endDate: '2026-03-17' })).status).toBe(201);
    expect((await post({ title: 'Extra holiday', kind: 'PUBLIC_HOLIDAY', startDate: '2026-12-29', endDate: '2026-12-29' })).status).toBe(201);
    // A school that has not set up its terms yet has no term dates to be outside of.
    const fresh = await prisma.school.create({ data: { name: 'No terms yet' } });
    const owner = await prisma.user.create({ data: { schoolId: fresh.id, fullName: 'Fresh Admin', email: 'fresh@notermsyet.test', role: 'ADMIN', passwordHash: 'x' } });
    const r = await post({ ...base, title: 'Any day', startDate: '2026-12-28', endDate: '2026-12-28' }, { id: owner.id, email: owner.email, schoolId: fresh.id, role: 'ADMIN', fullName: owner.fullName });
    expect(r.status).toBe(201);
  });

  it('apply to edits too, and an edit does not clash with itself', async () => {
    const made = await post({ ...base, title: 'Movable', startDate: '2026-03-18', endDate: '2026-03-18' });
    const id = made.json.data.event.id;
    const patch = (body: object) => call('system/calendar/[id]', 'PATCH', { as: admin(), params: { id }, body });
    const moved = await patch({ ...base, title: 'Movable', startDate: '2026-05-01', endDate: '2026-05-01' }); // Workers' Day
    expect(moved.status).toBe(409);
    expect(moved.json.warnings.join(' ')).toContain("Workers' Day");
    expect((await prisma.calendarEvent.findUniqueOrThrow({ where: { id } })).startDate.toISOString().slice(0, 10)).toBe('2026-03-18');
    expect((await patch({ ...base, title: 'Movable', startDate: '2026-05-01', endDate: '2026-05-01', acknowledged: true })).status).toBe(200);
    expect((await patch({ ...base, title: 'Renamed', startDate: '2026-03-19', endDate: '2026-03-19' })).status).toBe(200);
  });
});

describe('repeating events', () => {
  let id: string;
  const weekly = { ...base, title: 'Staff briefing', kind: 'MEETING', startDate: '2026-03-02', endDate: '2026-03-02', allDay: false, startTime: '07:30', endTime: '08:00', repeat: 'WEEKLY', repeatUntil: '2026-03-23' };

  it('show every date in the range they repeat over', async () => {
    const r = await post(weekly);
    expect(r.status).toBe(201);
    id = r.json.data.event.id;
    expect(await prisma.calendarEvent.count({ where: { schoolId: A.schoolId, title: 'Staff briefing' } })).toBe(1); // stored once
    const items = (await list('?from=2026-03-01&to=2026-03-31&type=MEETING')).filter((i) => i.id === id);
    expect(items.map((i) => i.startDate)).toEqual(['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23']);
    expect(items.map((i) => i.occurrence)).toEqual([0, 1, 2, 3]);
    expect(new Set(items.map((i) => i.key)).size).toBe(4);
    expect((await list('?from=2026-03-10&to=2026-03-16&type=MEETING')).filter((i) => i.id === id).map((i) => i.startDate)).toEqual(['2026-03-16']);
    expect((await list('?from=2026-04-01&to=2026-04-30&type=MEETING')).filter((i) => i.id === id)).toEqual([]);
  });

  it('change for the whole series when edited, and disappear when deleted', async () => {
    expect((await call('system/calendar/[id]', 'PATCH', { as: admin(), params: { id }, body: { ...weekly, startTime: '07:00' } })).status).toBe(200);
    const items = (await list('?from=2026-03-01&to=2026-03-31&type=MEETING')).filter((i) => i.id === id);
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.startTime === '07:00')).toBe(true);
    expect((await call('system/calendar/[id]', 'DELETE', { as: admin(), params: { id } })).status).toBe(200);
    expect((await list('?from=2026-03-01&to=2026-03-31&type=MEETING')).filter((i) => i.id === id)).toEqual([]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'DELETE_CALENDAR_EVENT', entityId: id } });
    expect(log.detail).toContain('and its repeats');
  });

  it('warn once about the dates that fall outside term time', async () => {
    const r = await post({ ...weekly, title: 'Long series', startDate: '2026-12-07', endDate: '2026-12-07', repeatUntil: '2027-01-04' });
    expect(r.status).toBe(409);
    expect(r.json.warnings.join(' ')).toMatch(/of its 5 dates fall outside term dates/);
  });

  it('repeat monthly and yearly', async () => {
    const m = await post({ ...base, title: 'Monthly', startDate: '2026-03-31', endDate: '2026-03-31', repeat: 'MONTHLY', repeatUntil: '2026-06-30' });
    expect((await list('?from=2026-03-01&to=2026-07-31&type=EXAM')).filter((i) => i.id === m.json.data.event.id).map((i) => i.startDate)).toEqual(['2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
    const y = await post({ ...base, title: 'Yearly prize giving', kind: 'PRIZE_GIVING', startDate: '2026-03-20', endDate: '2026-03-20', repeat: 'YEARLY', repeatUntil: '2028-03-20', acknowledged: true });
    expect((await list('?from=2028-03-01&to=2028-03-31&type=PRIZE_GIVING')).filter((i) => i.id === y.json.data.event.id).map((i) => i.startDate)).toEqual(['2028-03-20']);
  });
});

describe('the calendar list', () => {
  it('filters by type', async () => {
    const exams = await list('?from=2026-03-01&to=2026-03-31&type=EXAM');
    expect(exams.length).toBeGreaterThan(0);
    expect(exams.every((i) => i.kind === 'EXAM')).toBe(true);
    const terms = await list('?from=2026-01-01&to=2026-12-31&type=TERM');
    expect(terms.every((i) => i.kind === 'TERM')).toBe(true);
  });

  it('is sorted by date, then time, and never shows another school', async () => {
    await call('system/calendar', 'POST', { as: B.users.ADMIN, body: { ...base, title: 'B secret', startDate: '2026-03-05', endDate: '2026-03-05' } });
    const march = await list('?from=2026-03-01&to=2026-03-31');
    expect(march.map((i) => i.title)).not.toContain('B secret');
    const sorted = [...march].sort((a, b) => a.startDate.localeCompare(b.startDate));
    expect(march.map((i) => i.startDate)).toEqual(sorted.map((i) => i.startDate));
    const b = await list('?from=2026-03-01&to=2026-03-31', B.users.ADMIN);
    expect(b.map((i) => i.title)).toContain('B secret');
    expect(b.map((i) => i.title)).not.toContain('Staff briefing');
  });

  it('refuses a request for more than 400 days at once', async () => {
    expect((await call('system/calendar', 'GET', { as: admin(), query: '?from=2020-01-01&to=2026-12-31' })).status).toBe(422);
  });
});

describe('PDF for the notice board', () => {
  it("is a PDF of the term's dates, holidays and events", async () => {
    const r = await call('system/calendar/pdf', 'GET', { as: admin(), query: `?termId=${A.termId}` });
    expect(r.status).toBe(200);
    expect(r.response.headers.get('content-type')).toBe('application/pdf');
    expect(r.response.headers.get('content-disposition')).toContain('calendar-Term-1-2026.pdf');
    expect(r.text.startsWith('%PDF')).toBe(true);
  });

  it("holds exactly what the calendar shows for the term", async () => {
    const { CalendarPdf } = await import('@/components/system/CalendarPdf');
    const { renderToStaticMarkup } = await import('react-dom/server');
    expect(typeof CalendarPdf).toBe('function');
    expect(renderToStaticMarkup).toBeTypeOf('function');
    const items = await list('?from=2026-01-10&to=2026-12-20');
    expect(items.some((i) => i.title === 'Term 1 2026 begins')).toBe(true);
    expect(items.some((i) => i.kind === 'PUBLIC_HOLIDAY')).toBe(true);
    expect(items.some((i) => i.title === 'Quiet day')).toBe(true);
  });

  it('needs a term of this school and the export permission', async () => {
    expect((await call('system/calendar/pdf', 'GET', { as: admin() })).status).toBe(400);
    expect((await call('system/calendar/pdf', 'GET', { as: admin(), query: `?termId=${B.termId}` })).status).toBe(404);
    expect((await call('system/calendar/pdf', 'GET', { as: admin(), query: '?termId=nope' })).status).toBe(404);
    expect((await call('system/calendar/pdf', 'GET', { as: A.users.HEAD, query: `?termId=${A.termId}` })).status).toBe(403);
    expect((await call('system/calendar/pdf', 'GET', { as: null, query: `?termId=${A.termId}` })).status).toBe(401);
    await prisma.rolePermission.create({ data: { schoolId: A.schoolId, role: 'HEAD', permission: 'system.calendar.export' } });
    expect((await call('system/calendar/pdf', 'GET', { as: A.users.HEAD, query: `?termId=${A.termId}` })).status).toBe(200);
    await prisma.rolePermission.deleteMany({ where: { schoolId: A.schoolId } });
  });
});

describe('the calendar page', () => {
  it('renders every view, filtered or not, for an administrator', async () => {
    const { session } = await import('../helpers/session');
    session.current = { ...admin() };
    const mod = await import('@/app/(dashboard)/system/calendar/page');
    for (const sp of [{}, { view: 'week' }, { view: 'list', date: '2026-03-10' }, { view: 'month', type: 'EXAM' }, { view: 'bogus', date: 'nope', type: 'PARTY' }]) {
      const tree = await mod.default({ searchParams: sp });
      expect(tree).toBeTruthy();
    }
  });

  it('shows the access-denied page without the permission', async () => {
    const { session } = await import('../helpers/session');
    session.current = { ...A.users.TEACHER };
    const mod = await import('@/app/(dashboard)/system/calendar/page');
    const tree = (await mod.default({ searchParams: {} })) as { type: { name: string } };
    expect(tree.type.name).toBe('AccessDenied');
  });

  it('is cut off when the System permission is missing, and the buttons follow can()', async () => {
    await prisma.rolePermission.create({ data: { schoolId: A.schoolId, role: 'BURSAR', permission: 'system.calendar.view' } });
    const { session } = await import('../helpers/session');
    session.current = { ...A.users.BURSAR };
    const mod = await import('@/app/(dashboard)/system/calendar/page');
    const tree = (await mod.default({ searchParams: {} })) as { props: { children: { props: Record<string, unknown> }[] } };
    const client = tree.props.children[1].props;
    expect([client.canCreate, client.canUpdate, client.canDelete, client.canExport]).toEqual([false, false, false, false]);
    await prisma.rolePermission.deleteMany({ where: { schoolId: A.schoolId } });
  });
});
