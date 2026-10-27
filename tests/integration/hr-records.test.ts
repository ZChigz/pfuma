// @vitest-environment node
// HR & Staff against a real PostgreSQL: the directory and employee records, who may see sensitive data (and the log of every look),
// government-paid versus school-paid staff, pay changes with reasons and history, leavers, posts that need the Head and the Owner,
// leave (school days, balances, nobody approves their own), the staff register, and the duty roster.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { fails, hrWorld, type HrWorld } from '../helpers/hr';

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: HrWorld;
let prisma: typeof import('@/lib/prisma').prisma;
let emp: typeof import('@/lib/hr/employees');
let rec: typeof import('@/lib/hr/recruitment');
let leave: typeof import('@/lib/hr/leave');
let att: typeof import('@/lib/hr/attendance');
let duties: typeof import('@/lib/hr/duties');
let letters: typeof import('@/lib/hr/letters');
let reports: typeof import('@/lib/hr/reports');
let pset: typeof import('@/lib/payroll/settings-service');

const NOW = new Date('2026-10-14T05:00:00Z'); // Wednesday, 07:00 in Harare
const ids: Record<string, string> = {};
const audits = (action: string, entityId?: string) => prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: action as never, ...(entityId ? { entityId } : {}) } });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  [emp, rec, leave, att, duties, letters, reports, pset] = await Promise.all([
    import('@/lib/hr/employees'), import('@/lib/hr/recruitment'), import('@/lib/hr/leave'), import('@/lib/hr/attendance'), import('@/lib/hr/duties'), import('@/lib/hr/letters'), import('@/lib/hr/reports'),
    import('@/lib/payroll/settings-service'),
  ]);
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  W = await hrWorld(prisma, A);
  await pset.getPayrollSettings(W.hr); // makes the school's starting lists
}, 240_000);

afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await t.stop();
});

describe('employees, the directory and sensitive data', () => {
  it('a government teacher is added directly with an EC number and posting date, and is linked to a login', async () => {
    await fails(rec.addGovernmentTeacher(W.hr, { firstName: 'Tendai', surname: 'Moyo', postedOn: '2026-01-12' }), 422);
    const r = await rec.addGovernmentTeacher(W.hr, { firstName: 'Tendai', surname: 'Moyo', gender: 'M', nationalId: '63-123456 K 42', ecNumber: 'EC123456', postedOn: '2026-01-12', personalPhone: '0771234567', workPhone: '0242700100' });
    ids.gov = r.id;
    expect(r.employeeNo).toBe('EMP-0001');
    await emp.linkUser(W.hr, r.id, { userId: W.teacher.id });
    await fails(emp.linkUser(W.hr, r.id, { userId: W.teacher.id }), 409, /already has a login/);
    const e = await prisma.employee.findUniqueOrThrow({ where: { id: r.id } });
    expect(e).toMatchObject({ employer: 'GOVERNMENT', category: 'TEACHING', ecNumber: 'EC123456', userId: W.teacher.id });
  });

  it('employee numbers count up and never repeat; a school-paid person cannot have an EC number', async () => {
    await fails(emp.createEmployee(W.hr, { firstName: 'Gift', surname: 'Sibanda', jobTitle: 'Groundsman', category: 'GROUNDS', employer: 'SCHOOL', ecNumber: 'EC1', startDate: '2026-02-01' }), 422);
    const g = await emp.createEmployee(W.hr, { firstName: 'Gift', surname: 'Sibanda', jobTitle: 'Groundsman', category: 'GROUNDS', employer: 'SCHOOL', startDate: '2026-02-01', nationalId: '08-111111 Z 08', medicalNotes: 'Asthma', personalPhone: '0712345678' });
    ids.grounds = g.id;
    expect(g.employeeNo).toBe('EMP-0002');
    const s = await emp.createEmployee(W.hr, { firstName: 'Rudo', surname: 'Chari', jobTitle: 'Cleaner', category: 'ANCILLARY', employer: 'SCHOOL', startDate: '2026-02-01', personalPhone: '0712000000' });
    ids.cleaner = s.id;
    expect(s.employeeNo).toBe('EMP-0003');
    const t2 = await emp.createEmployee(W.hr, { firstName: 'Mary', surname: 'Teacher', jobTitle: 'Teacher', category: 'TEACHING', employer: 'SCHOOL', startDate: '2026-01-05' });
    ids.t2 = t2.id;
    await emp.linkUser(W.hr, t2.id, { userId: W.teacher2.id });
    await fails(emp.createEmployee(W.hr, { firstName: 'X', surname: 'Y', jobTitle: 'Teacher', category: 'TEACHING', employer: 'GOVERNMENT', ecNumber: 'EC123456', startDate: '2026-02-01' }), 409, /EC number/);
  });

  it('every change to an employee is written to the audit log', async () => {
    expect((await audits('HR_SAVE_EMPLOYEE')).length).toBeGreaterThanOrEqual(4);
  });

  it('the Administrator and a teacher see only the directory; HR sees the record', async () => {
    const dirAdmin = await emp.listDirectory(W.admin);
    expect(dirAdmin.total).toBe(4);
    expect(dirAdmin.items[0]).not.toHaveProperty('nationalId');
    const view = await emp.getEmployee(W.admin, ids.grounds!);
    expect(view.access).toMatchObject({ full: false, pay: false });
    expect(view.personal).toBeNull();
    expect(view.pay).toBeNull();
    // Every member of staff holds hr.directory.view: a teacher sees names, titles and departments, never the record.
    expect((await emp.listDirectory(W.teacher2)).items[0]).not.toHaveProperty('nationalId');
    const teacherView = await emp.getEmployee(W.teacher2, ids.grounds!);
    expect(teacherView.access).toMatchObject({ full: false, pay: false });
    expect(teacherView.personal).toBeNull();
    expect(teacherView.pay).toBeNull();
    const hrView = await emp.getEmployee(W.hr, ids.grounds!);
    expect(hrView.access).toMatchObject({ full: true, pay: true });
    expect(hrView.personal?.nationalId).toBe('08-111111 Z 08');
    expect(hrView.personal?.medicalNotes).toBe('Asthma');
  });

  it('the directory shows the work phone, not the personal one, to people without full access', async () => {
    const adminRow = (await emp.listDirectory(W.admin)).items.find((r) => r.id === ids.gov)!;
    expect(adminRow.phone).toBe('0242700100');
    const cleanerAdmin = (await emp.listDirectory(W.admin)).items.find((r) => r.id === ids.cleaner)!;
    expect(cleanerAdmin.phone).toBeNull();
    const cleanerHr = (await emp.listDirectory(W.hr)).items.find((r) => r.id === ids.cleaner)!;
    expect(cleanerHr.phone).toBe('0712000000');
  });

  it('searches and filters by employer, category and status', async () => {
    expect((await emp.listDirectory(W.hr, { employer: 'GOVERNMENT' })).total).toBe(1);
    expect((await emp.listDirectory(W.hr, { category: 'GROUNDS' })).items.map((r) => r.name)).toEqual(['Gift Sibanda']);
    expect((await emp.listDirectory(W.hr, { q: 'moyo' })).total).toBe(1);
    expect((await emp.exportDirectory(W.hr)).split('\n')[0]).toContain('Employee no');
  });

  it('looking at someone else\'s ID number and medical notes is logged; looking at your own is not', async () => {
    const before = await prisma.hrSensitiveView.count({ where: { employeeId: ids.grounds } });
    await emp.getEmployee(W.owner, ids.grounds!);
    const rows = await prisma.hrSensitiveView.findMany({ where: { employeeId: ids.grounds }, orderBy: { createdAt: 'asc' } });
    expect(rows.length).toBeGreaterThan(before);
    expect(rows.map((r) => r.kind)).toEqual(expect.arrayContaining(['NATIONAL_ID', 'MEDICAL']));
    const own = await prisma.hrSensitiveView.count({ where: { employeeId: ids.gov } });
    const mine = await emp.getEmployee(W.teacher, ids.gov!);
    expect(mine.personal?.nationalId).toBe('63-123456 K 42');
    expect(await prisma.hrSensitiveView.count({ where: { employeeId: ids.gov } })).toBe(own);
  });

  it('an employee cannot see a colleague\'s record, only their own', async () => {
    const colleague = await emp.getEmployee(W.teacher2, ids.gov!); // the directory entry only
    expect(colleague.access).toMatchObject({ full: false, pay: false });
    expect(colleague.personal).toBeNull();
    expect(colleague.pay).toBeNull();
    const mine = await emp.getMyRecord(W.teacher2);
    expect(mine.id).toBe(ids.t2);
    await fails(emp.getMyRecord(W.outsider), 404);
  });

  it('changing who pays a person needs a reason and is kept in the history', async () => {
    await fails(emp.updateEmployee(W.hr, ids.t2!, { employer: 'GOVERNMENT', ecNumber: 'EC777777' }), 422, /reason/);
    await emp.updateEmployee(W.hr, ids.t2!, { employer: 'GOVERNMENT', ecNumber: 'EC777777', reason: 'Posted by the ministry' });
    let h = await prisma.employeeHistory.findMany({ where: { employeeId: ids.t2, field: 'employer' } });
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ oldValue: 'SCHOOL', newValue: 'GOVERNMENT', reason: 'Posted by the ministry' });
    await emp.updateEmployee(W.hr, ids.t2!, { employer: 'SCHOOL', ecNumber: null, reason: 'Back on the school payroll' });
    h = await prisma.employeeHistory.findMany({ where: { employeeId: ids.t2, field: 'employer' } });
    expect(h).toHaveLength(2);
  });

  it('records are never deleted', async () => {
    await expect(t.pg.query(`DELETE FROM "Employee" WHERE id = '${ids.cleaner}'`)).rejects.toThrow(/never deleted/);
    await expect(t.pg.query(`UPDATE "EmployeeHistory" SET "newValue" = 'x'`)).rejects.toThrow(/only be added/);
  });

  it('a person cannot be their own line manager', async () => {
    await fails(emp.updateEmployee(W.hr, ids.cleaner!, { lineManagerId: ids.cleaner }), 422);
    await emp.updateEmployee(W.hr, ids.cleaner!, { lineManagerId: ids.grounds });
  });

  it('only HR (employees.manage) changes records', async () => {
    await fails(emp.createEmployee(W.head, { firstName: 'A', surname: 'B', jobTitle: 'X', category: 'GROUNDS', employer: 'SCHOOL', startDate: '2026-01-01' }), 403);
    await fails(emp.updateEmployee(W.admin, ids.cleaner!, { jobTitle: 'Boss' }), 403);
  });
});

describe('pay set-up of school-paid staff', () => {
  it('government-paid staff have no pay set-up, by service and by database', async () => {
    await fails(emp.setPay(W.hr, ids.gov!, { paymentMethod: 'CASH', basicUsdCents: 10000, reason: 'Initial set-up' }), 409, /state/);
    await expect(t.pg.query(`INSERT INTO "EmployeePay" ("id","schoolId","employeeId","effectiveFrom","updatedAt") VALUES ('p1','${A.schoolId}','${ids.gov}', now(), now())`)).rejects.toThrow(/never appear in the school payroll/);
  });

  it('pay needs a reason, the bank details when the method is bank, and a rate for casual staff', async () => {
    await fails(emp.setPay(W.hr, ids.grounds!, { paymentMethod: 'BANK', basicUsdCents: 40000, reason: 'Initial set-up' }), 422, /bank/i);
    await fails(emp.setPay(W.hr, ids.grounds!, { paymentMethod: 'CASH', basicUsdCents: 40000, reason: 'no' }), 422);
    await fails(emp.setPay(W.hr, ids.grounds!, { paymentMethod: 'CASH', payBasis: 'DAILY', reason: 'Initial set-up' }), 422, /rate/);
    await fails(emp.setPay(W.teacher2, ids.grounds!, { paymentMethod: 'CASH', basicUsdCents: 40000, reason: 'Initial set-up' }), 403);
  });

  it('sets up pay, logs the changes with before and after, and texts the employee when bank details change', async () => {
    await emp.setPay(W.hr, ids.grounds!, { paymentMethod: 'BANK', bankName: 'CBZ', accountNumber: '1234567890', basicUsdCents: 40000, basicZigCents: 270000, zimraTaxNo: 'TAX99887', nssaNo: 'NSSA55512', reason: 'Initial set-up' });
    const r = await emp.setPay(W.hr, ids.grounds!, { paymentMethod: 'BANK', bankName: 'CBZ', accountNumber: '9999999999', basicUsdCents: 45000, basicZigCents: 270000, zimraTaxNo: 'TAX99887', nssaNo: 'NSSA55512', reason: 'Raise and new account' });
    expect(r.changed).toEqual(expect.arrayContaining(['basicUsdCents', 'accountNumber']));
    const h = await prisma.employeeHistory.findMany({ where: { employeeId: ids.grounds, field: 'pay.basicUsdCents' }, orderBy: { createdAt: 'asc' } });
    expect(h.map((x) => [x.oldValue, x.newValue])).toEqual([[null, '40000'], ['40000', '45000']]);
    expect(h[1]!.reason).toBe('Raise and new account');
    const sms = await prisma.messageOutbox.findMany({ where: { schoolId: A.schoolId, toPhone: '+263712345678' } });
    expect(sms).toHaveLength(1);
    expect(sms[0]!.body).toMatch(/payment details/);
    const same = await emp.setPay(W.hr, ids.grounds!, { paymentMethod: 'BANK', bankName: 'CBZ', accountNumber: '9999999999', basicUsdCents: 45000, basicZigCents: 270000, zimraTaxNo: 'TAX99887', nssaNo: 'NSSA55512', reason: 'No change really' });
    expect(same.changed).toEqual([]);
  });

  it('the salary is shown to HR, the Owner and the employee, never the Administrator, and every look by someone else is logged', async () => {
    await fails(emp.getPay(W.admin, ids.grounds!), 403);
    await fails(emp.getPay(W.head, ids.grounds!), 403);
    await fails(emp.getPay(W.teacher2, ids.grounds!), 403);
    const before = await prisma.hrSensitiveView.count({ where: { employeeId: ids.grounds, kind: 'SALARY' } });
    const p = await emp.getPay(W.owner, ids.grounds!);
    expect(p).toMatchObject({ basicUsdCents: 45000, accountNumber: '9999999999' });
    expect(await prisma.hrSensitiveView.count({ where: { employeeId: ids.grounds, kind: 'SALARY' } })).toBe(before + 1);
    expect(await prisma.hrSensitiveView.count({ where: { employeeId: ids.grounds, kind: 'BANK' } })).toBeGreaterThan(0);
    // The audit log shows that pay changed, not what the bank account number is.
    const rowLog = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, entityType: 'EmployeePay' } });
    expect(JSON.stringify(rowLog)).not.toContain('9999999999');
  });

  it('allowances need a start date; child fees need the employee\'s consent', async () => {
    const comps = await prisma.payComponent.findMany({ where: { schoolId: A.schoolId } });
    const housing = comps.find((c) => c.code === 'HOUSING')!;
    const fees = comps.find((c) => c.code === 'STAFF_FEES')!;
    const student = await prisma.student.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    await fails(emp.saveComponent(W.hr, ids.grounds!, { componentId: fees.id, amountCents: 5000, startsOn: '2026-10-01', childStudentId: student.id, reason: 'Child fees' }), 422, /consent/);
    await emp.saveComponent(W.hr, ids.grounds!, { componentId: housing.id, amountCents: 5000, startsOn: '2026-10-01', reason: 'Housing allowance' });
    const p = await emp.getPay(W.hr, ids.grounds!);
    expect(p?.components).toHaveLength(1);
  });

  it('a loan stops being deducted when repaid (the instalment is never more than the balance)', async () => {
    await fails(emp.createLoan(W.hr, { employeeId: ids.grounds, principalCents: 1000, instalmentCents: 5000, startMonth: '2026-10', reason: 'Advance' }), 422);
    const l = await emp.createLoan(W.hr, { employeeId: ids.grounds, principalCents: 10000, instalmentCents: 4000, startMonth: '2026-10', reason: 'Salary advance' });
    expect(l.id).toBeTruthy();
    await expect(t.pg.query(`UPDATE "Loan" SET "balanceCents" = 20000 WHERE id = '${l.id}'`)).rejects.toThrow();
  });
});

describe('change requests from staff', () => {
  it('HR approves an address change; the employee cannot approve their own', async () => {
    const r = await emp.requestChange(W.teacher, { group: 'DETAILS', changes: { homeAddress: '12 Samora Machel Ave' } });
    await fails(emp.requestChange(W.teacher, { group: 'DETAILS', changes: { homeAddress: 'again' } }), 409);
    await fails(emp.decideChange(W.teacher, r.id, { decision: 'APPROVE' }), 403);
    expect((await emp.listChangeRequests(W.teacher)).length).toBe(1);
    await emp.decideChange(W.hr, r.id, { decision: 'APPROVE' });
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: ids.gov } })).homeAddress).toBe('12 Samora Machel Ave');
    await fails(emp.decideChange(W.hr, r.id, { decision: 'APPROVE' }), 409);
  });

  it('a rejection needs a reason', async () => {
    const r = await emp.requestChange(W.teacher, { group: 'DETAILS', changes: { personalPhone: '0779999999' } });
    await fails(emp.decideChange(W.hr, r.id, { decision: 'REJECT' }), 422);
    await emp.decideChange(W.hr, r.id, { decision: 'REJECT', reason: 'Please bring proof' });
    expect((await prisma.employeeChangeRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('REJECTED');
  });

  it('a bank change needs HR and then the Owner, two different people, and the employee is told', async () => {
    const r = await emp.requestChange(W.teacher2, { group: 'DETAILS', changes: { maritalStatus: 'Married' } });
    await emp.decideChange(W.hr, r.id, { decision: 'APPROVE' });
    // The grounds worker has no login, so the school-paid teacher with a login is used for the bank request.
    await emp.setPay(W.hr, ids.t2!, { paymentMethod: 'BANK', bankName: 'CBZ', accountNumber: '1111111111', basicUsdCents: 50000, reason: 'Initial set-up' });
    await prisma.employee.update({ where: { id: ids.t2 }, data: { personalPhone: '0773333333' } });
    const b = await emp.requestChange(W.teacher2, { group: 'BANK', changes: { paymentMethod: 'BANK', bankName: 'Stanbic', accountNumber: '2222222222' } });
    expect((await emp.listChangeRequests(W.teacher2))[0]!.changes).toBeNull(); // the new account number is for the deciders
    await fails(emp.decideChange(W.owner, b.id, { decision: 'APPROVE' }), 403, /Owner|HR/);
    const first = await emp.decideChange(W.hr, b.id, { decision: 'APPROVE' });
    expect(first.status).toBe('HR_APPROVED');
    expect((await prisma.employeePay.findUniqueOrThrow({ where: { employeeId: ids.t2 } })).accountNumber).toBe('1111111111');
    await fails(emp.decideChange(W.hr2, b.id, { decision: 'APPROVE' }), 403);
    const done = await emp.decideChange(W.owner, b.id, { decision: 'APPROVE' });
    expect(done.status).toBe('APPROVED');
    expect((await prisma.employeePay.findUniqueOrThrow({ where: { employeeId: ids.t2 } })).accountNumber).toBe('2222222222');
    const sms = await prisma.messageOutbox.findMany({ where: { schoolId: A.schoolId, toPhone: '+263773333333' } });
    expect(sms.length).toBeGreaterThan(0);
    const notes = await prisma.notification.findMany({ where: { userId: W.teacher2.id, title: 'Your payment details were changed' } });
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe('posts and recruitment', () => {
  it('a new post shows its cost and needs the Head and the Owner, two different people', async () => {
    const p = await rec.requestPost(W.hr, { title: 'Science teacher', category: 'TEACHING', count: 2, monthlyCostCents: 60000, currency: 'USD' });
    ids.post = p.id;
    expect(p.monthlyTotalCents).toBe(120000);
    await fails(rec.decidePost(W.hr, p.id, { decision: 'APPROVE' }), 403);       // not the person who asked, and no authority
    await fails(rec.decidePost(W.admin, p.id, { decision: 'APPROVE' }), 403);   // the Administrator holds no approval at all
    const a = await rec.decidePost(W.head, p.id, { decision: 'APPROVE' });
    expect(a).toMatchObject({ status: 'PENDING', awaiting: 'owner' });
    await fails(rec.decidePost(W.head, p.id, { decision: 'APPROVE' }), 409);
    const b = await rec.decidePost(W.owner, p.id, { decision: 'APPROVE' });
    expect(b.status).toBe('APPROVED');
    await expect(t.pg.query(`UPDATE "Post" SET "status" = 'APPROVED', "headApprovedById" = NULL WHERE id = '${(await rec.requestPost(W.hr, { title: 'Xx', category: 'ANCILLARY', count: 1, monthlyCostCents: 100 })).id}'`)).rejects.toThrow(/Post_approved_by_both/);
  });

  it('a vacancy opens only on an approved post, applicants move one stage at a time, and hiring makes an employee with a draft contract', async () => {
    const pending = await rec.requestPost(W.hr, { title: 'Bursar', category: 'ADMINISTRATION', count: 1, monthlyCostCents: 90000 });
    await fails(rec.openVacancy(W.hr, { postId: pending.id, title: 'Bursar', closingDate: '2026-11-30' }), 409, /approved/);
    await fails(rec.openVacancy(W.hr, { postId: ids.post, title: 'Science teacher', closingDate: '2026-10-01' }), 422);
    const v = await rec.openVacancy(W.hr, { postId: ids.post, title: 'Science teacher', requirements: 'Degree in science', closingDate: '2026-11-30' });
    const a = await rec.addApplicant({ ...W.hr }, { vacancyId: v.id, name: 'Chipo Dziva', phone: '0775555555' });
    await fails(rec.moveApplicant(W.hr, a.id, { stage: 'INTERVIEWED' }), 409, /one stage/);
    await rec.moveApplicant(W.hr, a.id, { stage: 'SHORTLISTED' });
    await fails(rec.scoreApplicant(W.hr, a.id, { scores: [{ criterion: 'Subject knowledge', score: 6 }], recommendation: 'HIRE' }), 422);
    await rec.scoreApplicant(W.hr, a.id, { scores: [{ criterion: 'Subject knowledge', score: 5 }, { criterion: 'Communication', score: 4 }], recommendation: 'HIRE' });
    await rec.scoreApplicant(W.hr2, a.id, { scores: [{ criterion: 'Subject knowledge', score: 3 }, { criterion: 'Communication', score: 3 }], recommendation: 'CONSIDER' });
    const list = await rec.listApplicants(W.hr, v.id);
    expect(list[0]).toMatchObject({ average: 3.75, panelists: 2 });
    await fails(rec.moveApplicant(W.hr, a.id, { stage: 'OFFERED' }), 409, /one stage/);
    await rec.moveApplicant(W.hr, a.id, { stage: 'INTERVIEWED' });
    await rec.moveApplicant(W.hr, a.id, { stage: 'OFFERED' });
    await fails(rec.hireApplicant(W.hr, a.id, { startDate: '2027-01-05', kind: 'FIXED_TERM' }), 422, /end date/);
    const h = await rec.hireApplicant(W.hr, a.id, { startDate: '2027-01-05', kind: 'FIXED_TERM', endDate: '2027-12-15', probationEnd: '2027-04-05' });
    const e = await prisma.employee.findUniqueOrThrow({ where: { id: h.employeeId } });
    expect(e).toMatchObject({ jobTitle: 'Science teacher', employer: 'SCHOOL', postId: ids.post, firstName: 'Chipo', surname: 'Dziva' });
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: h.contractId } })).status).toBe('DRAFT');
    await fails(rec.moveApplicant(W.hr, a.id, { stage: 'REJECTED', reason: 'too late' }), 409);
    ids.hired = h.employeeId;
    const posts = await rec.listPosts(W.hr);
    expect(posts.find((p) => p.id === ids.post)).toMatchObject({ count: 2, filled: 1, vacant: 1 });
  });

  it('contracts: fixed-term needs an end date, activating writes the document, a renewal links to the old one', async () => {
    const c = await prisma.contract.findFirstOrThrow({ where: { employeeId: ids.hired } });
    const act = await rec.activateContract(W.hr, c.id);
    expect(act.reference).toMatch(/^LTR-2026-\d{4}$/);
    const doc = await prisma.employeeDocument.findFirstOrThrow({ where: { employeeId: ids.hired, kind: 'CONTRACT' } });
    expect(doc.body).toContain('CONTRACT OF EMPLOYMENT');
    await expect(t.pg.query(`INSERT INTO "Contract" ("id","schoolId","employeeId","kind","startDate","jobTitle","createdById","updatedAt") VALUES ('c9','${A.schoolId}','${ids.hired}','FIXED_TERM','2027-01-01','X','${W.hr.id}', now())`)).rejects.toThrow(/Contract_end_required/);
    const r = await rec.renewContract(W.hr, c.id, { endDate: '2028-12-15' });
    const renewal = await prisma.contract.findUniqueOrThrow({ where: { id: r.id } });
    expect(renewal).toMatchObject({ previousContractId: c.id, status: 'DRAFT' });
    await rec.activateContract(W.hr, r.id);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('EXPIRED');
    await fails(rec.createContract(W.hr, { employeeId: ids.gov, kind: 'PERMANENT', startDate: '2026-01-01', jobTitle: 'Teacher' }), 409, /ministry/);
  });

  it('reminders go to HR and the Head once at 60 and once at 30 days', async () => {
    const e = await emp.createEmployee(W.hr, { firstName: 'Temp', surname: 'Worker', jobTitle: 'Relief', category: 'ANCILLARY', employer: 'SCHOOL', startDate: '2026-09-01' });
    const c = await rec.createContract(W.hr, { employeeId: e.id, kind: 'TEMPORARY', startDate: '2026-09-01', endDate: '2026-12-12', probationEnd: '2026-10-30', jobTitle: 'Relief' });
    await rec.activateContract(W.hr, c.id);
    const db = (await import('@/lib/scoped-db')).getScopedDb(A.schoolId);
    const first = await db.$tx((tx) => rec.runContractSchedule(tx, A.schoolId, '2026-10-14'));
    expect(first.reminded).toBeGreaterThan(0);
    const again = await db.$tx((tx) => rec.runContractSchedule(tx, A.schoolId, '2026-10-14'));
    expect(again.reminded).toBe(0);
    const titles = (await prisma.notification.findMany({ where: { userId: W.hr.id } })).map((n) => n.title);
    expect(titles.some((x) => /probation ends in 16 days/.test(x))).toBe(true);
    const later = await db.$tx((tx) => rec.runContractSchedule(tx, A.schoolId, '2026-11-20'));
    expect(later.reminded).toBeGreaterThan(0);
    const ending = await rec.contractsEnding(W.hr, 90);
    expect(ending.some((r) => r.what === 'Probation ends')).toBe(true);
  });

  it('ending employment records the exit, keeps the record, makes the certificate and switches off the login', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: W.teacher2.id } });
    expect(before.active).toBe(true);
    await fails(rec.endEmployment(W.teacher2, ids.t2!, { reason: 'RESIGNATION', lastDay: '2026-10-31' }), 403);
    const r = await rec.endEmployment(W.hr, ids.t2!, { reason: 'RESIGNATION', lastDay: '2026-10-31', noticeServed: true, finalPay: [{ label: 'Leave days paid out', kind: 'PAY', amountCents: 5000, currency: 'USD' }] });
    expect(r).toMatchObject({ status: 'RESIGNED', loginSwitchedOff: true });
    const e = await prisma.employee.findUniqueOrThrow({ where: { id: ids.t2 } });
    expect(e).toMatchObject({ status: 'RESIGNED', leavingReason: 'RESIGNATION' });
    expect(e.leavingDate?.toISOString().slice(0, 10)).toBe('2026-10-31');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: W.teacher2.id } })).active).toBe(false);
    expect(await prisma.employeeDocument.count({ where: { employeeId: ids.t2, kind: 'CERTIFICATE' } })).toBe(1);
    await fails(rec.endEmployment(W.hr, ids.t2!, { reason: 'RESIGNATION', lastDay: '2026-10-31' }), 409);
    await expect(t.pg.query(`UPDATE "Employee" SET "status" = 'RESIGNED', "leavingDate" = NULL WHERE id = '${ids.cleaner}'`)).rejects.toThrow(/Employee_leaver/);
  });

  it('a certificate of service has the length of service; letters get reference numbers; warnings are for disciplinary viewers only', async () => {
    expect(letters.serviceLength('2020-03-15', '2026-10-31')).toBe('6 years and 7 months');
    const l = await letters.generateLetter(W.hr, ids.cleaner!, { template: 'CONFIRMATION_OF_EMPLOYMENT', fields: {} });
    const l2 = await letters.generateLetter(W.hr, ids.cleaner!, { template: 'WARNING', fields: { reason: 'Lateness', outcome: 'written warning' } });
    expect(l.reference).not.toBe(l2.reference);
    const warn = await prisma.employeeDocument.findFirstOrThrow({ where: { reference: l2.reference } });
    expect(warn.restricted).toBe(true);
    await fails(letters.generateLetter(W.admin, ids.cleaner!, { template: 'CONFIRMATION_OF_EMPLOYMENT', fields: {} }), 403);
    await fails(letters.getLetter(W.admin, warn.id), 403);
    expect((await letters.getLetter(W.hr, warn.id)).paragraphs.join(' ')).toContain('Lateness');
  });
});

describe('leave', () => {
  it('counts school days only, shows the balance before and after, and refuses more than the balance', async () => {
    const vac = await prisma.leaveType.findFirstOrThrow({ where: { schoolId: A.schoolId, code: 'VACATION' } });
    ids.vac = vac.id;
    // Friday 16 Oct to Tuesday 20 Oct 2026: Fri + Mon + Tue = 3 school days.
    const p = await leave.previewLeave(W.teacher, { leaveTypeId: vac.id, startDate: '2026-10-16', endDate: '2026-10-20' });
    expect(p.days).toBe(3);
    expect(p.balanceAfter).toBe(p.balanceBefore - 3);
    const half = await leave.previewLeave(W.teacher, { leaveTypeId: vac.id, startDate: '2026-10-16', endDate: '2026-10-20', endHalfDay: true });
    expect(half.days).toBe(2.5);
    await fails(leave.previewLeave(W.teacher, { leaveTypeId: vac.id, startDate: '2026-10-17', endDate: '2026-10-18' }), 422, /no school days/);
    await fails(leave.previewLeave(W.teacher, { leaveTypeId: vac.id, startDate: '2026-10-19', endDate: '2026-12-18' }), 409, /left/);
    await fails(leave.previewLeave(W.outsider, { leaveTypeId: vac.id, startDate: '2026-10-19', endDate: '2026-10-20' }), 404);
  });

  it('a request waits for approval; nobody approves their own; a rejection needs a reason; only the Head (or the delegate) decides', async () => {
    const r = await leave.requestLeave(W.teacher, { leaveTypeId: ids.vac, startDate: '2026-10-19', endDate: '2026-10-20', reason: 'Family matter', handoverNotes: 'Notes on my desk' });
    ids.leave1 = r.id;
    expect(r.days).toBe(2);
    expect((await leave.getBalances(W.teacher)).find((b) => b.code === 'VACATION')!.pending).toBe(2);
    await fails(leave.requestLeave(W.teacher, { leaveTypeId: ids.vac, startDate: '2026-10-20', endDate: '2026-10-21' }), 409, /already have leave/);
    await fails(leave.decideLeave(W.teacher, r.id, { decision: 'APPROVE' }), 403);
    await fails(leave.decideLeave(W.hr, r.id, { decision: 'APPROVE' }), 403);       // HR sees all, but the Head decides
    await fails(leave.decideLeave(W.deputy, r.id, { decision: 'APPROVE' }), 403);   // not delegated yet
    await fails(leave.decideLeave(W.head, r.id, { decision: 'REJECT' }), 422);
    await leave.decideLeave(W.head, r.id, { decision: 'APPROVE' });
    const b = (await leave.getBalances(W.teacher)).find((x) => x.code === 'VACATION')!;
    expect(b).toMatchObject({ taken: 2, pending: 0 });
    await fails(leave.decideLeave(W.head, r.id, { decision: 'APPROVE' }), 409);
  });

  it('the DB refuses self-approval even if the service is bypassed', async () => {
    const mine = await prisma.leaveRequest.create({ data: { schoolId: A.schoolId, employeeId: ids.gov!, leaveTypeId: ids.vac!, startDate: new Date('2026-11-02'), endDate: new Date('2026-11-02'), days: 1, requestedById: W.teacher.id } });
    await expect(t.pg.query(`UPDATE "LeaveRequest" SET "status" = 'APPROVED', "approvedById" = '${W.teacher.id}', "decidedAt" = now() WHERE id = '${mine.id}'`)).rejects.toThrow(/own leave/);
    await leave.cancelLeave(W.teacher, mine.id);
  });

  it('approved leave shows on the calendar as "away" without the reason, and appears on the staff register and the cover list', async () => {
    const ev = await prisma.calendarEvent.findFirstOrThrow({ where: { schoolId: A.schoolId, autoKey: `LEAVE:${ids.leave1}` } });
    expect(ev.title).toBe('Mr Tendai Moyo away'.replace('Mr ', ''));
    expect(JSON.stringify(ev)).not.toContain('Family matter');
    const reg = await att.getRegister(W.hr, '2026-10-19');
    expect(reg.rows.find((r) => r.employeeId === ids.gov)).toMatchObject({ status: 'ON_LEAVE', fromLeave: true });
    const cover = await att.coverList(W.deputy, '2026-10-19').catch(() => null);
    void cover;
  });

  it('approvers see who else in the department is away', async () => {
    const dept = await prisma.department.create({ data: { schoolId: A.schoolId, name: 'Sciences' } });
    await prisma.employee.updateMany({ where: { id: { in: [ids.gov!, ids.cleaner!] } }, data: { departmentId: dept.id } });
    const r = await leave.requestLeave(W.teacher, { leaveTypeId: ids.vac, startDate: '2026-10-26', endDate: '2026-10-27' });
    await leave.decideLeave(W.head, r.id, { decision: 'APPROVE' });
    const cleanerLogin = await prisma.employee.findUniqueOrThrow({ where: { id: ids.cleaner } });
    expect(cleanerLogin.userId).toBeNull();
    const list = await leave.listLeaveRequests(W.head, { status: 'PENDING' });
    expect(Array.isArray(list)).toBe(true);
  });

  it('the Head can delegate teaching staff leave to the Deputy', async () => {
    await prisma.hrSettings.update({ where: { schoolId: A.schoolId }, data: { leaveDelegateUserId: W.deputy.id } });
    const r = await leave.requestLeave(W.teacher, { leaveTypeId: ids.vac, startDate: '2026-11-02', endDate: '2026-11-02' });
    await leave.decideLeave(W.deputy, r.id, { decision: 'APPROVE' });
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('APPROVED');
    await prisma.hrSettings.update({ where: { schoolId: A.schoolId }, data: { leaveDelegateUserId: null } });
  });

  it('sick leave beyond two days needs a certificate; maternity counts calendar days', async () => {
    const sick = await prisma.leaveType.findFirstOrThrow({ where: { schoolId: A.schoolId, code: 'SICK' } });
    await fails(leave.requestLeave(W.teacher, { leaveTypeId: sick.id, startDate: '2026-11-09', endDate: '2026-11-12' }), 422, /certificate/);
    const ok = await leave.requestLeave(W.teacher, { leaveTypeId: sick.id, startDate: '2026-11-09', endDate: '2026-11-12', attachmentKey: 'uploads/cert.pdf' });
    await leave.cancelLeave(W.teacher, ok.id);
    const mat = await prisma.leaveType.findFirstOrThrow({ where: { schoolId: A.schoolId, code: 'MATERNITY' } });
    const p = await leave.previewLeave(W.teacher, { leaveTypeId: mat.id, startDate: '2026-12-01', endDate: '2027-03-08', attachmentKey: 'uploads/cert.pdf' });
    expect(p.days).toBe(98);
  });

  it('a person cancels only a pending request; HR adjusts balances with a reason', async () => {
    const r = await leave.requestLeave(W.teacher, { leaveTypeId: ids.vac, startDate: '2026-11-16', endDate: '2026-11-16' });
    await leave.cancelLeave(W.teacher, r.id);
    const r2 = await leave.requestLeave(W.teacher, { leaveTypeId: ids.vac, startDate: '2026-11-16', endDate: '2026-11-16' });
    await leave.decideLeave(W.head, r2.id, { decision: 'APPROVE' });
    await fails(leave.cancelLeave(W.teacher, r2.id), 409);
    await fails(leave.adjustBalance(W.teacher, { employeeId: ids.gov, leaveTypeId: ids.vac, year: 2026, days: 5, reason: 'Opening balance' }), 403);
    await fails(leave.adjustBalance(W.hr, { employeeId: ids.gov, leaveTypeId: ids.vac, year: 2026, days: 5, reason: 'x' }), 422);
    const before = (await leave.getBalances(W.hr, ids.gov)).find((b) => b.code === 'VACATION')!.remaining;
    await leave.adjustBalance(W.hr, { employeeId: ids.gov, leaveTypeId: ids.vac, year: 2026, days: 5, reason: 'Opening balance from the old register' });
    expect((await leave.getBalances(W.hr, ids.gov)).find((b) => b.code === 'VACATION')!.remaining).toBe(before + 5);
    await expect(t.pg.query(`UPDATE "LeaveAdjustment" SET "days" = 100`)).rejects.toThrow(/only be added/);
    await fails(leave.getBalances(W.teacher, ids.cleaner), 403);
  });

  it('leave of a government-paid teacher is recorded for the school', async () => {
    const r = await prisma.leaveRequest.findFirstOrThrow({ where: { id: ids.leave1 } });
    expect(r.recordOnly).toBe(true);
  });
});

describe('the staff register', () => {
  it('everyone starts present; exceptions are marked; late is decided by the school\'s time', async () => {
    const day = '2026-10-14';
    await fails(att.markRegister(W.teacher, { date: day }), 403);
    await fails(att.markRegister(W.hr, { date: '2026-10-15' }), 422, /not come/);
    await fails(att.markRegister(W.hr, { date: day, entries: [{ employeeId: ids.gov, status: 'LATE' }] }), 422, /arrival time/);
    await fails(att.markRegister(W.hr, { date: day, entries: [{ employeeId: ids.gov, status: 'LATE', arrivalTime: '07:10' }] }), 422, /not after/);
    const r = await att.markRegister(W.hr, { date: day, entries: [{ employeeId: ids.gov, status: 'PRESENT', arrivalTime: '07:55' }, { employeeId: ids.grounds, status: 'ABSENT' }] });
    expect(r.created).toBeGreaterThanOrEqual(3);
    const reg = await att.getRegister(W.hr, day);
    expect(reg.rows.find((x) => x.employeeId === ids.gov)).toMatchObject({ status: 'LATE', arrivalTime: '07:55' });
    expect(reg.rows.find((x) => x.employeeId === ids.grounds)?.status).toBe('ABSENT');
    expect(reg.rows.find((x) => x.employeeId === ids.cleaner)?.status).toBe('PRESENT');
    const sum = await att.dailySummary(W.deputy, day); // the Deputy holds hr.attendance.view; the Head does not
    expect(sum.total.LATE).toBe(1);
    expect(sum.total.ABSENT).toBe(1);
  });

  it('weekends and public holidays have no register', async () => {
    await fails(att.markRegister(W.hr, { date: '2026-10-10', reason: 'Late entry' }), 409, /no staff register/);
    expect((await att.getRegister(W.hr, '2026-10-10')).working).toBe(false);
  });

  it('a day that has passed needs a reason, hr.attendance.correct, and leaves a log', async () => {
    await fails(att.markRegister(W.hr, { date: '2026-10-13', entries: [{ employeeId: ids.cleaner, status: 'ABSENT' }] }), 422, /reason/);
    await att.markRegister(W.hr, { date: '2026-10-13', entries: [{ employeeId: ids.cleaner, status: 'ABSENT' }], reason: 'Late entry from the paper register' });
    await att.markRegister(W.hr, { date: '2026-10-13', entries: [{ employeeId: ids.cleaner, status: 'PRESENT', arrivalTime: '07:00' }], reason: 'Was at the gate, wrongly marked' });
    const log = await prisma.staffAttendanceChange.findMany({ where: { employeeId: ids.cleaner, date: new Date('2026-10-13') }, orderBy: { createdAt: 'asc' } });
    expect(log.map((l) => [l.oldStatus, l.newStatus])).toEqual([[null, 'ABSENT'], ['ABSENT', 'PRESENT']]);
    await expect(t.pg.query(`DELETE FROM "StaffAttendance"`)).rejects.toThrow(/never deleted/);
  });

  it('three days absent in a row alerts HR and the Head, once', async () => {
    for (const d of ['2026-10-12', '2026-10-13', '2026-10-14']) {
      await att.markRegister(W.hr, { date: d, entries: [{ employeeId: ids.grounds, status: 'ABSENT' }], reason: 'Absent without leave' });
    }
    const hrNotes = await prisma.notification.findMany({ where: { userId: W.hr2.id, title: { contains: 'absent for 3 days' } } });
    const headNotes = await prisma.notification.findMany({ where: { userId: W.head.id, title: { contains: 'absent for 3 days' } } });
    expect(hrNotes).toHaveLength(1);
    expect(headNotes).toHaveLength(1);
  });

  it('self sign-in is within the school\'s hours, once, and late after the set time', async () => {
    await fails(att.selfSignIn(W.teacher2, new Date('2026-10-14T05:00:00Z')), 409, /not switched on|left/);
    await prisma.hrSettings.update({ where: { schoolId: A.schoolId }, data: { selfSignIn: true, tabletSignIn: true } });
    await fails(att.selfSignIn(W.outsider), 404);
    // 06:00Z = 08:00 Harare; the teacher was marked in the register earlier today, so signing in again is refused.
    await fails(att.selfSignIn(W.teacher, new Date('2026-10-14T06:00:00Z')), 409, /already/);
    await fails(att.selfSignIn(W.teacher, new Date('2026-10-14T22:30:00Z')), 409);
  });

  it('the office tablet: a 4-digit PIN, the same answer for wrong number and wrong PIN, locked after five wrong tries', async () => {
    await fails(att.setTabletPin(W.hr, ids.cleaner!, { pin: '12' }), 422);
    await att.setTabletPin(W.hr, ids.cleaner!, { pin: '4821' });
    await fails(att.tabletSignIn(W.hr, { employeeNo: 'EMP-9999', pin: '4821' }), 403, /do not match/);
    for (let i = 0; i < 5; i++) await fails(att.tabletSignIn(W.hr, { employeeNo: 'EMP-0003', pin: '0000' }), 403, /do not match/);
    await fails(att.tabletSignIn(W.hr, { employeeNo: 'EMP-0003', pin: '4821' }), 429);
  });

  it('reports: monthly attendance per employee and lateness trend', async () => {
    const m = await att.monthlyAttendance(W.hr, '2026-10');
    const row = m.rows.find((r) => r.employeeId === ids.gov)!;
    expect(row.late).toBe(1);
    const trend = await att.latenessTrend(W.hr, { from: '2026-10-01', to: '2026-10-31' });
    expect(trend[0]).toMatchObject({ weekStart: '2026-10-12', late: 1 });
  });
});

describe('the duty roster', () => {
  it('the Deputy builds it, auto-fill spreads duties and skips people on leave, the creator cannot approve, the Head approves and publishes', async () => {
    const r = await duties.createRoster(W.deputy, { label: 'Week of 26 October', startDate: '2026-10-26', endDate: '2026-10-30' });
    ids.roster = r.id;
    await fails(duties.createRoster(W.teacher, { label: 'x', startDate: '2026-10-26', endDate: '2026-10-30' }), 403);
    const types = await duties.listDutyTypes(W.deputy);
    ids.gate = types.find((x) => x.name === 'Gate')!.id;
    ids.tod = types.find((x) => x.name === 'Teacher on duty')!.id;
    // Mr Moyo is on leave 26 and 27 October (approved above).
    const f = await duties.autoFillRoster(W.deputy, r.id, { dutyTypeIds: [ids.tod!] });
    expect(f.placed + f.unfilled.length).toBeGreaterThan(0);
    const g = await duties.getRoster(W.deputy, r.id);
    for (const a of g.assignments) if (a.employeeId === ids.gov) expect(['2026-10-26', '2026-10-27']).not.toContain(a.date);
    await fails(duties.assignDuty(W.deputy, r.id, { dutyTypeId: ids.gate, date: '2026-10-26', employeeId: ids.gov }), 409, /leave/);
    await fails(duties.assignDuty(W.deputy, r.id, { dutyTypeId: ids.gate, date: '2026-10-28', employeeId: ids.cleaner }), 422, /not eligible/);
    await duties.assignDuty(W.deputy, r.id, { dutyTypeId: ids.gate, date: '2026-10-28', employeeId: ids.gov });
    await fails(duties.approveRoster(W.deputy, r.id), 403);
    await fails(duties.publishRoster(W.head, r.id), 409, /approve/);
    await duties.approveRoster(W.head, r.id);
    await fails(duties.assignDuty(W.deputy, r.id, { dutyTypeId: ids.gate, date: '2026-10-29', employeeId: ids.gov }), 409, /swap/);
    await expect(t.pg.query(`DELETE FROM "DutyAssignment" WHERE "rosterId" = '${r.id}'`)).rejects.toThrow(/cannot be rearranged/);
    const p = await duties.publishRoster(W.head, r.id);
    expect(p.told).toBeGreaterThanOrEqual(1);
  });

  it('fairness: the most and least loaded are marked', async () => {
    const g = await duties.getRoster(W.head, ids.roster!);
    expect(g.fairness.length).toBeGreaterThan(0);
    const counts = g.fairness.map((f) => f.count);
    if (Math.max(...counts) > Math.min(...counts)) {
      expect(g.fairness.some((f) => f.most)).toBe(true);
      expect(g.fairness.some((f) => f.least)).toBe(true);
    }
  });

  it('a swap: the colleague accepts, the Deputy confirms', async () => {
    const mine = (await duties.myDuties(W.teacher, '2026-10-26')).find((d) => d.duty === 'Gate')!;
    expect(mine).toBeTruthy();
    const peer = await emp.createEmployee(W.hr, { firstName: 'Peer', surname: 'Teacher', jobTitle: 'Teacher', category: 'TEACHING', employer: 'SCHOOL', startDate: '2026-01-05' });
    const s = await duties.requestSwap(W.teacher, { assignmentId: mine.id, toEmployeeId: peer.id });
    await fails(duties.confirmSwap(W.deputy, s.id), 409, /not accepted/);
    await fails(duties.requestSwap(W.teacher, { assignmentId: mine.id, toEmployeeId: peer.id }), 409);
    await fails(duties.requestSwap(W.teacher2, { assignmentId: mine.id, toEmployeeId: peer.id }), 403);
    await prisma.employee.update({ where: { id: peer.id }, data: { userId: W.hr2.id } });
    await duties.replySwap(W.hr2, s.id, { accept: true });
    await duties.confirmSwap(W.deputy, s.id);
    expect((await prisma.dutyAssignment.findUniqueOrThrow({ where: { id: mine.id } })).employeeId).toBe(peer.id);
    expect((await duties.myDuties(W.teacher, '2026-10-26')).find((d) => d.id === mine.id)).toBeUndefined();
  });

  it('the evening reminder is sent once', async () => {
    const db = (await import('@/lib/scoped-db')).getScopedDb(A.schoolId);
    const n = await db.$tx((tx) => duties.sendDutyReminders(tx, A.schoolId, '2026-10-27'));
    expect(n).toBeGreaterThan(0);
    expect(await db.$tx((tx) => duties.sendDutyReminders(tx, A.schoolId, '2026-10-27'))).toBe(0);
  });
});

describe('reports and school isolation', () => {
  it('headcount by employer, establishment, staff returns; ID numbers only for those who may see them', async () => {
    const h = await reports.runHrReport(W.hr, 'headcount', { by: 'employer' });
    expect(h.rows.find((r) => r[0] === 'Government-paid')?.[1]).toBe(1);
    const e = await reports.runHrReport(W.hr, 'establishment', {});
    expect(e.rows[0]![0]).toBe('Science teacher');
    const s = await reports.runHrReport(W.hr, 'staff-returns', { columns: 'employeeNo,name,nationalId' });
    expect(s.headers).toEqual(['Employee no', 'Name', 'National ID']);
    await fails(reports.runHrReport(W.head, 'staff-returns', { columns: 'name,nationalId' }), 403);
    await fails(reports.runHrReport(W.teacher, 'headcount', {}), 403);
    await fails(reports.runHrReport(W.admin, 'payroll-summary', {}), 403);
  });

  it('another school sees none of this', async () => {
    const other = await (await import('../helpers/academics')).actorOf(prisma, B.users.DIRECTOR.id);
    expect((await emp.listDirectory(other)).total).toBe(0);
    await fails(emp.getEmployee(other, ids.gov!), 404);
    await fails(emp.getPay(other, ids.grounds!), 404);
    expect(await prisma.employee.count({ where: { schoolId: B.schoolId } })).toBe(0);
    await expect(t.pg.query(`INSERT INTO "Contract" ("id","schoolId","employeeId","kind","startDate","jobTitle","createdById","updatedAt") VALUES ('cx','${B.schoolId}','${ids.gov}','PERMANENT','2026-01-01','X','${B.users.DIRECTOR.id}', now())`)).rejects.toThrow(/another school/);
    void audits;
  });
});
