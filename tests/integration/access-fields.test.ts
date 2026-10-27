// @vitest-environment node
// Sensitive fields on the raw JSON. Each sensitive value in the database is a recognisable marker (ZZ...), every route that could
// show it is called by every role, and the text of the response is searched, not an object shaped by a helper: the marker may
// appear only where the person holds the permission that unlocks it (or it is their own record), and the values that must never
// leave the server (portal link, PIN, password and tablet PIN hashes) appear for nobody, the Owner included.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, userWithRoles, type SeededSchool, type SeededUser } from '../helpers/seed';
import { call } from '../helpers/route';
import { ROLES } from '../../prisma/seed/access';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
let access: typeof import('@/lib/access');
let studentId = '';
let employeeId = '';
let ownEmployeeUserId = '';

type Ctx = Awaited<ReturnType<typeof import('@/lib/access').loadAccessContext>>;
interface Person { label: string; user: SeededUser; ctx: Ctx; own?: boolean }
const people: Person[] = [];

/** value in the database -> the permission that unlocks it. `own` marks values a person may also see on their own record. */
const SENSITIVE: { value: string; key: string; own?: boolean; what: string }[] = [
  { value: 'ZZMEDICALNOTE', key: 'students.medical.view', what: 'a learner\'s medical notes' },
  { value: 'ZZMEDICALAID', key: 'students.medical.view', what: 'a learner\'s medical aid number' },
  { value: 'ZZDISCIPLINE', key: 'students.discipline.view', what: 'a learner\'s discipline record' },
  { value: 'ZZGUARDIANID', key: 'students.guardians.view_ids', what: 'a guardian\'s ID number' },
  { value: 'ZZBIRTHCERT', key: 'students.guardians.view_ids', what: 'a learner\'s birth certificate number' },
  { value: 'ZZEMPNATIONALID', key: 'hr.employees.view', own: true, what: 'a staff member\'s ID number' },
  { value: 'ZZEMPADDRESS', key: 'hr.employees.view', own: true, what: 'a staff member\'s home address' },
  { value: 'ZZEMPBANKACCT', key: 'hr.pay.view', what: 'a staff member\'s bank account number' },
  { value: 'ZZEMPTAXNO', key: 'hr.pay.view', what: 'a staff member\'s tax number' },
  { value: 'ZZEMPNSSANO', key: 'hr.pay.view', what: 'a staff member\'s NSSA number' },
  { value: '987654', key: 'hr.pay.view', own: true, what: 'a staff member\'s salary' },
  { value: 'ZZEMPMEDICAL', key: 'hr.pay.view', own: true, what: 'a staff member\'s medical notes' },
];
/** Never in a response, for anyone. */
const NEVER = ['ZZPORTALTOKEN', 'ZZPORTALPINHASH', 'ZZPASSWORDHASH', 'ZZTABLETPINHASH'];

const studentRoutes = ['students/[id]', 'students/[id]/guardians', 'students/[id]/medical', 'students/[id]/discipline', 'students/[id]/documents', 'students/[id]/enrolment', 'students/[id]/activity', 'students/[id]/print'];
const listRoutes: [string, string][] = [
  ['students', '?q=Sentinel'], ['students/search', '?q=Sentinel'], ['students/class-list', ''],
  ['students/discipline', ''], ['students/alumni', ''],
];
const hrRoutes = ['hr/employees/[id]', 'hr/employees/[id]/pay', 'hr/employees/[id]/discipline', 'hr/employees/[id]/documents', 'hr/employees/[id]/next-of-kin', 'hr/employees/[id]/components'];
const hrLists: [string, string][] = [['hr/employees', ''], ['hr/employees', '?q=Sentinel'], ['hr/employees/export', ''], ['hr/me', ''], ['hr/me/changes', ''], ['hr/changes', ''], ['hr/government-teachers', '']];

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  access = await import('@/lib/access');
  A = await seedSchool(prisma, 'School A');
  const sid = A.schoolId;

  // The learner with every sensitive thing attached.
  const student = await prisma.student.create({
    data: {
      schoolId: sid, admissionNumber: 'SENT001', firstName: 'Sentinel', surname: 'Learner', fullName: 'Sentinel Learner', gender: 'M', dateOfBirth: new Date('2013-06-01'),
      admissionDate: new Date('2026-01-10'), currentClassId: A.classId, status: 'ACTIVE', boarding: 'DAY', birthCertificateNumber: 'ZZBIRTHCERT',
      portalToken: 'ZZPORTALTOKEN', portalTokenHash: 'ZZPORTALTOKENHASH', portalPinHash: 'ZZPORTALPINHASH',
    },
  });
  studentId = student.id;
  await prisma.enrollment.create({ data: { schoolId: sid, studentId, classId: A.classId, termId: A.termId, startDate: new Date('2026-01-10'), status: 'ACTIVE' } });
  const guardian = await prisma.guardian.create({ data: { schoolId: sid, fullName: 'Guardian Sentinel', phone: '+263771999001', nationalId: 'ZZGUARDIANID' } });
  await prisma.studentGuardian.create({ data: { studentId, guardianId: guardian.id, relationship: 'MOTHER', isPrimary: true } });
  await prisma.medicalProfile.create({
    data: { schoolId: sid, studentId, notes: 'ZZMEDICALNOTE', medicalAidNumber: 'ZZMEDICALAID', conditions: [{ name: 'Asthma', note: 'ZZMEDICALNOTE' }], allergies: [{ name: 'Peanuts', severity: 'SEVERE' }], hasSevereAllergy: true },
  });
  const incident = await prisma.disciplineIncident.create({
    data: { schoolId: sid, occurredAt: new Date(), location: 'CLASSROOM', category: 'FIGHTING', severity: 'SERIOUS', description: 'ZZDISCIPLINE', recordedById: A.users.ADMIN.id },
  });
  await prisma.incidentStudent.create({ data: { schoolId: sid, incidentId: incident.id, studentId } });

  // The staff member with every sensitive thing attached; their own login is one of the people below.
  const staffUser = await userWithRoles(prisma, A, ['TEACHER'], 'ownstaff');
  ownEmployeeUserId = staffUser.id;
  const emp = await prisma.employee.create({
    data: {
      schoolId: sid, employeeNo: 'SENT-EMP', firstName: 'Sentinel', surname: 'Staff', jobTitle: 'Groundsman', category: 'GROUNDS', employer: 'SCHOOL', startDate: new Date('2026-02-01'),
      createdById: A.users.ADMIN.id, nationalId: 'ZZEMPNATIONALID', homeAddress: 'ZZEMPADDRESS', medicalNotes: 'ZZEMPMEDICAL', userId: staffUser.id, tabletPinHash: 'ZZTABLETPINHASH',
    } as never,
  });
  employeeId = emp.id;
  await prisma.employeePay.create({
    data: { schoolId: sid, employeeId, payBasis: 'MONTHLY', basicUsdCents: 987654, basicZigCents: 0, paymentMethod: 'BANK', bankName: 'CBZ', accountNumber: 'ZZEMPBANKACCT', zimraTaxNo: 'ZZEMPTAXNO', nssaNo: 'ZZEMPNSSANO', effectiveFrom: new Date('2026-02-01') } as never,
  });
  await prisma.user.update({ where: { id: A.users.TEACHER.id }, data: { passwordHash: 'ZZPASSWORDHASH' } });

  // Every role, with nothing pinned, then the people who reach the learner through the class they teach, run or head.
  const make = async (label: string, roles: string[]) => {
    const user = await userWithRoles(prisma, A, roles, label.toLowerCase());
    people.push({ label, user, ctx: await access.loadAccessContext({ user: { id: user.id, schoolId: user.schoolId, role: 'TEACHER', email: user.email, fullName: user.fullName } as never }) });
    return user;
  };
  for (const r of ROLES) await make(r.key, [r.key]);
  await make('NOBODY', []);
  const ct = await make('CLASS_TEACHER (of the class)', ['CLASS_TEACHER']);
  await prisma.classTeacher.create({ data: { schoolId: sid, classId: A.classId, termId: A.termId, userId: ct.id } });
  const tr = await make('TEACHER (teaches the class)', ['TEACHER']);
  await prisma.teacherAssignment.create({ data: { schoolId: sid, termId: A.termId, teacherId: tr.id, subjectId: A.subjectId, classId: A.classId, periodsPerWeek: 4, doublesPerWeek: 0, startDate: new Date('2026-09-01') } });
  const own = await access.loadAccessContext({ user: { id: staffUser.id, schoolId: sid, role: 'TEACHER', email: staffUser.email, fullName: staffUser.fullName } as never });
  people.push({ label: 'TEACHER (the staff member themself)', user: staffUser, ctx: own, own: true });
}, 300_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

const seen = new Map<string, string[]>();

async function crawl(calls: { file: string; params?: Record<string, string>; query?: string; method?: 'GET' | 'POST'; body?: unknown }[]) {
  const wrong: string[] = [];
  for (const p of people) {
    for (const c of calls) {
      const r = await call(c.file, c.method ?? 'GET', { as: p.user, params: c.params, query: c.query, body: c.body }).catch((e: Error) => ({ status: 500, text: e.message }));
      const text = (r as { text: string }).text ?? '';
      for (const s of SENSITIVE) {
        if (!text.includes(s.value)) continue;
        const entitled = access.can(p.ctx, s.key as never) || (!!s.own && p.own === true);
        if (!entitled) wrong.push(`${p.label} GET ${c.file}${c.query ?? ''} shows ${s.what} (${s.value}) without ${s.key}`);
        else seen.set(s.value, [...(seen.get(s.value) ?? []), `${p.label} ${c.file}`]);
      }
      for (const v of NEVER) if (text.includes(v)) wrong.push(`${p.label} GET ${c.file}${c.query ?? ''} shows ${v}, which never leaves the server`);
    }
  }
  return wrong;
}

describe('a learner', () => {
  it('shows sensitive details only where the permission is held, in every route that returns a learner', async () => {
    const calls = [
      ...studentRoutes.map((file) => ({ file, params: { id: studentId } })),
      ...listRoutes.map(([file, query]) => ({ file, query: file === 'students/class-list' ? `?classIds=${A.classId}` : query })),
      { file: 'students/export', method: 'POST' as const, body: {} },
    ];
    expect(await crawl(calls)).toEqual([]);
  }, 600_000);

  it('does show them to someone who holds the permission (so the check above is not an empty one)', () => {
    for (const v of ['ZZMEDICALNOTE', 'ZZDISCIPLINE', 'ZZGUARDIANID']) expect(seen.get(v)?.length, `${v} was never shown to anybody`).toBeGreaterThan(0);
  });
});

describe('a staff member', () => {
  it('shows ID numbers, address, pay, bank, tax and medical details only where the permission is held, or on their own record', async () => {
    const calls = [
      ...hrRoutes.map((file) => ({ file, params: { id: employeeId } })),
      ...hrLists.map(([file, query]) => ({ file, query })),
    ];
    expect(await crawl(calls)).toEqual([]);
  }, 600_000);

  it('does show them to someone who holds the permission', () => {
    for (const v of ['ZZEMPNATIONALID', 'ZZEMPBANKACCT']) expect(seen.get(v)?.length, `${v} was never shown to anybody`).toBeGreaterThan(0);
  });

  it('shows a person their own record', () => {
    expect(ownEmployeeUserId).not.toBe('');
  });
});

describe('the audit log', () => {
  const holder = async (label: string, keys: string[]) => {
    const key = `FIELDS_${label.toUpperCase()}`;
    const role = await prisma.roleDefinition.create({ data: { schoolId: A.schoolId, key, name: label, description: 'Test role', isSystem: false } });
    await prisma.rolePermission.createMany({ data: keys.map((permissionKey) => ({ schoolId: A.schoolId, roleId: role.id, permissionKey, scope: 'SCHOOL' as const })) });
    return userWithRoles(prisma, A, [key], label);
  };

  it('shows finance entries only to someone who holds the audit permission together with the finance reports permission', async () => {
    await prisma.auditLog.create({ data: { schoolId: A.schoolId, actorId: A.users.ADMIN.id, action: 'CREATE_USER', entityType: 'FinPayment', entityId: 'zz-pay', detail: 'ZZFINANCEAUDIT payment of 400 USD', module: 'finance' } as never });
    await prisma.auditLog.create({ data: { schoolId: A.schoolId, actorId: A.users.ADMIN.id, action: 'CREATE_USER', entityType: 'User', entityId: 'zz-user', detail: 'ZZPLAINAUDIT user added', module: 'system' } as never });
    const onlyAudit = await holder('auditonly', ['system.audit.view']);
    const both = await holder('auditfinance', ['system.audit.view', 'finance.reports.view']);

    const plain = await call('system/audit-log', 'GET', { as: onlyAudit });
    expect(plain.status).toBe(200);
    expect(plain.text).toContain('ZZPLAINAUDIT');
    expect(plain.text).not.toContain('ZZFINANCEAUDIT');

    const full = await call('system/audit-log', 'GET', { as: both });
    expect(full.text).toContain('ZZFINANCEAUDIT');
    expect(full.text).toContain('ZZPLAINAUDIT');
  });
});
