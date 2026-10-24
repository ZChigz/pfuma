// What a school starts with the first time anyone opens HR: leave types, duty types, pay components, and today's tax tables and
// statutory rates as editable defaults. The tax tables and rates start UNCONFIRMED: the school's accountant confirms them
// (Payroll settings) before the first payroll run can be created.
import type { Db } from '@/lib/scoped-db';
import { DEFAULT_EFFECTIVE_FROM, DEFAULT_RATES, DEFAULT_USD_BANDS, DEFAULT_ZIG_BANDS } from '@/lib/payroll/settings';
import { loadHrSettings } from '@/lib/hr/common';

// Confirm each against the Labour Act and the relevant NEC or public service rules; HR edits them in Leave settings.
export const DEFAULT_LEAVE_TYPES = [
  { code: 'VACATION', name: 'Vacation / annual', daysPerYear: 22, accruesMonthly: true, carryOverMax: 10, deductsBalance: true, unpaid: false, calendarDays: false },
  { code: 'SICK', name: 'Sick', daysPerYear: 180, fullPayDays: 90, halfPayDays: 90, certificateAfterDays: 2, deductsBalance: true, unpaid: false, calendarDays: false },
  { code: 'MATERNITY', name: 'Maternity', daysPerYear: 98, requiresAttachment: true, deductsBalance: true, unpaid: false, calendarDays: true },
  { code: 'COMPASSIONATE', name: 'Compassionate / bereavement', daysPerYear: 6, deductsBalance: true, unpaid: false, calendarDays: false },
  { code: 'STUDY', name: 'Study / exam', daysPerYear: 10, requiresAttachment: true, deductsBalance: true, unpaid: false, calendarDays: false },
  { code: 'SPECIAL', name: 'Special / unpaid', daysPerYear: 0, deductsBalance: false, unpaid: true, calendarDays: false },
  { code: 'OFFICIAL', name: 'Official duty', daysPerYear: 0, deductsBalance: false, unpaid: false, calendarDays: false },
] as const;

export const DEFAULT_DUTY_TYPES: { name: string; wholeDay: boolean; eligibleCategories: ('TEACHING' | 'BOARDING' | 'SECURITY' | 'ADMINISTRATION')[]; perDay: number }[] = [
  { name: 'Teacher on duty', wholeDay: true, eligibleCategories: ['TEACHING'], perDay: 1 },
  { name: 'Gate', wholeDay: false, eligibleCategories: ['TEACHING'], perDay: 1 },
  { name: 'Assembly', wholeDay: false, eligibleCategories: ['TEACHING'], perDay: 1 },
  { name: 'Break and lunch supervision', wholeDay: false, eligibleCategories: ['TEACHING'], perDay: 2 },
  { name: 'Dining hall', wholeDay: false, eligibleCategories: ['TEACHING', 'BOARDING'], perDay: 1 },
  { name: 'Evening prep', wholeDay: false, eligibleCategories: ['TEACHING', 'BOARDING'], perDay: 1 },
  { name: 'Dormitory (night)', wholeDay: false, eligibleCategories: ['BOARDING'], perDay: 1 },
  { name: 'Weekend duty', wholeDay: true, eligibleCategories: ['TEACHING', 'BOARDING'], perDay: 1 },
  { name: 'Sports fixture', wholeDay: false, eligibleCategories: ['TEACHING'], perDay: 1 },
  { name: 'Exam invigilation', wholeDay: false, eligibleCategories: ['TEACHING'], perDay: 1 },
];

export const DEFAULT_COMPONENTS: { code: string; name: string; kind: 'ALLOWANCE' | 'DEDUCTION'; taxable: boolean; variable: boolean }[] = [
  { code: 'HOUSING', name: 'Housing allowance', kind: 'ALLOWANCE', taxable: true, variable: false },
  { code: 'TRANSPORT', name: 'Transport allowance', kind: 'ALLOWANCE', taxable: true, variable: false },
  { code: 'RESPONSIBILITY', name: 'Responsibility allowance (HOD, head of boarding)', kind: 'ALLOWANCE', taxable: true, variable: false },
  { code: 'ACTING', name: 'Acting allowance', kind: 'ALLOWANCE', taxable: true, variable: true },
  { code: 'OVERTIME', name: 'Overtime', kind: 'ALLOWANCE', taxable: true, variable: true },
  { code: 'UNION', name: 'Union dues', kind: 'DEDUCTION', taxable: false, variable: false },
  { code: 'PENSION', name: 'Pension', kind: 'DEDUCTION', taxable: false, variable: false },
  { code: 'MEDICAL_AID', name: 'Medical aid', kind: 'DEDUCTION', taxable: false, variable: false },
  { code: 'FUNERAL', name: 'Funeral policy', kind: 'DEDUCTION', taxable: false, variable: false },
  { code: 'STAFF_FEES', name: 'Staff child fees', kind: 'DEDUCTION', taxable: false, variable: false },
];

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Makes the school's starting lists the first time; does nothing when they already exist. Safe to call often. */
export async function ensureHrDefaults(tx: Db, schoolId: string): Promise<void> {
  await loadHrSettings(tx, schoolId);
  if ((await tx.leaveType.count({ where: { schoolId } })) === 0) {
    await tx.leaveType.createMany({ data: DEFAULT_LEAVE_TYPES.map((t, i) => ({ schoolId, sortOrder: i, ...t })), skipDuplicates: true });
  }
  if ((await tx.dutyType.count({ where: { schoolId } })) === 0) {
    await tx.dutyType.createMany({ data: DEFAULT_DUTY_TYPES.map((t, i) => ({ schoolId, sortOrder: i, ...t })), skipDuplicates: true });
  }
  if ((await tx.payComponent.count({ where: { schoolId } })) === 0) {
    await tx.payComponent.createMany({ data: DEFAULT_COMPONENTS.map((c) => ({ schoolId, ...c })), skipDuplicates: true });
  }
  if ((await tx.taxTable.count({ where: { schoolId } })) === 0) {
    for (const [currency, bands] of [['USD', DEFAULT_USD_BANDS], ['ZIG', DEFAULT_ZIG_BANDS]] as const) {
      const t = await tx.taxTable.create({
        data: { schoolId, currency, effectiveFrom: day(DEFAULT_EFFECTIVE_FROM), createdById: await systemUserId(tx, schoolId), note: 'Starting default. The accountant must confirm it.' },
      });
      await tx.taxBand.createMany({ data: bands.map((b) => ({ schoolId, tableId: t.id, fromCents: b.fromCents, rateBps: b.rateBps })) });
    }
  }
  if ((await tx.statutoryRate.count({ where: { schoolId } })) === 0) {
    await tx.statutoryRate.create({
      data: {
        schoolId, effectiveFrom: day(DEFAULT_EFFECTIVE_FROM), createdById: await systemUserId(tx, schoolId), note: 'Starting default. The accountant must confirm it.',
        aidsLevyBps: DEFAULT_RATES.aidsLevyBps, nssaEmployeeBps: DEFAULT_RATES.nssaEmployeeBps, nssaEmployerBps: DEFAULT_RATES.nssaEmployerBps,
        nssaCeilingUsdCents: DEFAULT_RATES.nssaCeilingCents.USD, nssaCeilingZigCents: DEFAULT_RATES.nssaCeilingCents.ZIG,
        nssaDeductibleBeforePaye: DEFAULT_RATES.nssaDeductibleBeforePaye, zimdefBps: DEFAULT_RATES.zimdefBps,
      },
    });
  }
}

/** Who the seeded settings are "created by": the school's oldest active user (the settings tables need a person). */
async function systemUserId(tx: Db, schoolId: string): Promise<string> {
  const u = await tx.user.findFirst({ where: { schoolId, active: true, isSupport: false }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!u) throw new Error('A school needs at least one user before HR can be set up');
  return u.id;
}
