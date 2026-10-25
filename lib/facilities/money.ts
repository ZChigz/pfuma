// The one rule for money that a learner owes because of a facilities service (boarding fee, transport fee, library fine, lost book,
// uniform bought on account, damage, trip): it becomes a charge in Finance, never a separate balance. Where Finance is switched off for
// the school, it is kept on the facilities ledger (FacLedgerEntry) and shown in the part's report, and nothing else breaks.
//
//   Finance module off                           -> a FacLedgerEntry (the part's own ledger)
//   Finance on, school runs its money in Finance -> a FinCharge in the fund of the fee item
//   Finance on, school still on the older screens -> a legacy Charge, with a ledger entry that points at it
import type { Fund } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import type { Db } from '@/lib/scoped-db';
import { DEFAULT_FUNDS, ensureFunds } from '@/lib/finance/common';
import { onFinance } from '@/lib/finance/external';
import { MAX_CENTS, type Cur } from '@/lib/finance/money';

export type FacLedgerPart = 'HOSTEL' | 'LIBRARY' | 'TRANSPORT' | 'INVENTORY' | 'TUCKSHOP';

/** The fee item (the name on the learner's account) each kind of facilities charge is raised under, and its fund. */
export const FEE_ITEMS = {
  BOARDING: { name: 'Boarding fee', fund: 'BOARDING' },
  TRANSPORT: { name: 'Transport', fund: 'GENERAL' },
  TRIP: { name: 'Trips', fund: 'GENERAL' },
  LIBRARY_FINE: { name: 'Library fine', fund: 'GENERAL' },
  LOST_BOOK: { name: 'Lost or damaged book', fund: 'GENERAL' },
  UNIFORM: { name: 'Uniform', fund: 'GENERAL' },
  STATIONERY: { name: 'Stationery', fund: 'GENERAL' },
  DAMAGE: { name: 'Damage to school property', fund: 'GENERAL' },
} as const;
export type FeeItemKind = keyof typeof FEE_ITEMS;

/** True unless the school has switched the Finance module off. */
export async function financeIsOn(tx: Db, schoolId: string): Promise<boolean> {
  return !(await tx.schoolModule.findFirst({ where: { schoolId, module: 'finance', enabled: false }, select: { module: true } }));
}

/** The term charges are raised in: the open one (or the latest when none is open). */
export async function chargeTermId(tx: Db, schoolId: string): Promise<string | null> {
  const open = await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' }, select: { id: true }, orderBy: { startDate: 'desc' } });
  if (open) return open.id;
  return (await tx.academicTerm.findFirst({ where: { schoolId }, select: { id: true }, orderBy: { startDate: 'desc' } }))?.id ?? null;
}

/** The fee item with this name (made in the right fund the first time), so the charge shows under it on the account. */
async function ensureFeeItem(tx: Db, schoolId: string, kind: FeeItemKind) {
  const spec = FEE_ITEMS[kind];
  const funds = await ensureFunds(tx, schoolId);
  const existing = await tx.feeItem.findFirst({ where: { schoolId, name: spec.name } });
  if (existing) return { item: existing, funds };
  const fund = funds.find((f) => f.code === spec.fund && f.active) ?? funds.find((f) => f.active);
  if (!fund) throw new ServiceError('The school has no fund that can take charges', 409);
  const sortOrder = (await tx.feeItem.count({ where: { schoolId } })) + 1;
  const item = await tx.feeItem.create({ data: { schoolId, name: spec.name, fundId: fund.id, recurring: false, sortOrder } });
  return { item, funds };
}

export interface LearnerCharge {
  schoolId: string;
  actorId: string;
  studentId: string;
  part: FacLedgerPart;
  kind: FeeItemKind;
  description: string;
  currency: Cur;
  amountCents: number;
  /** The record that caused it (a loan, a textbook issue, an inspection item ...), so the report can say why. */
  sourceType: string;
  sourceId: string;
  dueDate?: Date | null;
}

export interface LearnerChargeResult {
  where: 'FINANCE' | 'LEGACY' | 'LEDGER';
  /** The FinCharge, when Finance carries it. */
  chargeId: string | null;
  /** The facilities ledger entry (always when Finance is off; a pointer when the older screens carry it). */
  ledgerEntryId: string | null;
}

/** Raises what a learner owes. Call inside the same transaction as the record that caused it. */
export async function chargeLearner(tx: Db, c: LearnerCharge): Promise<LearnerChargeResult> {
  if (!Number.isInteger(c.amountCents) || c.amountCents <= 0) throw new ServiceError('The amount must be more than zero', 422);
  if (c.amountCents > MAX_CENTS) throw new ServiceError('That amount is too large', 422);
  const student = await tx.student.findFirst({ where: { id: c.studentId, schoolId: c.schoolId }, select: { id: true } });
  if (!student) throw new ServiceError('Student not found', 404);
  const termId = await chargeTermId(tx, c.schoolId);

  const ledger = (extra: { chargeId?: string | null; sourceType?: string; sourceId?: string } = {}) =>
    tx.facLedgerEntry.create({
      data: {
        schoolId: c.schoolId, part: c.part, studentId: c.studentId, termId, description: c.description, currency: c.currency, amountCents: c.amountCents,
        chargeId: extra.chargeId ?? null, sourceType: extra.sourceType ?? c.sourceType, sourceId: extra.sourceId ?? c.sourceId, createdById: c.actorId,
      },
      select: { id: true },
    });

  // Finance switched off: the part keeps its own ledger.
  if (!(await financeIsOn(tx, c.schoolId))) {
    const e = await ledger();
    return { where: 'LEDGER', chargeId: null, ledgerEntryId: e.id };
  }

  if (!termId) throw new ServiceError('The school has no term to raise the charge in', 409);

  // The school's money is still on the older accounting screens: the learner owes it there, once. The ledger entry only points at it.
  if (!(await onFinance(tx, c.schoolId))) {
    const legacy = await tx.charge.create({ data: { schoolId: c.schoolId, studentId: c.studentId, termId, label: c.description, currency: c.currency, amount: c.amountCents / 100 } });
    const e = await ledger({ sourceType: 'LEGACY_CHARGE', sourceId: legacy.id });
    return { where: 'LEGACY', chargeId: null, ledgerEntryId: e.id };
  }

  const { item, funds } = await ensureFeeItem(tx, c.schoolId, c.kind);
  const fund = funds.find((f) => f.id === item.fundId && f.active) ?? funds.find((f) => f.active);
  if (!fund) throw new ServiceError('The school has no fund that can take charges', 409);
  const charge = await tx.finCharge.create({
    data: {
      schoolId: c.schoolId, studentId: c.studentId, termId, fundId: fund.id, catalogItemId: item.id, description: c.description, currency: c.currency,
      amountCents: c.amountCents, source: 'FACILITIES', dueDate: c.dueDate ?? null, createdById: c.actorId,
    },
    select: { id: true },
  });
  return { where: 'FINANCE', chargeId: charge.id, ledgerEntryId: null };
}

// ─── Pocket money and the tuck shop keep their own funds ────────────────────

export interface FacilityFunds { trust: Fund; tuckshop: Fund }

/**
 * The "Pocket money (held in trust)" fund and the "Tuck shop" fund. Pocket money is not school income: it never sits in a fee fund and
 * is never allocated to fees. Made the first time they are needed.
 */
export async function ensureFacilityFunds(tx: Db, schoolId: string): Promise<FacilityFunds> {
  await ensureFunds(tx, schoolId);
  const order = DEFAULT_FUNDS.length;
  const make = async (code: string, name: string, kind: 'TRUST' | 'TUCKSHOP', sortOrder: number) => {
    const found = await tx.fund.findFirst({ where: { schoolId, code } });
    if (found) return found;
    return tx.fund.create({ data: { schoolId, code, name, kind, sortOrder } });
  };
  const trust = await make('POCKET', 'Pocket money (held in trust)', 'TRUST', order);
  const tuckshop = await make('TUCKSHOP', 'Tuck shop', 'TUCKSHOP', order + 1);
  return { trust, tuckshop };
}
