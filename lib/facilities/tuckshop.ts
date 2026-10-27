// Pocket money wallets and the tuck shop.
//
// Pocket money is held in trust: a deposit is a Finance payment into the "Pocket money (held in trust)" fund (never a fee fund; the database
// refuses to use it against a fee), and the wallet is a ledger of entries, so its balance is a sum and never a stored number. A wallet is one
// currency and is never overdrawn. The tuck shop sells stock from the "Tuck shop" store, paid in cash or from the learner's wallet, with a
// weekly spending limit, a low-balance SMS to the guardian, a cash-up at the end of the day, and a weekly statement.
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { can } from '@/lib/access-core';
import { scopeWhere } from '@/lib/access/where';
import { proofKeyBelongsTo } from '@/lib/proof-of-payment';
import { recordPaymentTx } from '@/lib/finance/payments';
import { onFinance } from '@/lib/finance/external';
import { queueSms } from '@/lib/finance/sms';
import { drawFromStore, storeStock } from '@/lib/facilities/inventory';
import { primaryContacts } from '@/lib/facilities/exeats';
import { ensureFacilityFunds, financeIsOn } from '@/lib/facilities/money';
import {
  audit, centsSchema, currencySchema, formatMoney, idSchema, isoDateSchema, loadFacSettings, need, optText, textSchema, todayInHarare, toDay, within, type Actor, type Cur,
} from '@/lib/facilities/common';

export const TUCK_STORE = 'Tuck shop';
const WALLET_KEYS = ['facilities.wallets.manage', 'facilities.wallets.view'] as const;
const heldWallet = (u: Actor) => (can(u, 'facilities.wallets.manage') ? 'facilities.wallets.manage' : 'facilities.wallets.view');

/** The Monday (Harare) of the week a moment falls in: the weekly limit counts from here. */
export function weekStart(at: Date): Date {
  const local = new Date(at.getTime() + 2 * 3_600_000);
  const dow = (local.getUTCDay() + 6) % 7;
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dow);
  return new Date(start - 2 * 3_600_000);
}

// ─── Wallets ─────────────────────────────────────────────────────────────────

async function balanceOf(tx: Db, walletId: string): Promise<number> {
  return (await tx.facWalletEntry.aggregate({ where: { walletId }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
}

async function spentThisWeek(tx: Db, walletId: string, now = new Date()): Promise<number> {
  return -((await tx.facWalletEntry.aggregate({ where: { walletId, type: 'PURCHASE', createdAt: { gte: weekStart(now) } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0);
}

async function boarder(tx: Db, schoolId: string, studentId: string) {
  const s = await tx.student.findFirst({ where: { id: studentId, schoolId }, select: { id: true, fullName: true, boarding: true, status: true } });
  if (!s) throw new ServiceError('Student not found', 404);
  if (s.boarding !== 'BOARDER') throw new ServiceError(`${s.fullName} is a day scholar. Pocket money wallets are for boarders.`, 409);
  if (s.status !== 'ACTIVE') throw new ServiceError(`${s.fullName} is not at the school`, 409);
  return s;
}

/** The wallet for a learner in a currency, made the first time money is paid in. */
async function walletFor(tx: Db, schoolId: string, studentId: string, currency: Cur, create: boolean) {
  const existing = await tx.facWallet.findUnique({ where: { studentId_currency: { studentId, currency } } });
  if (existing) {
    if (existing.schoolId !== schoolId) throw new ServiceError('Wallet not found', 404);
    return existing;
  }
  if (!create) return null;
  return tx.facWallet.create({ data: { schoolId, studentId, currency } });
}

export interface WalletRow {
  walletId: string; studentId: string; student: string; admissionNumber: string; className: string | null; currency: Cur; balanceCents: number; weeklyLimitCents: number | null; spentThisWeekCents: number;
  lowBalanceCents: number | null; low: boolean; closed: boolean;
}

export async function listWallets(user: Actor, f: { q?: string; lowOnly?: boolean } = {}): Promise<WalletRow[]> {
  need(user, ...WALLET_KEYS);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const reach = (await scopeWhere(user, heldWallet(user), 'Student', tx)) as Prisma.StudentWhereInput;
    const students = await tx.student.findMany({
      where: { AND: [reach, { schoolId: user.schoolId, boarding: 'BOARDER' }, f.q ? { OR: [{ fullName: { contains: f.q, mode: 'insensitive' } }, { admissionNumber: { contains: f.q, mode: 'insensitive' } }] } : {}] },
      select: { id: true, fullName: true, admissionNumber: true, currentClass: { select: { name: true } } }, take: 400,
    });
    const wallets = await tx.facWallet.findMany({ where: { schoolId: user.schoolId, studentId: { in: students.map((s) => s.id) } } });
    const settings = await loadFacSettings(tx, user.schoolId);
    const sums = await tx.facWalletEntry.groupBy({ by: ['walletId'], where: { schoolId: user.schoolId, walletId: { in: wallets.map((w) => w.id) } }, _sum: { amountCents: true } });
    const week = await tx.facWalletEntry.groupBy({ by: ['walletId'], where: { schoolId: user.schoolId, type: 'PURCHASE', createdAt: { gte: weekStart(new Date()) }, walletId: { in: wallets.map((w) => w.id) } }, _sum: { amountCents: true } });
    const rows = wallets.map((w): WalletRow => {
      const s = students.find((x) => x.id === w.studentId)!;
      const balance = sums.find((x) => x.walletId === w.id)?._sum.amountCents ?? 0;
      const lowAt = w.lowBalanceCents ?? (settings.walletLowBalanceCents || null);
      return {
        walletId: w.id, studentId: w.studentId, student: s.fullName, admissionNumber: s.admissionNumber, className: s.currentClass?.name ?? null, currency: w.currency as Cur, balanceCents: balance,
        weeklyLimitCents: w.weeklyLimitCents, spentThisWeekCents: -(week.find((x) => x.walletId === w.id)?._sum.amountCents ?? 0), lowBalanceCents: lowAt, low: !w.closedAt && lowAt !== null && balance <= lowAt, closed: !!w.closedAt,
      };
    }).filter((r) => !f.lowOnly || r.low).sort((a, b) => a.student.localeCompare(b.student));
    return rows;
  });
}

export async function walletDetail(user: Actor, studentId: string, currency: string) {
  need(user, ...WALLET_KEYS);
  const cur = currencySchema.parse(currency);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await within(tx, user, heldWallet(user), 'Student', studentId);
    const s = await tx.student.findFirst({ where: { id: studentId, schoolId: user.schoolId }, select: { id: true, fullName: true, admissionNumber: true } });
    if (!s) throw new ServiceError('Student not found', 404);
    const w = await walletFor(tx, user.schoolId, studentId, cur, false);
    if (!w) return { student: s.fullName, currency: cur, balanceCents: 0, entries: [] as { id: string; at: string; type: string; amountCents: number; note: string | null }[], weeklyLimitCents: null, spentThisWeekCents: 0, closed: false };
    const entries = await tx.facWalletEntry.findMany({ where: { walletId: w.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    return {
      student: s.fullName, currency: cur, balanceCents: await balanceOf(tx, w.id), weeklyLimitCents: w.weeklyLimitCents, spentThisWeekCents: await spentThisWeek(tx, w.id), closed: !!w.closedAt,
      entries: entries.map((e) => ({ id: e.id, at: e.createdAt.toISOString(), type: e.type, amountCents: e.amountCents, note: e.note })),
    };
  });
}

export const DepositSchema = z.object({ studentId: idSchema, currency: currencySchema, amountCents: centsSchema, paidBy: optText(80), note: optText(200) });

/**
 * Pocket money handed in at the boarding master's desk (cash). Finance on: a payment into the pocket-money fund (with its receipt) in the
 * same transaction as the wallet entry. Finance off: the wallet ledger is the record and needs a note.
 */
export async function deposit(user: Actor, raw: unknown) {
  need(user, 'facilities.wallets.manage');
  const v = DepositSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await boarder(tx, user.schoolId, v.studentId);
    await within(tx, user, 'facilities.wallets.manage', 'Student', v.studentId);
    const w = await walletFor(tx, user.schoolId, s.id, v.currency, true);
    if (!w) throw new ServiceError('Wallet not found', 404);
    if (w.closedAt) throw new ServiceError('This wallet is closed', 409);
    let paymentId: string | null = null;
    let receipt: string | null = null;
    if (await onFinance(tx, user.schoolId)) {
      const funds = await ensureFacilityFunds(tx, user.schoolId);
      const out = await recordPaymentTx(tx, user, { studentId: s.id, currency: v.currency, method: 'CASH', paidBy: v.paidBy, note: 'Pocket money', lines: [{ fundId: funds.trust.id, amount: v.amountCents }] } as never);
      paymentId = out.payments[0]!.id;
      receipt = out.payments[0]!.receiptNumber ?? out.payments[0]!.ackNumber;
    } else if (!v.note || v.note.length < 3) {
      throw new ServiceError('Add a note (who handed it in, and when)', 422);
    }
    const e = await tx.facWalletEntry.create({ data: { schoolId: user.schoolId, walletId: w.id, currency: v.currency, amountCents: v.amountCents, type: 'DEPOSIT', paymentId, note: v.note ?? (v.paidBy ? `From ${v.paidBy}` : null), createdById: user.id } });
    const balance = await balanceOf(tx, w.id);
    await audit(tx, user, 'FAC_WALLET_DEPOSIT', 'FacWallet', w.id, `${s.fullName}: ${formatMoney(v.amountCents, v.currency)} pocket money paid in${receipt ? ` (receipt ${receipt})` : ''}`, undefined, { entryId: e.id, amountCents: v.amountCents, currency: v.currency, paymentId, balanceCents: balance } as never);
    return { entryId: e.id, balanceCents: balance, receipt };
  });
}

export const WithdrawSchema = z.object({ studentId: idSchema, currency: currencySchema, amountCents: centsSchema, note: textSchema('what it is for', 3, 200), signatureKey: optText(200) });

/** Cash handed back to the learner from the wallet; the learner signs on the phone. The database refuses more than the balance. */
export async function withdraw(user: Actor, raw: unknown) {
  need(user, 'facilities.wallets.manage');
  const v = WithdrawSchema.parse(raw);
  if (v.signatureKey && !proofKeyBelongsTo(v.signatureKey, user.schoolId)) throw new ServiceError('That signature does not belong to this school', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await boarder(tx, user.schoolId, v.studentId);
    await within(tx, user, 'facilities.wallets.manage', 'Student', v.studentId);
    const w = await walletFor(tx, user.schoolId, s.id, v.currency, false);
    if (!w) throw new ServiceError(`${s.fullName} has no ${v.currency} wallet`, 404);
    const balance = await balanceOf(tx, w.id);
    if (v.amountCents > balance) throw new ServiceError(`Not enough pocket money: ${formatMoney(balance, v.currency)} in the wallet`, 409);
    const e = await tx.facWalletEntry.create({ data: { schoolId: user.schoolId, walletId: w.id, currency: v.currency, amountCents: -v.amountCents, type: 'WITHDRAWAL', note: v.note, signatureKey: v.signatureKey ?? null, createdById: user.id } });
    await audit(tx, user, 'FAC_WALLET_WITHDRAW', 'FacWallet', w.id, `${s.fullName}: ${formatMoney(v.amountCents, v.currency)} pocket money handed out (${v.note})`, undefined, { entryId: e.id, amountCents: v.amountCents, balanceCents: balance - v.amountCents } as never);
    return { entryId: e.id, balanceCents: balance - v.amountCents };
  });
}

export const LimitSchema = z.object({ studentId: idSchema, currency: currencySchema, weeklyLimitCents: centsSchema.nullable(), lowBalanceCents: centsSchema.nullable().optional() });

export async function setLimits(user: Actor, raw: unknown) {
  need(user, 'facilities.wallets.manage');
  const v = LimitSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await boarder(tx, user.schoolId, v.studentId);
    await within(tx, user, 'facilities.wallets.manage', 'Student', v.studentId);
    const w = await walletFor(tx, user.schoolId, s.id, v.currency, true);
    if (!w) throw new ServiceError('Wallet not found', 404);
    await tx.facWallet.update({ where: { id: w.id }, data: { weeklyLimitCents: v.weeklyLimitCents, ...(v.lowBalanceCents !== undefined ? { lowBalanceCents: v.lowBalanceCents } : {}) } });
    await audit(tx, user, 'FAC_WALLET_SETTINGS', 'FacWallet', w.id, `${s.fullName}: spending limits changed`, { weeklyLimitCents: w.weeklyLimitCents, lowBalanceCents: w.lowBalanceCents }, { weeklyLimitCents: v.weeklyLimitCents, lowBalanceCents: v.lowBalanceCents ?? w.lowBalanceCents });
    return { walletId: w.id };
  });
}

export const CloseSchema = z.object({ studentId: idSchema, currency: currencySchema, action: z.enum(['REFUNDED', 'CARRIED_FORWARD']), note: textSchema('the reason', 3, 200) });

/** When a learner leaves: the balance is refunded (cash back) or carried forward (kept in trust, never used for fees without written consent). */
export async function closeWallet(user: Actor, raw: unknown) {
  need(user, 'facilities.wallets.manage');
  const v = CloseSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await within(tx, user, 'facilities.wallets.manage', 'Student', v.studentId);
    const s = await tx.student.findFirst({ where: { id: v.studentId, schoolId: user.schoolId }, select: { id: true, fullName: true } });
    if (!s) throw new ServiceError('Student not found', 404);
    const w = await walletFor(tx, user.schoolId, s.id, v.currency, false);
    if (!w) throw new ServiceError(`${s.fullName} has no ${v.currency} wallet`, 404);
    if (w.closedAt) throw new ServiceError('This wallet is already closed', 409);
    const balance = await balanceOf(tx, w.id);
    if (v.action === 'REFUNDED' && balance > 0) {
      await tx.facWalletEntry.create({ data: { schoolId: user.schoolId, walletId: w.id, currency: v.currency, amountCents: -balance, type: 'REFUND', note: v.note, createdById: user.id } });
    }
    await tx.facWallet.update({ where: { id: w.id }, data: { closedAt: new Date(), closeAction: v.action, closedById: user.id } });
    await audit(tx, user, 'FAC_WALLET_CLOSE', 'FacWallet', w.id, `${s.fullName}: wallet closed, ${v.action === 'REFUNDED' ? `${formatMoney(balance, v.currency)} refunded` : `${formatMoney(balance, v.currency)} carried forward`}`, { closedAt: null }, { closeAction: v.action, balanceCents: balance });
    return { refundedCents: v.action === 'REFUNDED' ? balance : 0, carriedForwardCents: v.action === 'CARRIED_FORWARD' ? balance : 0 };
  });
}

// ─── Selling ─────────────────────────────────────────────────────────────────

export async function tuckItems(user: Actor) {
  need(user, 'facilities.tuckshop.sell', 'facilities.tuckshop.cashup');
  return getScopedDb(user.schoolId, user.id).$tx((tx) => storeStock(tx, user.schoolId, TUCK_STORE));
}

export const SaleSchema = z.object({
  lines: z.array(z.object({ itemId: idSchema, qty: z.number().int().min(1).max(500) })).min(1).max(40),
  payment: z.enum(['CASH', 'WALLET']), studentId: idSchema.optional(),
  // A random id made on the phone, so a sale sent twice (a flaky connection) is counted once.
  clientId: z.string().trim().min(8).max(64).optional(),
});

/** One sale at the till. Stock leaves the Tuck shop store at the prices on the items; a wallet sale cannot overdraw or pass the weekly limit. */
export async function sell(user: Actor, raw: unknown) {
  need(user, 'facilities.tuckshop.sell');
  const v = SaleSchema.parse(raw);
  if (v.payment === 'WALLET' && !v.studentId) throw new ServiceError('Choose the learner whose wallet pays', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (v.clientId) {
      const dup = await tx.facTuckShopSale.findUnique({ where: { schoolId_clientId: { schoolId: user.schoolId, clientId: v.clientId } } });
      if (dup) return { saleId: dup.id, totalCents: dup.totalCents, currency: dup.currency as Cur, balanceCents: null as number | null, duplicate: true, lowBalance: false };
    }
    const merged = new Map<string, number>();
    for (const l of v.lines) merged.set(l.itemId, (merged.get(l.itemId) ?? 0) + l.qty);
    const items = await tx.facStockItem.findMany({ where: { schoolId: user.schoolId, id: { in: Array.from(merged.keys()) }, active: true } });
    if (items.length !== merged.size) throw new ServiceError('An item was not found', 404);
    let currency: Cur | null = null;
    let total = 0;
    for (const i of items) {
      if (i.priceCents == null || !i.priceCurrency) throw new ServiceError(`${i.name} has no selling price`, 422);
      if (currency && currency !== i.priceCurrency) throw new ServiceError('The items are priced in different currencies. Sell them separately.', 422);
      currency = i.priceCurrency as Cur;
      total += i.priceCents * merged.get(i.id)!;
    }
    if (total <= 0 || !currency) throw new ServiceError('There is nothing to charge for', 422);

    let wallet: Awaited<ReturnType<typeof walletFor>> = null;
    let student: { id: string; fullName: string } | null = null;
    if (v.studentId) {
      student = await boarder(tx, user.schoolId, v.studentId);
      await within(tx, user, 'facilities.tuckshop.sell', 'Student', v.studentId);
    }
    if (v.payment === 'WALLET') {
      wallet = await walletFor(tx, user.schoolId, student!.id, currency, false);
      if (!wallet) throw new ServiceError(`${student!.fullName} has no ${currency} wallet`, 409);
      if (wallet.closedAt) throw new ServiceError('This wallet is closed', 409);
      const balance = await balanceOf(tx, wallet.id);
      if (total > balance) throw new ServiceError(`Not enough pocket money: ${formatMoney(balance, currency)} in the wallet, ${formatMoney(total, currency)} to pay`, 409);
      if (wallet.weeklyLimitCents != null) {
        const spent = await spentThisWeek(tx, wallet.id);
        if (spent + total > wallet.weeklyLimitCents) throw new ServiceError(`Over the weekly limit: ${formatMoney(spent, currency)} of ${formatMoney(wallet.weeklyLimitCents, currency)} already spent this week`, 409);
      }
    }

    const sale = await tx.facTuckShopSale.create({
      data: { schoolId: user.schoolId, attendantId: user.id, studentId: student?.id ?? null, walletId: wallet?.id ?? null, payment: v.payment, currency, totalCents: total, clientId: v.clientId ?? null },
    });
    let cost = 0;
    for (const i of items) {
      const qty = merged.get(i.id)!;
      const out = await drawFromStore(tx, user, { storeName: TUCK_STORE, itemId: i.id, qty, type: 'SALE', studentId: student?.id, reason: `Tuck shop sale ${sale.id}` });
      cost += out.unitCostCents * qty;
      await tx.facTuckShopSaleLine.create({ data: { schoolId: user.schoolId, saleId: sale.id, stockItemId: i.id, qty, unitPriceCents: i.priceCents!, unitCostCents: out.unitCostCents, movementId: out.movementIds[0] ?? null } });
    }
    await tx.facTuckShopSale.update({ where: { id: sale.id }, data: { costCents: cost } });
    let balanceAfter: number | null = null;
    let low = false;
    if (wallet) {
      await tx.facWalletEntry.create({ data: { schoolId: user.schoolId, walletId: wallet.id, currency, amountCents: -total, type: 'PURCHASE', saleId: sale.id, note: items.map((i) => `${merged.get(i.id)} × ${i.name}`).join(', ').slice(0, 200), createdById: user.id } });
      balanceAfter = await balanceOf(tx, wallet.id);
      const settings = await loadFacSettings(tx, user.schoolId);
      const lowAt = wallet.lowBalanceCents ?? (settings.walletLowBalanceCents || null);
      if (lowAt !== null && balanceAfter <= lowAt) {
        low = true;
        await queueSms(tx, user.schoolId, await primaryContacts(tx, user.schoolId, student!.id), `${student!.fullName}'s pocket money is low: ${formatMoney(balanceAfter, currency)} left.`, { studentId: student!.id, key: `wallet-low:${wallet.id}:${todayInHarare()}` });
      }
    }
    await audit(tx, user, 'FAC_TUCKSHOP_SALE', 'FacTuckShopSale', sale.id, `Tuck shop sale ${formatMoney(total, currency)} (${v.payment === 'WALLET' ? `from ${student!.fullName}'s wallet` : 'cash'})`, undefined, { totalCents: total, currency, payment: v.payment, studentId: student?.id ?? null, costCents: cost, balanceCents: balanceAfter } as never);
    return { saleId: sale.id, totalCents: total, currency, balanceCents: balanceAfter, duplicate: false, lowBalance: low };
  });
}

export interface SaleRow { id: string; soldAt: string; attendant: string; student: string | null; payment: string; currency: Cur; totalCents: number; costCents: number; lines: string; cashUpId: string | null }

export async function todaysSales(user: Actor, date?: string): Promise<{ date: string; sales: SaleRow[]; totals: { currency: Cur; cashCents: number; walletCents: number; costCents: number }[] }> {
  need(user, 'facilities.tuckshop.sell', 'facilities.tuckshop.cashup');
  const day = date ?? todayInHarare();
  if (!isoDateSchema.safeParse(day).success) throw new ServiceError('Enter a valid date', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const from = new Date(`${day}T00:00:00+02:00`);
    const all = can(user, 'facilities.tuckshop.cashup');
    const sales = await tx.facTuckShopSale.findMany({ where: { schoolId: user.schoolId, soldAt: { gte: from, lt: new Date(from.getTime() + 86_400_000) }, ...(all ? {} : { attendantId: user.id }) }, orderBy: { soldAt: 'desc' }, take: 500 });
    const lines = await tx.facTuckShopSaleLine.findMany({ where: { saleId: { in: sales.map((s) => s.id) } } });
    const items = await tx.facStockItem.findMany({ where: { id: { in: lines.map((l) => l.stockItemId) } }, select: { id: true, name: true } });
    const people = await tx.user.findMany({ where: { id: { in: sales.map((s) => s.attendantId) } }, select: { id: true, fullName: true } });
    const kids = await tx.student.findMany({ where: { id: { in: sales.map((s) => s.studentId ?? '') } }, select: { id: true, fullName: true } });
    const rows = sales.map((s): SaleRow => ({
      id: s.id, soldAt: s.soldAt.toISOString(), attendant: people.find((p) => p.id === s.attendantId)?.fullName ?? '', student: kids.find((k) => k.id === s.studentId)?.fullName ?? null, payment: s.payment, currency: s.currency as Cur,
      totalCents: s.totalCents, costCents: s.costCents, cashUpId: s.cashUpId,
      lines: lines.filter((l) => l.saleId === s.id).map((l) => `${l.qty} × ${items.find((i) => i.id === l.stockItemId)?.name ?? ''}`).join(', '),
    }));
    const totals = (['USD', 'ZIG'] as const).map((currency) => ({
      currency, cashCents: rows.filter((r) => r.currency === currency && r.payment === 'CASH').reduce((a, r) => a + r.totalCents, 0),
      walletCents: rows.filter((r) => r.currency === currency && r.payment === 'WALLET').reduce((a, r) => a + r.totalCents, 0), costCents: rows.filter((r) => r.currency === currency).reduce((a, r) => a + r.costCents, 0),
    })).filter((t) => t.cashCents || t.walletCents);
    return { date: day, sales: rows, totals };
  });
}

// ─── Cash-up ─────────────────────────────────────────────────────────────────

export const CashUpSchema = z.object({ date: isoDateSchema.optional(), currency: currencySchema, countedCents: centsSchema.or(z.literal(0)), note: optText(200) });

/** The attendant counts the cash for the day; the system says what it should be; a difference needs a note. Another person confirms. */
export async function cashUp(user: Actor, raw: unknown) {
  need(user, 'facilities.tuckshop.sell');
  const v = CashUpSchema.parse(raw);
  const day = v.date ?? todayInHarare();
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const from = new Date(`${day}T00:00:00+02:00`);
    const sales = await tx.facTuckShopSale.findMany({ where: { schoolId: user.schoolId, attendantId: user.id, payment: 'CASH', currency: v.currency, soldAt: { gte: from, lt: new Date(from.getTime() + 86_400_000) } } });
    const expected = sales.reduce((a, s) => a + s.totalCents, 0);
    if (await tx.facTuckShopCashUp.findFirst({ where: { schoolId: user.schoolId, attendantId: user.id, date: toDay(day), currency: v.currency } })) throw new ServiceError('You already cashed up this day', 409);
    if (v.countedCents !== expected && (v.note ?? '').length < 3) throw new ServiceError(`The cash should be ${formatMoney(expected, v.currency)} and you counted ${formatMoney(v.countedCents, v.currency)}. Say why they differ.`, 422);
    const row = await tx.facTuckShopCashUp.create({ data: { schoolId: user.schoolId, attendantId: user.id, date: toDay(day), currency: v.currency, expectedCashCents: expected, countedCashCents: v.countedCents, note: v.note ?? null } });
    await tx.facTuckShopSale.updateMany({ where: { id: { in: sales.map((s) => s.id) } }, data: { cashUpId: row.id } });
    await audit(tx, user, 'FAC_TUCKSHOP_CASHUP', 'FacTuckShopCashUp', row.id, `Cash-up for ${day}: ${formatMoney(v.countedCents, v.currency)} counted, ${formatMoney(expected, v.currency)} expected`, undefined, { expectedCents: expected, countedCents: v.countedCents, differenceCents: v.countedCents - expected } as never);
    return { id: row.id, expectedCents: expected, countedCents: v.countedCents, differenceCents: v.countedCents - expected };
  });
}

export async function listCashUps(user: Actor) {
  need(user, 'facilities.tuckshop.cashup', 'facilities.tuckshop.sell');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.facTuckShopCashUp.findMany({ where: { schoolId: user.schoolId, ...(can(user, 'facilities.tuckshop.cashup') ? {} : { attendantId: user.id }) }, orderBy: { date: 'desc' }, take: 60 });
    const people = await tx.user.findMany({ where: { id: { in: rows.map((r) => r.attendantId) } }, select: { id: true, fullName: true } });
    return rows.map((r) => ({ id: r.id, date: r.date.toISOString().slice(0, 10), attendant: people.find((p) => p.id === r.attendantId)?.fullName ?? '', attendantId: r.attendantId, currency: r.currency as Cur, expectedCents: r.expectedCashCents, countedCents: r.countedCashCents, differenceCents: r.countedCashCents - r.expectedCashCents, note: r.note, confirmed: !!r.confirmedById }));
  });
}

/** Someone else confirms the cash-up (never the person who counted). */
export async function confirmCashUp(user: Actor, id: string) {
  need(user, 'facilities.tuckshop.cashup');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.facTuckShopCashUp.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!r) throw new ServiceError('Cash-up not found', 404);
    if (r.attendantId === user.id) throw new ServiceError('You counted this cash, so someone else must confirm it.', 403);
    if (r.confirmedById) throw new ServiceError('This cash-up was already confirmed', 409);
    await tx.facTuckShopCashUp.update({ where: { id }, data: { confirmedById: user.id } });
    await audit(tx, user, 'FAC_TUCKSHOP_CASHUP', 'FacTuckShopCashUp', id, 'Cash-up confirmed', { confirmedById: null }, { confirmedById: user.id });
    return { id };
  });
}

// ─── Statements and the trust check ──────────────────────────────────────────

/** The weekly SMS to the guardian of each boarder who has a wallet: balance and what was spent this week. Sent once per wallet per week. */
export async function walletStatements(tx: Db, schoolId: string): Promise<number> {
  const wallets = await tx.facWallet.findMany({ where: { schoolId, closedAt: null } });
  const since = weekStart(new Date());
  const weekKey = since.toISOString().slice(0, 10);
  let sent = 0;
  for (const w of wallets) {
    const bal = await balanceOf(tx, w.id);
    const spent = await spentThisWeek(tx, w.id);
    if (bal === 0 && spent === 0) continue;
    const s = await tx.student.findUnique({ where: { id: w.studentId }, select: { fullName: true } });
    sent += await queueSms(tx, schoolId, await primaryContacts(tx, schoolId, w.studentId), `${s?.fullName}: pocket money balance ${formatMoney(bal, w.currency as Cur)}, spent this week ${formatMoney(spent, w.currency as Cur)}.`, { studentId: w.studentId, key: `wallet-week:${w.id}:${weekKey}` });
  }
  return sent;
}

export interface TrustCheck { currency: Cur; walletsCents: number; financeDepositsCents: number; fundReceivedCents: number | null; unmatchedCents: number | null; ok: boolean }

/**
 * The trust check: the pocket-money wallets together hold exactly what was paid in, less what was spent or handed back. Where Finance holds
 * the money, the payments into the pocket-money fund must equal the wallet deposits that point at a payment; a payment recorded straight
 * into the fund without a wallet entry shows as unmatched.
 */
export async function trustCheck(user: Actor): Promise<TrustCheck[]> {
  need(user, 'facilities.wallets.manage', 'facilities.wallets.view', 'facilities.tuckshop.cashup');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const out: TrustCheck[] = [];
    const finance = (await financeIsOn(tx, user.schoolId)) && (await onFinance(tx, user.schoolId));
    const trust = finance ? await tx.fund.findFirst({ where: { schoolId: user.schoolId, code: 'POCKET' }, select: { id: true } }) : null;
    for (const currency of ['USD', 'ZIG'] as const) {
      const wallets = (await tx.facWalletEntry.aggregate({ where: { schoolId: user.schoolId, currency }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
      const deposits = (await tx.facWalletEntry.aggregate({ where: { schoolId: user.schoolId, currency, type: 'DEPOSIT', paymentId: { not: null } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
      let fund: number | null = null;
      if (trust) {
        fund = (await tx.finPayment.aggregate({ where: { schoolId: user.schoolId, currency, fundId: trust.id, status: { in: ['RECEIVED', 'VERIFIED'] }, voidRow: null }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
      }
      if (!wallets && !deposits && !fund) continue;
      out.push({ currency, walletsCents: wallets, financeDepositsCents: deposits, fundReceivedCents: fund, unmatchedCents: fund === null ? null : fund - deposits, ok: fund === null || fund === deposits });
    }
    return out;
  });
}
