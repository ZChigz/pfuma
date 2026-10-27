// Purchase requests: spending goes out along its own path. One person raises the request, a second approves it, a third pays it; no one may do two of
// the three steps, whatever their role. The Head approves up to a limit the Owner sets; above it the Owner approves after the Head. Only the payment
// creates an expense, so the books always match the approvals. A payment more than the allowed margin over the approved total goes back for approval.
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import * as guards from '@/lib/access/guards';
import { notifyUsers } from '@/lib/system/notifications';
import { proofKeyBelongsTo } from '@/lib/proof-of-payment';
import {
  activeFund, amountSchema, assertCurrencyOn, audit, currencySchema, dayOf, holds, idSchema, isoDateSchema, loadFinSettings, nameMap, nameOf, need, nextRequestNumber, tellApprovers, textSchema,
  todayInHarare, whySchema, ymd, type Actor,
} from '@/lib/finance/common';
import { fundBudgetView } from '@/lib/finance/spending';
import { formatMoney, type Cur } from '@/lib/finance/money';
import { METHODS, type Method } from '@/lib/finance/methods';

export const REQUEST_TYPES = ['PURCHASE_ORDER', 'UTILITY_BILL', 'FUEL', 'SALARY_ADVANCE', 'MAINTENANCE', 'OTHER'] as const;
export const TYPE_LABEL: Record<(typeof REQUEST_TYPES)[number], string> = {
  PURCHASE_ORDER: 'Purchase order', UTILITY_BILL: 'Utility bill', FUEL: 'Fuel', SALARY_ADVANCE: 'Salary advance', MAINTENANCE: 'Maintenance', OTHER: 'Other',
};

const ItemSchema = z.object({ description: textSchema('what is needed', 1, 160), quantity: z.number().int().min(1).max(100000), unit: amountSchema });

export const RequestSchema = z.object({
  title: textSchema('a title', 3, 120),
  type: z.enum(REQUEST_TYPES),
  department: textSchema('the department', 1, 60),
  justification: textSchema('why it is needed', 5, 500),
  fundId: idSchema,
  currency: currencySchema,
  neededBy: isoDateSchema.optional(),
  supplierId: idSchema.optional(),
  quoteKeys: z.array(z.string().trim().max(200)).max(10).default([]),
  items: z.array(ItemSchema).min(1, 'Add at least one line').max(30),
  submit: z.boolean().optional(),
});

const total = (items: { quantity: number; unit: number }[]) => items.reduce((s, i) => s + i.quantity * i.unit, 0);
const itemRows = (schoolId: string, requestId: string, items: z.infer<typeof ItemSchema>[]) => items.map((i) => ({ schoolId, requestId, description: i.description, quantity: i.quantity, unitCents: i.unit, totalCents: i.quantity * i.unit }));

async function load(tx: Db, schoolId: string, id: string) {
  const r = await tx.finExpenseRequest.findFirst({ where: { id, schoolId }, include: { items: { orderBy: { id: 'asc' } }, expense: { select: { id: true, amountCents: true, recordedById: true, voidRow: { select: { id: true } } } }, fund: { select: { name: true } } } });
  if (!r) throw new ServiceError('Request not found', 404);
  return r;
}

const limitFor = (s: { headLimitUsdCents: number | null; headLimitZigCents: number | null }, c: Cur) => (c === 'USD' ? s.headLimitUsdCents : s.headLimitZigCents);

async function submitTx(tx: Db, user: Actor, id: string) {
  const r = await load(tx, user.schoolId, id);
  if (r.requestedById !== user.id) throw new ServiceError('Only the person who raised a request can submit it', 403);
  if (r.status !== 'DRAFT') throw new ServiceError('This request was already submitted', 409);
  const sum = r.items.reduce((s, i) => s + i.totalCents, 0);
  if (r.items.length === 0 || sum <= 0) throw new ServiceError('A request needs at least one line', 422);
  const settings = await loadFinSettings(tx, user.schoolId);
  const quotesAbove = r.currency === 'USD' ? settings.quotesAboveUsdCents : settings.quotesAboveZigCents;
  if (quotesAbove !== null && sum > quotesAbove && r.quoteKeys.length < settings.quotesRequired) {
    throw new ServiceError(`A request above ${formatMoney(quotesAbove, r.currency)} needs ${settings.quotesRequired} quotes. Attach them first.`, 422);
  }
  const moved = await tx.finExpenseRequest.updateMany({ where: { id, schoolId: user.schoolId, status: 'DRAFT' }, data: { status: 'PENDING', submittedAt: new Date(), estimatedCents: sum } });
  if (moved.count !== 1) throw new ServiceError('This request was already submitted', 409);
  await audit(tx, user, 'SUBMIT_EXPENSE_REQUEST', 'FinExpenseRequest', id, `Submitted ${r.requestNumber}: ${r.title}`, { status: 'DRAFT' }, { status: 'PENDING', estimatedCents: sum, currency: r.currency, quotes: r.quoteKeys.length });
  await tellApprovers(tx, user, 'finance.requests.approve', { title: 'Purchase request to approve', body: `${r.requestNumber}: ${r.title}`, link: `/finance/requests/${id}` });
}

async function checkAttachments(tx: Db, user: Actor, input: z.infer<typeof RequestSchema>) {
  for (const k of input.quoteKeys) if (!proofKeyBelongsTo(k, user.schoolId)) throw new ServiceError('A quote does not belong to this school', 422);
  if (input.supplierId && !(await tx.supplier.findFirst({ where: { id: input.supplierId, schoolId: user.schoolId, active: true } }))) throw new ServiceError('Supplier not found', 404);
}

export async function createRequest(user: Actor, raw: unknown) {
  need(user, 'finance.requests.create');
  const input = RequestSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const fund = await activeFund(tx, user.schoolId, input.fundId);
    await assertCurrencyOn(tx, user.schoolId, input.currency);
    await checkAttachments(tx, user, input);
    const requestNumber = await nextRequestNumber(tx, user.schoolId, Number(todayInHarare().slice(0, 4)));
    const r = await tx.finExpenseRequest.create({
      data: {
        schoolId: user.schoolId, requestNumber, title: input.title, type: input.type, department: input.department, justification: input.justification, fundId: fund.id, currency: input.currency,
        estimatedCents: total(input.items.map((i) => ({ quantity: i.quantity, unit: i.unit }))), neededBy: input.neededBy ? dayOf(input.neededBy) : null, supplierId: input.supplierId ?? null,
        quoteKeys: input.quoteKeys, requestedById: user.id,
      },
    });
    await tx.finExpenseRequestItem.createMany({ data: itemRows(user.schoolId, r.id, input.items) });
    await audit(tx, user, 'CREATE_EXPENSE_REQUEST', 'FinExpenseRequest', r.id, `Raised ${requestNumber}: ${input.title}`, undefined, {
      requestNumber, fundId: fund.id, currency: input.currency, estimatedCents: r.estimatedCents, lines: input.items.length, status: 'DRAFT', quotes: input.quoteKeys.length,
    });
    if (input.submit) await submitTx(tx, user, r.id);
    return { id: r.id, requestNumber };
  });
}

/** A draft can be changed by the person who raised it; once submitted it is fixed. */
export async function updateDraft(user: Actor, id: string, raw: unknown) {
  need(user, 'finance.requests.create');
  const input = RequestSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await load(tx, user.schoolId, id);
    if (r.requestedById !== user.id) throw new ServiceError('Only the person who raised a request can change it', 403);
    if (r.status !== 'DRAFT') throw new ServiceError('A submitted request cannot be edited. Cancel it and raise a new one.', 409);
    const fund = await activeFund(tx, user.schoolId, input.fundId);
    await assertCurrencyOn(tx, user.schoolId, input.currency);
    await checkAttachments(tx, user, input);
    await tx.finExpenseRequestItem.deleteMany({ where: { requestId: id } });
    await tx.finExpenseRequestItem.createMany({ data: itemRows(user.schoolId, id, input.items) });
    const sum = total(input.items.map((i) => ({ quantity: i.quantity, unit: i.unit })));
    await tx.finExpenseRequest.update({
      where: { id },
      data: { title: input.title, type: input.type, department: input.department, justification: input.justification, fundId: fund.id, currency: input.currency, estimatedCents: sum, neededBy: input.neededBy ? dayOf(input.neededBy) : null, supplierId: input.supplierId ?? null, quoteKeys: input.quoteKeys },
    });
    await audit(tx, user, 'CREATE_EXPENSE_REQUEST', 'FinExpenseRequest', id, `Changed draft ${r.requestNumber}`, { title: r.title, estimatedCents: r.estimatedCents, currency: r.currency }, { title: input.title, estimatedCents: sum, currency: input.currency });
    if (input.submit) await submitTx(tx, user, id);
    return { id };
  });
}

export async function submitRequest(user: Actor, id: string) {
  need(user, 'finance.requests.create');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await submitTx(tx, user, id);
    return { id };
  });
}

export async function deleteDraft(user: Actor, id: string) {
  need(user, 'finance.requests.create');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await load(tx, user.schoolId, id);
    if (r.requestedById !== user.id) throw new ServiceError('Only the person who raised a request can delete it', 403);
    if (r.status !== 'DRAFT') throw new ServiceError('Only a draft can be deleted', 409);
    await audit(tx, user, 'CREATE_EXPENSE_REQUEST', 'FinExpenseRequest', id, `Deleted draft ${r.requestNumber}`, { title: r.title, estimatedCents: r.estimatedCents, status: 'DRAFT' }, { deleted: true });
    await tx.finExpenseRequest.delete({ where: { id } });
    return { id };
  });
}

/** The requester withdraws a request that nobody has approved yet; it stays on record as cancelled. */
export async function cancelRequest(user: Actor, id: string) {
  need(user, 'finance.requests.create');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await load(tx, user.schoolId, id);
    if (r.requestedById !== user.id) throw new ServiceError('Only the person who raised a request can cancel it', 403);
    if (r.status !== 'PENDING') throw new ServiceError(r.status === 'DRAFT' ? 'Delete a draft instead' : 'Only a request that nobody has approved yet can be cancelled', 409);
    if (r.firstApprovedById) throw new ServiceError('The Head has already approved this request, so it can no longer be cancelled', 409);
    await tx.finExpenseRequest.update({ where: { id }, data: { status: 'CANCELLED', cancelledById: user.id, cancelledAt: new Date() } });
    await audit(tx, user, 'CANCEL_EXPENSE_REQUEST', 'FinExpenseRequest', id, `Cancelled ${r.requestNumber}`, { status: 'PENDING' }, { status: 'CANCELLED', cancelledById: user.id });
    return { id };
  });
}

async function ownerIds(tx: Db, schoolId: string, exceptUserId?: string): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: { schoolId, active: true, isSupport: false, ...(exceptUserId ? { id: { not: exceptUserId } } : {}), userRoles: { some: { role: { key: 'OWNER' } } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Does the school have anyone besides the owners (and these people) who may approve requests? */
async function otherApprovers(tx: Db, schoolId: string, except: string[]): Promise<number> {
  return tx.user.count({
    where: {
      schoolId, active: true, isSupport: false, id: { notIn: except },
      userRoles: { some: { role: { permissions: { some: { permissionKey: 'finance.requests.approve' } }, key: { not: 'OWNER' } } } },
    },
  });
}

export async function decideRequest(user: Actor, id: string, decision: 'approve' | 'reject', rawReason?: unknown) {
  need(user, 'finance.requests.approve');
  const reason = rawReason === undefined || rawReason === '' ? undefined : whySchema(3).parse(rawReason);
  if (decision === 'reject' && !reason) throw new ServiceError('Give a reason for rejecting it', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await load(tx, user.schoolId, id);
    if (r.status !== 'PENDING') throw new ServiceError(`This request is ${r.status.toLowerCase()}, so it cannot be ${decision === 'approve' ? 'approved' : 'rejected'}`, 409);
    if (r.requestedById === user.id) throw new ServiceError(`You raised this request, so someone else must ${decision} it.`, 403);

    if (decision === 'reject') {
      const moved = await tx.finExpenseRequest.updateMany({ where: { id, schoolId: user.schoolId, status: 'PENDING' }, data: { status: 'REJECTED', rejectedById: user.id, rejectedAt: new Date(), rejectionReason: reason } });
      if (moved.count !== 1) throw new ServiceError('This request was just decided by someone else', 409);
      await audit(tx, user, 'REJECT_EXPENSE_REQUEST', 'FinExpenseRequest', id, `Rejected ${r.requestNumber}: ${r.title}`, { status: 'PENDING' }, { status: 'REJECTED', decidedById: user.id, estimatedCents: r.estimatedCents, currency: r.currency, reason });
      await notifyUsers(tx, user.schoolId, [r.requestedById], { type: 'FINANCE', title: 'Request rejected', body: `${r.requestNumber}: ${r.title}`, link: `/finance/requests/${id}` });
      return { id, status: 'REJECTED' as const };
    }

    const settings = await loadFinSettings(tx, user.schoolId);
    const limit = limitFor(settings, r.currency);
    const above = limit !== null && r.estimatedCents > limit;
    if (above && !guards.isOwner(user)) {
      // The Head's approval is the first of two; the Owner's follows.
      if (r.firstApprovedById) throw new ServiceError('The Head has already approved this request. It now waits for the Owner.', 409);
      await tx.finExpenseRequest.update({ where: { id }, data: { firstApprovedById: user.id, firstApprovedAt: new Date() } });
      await audit(tx, user, 'SECOND_APPROVE_REQUEST', 'FinExpenseRequest', id, `Approved ${r.requestNumber} (first of two: above ${formatMoney(limit!, r.currency)} the Owner approves too)`, { firstApprovedById: null }, { firstApprovedById: user.id, estimatedCents: r.estimatedCents });
      await notifyUsers(tx, user.schoolId, await ownerIds(tx, user.schoolId, r.requestedById), { type: 'FINANCE', title: 'Request waits for the Owner', body: `${r.requestNumber}: ${r.title}`, link: `/finance/requests/${id}` });
      return { id, status: 'PENDING' as const, waitingFor: 'OWNER' as const };
    }
    if (above && !r.firstApprovedById && (await otherApprovers(tx, user.schoolId, [r.requestedById, user.id])) > 0) {
      throw new ServiceError(`Above ${formatMoney(limit!, r.currency)} the Head approves first and the Owner approves after. Ask the Head to approve it.`, 409);
    }
    const ceiling = r.estimatedCents + Math.floor((r.estimatedCents * settings.overrunPercent) / 100);
    const moved = await tx.finExpenseRequest.updateMany({
      where: { id, schoolId: user.schoolId, status: 'PENDING' },
      data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date(), approvedCeilingCents: ceiling },
    });
    if (moved.count !== 1) throw new ServiceError('This request was just decided by someone else', 409);
    await audit(tx, user, 'APPROVE_EXPENSE_REQUEST', 'FinExpenseRequest', id, `Approved ${r.requestNumber}: ${r.title}`, { status: 'PENDING' }, {
      status: 'APPROVED', decidedById: user.id, firstApprovedById: r.firstApprovedById, estimatedCents: r.estimatedCents, currency: r.currency, ceilingCents: ceiling,
    });
    await tellApprovers(tx, user, 'finance.requests.disburse', { title: 'Approved request to pay', body: `${r.requestNumber}: ${r.title}`, link: `/finance/requests/${id}` });
    await notifyUsers(tx, user.schoolId, [r.requestedById], { type: 'FINANCE', title: 'Request approved', body: `${r.requestNumber}: ${r.title}`, link: `/finance/requests/${id}` });
    return { id, status: 'APPROVED' as const };
  });
}

export const DisburseSchema = z.object({
  method: z.enum(METHODS),
  reference: z.string().trim().max(80).optional().transform((v) => v || undefined),
  payee: z.string().trim().max(80).optional().transform((v) => v || undefined),
  supplierId: idSchema.optional(),
  categoryId: idSchema.optional(),
  paidOn: isoDateSchema.optional(),
  receiptKey: z.string().trim().max(200).optional(),
  // What was actually paid.
  amount: amountSchema.optional(),
});

/**
 * Pays an approved request: the expense is created here, by someone who neither raised nor approved it. The actual amount may differ from the
 * approved total; more than the allowed margin over it goes back for a second approval before it can be paid.
 */
export async function disburseRequest(user: Actor, id: string, raw: unknown) {
  need(user, 'finance.requests.disburse');
  const input = DisburseSchema.parse(raw);
  const paidOn = input.paidOn ?? todayInHarare();
  if (paidOn > todayInHarare()) throw new ServiceError('The date paid cannot be in the future', 422);
  if (input.receiptKey && !proofKeyBelongsTo(input.receiptKey, user.schoolId)) throw new ServiceError('That receipt does not belong to this school', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await load(tx, user.schoolId, id);
    if (r.status !== 'APPROVED') throw new ServiceError(r.status === 'DISBURSED' ? 'This request was already paid' : 'Only an approved request can be paid', 409);
    if (r.requestedById === user.id) throw new ServiceError('You raised this request, so someone else must pay it.', 403);
    if (r.approvedById === user.id) throw new ServiceError('You approved this request, so someone else must pay it.', 403);
    const amount = input.amount ?? r.estimatedCents;
    const ceiling = r.approvedCeilingCents ?? r.estimatedCents;
    if (amount > ceiling) {
      // Too far over what was approved: remember the amount and send it back for approval; nothing is paid.
      await tx.finExpenseRequest.update({ where: { id }, data: { overrunCents: amount } });
      await audit(tx, user, 'APPROVE_OVERRUN', 'FinExpenseRequest', id, `${formatMoney(amount, r.currency)} is more than the allowed margin over ${formatMoney(r.estimatedCents, r.currency)}: sent back for approval`, { overrunCents: r.overrunCents }, { overrunCents: amount, ceilingCents: ceiling });
      await tellApprovers(tx, user, 'finance.requests.approve', { title: 'Payment above the approved amount', body: `${r.requestNumber}: ${formatMoney(amount, r.currency)} against ${formatMoney(r.estimatedCents, r.currency)}`, link: `/finance/requests/${id}` });
      return { id, needsApproval: true as const, overrunCents: amount, expenseId: null };
    }
    await activeFund(tx, user.schoolId, r.fundId);
    const settings = await loadFinSettings(tx, user.schoolId);
    const receiptAbove = r.currency === 'USD' ? settings.receiptRequiredAboveUsdCents : settings.receiptRequiredAboveZigCents;
    if (receiptAbove !== null && amount > receiptAbove && !input.receiptKey) throw new ServiceError('Upload the supplier’s receipt or invoice for a payment of this size', 422);
    const supplierId = input.supplierId ?? r.supplierId ?? null;
    if (supplierId && !(await tx.supplier.findFirst({ where: { id: supplierId, schoolId: user.schoolId } }))) throw new ServiceError('Supplier not found', 404);
    if (input.categoryId && !(await tx.expenseCategory.findFirst({ where: { id: input.categoryId, schoolId: user.schoolId } }))) throw new ServiceError('Expense category not found', 404);
    const e = await tx.finExpense.create({
      data: {
        schoolId: user.schoolId, fundId: r.fundId, category: TYPE_LABEL[r.type], categoryId: input.categoryId ?? null, supplierId, description: r.title, payee: input.payee, currency: r.currency, amountCents: amount,
        paidOn: dayOf(paidOn), method: input.method, reference: input.reference, receiptKey: input.receiptKey || null, source: 'REQUEST', requestId: r.id, recordedById: user.id,
      },
    });
    const moved = await tx.finExpenseRequest.updateMany({ where: { id, schoolId: user.schoolId, status: 'APPROVED' }, data: { status: 'DISBURSED', disbursedById: user.id, disbursedAt: new Date() } });
    if (moved.count !== 1) throw new ServiceError('This request was just paid by someone else', 409);
    await audit(tx, user, 'DISBURSE_EXPENSE_REQUEST', 'FinExpenseRequest', id, `Paid ${r.requestNumber}: ${r.title}`, { status: 'APPROVED' }, {
      status: 'DISBURSED', disbursedById: user.id, expenseId: e.id, amountCents: amount, currency: r.currency, approvedCents: r.estimatedCents, method: input.method,
    });
    await notifyUsers(tx, user.schoolId, [r.requestedById], { type: 'FINANCE', title: 'Request paid', body: `${r.requestNumber}: ${r.title}`, link: `/finance/requests/${id}` });
    return { id, needsApproval: false as const, overrunCents: null, expenseId: e.id };
  });
}

/** An approver (never the requester) allows a payment above the margin; it is then paid by someone who did not approve it. */
export async function approveOverrun(user: Actor, id: string) {
  need(user, 'finance.requests.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await load(tx, user.schoolId, id);
    if (r.status !== 'APPROVED' || !r.overrunCents) throw new ServiceError('There is no payment waiting for approval on this request', 409);
    if (r.overrunApprovedById) throw new ServiceError('The extra amount was already approved', 409);
    if (r.requestedById === user.id) throw new ServiceError('You raised this request, so someone else must approve the extra amount.', 403);
    await tx.finExpenseRequest.update({ where: { id }, data: { overrunApprovedById: user.id, approvedCeilingCents: r.overrunCents } });
    await audit(tx, user, 'APPROVE_OVERRUN', 'FinExpenseRequest', id, `Approved paying up to ${formatMoney(r.overrunCents, r.currency)} on ${r.requestNumber}`, { ceilingCents: r.approvedCeilingCents }, { ceilingCents: r.overrunCents, overrunApprovedById: user.id });
    await tellApprovers(tx, user, 'finance.requests.disburse', { title: 'Request can now be paid', body: `${r.requestNumber}: ${r.title}`, link: `/finance/requests/${id}` });
    return { id, ceilingCents: r.overrunCents };
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export interface RequestRow {
  id: string;
  requestNumber: string;
  title: string;
  type: (typeof REQUEST_TYPES)[number];
  department: string;
  fundId: string;
  fundName: string;
  currency: Cur;
  estimatedCents: number;
  paidCents: number | null;
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISBURSED' | 'CANCELLED';
  requestedBy: string | null;
  requestedById: string;
  approvedBy: string | null;
  approvedById: string | null;
  firstApprovedBy: string | null;
  paidBy: string | null;
  neededBy: string | null;
  createdAt: string;
  rejectionReason: string | null;
}

const seesAll = (user: Actor) => holds(user, 'finance.requests.view') || holds(user, 'finance.requests.approve') || holds(user, 'finance.requests.disburse');

export async function listRequests(user: Actor, f: { status?: RequestRow['status']; mine?: boolean; fundId?: string; page?: number; pageSize?: number } = {}) {
  need(user, 'finance.requests.view', 'finance.requests.create', 'finance.requests.approve', 'finance.requests.disburse');
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(5000, Math.max(1, f.pageSize ?? 50));
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const own = f.mine || !seesAll(user);
    // Other people's drafts are theirs alone.
    const where: Prisma.FinExpenseRequestWhereInput = {
      schoolId: user.schoolId, ...(f.status ? { status: f.status } : {}), ...(f.fundId ? { fundId: f.fundId } : {}),
      ...(own ? { requestedById: user.id } : { OR: [{ status: { not: 'DRAFT' } }, { requestedById: user.id }] }),
    };
    const [totalCount, rows] = await Promise.all([
      tx.finExpenseRequest.count({ where }),
      tx.finExpenseRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { fund: { select: { name: true } }, expense: { select: { amountCents: true } } } }),
    ]);
    const names = await nameMap(tx, user.schoolId, rows.flatMap((r) => [r.requestedById, r.approvedById, r.disbursedById, r.firstApprovedById]));
    const out: RequestRow[] = rows.map((r) => ({
      id: r.id, requestNumber: r.requestNumber, title: r.title, type: r.type, department: r.department, fundId: r.fundId, fundName: r.fund.name, currency: r.currency, estimatedCents: r.estimatedCents,
      paidCents: r.expense?.amountCents ?? null, status: r.status, requestedBy: nameOf(names, r.requestedById), requestedById: r.requestedById, approvedBy: nameOf(names, r.approvedById),
      approvedById: r.approvedById, firstApprovedBy: nameOf(names, r.firstApprovedById), paidBy: nameOf(names, r.disbursedById), neededBy: r.neededBy ? ymd(r.neededBy) : null,
      createdAt: r.createdAt.toISOString(), rejectionReason: r.rejectionReason,
    }));
    return { rows: out, total: totalCount, page, pageSize };
  });
}

export async function getRequest(user: Actor, id: string) {
  need(user, 'finance.requests.view', 'finance.requests.create', 'finance.requests.approve', 'finance.requests.disburse');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await load(tx, user.schoolId, id);
    // A draft is private to the person who is writing it; a person with only "raise" sees only their own.
    if ((r.status === 'DRAFT' || !seesAll(user)) && r.requestedById !== user.id) throw new ServiceError('Request not found', 404);
    const names = await nameMap(tx, user.schoolId, [r.requestedById, r.approvedById, r.rejectedById, r.disbursedById, r.firstApprovedById, r.overrunApprovedById, r.cancelledById]);
    const settings = await loadFinSettings(tx, user.schoolId);
    const limit = limitFor(settings, r.currency);
    const supplier = r.supplierId ? await tx.supplier.findFirst({ where: { id: r.supplierId }, select: { name: true } }) : null;
    const budget = seesAll(user) ? await fundBudgetView(tx, user.schoolId, r.fundId, r.currency) : null;
    return {
      id: r.id, requestNumber: r.requestNumber, title: r.title, type: r.type, department: r.department, justification: r.justification, fundId: r.fundId, fundName: r.fund.name, currency: r.currency as Cur,
      estimatedCents: r.estimatedCents, status: r.status, createdAt: r.createdAt.toISOString(), submittedAt: r.submittedAt?.toISOString() ?? null, requestedById: r.requestedById,
      requestedBy: nameOf(names, r.requestedById), approvedBy: nameOf(names, r.approvedById), approvedById: r.approvedById, firstApprovedBy: nameOf(names, r.firstApprovedById), firstApprovedById: r.firstApprovedById,
      rejectedBy: nameOf(names, r.rejectedById), rejectionReason: r.rejectionReason, paidBy: nameOf(names, r.disbursedById), paidAt: r.disbursedAt?.toISOString() ?? null, paidCents: r.expense?.amountCents ?? null,
      expenseId: r.expense?.id ?? null, neededBy: r.neededBy ? ymd(r.neededBy) : null, supplierId: r.supplierId, supplierName: supplier?.name ?? null, quoteKeys: r.quoteKeys,
      ceilingCents: r.approvedCeilingCents, overrunCents: r.overrunCents, overrunApprovedBy: nameOf(names, r.overrunApprovedById), cancelledBy: nameOf(names, r.cancelledById),
      needsOwner: limit !== null && r.estimatedCents > limit, headLimitCents: limit,
      budget,
      items: r.items.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, unitCents: i.unitCents, totalCents: i.totalCents })),
    };
  });
}

export type { Method };
