// Payroll settings: tax tables and statutory rates with effective dates. They are only ever added to (a change is a new row that takes
// effect on its date), and the school's accountant confirms them before the first run that uses them can be created.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { audit, centsSchema, currencySchema, hrHolds, isoDateSchema, isoOf, need, optText, reasonSchema, toDay, type Actor } from '@/lib/hr/common';
import { ensureHrDefaults } from '@/lib/hr/defaults';
import { assertValidBands, type Cur, type TaxBand } from '@/lib/payroll/calc';
import { ratesFor, type Dated, type RateSet } from '@/lib/payroll/settings';
import type { StatutoryRates } from '@/lib/payroll/calc';

export interface DatedRow<T> extends Dated<T> { id: string; confirmed: boolean }

export interface LoadedSettings { tables: Record<Cur, DatedRow<TaxBand[]>[]>; rates: DatedRow<RateSet>[] }

export async function loadSettings(tx: Db, schoolId: string): Promise<LoadedSettings> {
  const tables = await tx.taxTable.findMany({ where: { schoolId }, orderBy: { effectiveFrom: 'asc' } });
  const bands = await tx.taxBand.findMany({ where: { schoolId, tableId: { in: tables.map((t) => t.id) } }, orderBy: { fromCents: 'asc' } });
  const out: LoadedSettings = { tables: { USD: [], ZIG: [] }, rates: [] };
  for (const t of tables) {
    out.tables[t.currency as Cur].push({ id: t.id, effectiveFrom: isoOf(t.effectiveFrom), confirmed: !!t.confirmedAt, value: bands.filter((b) => b.tableId === t.id).map((b) => ({ fromCents: b.fromCents, rateBps: b.rateBps })) });
  }
  const rates = await tx.statutoryRate.findMany({ where: { schoolId }, orderBy: { effectiveFrom: 'asc' } });
  out.rates = rates.map((r) => ({
    id: r.id, effectiveFrom: isoOf(r.effectiveFrom), confirmed: !!r.confirmedAt,
    value: { aidsLevyBps: r.aidsLevyBps, nssaEmployeeBps: r.nssaEmployeeBps, nssaEmployerBps: r.nssaEmployerBps, nssaCeilingCents: { USD: r.nssaCeilingUsdCents, ZIG: r.nssaCeilingZigCents }, nssaDeductibleBeforePaye: r.nssaDeductibleBeforePaye, zimdefBps: r.zimdefBps },
  }));
  return out;
}

/** The rates for a month and currency. Throws if the tables and rates in force have not been confirmed by the accountant. */
export function ratesForMonth(s: LoadedSettings, currency: Cur, month: string): StatutoryRates {
  const table = s.tables[currency].filter((t) => t.effectiveFrom <= `${month}-01`).slice(-1)[0];
  if (!table) throw new ServiceError(`No ${currency} tax table is in force for ${month}. Add one in Payroll settings.`, 409);
  const rate = s.rates.filter((r) => r.effectiveFrom <= `${month}-01`).slice(-1)[0];
  if (!rate) throw new ServiceError(`No statutory rates are in force for ${month}. Add them in Payroll settings.`, 409);
  if (!table.confirmed) throw new ServiceError(`The ${currency} tax table in force for ${month} has not been confirmed. The school's accountant confirms it in Payroll settings before a run can be made.`, 409);
  if (!rate.confirmed) throw new ServiceError(`The statutory rates in force for ${month} have not been confirmed. The school's accountant confirms them in Payroll settings before a run can be made.`, 409);
  return ratesFor(currency, month, s.tables, s.rates);
}

export async function getPayrollSettings(user: Actor) {
  need(user, 'hr.payroll.settings', 'hr.payroll.view', 'hr.payroll.prepare');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    const s = await loadSettings(tx, user.schoolId);
    const hr = await tx.hrSettings.findUniqueOrThrow({ where: { schoolId: user.schoolId } });
    return {
      tables: s.tables, rates: s.rates, canEdit: hrHolds(user, 'hr.payroll.settings'),
      payrollZigPerUsd: hr.payrollZigPerUsd, netChangeFlagPct: hr.netChangeFlagPct, payeDueDay: hr.payeDueDay, nssaDueDay: hr.nssaDueDay, zimdefDueDay: hr.zimdefDueDay,
    };
  });
}

export const TaxTableSchema = z.object({
  currency: currencySchema, effectiveFrom: isoDateSchema, note: optText(300),
  bands: z.array(z.object({ fromCents: centsSchema, rateBps: z.number().int().min(0).max(10000) })).min(1).max(12),
});

/** The form sends the bands as text "0:0,100:20,300:25" (income from in dollars : rate in percent); the API takes the bands as cents and basis points. */
function bandsFromText(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || typeof (raw as { bandsText?: unknown }).bandsText !== 'string') return raw;
  const { bandsText, ...rest } = raw as { bandsText: string };
  const bands = bandsText.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
    const [from, rate] = p.split(':').map((x) => Number(x.trim().replace(/%/g, '')));
    if (from === undefined || rate === undefined || !Number.isFinite(from) || !Number.isFinite(rate)) throw new ServiceError('Write the bands like 0:0,100:20,300:25 (income from : rate in percent)', 422);
    return { fromCents: Math.round(from * 100), rateBps: Math.round(rate * 100) };
  });
  return { ...rest, bands };
}

export async function saveTaxTable(user: Actor, raw: unknown) {
  need(user, 'hr.payroll.settings');
  const v = TaxTableSchema.parse(bandsFromText(raw));
  try { assertValidBands(v.bands); } catch (e) { throw new ServiceError((e as Error).message, 422); }
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    if (await tx.taxTable.findFirst({ where: { schoolId: user.schoolId, currency: v.currency, effectiveFrom: toDay(v.effectiveFrom) }, select: { id: true } })) {
      throw new ServiceError('There is already a table for this currency from this date. Tables are not edited: add one with a later date.', 409);
    }
    const t = await tx.taxTable.create({ data: { schoolId: user.schoolId, currency: v.currency, effectiveFrom: toDay(v.effectiveFrom), note: v.note ?? null, createdById: user.id } });
    await tx.taxBand.createMany({ data: v.bands.map((b) => ({ schoolId: user.schoolId, tableId: t.id, fromCents: b.fromCents, rateBps: b.rateBps })) });
    await audit(tx, user, 'HR_SAVE_TAX_SETTINGS', 'TaxTable', t.id, `${v.currency} tax table from ${v.effectiveFrom} (${v.bands.length} bands)`, undefined, { currency: v.currency, effectiveFrom: v.effectiveFrom, bands: v.bands });
    return { id: t.id };
  });
}

export const RatesSchema = z.object({
  effectiveFrom: isoDateSchema, aidsLevyBps: z.number().int().min(0).max(10000), nssaEmployeeBps: z.number().int().min(0).max(10000), nssaEmployerBps: z.number().int().min(0).max(10000),
  nssaCeilingUsdCents: centsSchema.nullish().transform((x) => x ?? null), nssaCeilingZigCents: centsSchema.nullish().transform((x) => x ?? null), nssaDeductibleBeforePaye: z.boolean().default(false), zimdefBps: z.number().int().min(0).max(10000), note: optText(300),
});

export async function saveStatutoryRates(user: Actor, raw: unknown) {
  need(user, 'hr.payroll.settings');
  const v = RatesSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    if (await tx.statutoryRate.findFirst({ where: { schoolId: user.schoolId, effectiveFrom: toDay(v.effectiveFrom) }, select: { id: true } })) {
      throw new ServiceError('There are already rates from this date. Rates are not edited: add a set with a later date.', 409);
    }
    const { effectiveFrom, note, ...rest } = v;
    const r = await tx.statutoryRate.create({ data: { schoolId: user.schoolId, effectiveFrom: toDay(effectiveFrom), note: note ?? null, createdById: user.id, ...rest } });
    await audit(tx, user, 'HR_SAVE_TAX_SETTINGS', 'StatutoryRate', r.id, `Statutory rates from ${effectiveFrom}`, undefined, { effectiveFrom, ...rest });
    return { id: r.id };
  });
}

export const ConfirmSchema = z.object({ kind: z.enum(['TAX_TABLE', 'RATES']), id: z.string().min(1) });

/** The accountant confirms a table or a set of rates. The person who entered it can also confirm it only if they are not the only reviewer: the log records both. */
export async function confirmSetting(user: Actor, raw: unknown) {
  need(user, 'hr.payroll.settings');
  const v = ConfirmSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const now = new Date();
    if (v.kind === 'TAX_TABLE') {
      const t = await tx.taxTable.findFirst({ where: { id: v.id, schoolId: user.schoolId } });
      if (!t) throw new ServiceError('Tax table not found', 404);
      if (t.confirmedAt) throw new ServiceError('Already confirmed', 409);
      await tx.taxTable.update({ where: { id: t.id }, data: { confirmedById: user.id, confirmedAt: now } });
      await audit(tx, user, 'HR_CONFIRM_TAX_SETTINGS', 'TaxTable', t.id, `Confirmed the ${t.currency} tax table from ${isoOf(t.effectiveFrom)}`, { confirmed: false }, { confirmed: true });
    } else {
      const r = await tx.statutoryRate.findFirst({ where: { id: v.id, schoolId: user.schoolId } });
      if (!r) throw new ServiceError('Rates not found', 404);
      if (r.confirmedAt) throw new ServiceError('Already confirmed', 409);
      await tx.statutoryRate.update({ where: { id: r.id }, data: { confirmedById: user.id, confirmedAt: now } });
      await audit(tx, user, 'HR_CONFIRM_TAX_SETTINGS', 'StatutoryRate', r.id, `Confirmed the statutory rates from ${isoOf(r.effectiveFrom)}`, { confirmed: false }, { confirmed: true });
    }
    return { id: v.id };
  });
}

export const PayrollOptionsSchema = z.object({
  payrollZigPerUsd: z.number().int().min(1).max(10_000_000).nullable().optional(), netChangeFlagPct: z.number().int().min(1).max(100).optional(),
  payeDueDay: z.number().int().min(1).max(28).optional(), nssaDueDay: z.number().int().min(1).max(28).optional(), zimdefDueDay: z.number().int().min(1).max(28).optional(), reason: reasonSchema(3),
});

/** The payroll rate (ZiG per US$1, in hundredths), the size of the "net moved" flag and the statutory due days. */
export async function savePayrollOptions(user: Actor, raw: unknown) {
  need(user, 'hr.payroll.settings');
  const { reason, ...v } = PayrollOptionsSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    const before = await tx.hrSettings.findUniqueOrThrow({ where: { schoolId: user.schoolId } });
    const after = await tx.hrSettings.update({ where: { schoolId: user.schoolId }, data: v });
    await audit(tx, user, 'HR_SAVE_SETTINGS', 'HrSettings', after.id, `Payroll options changed (${reason})`,
      { payrollZigPerUsd: before.payrollZigPerUsd, netChangeFlagPct: before.netChangeFlagPct, payeDueDay: before.payeDueDay, nssaDueDay: before.nssaDueDay, zimdefDueDay: before.zimdefDueDay },
      { payrollZigPerUsd: after.payrollZigPerUsd, netChangeFlagPct: after.netChangeFlagPct, payeDueDay: after.payeDueDay, nssaDueDay: after.nssaDueDay, zimdefDueDay: after.zimdefDueDay });
    return { ok: true };
  });
}
