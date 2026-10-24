// HR reports as plain tables (title, headers, rows) so one route can give any of them on screen, as CSV, Excel or PDF. Reports that show
// pay need payroll access; the others need hr.reports.view. The two currencies are always on separate rows.
import { z } from 'zod';
import type { Employee, StaffAttStatus } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { runsIn, canSeePay, daysBetween, fullName, hrHolds, idSchema, isoDateSchema, isoOf, monthSchema, need, toDay, todayInHarare, type Actor } from '@/lib/hr/common';
import { formatMoney, type Cur } from '@/lib/finance/money';
import { contractsEnding, listPosts } from '@/lib/hr/recruitment';
import { monthlyAttendance } from '@/lib/hr/attendance';
import { addDays } from '@/lib/academics/common';

export const HR_REPORT_SLUGS = ['headcount', 'establishment', 'contracts-ending', 'qualifications', 'leave', 'attendance', 'duties', 'payroll-summary', 'statutory', 'wage-bill', 'staff-returns'] as const;
export type HrReportSlug = (typeof HR_REPORT_SLUGS)[number];
export interface HrTable { slug: HrReportSlug; title: string; subtitle: string; headers: string[]; rows: (string | number)[][]; align: ('left' | 'right')[]; totals?: (string | number)[]; landscape?: boolean }

export const HR_REPORT_TITLES: Record<HrReportSlug, string> = {
  headcount: 'Headcount', establishment: 'Establishment', 'contracts-ending': 'Contracts and probations ending', qualifications: 'Qualifications and teaching subjects', leave: 'Leave',
  attendance: 'Staff attendance', duties: 'Duties per person', 'payroll-summary': 'Payroll summary', statutory: 'Statutory payments', 'wage-bill': 'Wage bill trend', 'staff-returns': 'Staff returns',
};
const PAY_REPORTS: HrReportSlug[] = ['payroll-summary', 'statutory', 'wage-bill'];

export const StaffReturnColumns = ['employeeNo', 'name', 'gender', 'dateOfBirth', 'nationalId', 'jobTitle', 'department', 'category', 'employer', 'ecNumber', 'startDate', 'status', 'qualifications', 'phone'] as const;
const COLUMN_LABEL: Record<(typeof StaffReturnColumns)[number], string> = {
  employeeNo: 'Employee no', name: 'Name', gender: 'Gender', dateOfBirth: 'Date of birth', nationalId: 'National ID', jobTitle: 'Job title', department: 'Department', category: 'Category', employer: 'Paid by',
  ecNumber: 'EC number', startDate: 'Start date', status: 'Status', qualifications: 'Qualifications', phone: 'Phone',
};

export const HrReportParams = z.object({
  by: z.enum(['department', 'category', 'employer', 'gender', 'ageBand']).optional(), month: monthSchema.optional(), year: z.coerce.number().int().min(2000).max(2100).optional(),
  from: isoDateSchema.optional(), to: isoDateSchema.optional(), week: z.coerce.boolean().optional(), rosterId: idSchema.optional(), department: idSchema.optional(), employer: z.enum(['GOVERNMENT', 'SCHOOL']).optional(),
  columns: z.string().optional(),
});

const L = 'left' as const, R = 'right' as const;
const LEFT = ['RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'];
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const yearOf = (iso: string) => Number(iso.slice(0, 4));

function ageBand(dob: Date | null, today: string): string {
  if (!dob) return 'Unknown';
  const age = yearOf(today) - dob.getUTCFullYear() - (today.slice(5) < isoOf(dob).slice(5) ? 1 : 0);
  return age < 25 ? 'Under 25' : age < 35 ? '25 to 34' : age < 45 ? '35 to 44' : age < 55 ? '45 to 54' : age < 65 ? '55 to 64' : '65 and over';
}

export async function runHrReport(user: Actor, slug: HrReportSlug, raw: unknown): Promise<HrTable> {
  if (PAY_REPORTS.includes(slug)) need(user, 'hr.payroll.view');
  else need(user, 'hr.reports.view');
  const p = HrReportParams.parse(raw ?? {});
  const today = todayInHarare();
  const db = getScopedDb(user.schoolId, user.id);
  const mk = (title: string, subtitle: string, headers: string[], rows: (string | number)[][], align: ('left' | 'right')[], extra: Partial<HrTable> = {}): HrTable => ({ slug, title, subtitle, headers, rows, align, ...extra });

  switch (slug) {
    case 'headcount': {
      const by = p.by ?? 'department';
      return db.$tx(async (tx) => {
        const [emps, depts] = await Promise.all([tx.employee.findMany({ where: { schoolId: user.schoolId, status: { notIn: LEFT as never[] }, ...(p.employer ? { employer: p.employer } : {}) } }), tx.department.findMany({ where: { schoolId: user.schoolId } })]);
        const dn = new Map(depts.map((d) => [d.id, d.name]));
        const key = (e: Employee) => by === 'department' ? (e.departmentId ? dn.get(e.departmentId) ?? 'Unknown' : 'No department') : by === 'category' ? cap(e.category) : by === 'employer' ? (e.employer === 'GOVERNMENT' ? 'Government-paid' : 'School-paid') : by === 'gender' ? (e.gender === 'M' ? 'Male' : e.gender === 'F' ? 'Female' : 'Not recorded') : ageBand(e.dateOfBirth, today);
        const g = new Map<string, number>();
        for (const e of emps) g.set(key(e), (g.get(key(e)) ?? 0) + 1);
        const rows = Array.from(g.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => [k, n, `${Math.round((n / emps.length) * 1000) / 10}%`]);
        return mk('Headcount', `Staff by ${by === 'ageBand' ? 'age band' : by}, as at ${today}`, [cap(by === 'ageBand' ? 'age band' : by), 'Staff', 'Share'], rows, [L, R, R], { totals: ['Total', emps.length, '100%'] });
      });
    }
    case 'establishment': {
      const posts = (await listPosts(user)).filter((x) => x.status === 'APPROVED');
      return mk('Establishment', `Approved posts against people in them, as at ${today}`, ['Post', 'Department', 'Paid by', 'Approved', 'Filled', 'Vacant'], posts.map((x) => [x.title, x.department ?? '', x.employer === 'GOVERNMENT' ? 'Government' : 'School', x.count, x.filled, x.vacant]), [L, L, L, R, R, R],
        { totals: ['Total', '', '', posts.reduce((s, x) => s + x.count, 0), posts.reduce((s, x) => s + x.filled, 0), posts.reduce((s, x) => s + x.vacant, 0)] });
    }
    case 'contracts-ending': {
      const rows = await contractsEnding(user, 90);
      return mk('Contracts and probations ending', 'In the next 90 days', ['Employee', 'What', 'Date', 'Days left'], rows.map((r) => [r.employee, r.what, r.date, r.daysLeft]), [L, L, L, R]);
    }
    case 'qualifications': {
      return db.$tx(async (tx) => {
        const emps = await tx.employee.findMany({ where: { schoolId: user.schoolId, category: 'TEACHING', status: { notIn: LEFT as never[] } }, orderBy: [{ surname: 'asc' }, { firstName: 'asc' }] });
        const qs = await tx.employeeQualification.findMany({ where: { schoolId: user.schoolId, employeeId: { in: emps.map((e) => e.id) } } });
        const j = (id: string, kind: string) => qs.filter((q) => q.employeeId === id && q.kind === kind).map((q) => q.title).join('; ');
        return mk('Qualifications and teaching subjects', 'Teaching staff', ['Teacher', 'Employer', 'Qualifications', 'Can teach', 'Registration'], emps.map((e) => [fullName(e, true), e.employer === 'GOVERNMENT' ? 'Government' : 'School', j(e.id, 'QUALIFICATION'), j(e.id, 'SUBJECT'), j(e.id, 'REGISTRATION')]), [L, L, L, L, L], { landscape: true });
      });
    }
    case 'leave': {
      const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
      const from = p.week ? monday : (p.from ?? `${today.slice(0, 4)}-01-01`), to = p.week ? addDays(monday, 6) : (p.to ?? today);
      return db.$tx(async (tx) => {
        const reqs = await tx.leaveRequest.findMany({ where: { schoolId: user.schoolId, status: 'APPROVED', startDate: { lte: toDay(to) }, endDate: { gte: toDay(from) } }, orderBy: { startDate: 'asc' } });
        const [emps, types, depts] = await Promise.all([
          tx.employee.findMany({ where: { schoolId: user.schoolId, id: { in: reqs.map((r) => r.employeeId) } } }), tx.leaveType.findMany({ where: { schoolId: user.schoolId } }), tx.department.findMany({ where: { schoolId: user.schoolId } }),
        ]);
        const eo = new Map(emps.map((e) => [e.id, e])), to2 = new Map(types.map((t) => [t.id, t.name])), dn = new Map(depts.map((d) => [d.id, d.name]));
        const rows = reqs.map((r) => { const e = eo.get(r.employeeId); return [e ? fullName(e) : '?', e?.departmentId ? dn.get(e.departmentId) ?? '' : '', to2.get(r.leaveTypeId) ?? '?', isoOf(r.startDate), isoOf(r.endDate), r.days]; });
        return mk('Leave', p.week ? `Who is away this week (${from} to ${to})` : `Approved leave overlapping ${from} to ${to}`, ['Employee', 'Department', 'Type', 'From', 'To', 'Days'], rows, [L, L, L, L, L, R], { totals: ['Total', '', '', '', '', reqs.reduce((s, r) => s + r.days, 0)] });
      });
    }
    case 'attendance': {
      const month = p.month ?? today.slice(0, 7);
      const m = await monthlyAttendance(user, month);
      return mk('Staff attendance', `${month}: ${m.workingDays} working days`, ['Employee', 'Days present', 'Late', 'Absent', 'On leave', 'Rate %'], m.rows.map((r) => [r.name, r.daysPresent, r.late, r.absent, r.onLeave, r.rate ?? '']), [L, R, R, R, R, R]);
    }
    case 'duties': {
      return db.$tx(async (tx) => {
        const roster = p.rosterId ? await tx.dutyRoster.findFirst({ where: { id: p.rosterId, schoolId: user.schoolId } }) : await tx.dutyRoster.findFirst({ where: { schoolId: user.schoolId, status: 'PUBLISHED' }, orderBy: { startDate: 'desc' } });
        if (!roster) return mk('Duties per person', 'No published roster yet', ['Employee', 'Duties'], [], [L, R]);
        const [rows, types] = await Promise.all([tx.dutyAssignment.findMany({ where: { schoolId: user.schoolId, rosterId: roster.id } }), tx.dutyType.findMany({ where: { schoolId: user.schoolId }, orderBy: { sortOrder: 'asc' } })]);
        const emps = await tx.employee.findMany({ where: { schoolId: user.schoolId, id: { in: rows.map((r) => r.employeeId) } }, orderBy: [{ surname: 'asc' }, { firstName: 'asc' }] });
        const used = types.filter((t) => rows.some((r) => r.dutyTypeId === t.id));
        return mk('Duties per person', `${roster.label}, ${isoOf(roster.startDate)} to ${isoOf(roster.endDate)}`, ['Employee', ...used.map((t) => t.name), 'Total'],
          emps.map((e) => [fullName(e), ...used.map((t) => rows.filter((r) => r.employeeId === e.id && r.dutyTypeId === t.id).length), rows.filter((r) => r.employeeId === e.id).length]), ['left', ...used.map(() => R), R], { landscape: true });
      });
    }
    case 'payroll-summary': {
      const year = p.year ?? yearOf(today);
      return db.$tx(async (tx) => {
        const rs = await runsIn(tx, user.schoolId, ['APPROVED', 'PAID'], `${year}-01`, `${year}-12`); const mOf = new Map(rs.map((r) => [r.id, r.month]));
        const lines = (await tx.hrPayrollLine.findMany({ where: { schoolId: user.schoolId, runId: { in: rs.map((r) => r.id) } } })).map((l) => ({ ...l, run: { month: mOf.get(l.runId)! } }));
        const depts = new Map((await tx.department.findMany({ where: { schoolId: user.schoolId } })).map((d) => [d.id, d.name]));
        const g = new Map<string, { month: string; cur: Cur; dept: string; people: Set<string>; gross: number; ded: number; net: number }>();
        for (const l of lines) {
          const dept = l.departmentId ? depts.get(l.departmentId) ?? 'Unknown' : 'No department';
          const k = `${l.run.month}|${l.currency}|${dept}`;
          const x = g.get(k) ?? { month: l.run.month, cur: l.currency as Cur, dept, people: new Set(), gross: 0, ded: 0, net: 0 };
          x.people.add(l.employeeId); x.gross += l.grossCents; x.net += l.netCents; x.ded += l.grossCents - l.netCents; g.set(k, x);
        }
        const rows = Array.from(g.values()).sort((a, b) => a.month.localeCompare(b.month) || a.cur.localeCompare(b.cur) || a.dept.localeCompare(b.dept)).map((x) => [x.month, x.cur, x.dept, x.people.size, formatMoney(x.gross, x.cur), formatMoney(x.ded, x.cur), formatMoney(x.net, x.cur)]);
        return mk('Payroll summary', `${year}: approved and paid runs, each currency on its own rows. Salaries are paid from the General fund.`, ['Month', 'Currency', 'Department', 'People', 'Gross', 'Deductions', 'Net'], rows, [L, L, L, R, R, R, R], { landscape: true });
      });
    }
    case 'statutory': {
      const year = p.year ?? yearOf(today);
      return db.$tx(async (tx) => {
        const runs = await tx.payrollRun.findMany({ where: { schoolId: user.schoolId, hrRunId: { not: null }, status: { not: 'CANCELLED' }, period: { gte: `${year}-01`, lte: `${year}-12` } } });
        const st = await tx.statutoryPayment.findMany({ where: { schoolId: user.schoolId, payrollRunId: { in: runs.map((r) => r.id) } }, orderBy: [{ period: 'asc' }, { type: 'asc' }] });
        const rows = st.map((s) => [s.period, s.currency, s.type === 'AIDS_LEVY' ? 'AIDS levy' : s.type, formatMoney(s.amountCents, s.currency as Cur), isoOf(s.dueDate), s.paidAt ? `Paid ${isoOf(s.paidAt)}${s.reference ? ` (${s.reference})` : ''}` : 'Due']);
        return mk('Statutory payments', `PAYE and AIDS levy, NSSA (both shares) and ZIMDEF for ${year}, with what is due and what is paid`, ['Month', 'Currency', 'Type', 'Amount', 'Due', 'Status'], rows, [L, L, L, R, L, L]);
      });
    }
    case 'wage-bill': {
      const year = p.year ?? yearOf(today);
      return db.$tx(async (tx) => {
        const rs = await runsIn(tx, user.schoolId, ['APPROVED', 'PAID'], `${year - 1}-01`, `${year}-12`); const mOf = new Map(rs.map((r) => [r.id, r.month]));
        const lines = (await tx.hrPayrollLine.findMany({ where: { schoolId: user.schoolId, runId: { in: rs.map((r) => r.id) } } })).map((l) => ({ ...l, run: { month: mOf.get(l.runId)! } }));
        const cost = new Map<string, number>();
        for (const l of lines) cost.set(`${l.run.month}|${l.currency}`, (cost.get(`${l.run.month}|${l.currency}`) ?? 0) + l.grossCents + l.nssaEmployerCents + l.zimdefCents);
        const rows: (string | number)[][] = [];
        for (const cur of ['USD', 'ZIG'] as Cur[]) {
          for (let mth = 1; mth <= 12; mth++) {
            const mm = String(mth).padStart(2, '0');
            const now = cost.get(`${year}-${mm}|${cur}`), prev = cost.get(`${year - 1}-${mm}|${cur}`);
            if (now == null && prev == null) continue;
            rows.push([mm, cur, now != null ? formatMoney(now, cur) : '', prev != null ? formatMoney(prev, cur) : '', now != null && prev ? `${Math.round(((now - prev) / prev) * 1000) / 10}%` : '']);
          }
        }
        return mk('Wage bill trend', `Total staff cost (gross pay plus the employer's NSSA and ZIMDEF) by month, ${year} against ${year - 1}`, ['Month', 'Currency', String(year), String(year - 1), 'Change'], rows, [L, L, R, R, R]);
      });
    }
    case 'staff-returns': {
      const wanted = (p.columns ? p.columns.split(',') : ['employeeNo', 'name', 'gender', 'jobTitle', 'department', 'category', 'employer', 'ecNumber', 'startDate', 'status']).filter((c): c is (typeof StaffReturnColumns)[number] => (StaffReturnColumns as readonly string[]).includes(c));
      if (wanted.length === 0) throw new ServiceError('Choose at least one column', 422);
      if ((wanted.includes('nationalId') || wanted.includes('dateOfBirth')) && !canSeePay(user)) throw new ServiceError('ID numbers and dates of birth are for HR and the Owner', 403);
      return db.$tx(async (tx) => {
        const [emps, depts, quals] = await Promise.all([
          tx.employee.findMany({ where: { schoolId: user.schoolId, status: { notIn: LEFT as never[] }, ...(p.employer ? { employer: p.employer } : {}), ...(p.department ? { departmentId: p.department } : {}) }, orderBy: [{ surname: 'asc' }, { firstName: 'asc' }] }),
          tx.department.findMany({ where: { schoolId: user.schoolId } }), tx.employeeQualification.findMany({ where: { schoolId: user.schoolId, kind: 'QUALIFICATION' } }),
        ]);
        const dn = new Map(depts.map((d) => [d.id, d.name]));
        const val = (e: Employee, c: (typeof StaffReturnColumns)[number]): string => ({
          employeeNo: e.employeeNo, name: fullName(e, true), gender: e.gender === 'M' ? 'Male' : e.gender === 'F' ? 'Female' : '', dateOfBirth: e.dateOfBirth ? isoOf(e.dateOfBirth) : '', nationalId: e.nationalId ?? '', jobTitle: e.jobTitle,
          department: e.departmentId ? dn.get(e.departmentId) ?? '' : '', category: cap(e.category), employer: e.employer === 'GOVERNMENT' ? 'Government' : 'School', ecNumber: e.ecNumber ?? '', startDate: isoOf(e.startDate),
          status: cap(e.status), qualifications: quals.filter((q) => q.employeeId === e.id).map((q) => q.title).join('; '), phone: e.workPhone ?? e.personalPhone ?? '',
        })[c];
        return mk('Staff returns', `Staff list for the district or ministry, as at ${today}`, wanted.map((c) => COLUMN_LABEL[c]), emps.map((e) => wanted.map((c) => val(e, c))), wanted.map(() => L), { landscape: wanted.length > 6 });
      });
    }
  }
}

export type { StaffAttStatus };
export { hrHolds, daysBetween };
