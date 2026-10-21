// Funds and the school's money controls.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { ANY_FINANCE, amountSchema, audit, centsSchema, ensureFunds, loadFinSettings, need, textSchema, type Actor } from '@/lib/finance/common';

const kindSchema = z.enum(['TUITION', 'SDC_LEVY', 'BOARDING', 'GENERAL', 'OTHER']);
const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, 'The code is 2 to 20 letters, digits or underscores');

export const FundSchema = z.object({ code: codeSchema, name: textSchema('a name', 1, 40), kind: kindSchema.default('OTHER') });
const UpdateFundSchema = z.object({ name: textSchema('a name', 1, 40).optional(), active: z.boolean().optional(), sortOrder: z.number().int().min(0).max(100).optional() });

export interface FundView { id: string; code: string; name: string; kind: string; active: boolean; sortOrder: number }

export async function listFunds(user: Actor): Promise<FundView[]> {
  need(user, ...ANY_FINANCE);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const funds = await ensureFunds(tx, user.schoolId);
    return funds.map((f) => ({ id: f.id, code: f.code, name: f.name, kind: f.kind, active: f.active, sortOrder: f.sortOrder }));
  });
}

export async function createFund(user: Actor, raw: unknown) {
  need(user, 'finance.funds.manage');
  const input = FundSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const funds = await ensureFunds(tx, user.schoolId);
    if (funds.some((f) => f.code === input.code)) throw new ServiceError(`There is already a fund with the code ${input.code}`, 409);
    if (funds.some((f) => f.name.toLowerCase() === input.name.toLowerCase())) throw new ServiceError(`There is already a fund called ${input.name}`, 409);
    const f = await tx.fund.create({ data: { schoolId: user.schoolId, code: input.code, name: input.name, kind: input.kind, sortOrder: funds.length } });
    await audit(tx, user, 'SAVE_FUND', 'Fund', f.id, `Added the ${f.name} fund`, undefined, { code: f.code, name: f.name, kind: f.kind });
    return { id: f.id };
  });
}

export async function updateFund(user: Actor, id: string, raw: unknown) {
  need(user, 'finance.funds.manage');
  const input = UpdateFundSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const f = await tx.fund.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!f) throw new ServiceError('Fund not found', 404);
    if (input.name && input.name.toLowerCase() !== f.name.toLowerCase() && (await tx.fund.findFirst({ where: { schoolId: user.schoolId, id: { not: id }, name: { equals: input.name, mode: 'insensitive' } } }))) {
      throw new ServiceError(`There is already a fund called ${input.name}`, 409);
    }
    if (input.active === false && f.active) {
      const open = await tx.finPayment.count({ where: { schoolId: user.schoolId, fundId: id, status: { in: ['PENDING', 'RECEIVED'] } } });
      if (open > 0) throw new ServiceError(`${open} payment(s) in this fund are waiting to be verified. Verify or reject them first.`, 409);
    }
    const updated = await tx.fund.update({ where: { id }, data: { name: input.name, active: input.active, sortOrder: input.sortOrder } });
    await audit(tx, user, 'SAVE_FUND', 'Fund', id, `Changed the ${f.name} fund`, { name: f.name, active: f.active, sortOrder: f.sortOrder }, { name: updated.name, active: updated.active, sortOrder: updated.sortOrder });
    return { id };
  });
}

// ─── Money controls ──────────────────────────────────────────────────────────

/** Limits kept as cents per currency; null means no limit. Each can be sent as cents (…Cents) or as dollars typed by a person (the name without Cents). */
const LIMITS = [
  'directLimitUsd', 'directLimitZig', 'proofAboveUsd', 'proofAboveZig', 'receiptRequiredAboveUsd', 'receiptRequiredAboveZig', 'quotesAboveUsd', 'quotesAboveZig', 'headLimitUsd', 'headLimitZig',
] as const;
const FLAGS = ['requireReference', 'applyCreditAtBilling', 'prorateAdmission', 'autoBillOnAdmission', 'paynowEnabled'] as const;

export interface ControlsView {
  directLimitUsdCents: number | null;
  directLimitZigCents: number | null;
  proofAboveUsdCents: number | null;
  proofAboveZigCents: number | null;
  receiptRequiredAboveUsdCents: number | null;
  receiptRequiredAboveZigCents: number | null;
  quotesAboveUsdCents: number | null;
  quotesAboveZigCents: number | null;
  headLimitUsdCents: number | null;
  headLimitZigCents: number | null;
  quotesRequired: number;
  overrunPercent: number;
  staleRateDays: number;
  cashToleranceCents: number;
  reminderLeadDays: number;
  allocationMode: string;
  requireReference: boolean;
  applyCreditAtBilling: boolean;
  prorateAdmission: boolean;
  autoBillOnAdmission: boolean;
  paynowEnabled: boolean;
  paynowId: string | null;
  /** The integration key is never shown again once saved. */
  paynowKeySet: boolean;
  arrearsSmsTemplate: string;
  /** People who can verify payments through their own role, and people who can record them: the school's separation of duties. */
  verifiers: number;
  recorders: number;
}

export async function getControls(user: Actor): Promise<ControlsView> {
  need(user, ...ANY_FINANCE);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await loadFinSettings(tx, user.schoolId);
    const [verifiers, recorders] = await Promise.all([
      tx.user.count({ where: { schoolId: user.schoolId, active: true, isSupport: false, userRoles: { some: { role: { permissions: { some: { permissionKey: 'finance.payments.verify' } } } } } } }),
      tx.user.count({ where: { schoolId: user.schoolId, active: true, isSupport: false, userRoles: { some: { role: { permissions: { some: { permissionKey: 'finance.payments.record' } } } } } } }),
    ]);
    return {
      directLimitUsdCents: s.directLimitUsdCents, directLimitZigCents: s.directLimitZigCents, proofAboveUsdCents: s.proofAboveUsdCents, proofAboveZigCents: s.proofAboveZigCents,
      receiptRequiredAboveUsdCents: s.receiptRequiredAboveUsdCents, receiptRequiredAboveZigCents: s.receiptRequiredAboveZigCents, quotesAboveUsdCents: s.quotesAboveUsdCents, quotesAboveZigCents: s.quotesAboveZigCents,
      headLimitUsdCents: s.headLimitUsdCents, headLimitZigCents: s.headLimitZigCents, quotesRequired: s.quotesRequired, overrunPercent: s.overrunPercent, staleRateDays: s.staleRateDays,
      cashToleranceCents: s.cashToleranceCents, reminderLeadDays: s.reminderLeadDays, allocationMode: s.allocationMode, requireReference: s.requireReference, applyCreditAtBilling: s.applyCreditAtBilling,
      prorateAdmission: s.prorateAdmission, autoBillOnAdmission: s.autoBillOnAdmission, paynowEnabled: s.paynowEnabled, paynowId: s.paynowId, paynowKeySet: !!s.paynowKey,
      arrearsSmsTemplate: s.arrearsSmsTemplate, verifiers, recorders,
    };
  });
}

const limit = centsSchema.nullable();
// A limit is given in cents (directLimit…Cents) or as dollars typed by a person (directLimitUsd, directLimitZig); null removes it.
const dollars = amountSchema.nullable();
const limitShape = Object.fromEntries(LIMITS.flatMap((k) => [[`${k}Cents`, limit.optional()], [k, dollars.optional()]]));
const flagShape = Object.fromEntries(FLAGS.map((k) => [k, z.boolean().optional()]));
export const ControlsSchema = z.object({
  ...limitShape, ...flagShape,
  quotesRequired: z.number().int().min(1).max(10).optional(), overrunPercent: z.number().int().min(0).max(100).optional(), staleRateDays: z.number().int().min(1).max(60).optional(),
  cashToleranceCents: z.number().int().min(0).max(1_000_000).optional(), reminderLeadDays: z.number().int().min(1).max(14).optional(), allocationMode: z.enum(['OLDEST_FUND', 'PROPORTIONAL']).optional(),
  paynowId: z.string().trim().max(40).nullable().optional(), paynowKey: z.string().trim().min(8).max(120).optional(), arrearsSmsTemplate: z.string().trim().min(10).max(300).optional(),
});

export async function saveControls(user: Actor, raw: unknown) {
  need(user, 'finance.settings.manage');
  const input = ControlsSchema.parse(raw) as Record<string, unknown>;
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const before = await loadFinSettings(tx, user.schoolId);
    const data: Record<string, unknown> = {};
    for (const k of LIMITS) {
      const v = input[`${k}Cents`] !== undefined ? input[`${k}Cents`] : input[k];
      if (v !== undefined) data[`${k}Cents`] = v;
    }
    for (const k of [...FLAGS, 'quotesRequired', 'overrunPercent', 'staleRateDays', 'cashToleranceCents', 'reminderLeadDays', 'allocationMode', 'paynowId', 'paynowKey', 'arrearsSmsTemplate']) if (input[k] !== undefined) data[k] = input[k];
    if (data.paynowEnabled === true && !(data.paynowId ?? before.paynowId) ) throw new ServiceError('Enter the Paynow integration id before switching online payments on', 422);
    if (data.paynowEnabled === true && !(data.paynowKey ?? before.paynowKey)) throw new ServiceError('Enter the Paynow integration key before switching online payments on', 422);
    const after = await tx.finSettings.update({ where: { schoolId: user.schoolId }, data: data as never });
    // The Paynow key is a secret: the audit row records only that it was set.
    const pick = (s: typeof before) => ({ ...Object.fromEntries(Object.keys(data).filter((k) => k !== 'paynowKey').map((k) => [k, (s as unknown as Record<string, unknown>)[k]])), ...(data.paynowKey !== undefined ? { paynowKey: '[set]' } : {}) });
    await audit(tx, user, 'SAVE_FINANCE_CONTROLS', 'FinSettings', after.id, 'Changed the money controls', pick(before), pick(after));
    return { ok: true };
  });
}
