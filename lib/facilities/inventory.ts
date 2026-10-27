// Inventory and stores: stores, items, goods received against an approved purchase request (or as a donation / opening stock with a
// reason), issues, sales to learners, transfers, stock counts and write-offs.
//
// Stock on hand is never a stored number: it is the sum of FacStockMovement rows (lib/facilities/stock-math.ts), and the database
// refuses a movement that would take an item below zero. Stock cost is the weighted average of what came in.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FacStockCategory, FacStockUnit, Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { proofKeyBelongsTo } from '@/lib/proof-of-payment';
import { recordPayment } from '@/lib/finance/payments';
import { createRequest } from '@/lib/finance/requests';
import { ensureFunds } from '@/lib/finance/common';
import {
  audit, currencySchema, idSchema, isoDateSchema, loadFacSettings, need, optText, tellApprovers, textSchema, todayInHarare, toDay, isoOf, type Actor, type Cur,
} from '@/lib/facilities/common';
import { chargeLearner, financeIsOn, type FeeItemKind } from '@/lib/facilities/money';
import { drawFirstExpiring, position, qtyOk, round3, type Position } from '@/lib/facilities/stock-math';
import { onFinance } from '@/lib/finance/external';
import { holds } from '@/lib/academics/common';

export const CATEGORIES = ['UNIFORMS', 'STATIONERY', 'FOOD', 'CLEANING', 'MEDICAL', 'AGRICULTURE', 'MAINTENANCE'] as const;
export const UNITS = ['EACH', 'BOX', 'KG', 'LITRE'] as const;
export const DEFAULT_STORES = ['Main store', 'Kitchen', 'Uniform shop', 'Stationery', 'Sick bay', 'Tuck shop', 'Agriculture'];

const ANY_VIEW = ['facilities.inventory.view', 'facilities.inventory.manage', 'facilities.inventory.receive', 'facilities.inventory.issue', 'facilities.inventory.count', 'facilities.inventory.writeoff'] as const;
const viewer = (user: Actor) => need(user, ...ANY_VIEW);

const qtySchema = z.number().positive('The quantity must be more than zero').max(1_000_000);
const costSchema = z.number().int('Costs are whole cents').min(0).max(2_000_000_000);

// ─── Reading stock ───────────────────────────────────────────────────────────

interface Mv { itemId: string; storeId: string; lotId: string | null; qty: number; unitCostCents: number; currency: Cur; createdAt: Date; type: string }

/** Every movement of the school (or of one store / item), oldest first, as the costing needs them. */
async function movements(tx: Db, schoolId: string, where: Prisma.FacStockMovementWhereInput = {}): Promise<Mv[]> {
  const rows = await tx.facStockMovement.findMany({
    where: { schoolId, ...where },
    select: { itemId: true, storeId: true, lotId: true, qty: true, unitCostCents: true, currency: true, createdAt: true, type: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows as Mv[];
}

const key = (itemId: string, storeId: string) => `${itemId}|${storeId}`;

export interface PositionRow extends Position { itemId: string; storeId: string; currency: Cur | null }

/** Quantity, value and average cost of every item in every store that has had a movement. */
export function positions(all: Mv[]): Map<string, PositionRow> {
  const groups = new Map<string, Mv[]>();
  for (const m of all) {
    const k = key(m.itemId, m.storeId);
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const out = new Map<string, PositionRow>();
  for (const [k, list] of Array.from(groups)) {
    const p = position(list);
    out.set(k, { ...p, itemId: list[0]!.itemId, storeId: list[0]!.storeId, currency: list[list.length - 1]!.currency });
  }
  return out;
}

async function positionOf(tx: Db, schoolId: string, itemId: string, storeId: string): Promise<PositionRow> {
  const list = await movements(tx, schoolId, { itemId, storeId });
  const p = position(list);
  return { ...p, itemId, storeId, currency: list.length ? list[list.length - 1]!.currency : null };
}

async function lotBalances(tx: Db, schoolId: string, itemId: string, storeId: string) {
  const [grouped, lots] = await Promise.all([
    tx.facStockMovement.groupBy({ by: ['lotId'], where: { schoolId, itemId, storeId }, _sum: { qty: true } }),
    tx.facStockLot.findMany({ where: { schoolId, itemId, storeId }, select: { id: true, expiry: true } }),
  ]);
  const expiry = new Map(lots.map((l) => [l.id, l.expiry ? isoOf(l.expiry) : null]));
  return grouped.map((g) => ({ lotId: g.lotId, expiry: g.lotId ? expiry.get(g.lotId) ?? null : null, qty: round3(g._sum.qty ?? 0) }));
}

/** Takes `qty` from the batches that expire first. Throws the reason when there is not enough. */
async function plan(tx: Db, schoolId: string, itemId: string, storeId: string, qty: number, itemName: string) {
  const lots = await lotBalances(tx, schoolId, itemId, storeId);
  const total = round3(lots.reduce((s, l) => s + l.qty, 0));
  const drawn = drawFirstExpiring(lots, total, qty);
  if (!drawn) throw new ServiceError(`Not enough ${itemName} in this store: ${total} on hand, ${qty} asked for`, 409);
  return drawn;
}

async function storeOf(tx: Db, schoolId: string, id: string) {
  const s = await tx.facStore.findFirst({ where: { id, schoolId } });
  if (!s) throw new ServiceError('Store not found', 404);
  if (!s.active) throw new ServiceError(`${s.name} is not in use`, 409);
  return s;
}

async function itemOf(tx: Db, schoolId: string, id: string) {
  const i = await tx.facStockItem.findFirst({ where: { id, schoolId } });
  if (!i) throw new ServiceError('Item not found', 404);
  if (!i.active) throw new ServiceError(`${i.name} is not in use`, 409);
  return i;
}

// ─── Stores and items ────────────────────────────────────────────────────────

async function ensureStores(tx: Db, schoolId: string) {
  if ((await tx.facStore.count({ where: { schoolId } })) === 0) {
    await tx.facStore.createMany({ data: DEFAULT_STORES.map((name) => ({ schoolId, name })), skipDuplicates: true });
  }
}

export async function listStores(user: Actor) {
  viewer(user);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureStores(tx, user.schoolId);
    const [stores, people] = await Promise.all([
      tx.facStore.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' } }),
      tx.user.findMany({ where: { schoolId: user.schoolId, active: true, isSupport: false }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
    ]);
    const name = new Map(people.map((p) => [p.id, p.fullName]));
    return { stores: stores.map((s) => ({ id: s.id, name: s.name, active: s.active, storekeeperId: s.storekeeperId, storekeeper: s.storekeeperId ? name.get(s.storekeeperId) ?? null : null })), people };
  });
}

export const StoreSchema = z.object({ id: idSchema.optional(), name: textSchema('the store name', 2, 60), storekeeperId: idSchema.nullable().optional(), active: z.boolean().optional() });

export async function saveStore(user: Actor, raw: unknown) {
  need(user, 'facilities.inventory.manage');
  const v = StoreSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (v.storekeeperId && !(await tx.user.findFirst({ where: { id: v.storekeeperId, schoolId: user.schoolId, active: true }, select: { id: true } }))) throw new ServiceError('Storekeeper not found', 404);
    if (await tx.facStore.findFirst({ where: { schoolId: user.schoolId, name: v.name, ...(v.id ? { id: { not: v.id } } : {}) }, select: { id: true } })) throw new ServiceError(`There is already a store called ${v.name}`, 409);
    if (!v.id) {
      const s = await tx.facStore.create({ data: { schoolId: user.schoolId, name: v.name, storekeeperId: v.storekeeperId ?? null } });
      await audit(tx, user, 'FAC_STORE_SAVE', 'FacStore', s.id, `Added the store ${v.name}`, undefined, { name: v.name, storekeeperId: v.storekeeperId ?? null });
      return { id: s.id };
    }
    const before = await tx.facStore.findFirst({ where: { id: v.id, schoolId: user.schoolId } });
    if (!before) throw new ServiceError('Store not found', 404);
    if (v.active === false && before.active) {
      const held = await positionsForStore(tx, user.schoolId, before.id);
      if (held.some((p) => p.qty > 0)) throw new ServiceError('This store still holds stock. Issue, transfer or write it off first.', 409);
    }
    const after = await tx.facStore.update({ where: { id: v.id }, data: { name: v.name, storekeeperId: v.storekeeperId === undefined ? before.storekeeperId : v.storekeeperId, active: v.active ?? before.active } });
    await audit(tx, user, 'FAC_STORE_SAVE', 'FacStore', v.id, `Changed the store ${v.name}`, { name: before.name, storekeeperId: before.storekeeperId, active: before.active }, { name: after.name, storekeeperId: after.storekeeperId, active: after.active });
    return { id: v.id };
  });
}

async function positionsForStore(tx: Db, schoolId: string, storeId: string) {
  return Array.from(positions(await movements(tx, schoolId, { storeId })).values());
}

export const ItemSchema = z.object({
  id: idSchema.optional(),
  name: textSchema('the item name', 2, 80),
  category: z.enum(CATEGORIES),
  unit: z.enum(UNITS).default('EACH'),
  size: optText(20),
  gender: z.enum(['M', 'F']).nullable().optional(),
  barcode: optText(60),
  reorderLevel: z.number().int().min(0).max(1_000_000).default(0),
  priceCents: costSchema.nullable().optional(),
  priceCurrency: currencySchema.nullable().optional(),
  tracksExpiry: z.boolean().default(false),
  active: z.boolean().default(true),
}).superRefine((v, ctx) => {
  if ((v.priceCents == null) !== (v.priceCurrency == null)) ctx.addIssue({ code: 'custom', message: 'A selling price needs its currency', path: ['priceCurrency'] });
});

export async function saveItem(user: Actor, raw: unknown) {
  need(user, 'facilities.inventory.manage');
  const v = ItemSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (v.barcode && await tx.facStockItem.findFirst({ where: { schoolId: user.schoolId, barcode: v.barcode, ...(v.id ? { id: { not: v.id } } : {}) }, select: { id: true } })) throw new ServiceError('Another item has that barcode', 409);
    const data = {
      name: v.name, category: v.category as FacStockCategory, unit: v.unit as FacStockUnit, size: v.size ?? null, gender: v.gender ?? null, barcode: v.barcode ?? null,
      reorderLevel: v.reorderLevel, priceCents: v.priceCents ?? null, priceCurrency: v.priceCurrency ?? null, tracksExpiry: v.tracksExpiry, active: v.active,
    };
    if (!v.id) {
      const i = await tx.facStockItem.create({ data: { schoolId: user.schoolId, ...data } });
      await audit(tx, user, 'FAC_ITEM_SAVE', 'FacStockItem', i.id, `Added the item ${v.name}`, undefined, data as never);
      return { id: i.id };
    }
    const before = await tx.facStockItem.findFirst({ where: { id: v.id, schoolId: user.schoolId } });
    if (!before) throw new ServiceError('Item not found', 404);
    if (before.unit !== data.unit && (await tx.facStockMovement.count({ where: { schoolId: user.schoolId, itemId: v.id } })) > 0) throw new ServiceError('The unit cannot change once the item has stock movements', 409);
    await tx.facStockItem.update({ where: { id: v.id }, data });
    await audit(tx, user, 'FAC_ITEM_SAVE', 'FacStockItem', v.id, `Changed the item ${v.name}`, { name: before.name, priceCents: before.priceCents, reorderLevel: before.reorderLevel, active: before.active } as never, { name: v.name, priceCents: data.priceCents, reorderLevel: data.reorderLevel, active: data.active } as never);
    return { id: v.id };
  });
}

export interface StockRow {
  itemId: string; name: string; category: FacStockCategory; unit: FacStockUnit; size: string | null; gender: string | null; barcode: string | null;
  reorderLevel: number; priceCents: number | null; priceCurrency: Cur | null; tracksExpiry: boolean; active: boolean;
  qty: number; avgCents: number; valueCents: number; costCurrency: Cur | null; low: boolean; expiringSoon: number;
}

/** The items with what each store holds. With a store: that store's stock; without: the school's total. */
export async function stockTable(user: Actor, f: { storeId?: string; q?: string; category?: string; lowOnly?: boolean } = {}): Promise<{ rows: StockRow[]; days: number }> {
  viewer(user);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const settings = await loadFacSettings(tx, user.schoolId);
    const [items, all, lots] = await Promise.all([
      tx.facStockItem.findMany({ where: { schoolId: user.schoolId, ...(f.category ? { category: f.category as FacStockCategory } : {}), ...(f.q ? { name: { contains: f.q, mode: 'insensitive' } } : {}) }, orderBy: [{ category: 'asc' }, { name: 'asc' }, { size: 'asc' }] }),
      movements(tx, user.schoolId, f.storeId ? { storeId: f.storeId } : {}),
      tx.facStockLot.findMany({ where: { schoolId: user.schoolId, ...(f.storeId ? { storeId: f.storeId } : {}), expiry: { not: null } }, select: { id: true, itemId: true, expiry: true } }),
    ]);
    const pos = positions(all);
    const horizon = new Date(toDay(todayInHarare()).getTime() + settings.expiryWarningDays * 864e5);
    const lotQty = new Map<string, number>();
    for (const m of all) if (m.lotId) lotQty.set(m.lotId, round3((lotQty.get(m.lotId) ?? 0) + m.qty));
    const rows = items.map((i): StockRow => {
      const mine = Array.from(pos.values()).filter((p) => p.itemId === i.id);
      const qty = round3(mine.reduce((s, p) => s + p.qty, 0));
      const value = mine.reduce((s, p) => s + p.valueCents, 0);
      const cur = mine.find((p) => p.currency)?.currency ?? null;
      const soon = lots.filter((l) => l.itemId === i.id && l.expiry && l.expiry <= horizon && (lotQty.get(l.id) ?? 0) > 0).length;
      return {
        itemId: i.id, name: i.name, category: i.category, unit: i.unit, size: i.size, gender: i.gender, barcode: i.barcode, reorderLevel: i.reorderLevel, priceCents: i.priceCents,
        priceCurrency: i.priceCurrency as Cur | null, tracksExpiry: i.tracksExpiry, active: i.active, qty, valueCents: value, avgCents: qty > 0 ? Math.round(value / qty) : 0,
        costCurrency: cur, low: i.active && i.reorderLevel > 0 && qty <= i.reorderLevel, expiringSoon: soon,
      };
    }).filter((r) => (f.storeId ? r.qty > 0 || r.active : true) && (!f.lowOnly || r.low));
    return { rows, days: settings.expiryWarningDays };
  });
}

/** An item found by the code on its label (its barcode), or by its exact name. */
export async function findItemByScan(user: Actor, code: string) {
  viewer(user);
  const c = code.trim();
  if (!c) throw new ServiceError('Nothing was scanned', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const i = await tx.facStockItem.findFirst({ where: { schoolId: user.schoolId, active: true, OR: [{ barcode: c }, { name: { equals: c, mode: 'insensitive' } }] }, select: { id: true, name: true, size: true, unit: true } });
    if (!i) throw new ServiceError('No item has that barcode', 404);
    return i;
  });
}

// ─── Goods received ──────────────────────────────────────────────────────────

/** Approved purchase requests with what is still to be delivered on each line (receipts fill their lines in). */
export async function requestsToReceive(user: Actor) {
  need(user, 'facilities.inventory.receive');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const reqs = await tx.finExpenseRequest.findMany({
      where: { schoolId: user.schoolId, status: { in: ['APPROVED', 'DISBURSED'] } },
      include: { items: { orderBy: { id: 'asc' } } }, orderBy: { createdAt: 'desc' }, take: 60,
    });
    const got = await tx.facStockMovement.groupBy({ by: ['requestItemId'], where: { schoolId: user.schoolId, type: 'IN', requestItemId: { not: null } }, _sum: { qty: true } });
    const received = new Map(got.map((g) => [g.requestItemId!, g._sum.qty ?? 0]));
    return reqs.map((r) => ({
      id: r.id, requestNumber: r.requestNumber, title: r.title, currency: r.currency as Cur, status: r.status,
      lines: r.items.map((l) => ({ id: l.id, description: l.description, ordered: l.quantity, unitCents: l.unitCents, received: received.get(l.id) ?? 0, outstanding: Math.max(0, l.quantity - (received.get(l.id) ?? 0)) })),
    })).filter((r) => r.lines.some((l) => l.outstanding > 0));
  });
}

const ReceiveLine = z.object({
  itemId: idSchema, qty: z.number().min(0).max(1_000_000), unitCostCents: costSchema, requestItemId: idSchema.optional(),
  damagedQty: z.number().min(0).max(1_000_000).default(0), expiry: isoDateSchema.optional(), shortfallNote: optText(300),
});

export const ReceiveSchema = z.object({
  storeId: idSchema,
  purchaseRequestId: idSchema.optional(),
  reason: optText(300),
  currency: currencySchema.optional(),
  deliveryNote: optText(60),
  photoKey: optText(200),
  lines: z.array(ReceiveLine).min(1, 'Add at least one line').max(60),
});

/**
 * Takes goods into a store. Against an approved purchase request the lines fill in from the request; the storekeeper enters what was
 * actually delivered, the delivery note number and a photo, and anything short or damaged is noted for the bursar. A donation or opening
 * stock has no request and must say why.
 */
export async function receiveStock(user: Actor, raw: unknown) {
  need(user, 'facilities.inventory.receive');
  const v = ReceiveSchema.parse(raw);
  if (v.photoKey && !proofKeyBelongsTo(v.photoKey, user.schoolId)) throw new ServiceError('That photo does not belong to this school', 422);
  if (!v.purchaseRequestId && (v.reason ?? '').trim().length < 3) throw new ServiceError('Goods without a purchase request (a donation, opening stock) need a reason', 422);
  if (v.purchaseRequestId && !v.deliveryNote) throw new ServiceError('Enter the delivery note number', 422);
  if (v.lines.every((l) => l.qty === 0 && l.damagedQty === 0)) throw new ServiceError('Enter what was delivered', 422);

  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const store = await storeOf(tx, user.schoolId, v.storeId);
    let request: Awaited<ReturnType<typeof loadRequest>> | null = null;
    if (v.purchaseRequestId) request = await loadRequest(tx, user.schoolId, v.purchaseRequestId);
    const currency = (request ? request.currency : v.currency ?? 'USD') as Cur;
    const outstanding = new Map<string, number>();
    if (request) {
      const got = await tx.facStockMovement.groupBy({ by: ['requestItemId'], where: { schoolId: user.schoolId, type: 'IN', purchaseRequestId: request.id }, _sum: { qty: true } });
      const have = new Map(got.map((g) => [g.requestItemId, g._sum.qty ?? 0]));
      for (const l of request.items) outstanding.set(l.id, l.quantity - (have.get(l.id) ?? 0));
    }

    const made: { movementId: string; itemId: string; qty: number }[] = [];
    const notes: string[] = [];
    for (const line of v.lines) {
      const item = await itemOf(tx, user.schoolId, line.itemId);
      for (const q of [line.qty, line.damagedQty]) if (q > 0 && !qtyOk(item.unit, q)) throw new ServiceError(`${item.name} is counted in whole ${item.unit.toLowerCase()}s`, 422);
      if (request) {
        if (!line.requestItemId || !outstanding.has(line.requestItemId)) throw new ServiceError(`${item.name}: choose the line of the purchase request it fills in`, 422);
        const left = outstanding.get(line.requestItemId)!;
        if (line.qty + line.damagedQty > left + 1e-9) throw new ServiceError(`${item.name}: only ${left} still to be delivered on that line`, 422);
        const short = left - line.qty - line.damagedQty;
        if ((short > 1e-9 || line.damagedQty > 0) && (line.shortfallNote ?? '').trim().length < 3) throw new ServiceError(`${item.name}: say what was short or damaged`, 422);
        if (short > 1e-9 || line.damagedQty > 0) notes.push(`${item.name}: ${line.qty} accepted${line.damagedQty ? `, ${line.damagedQty} damaged` : ''}${short > 1e-9 ? `, ${round3(short)} still to come` : ''}. ${line.shortfallNote}`);
        outstanding.set(line.requestItemId, short);
      } else if (line.requestItemId) throw new ServiceError('A request line was named but no purchase request was chosen', 422);
      if (line.qty === 0) continue;
      if (item.tracksExpiry && !line.expiry) throw new ServiceError(`${item.name}: enter the expiry date`, 422);
      const pool = await positionOf(tx, user.schoolId, item.id, store.id);
      if (pool.qty > 0 && pool.currency && pool.currency !== currency) throw new ServiceError(`${item.name} in ${store.name} is costed in ${pool.currency}; receive it in ${pool.currency}, or use up the stock first`, 409);
      let lotId: string | null = null;
      if (item.tracksExpiry) {
        const expiry = toDay(line.expiry!);
        const lot = (await tx.facStockLot.findFirst({ where: { schoolId: user.schoolId, itemId: item.id, storeId: store.id, expiry } })) ?? (await tx.facStockLot.create({ data: { schoolId: user.schoolId, itemId: item.id, storeId: store.id, expiry } }));
        lotId = lot.id;
      }
      const m = await tx.facStockMovement.create({
        data: {
          schoolId: user.schoolId, itemId: item.id, storeId: store.id, lotId, type: 'IN', qty: line.qty, unitCostCents: line.unitCostCents, currency,
          purchaseRequestId: request?.id ?? null, requestItemId: line.requestItemId ?? null, deliveryNote: v.deliveryNote ?? null, photoKey: v.photoKey ?? null,
          reason: v.reason ?? (request ? `Delivery against ${request.requestNumber}` : null), shortfallNote: line.shortfallNote ?? null, createdById: user.id,
        },
        select: { id: true },
      });
      made.push({ movementId: m.id, itemId: item.id, qty: line.qty });
    }
    await audit(tx, user, 'FAC_STOCK_RECEIVE', 'FacStore', store.id,
      request ? `Received goods into ${store.name} against ${request.requestNumber} (delivery note ${v.deliveryNote})` : `Received goods into ${store.name} without a purchase request: ${v.reason}`,
      undefined, { storeId: store.id, purchaseRequestId: request?.id ?? null, deliveryNote: v.deliveryNote ?? null, reason: v.reason ?? null, lines: made.map((m) => ({ itemId: m.itemId, qty: m.qty })), shortfalls: notes } as never);
    if (notes.length > 0) {
      await tellApprovers(tx, user, 'finance.requests.disburse', { title: `Short or damaged delivery: ${request?.requestNumber ?? store.name}`, body: notes.join(' | ').slice(0, 400), link: request ? `/finance/requests/${request.id}` : '/facilities/inventory' });
    }
    return { received: made, shortfalls: notes };
  });
}

async function loadRequest(tx: Db, schoolId: string, id: string) {
  const r = await tx.finExpenseRequest.findFirst({ where: { id, schoolId }, include: { items: true } });
  if (!r) throw new ServiceError('Purchase request not found', 404);
  if (r.status !== 'APPROVED' && r.status !== 'DISBURSED') throw new ServiceError(`${r.requestNumber} is not approved yet, so nothing can be received against it`, 409);
  return r;
}

// ─── Stock out ───────────────────────────────────────────────────────────────

export const IssueSchema = z.object({
  storeId: idSchema, itemId: idSchema, qty: qtySchema,
  receiverName: textSchema('who received it', 2, 80), receiverEmployeeId: idSchema.optional(), department: optText(80), signatureKey: optText(200), note: optText(200),
});

/** Issues stock to a department, a member of staff or the kitchen. The receiver signs on the phone. */
export async function issueStock(user: Actor, raw: unknown) {
  need(user, 'facilities.inventory.issue');
  const v = IssueSchema.parse(raw);
  if (v.signatureKey && !proofKeyBelongsTo(v.signatureKey, user.schoolId)) throw new ServiceError('That signature does not belong to this school', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const [store, item] = await Promise.all([storeOf(tx, user.schoolId, v.storeId), itemOf(tx, user.schoolId, v.itemId)]);
    if (!qtyOk(item.unit, v.qty)) throw new ServiceError(`${item.name} is counted in whole ${item.unit.toLowerCase()}s`, 422);
    if (v.receiverEmployeeId && !(await tx.employee.findFirst({ where: { id: v.receiverEmployeeId, schoolId: user.schoolId }, select: { id: true } }))) throw new ServiceError('Employee not found', 404);
    const pool = await positionOf(tx, user.schoolId, item.id, store.id);
    const drawn = await plan(tx, user.schoolId, item.id, store.id, v.qty, item.name);
    const ids: string[] = [];
    for (const d of drawn) {
      const m = await tx.facStockMovement.create({
        data: {
          schoolId: user.schoolId, itemId: item.id, storeId: store.id, lotId: d.lotId, type: 'ISSUE', qty: -d.qty, unitCostCents: pool.avgCents, currency: pool.currency ?? 'USD',
          receiverName: v.receiverName, receiverEmployeeId: v.receiverEmployeeId ?? null, department: v.department ?? null, signatureKey: v.signatureKey ?? null, reason: v.note ?? null, createdById: user.id,
        },
        select: { id: true },
      });
      ids.push(m.id);
    }
    await audit(tx, user, 'FAC_STOCK_ISSUE', 'FacStockItem', item.id, `Issued ${v.qty} ${item.name} from ${store.name} to ${v.receiverName}${v.department ? ` (${v.department})` : ''}`, undefined, { storeId: store.id, qty: v.qty, receiver: v.receiverName, department: v.department ?? null, movements: ids } as never);
    return { movements: ids };
  });
}

export const SellSchema = z.object({
  storeId: idSchema, studentId: idSchema,
  lines: z.array(z.object({ itemId: idSchema, qty: z.number().int().min(1).max(1000) })).min(1).max(30),
  // Paid now: through Finance as a cash payment (or settled on the ledger where Finance is off). Otherwise charged to the learner's account.
  payment: z.enum(['NOW', 'ACCOUNT']).default('ACCOUNT'),
});

/** Sells uniforms, stationery and the like to a learner: stock goes out and the cost becomes a charge (never a second balance). */
export async function sellStock(user: Actor, raw: unknown) {
  need(user, 'facilities.inventory.issue');
  const v = SellSchema.parse(raw);
  const finance = await getScopedDb(user.schoolId, user.id).$tx((tx) => financeIsOn(tx, user.schoolId));
  const retired = finance && (await getScopedDb(user.schoolId, user.id).$tx((tx) => onFinance(tx, user.schoolId)));
  if (v.payment === 'NOW' && retired && !holds(user, 'finance.payments.record')) throw new ServiceError('Taking payment on the spot needs permission to record payments in Finance. Charge it to the learner\'s account instead.', 403);

  const sale = await getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const store = await storeOf(tx, user.schoolId, v.storeId);
    const merged = new Map<string, number>();
    for (const l of v.lines) merged.set(l.itemId, (merged.get(l.itemId) ?? 0) + l.qty);
    const items = await Promise.all(Array.from(merged.keys()).map((id) => itemOf(tx, user.schoolId, id)));
    let currency: Cur | null = null;
    let total = 0;
    for (const i of items) {
      if (i.priceCents == null || !i.priceCurrency) throw new ServiceError(`${i.name} has no selling price`, 422);
      if (currency && currency !== i.priceCurrency) throw new ServiceError('The items are priced in different currencies. Sell them separately.', 422);
      currency = i.priceCurrency as Cur;
      total += i.priceCents * merged.get(i.id)!;
    }
    if (total <= 0) throw new ServiceError('There is nothing to charge for', 422);
    const kind: FeeItemKind = items.every((i) => i.category === 'UNIFORMS') ? 'UNIFORM' : 'STATIONERY';
    const what = items.map((i) => `${merged.get(i.id)} × ${i.name}${i.size ? ` (${i.size})` : ''}`).join(', ');
    const description = `${kind === 'UNIFORM' ? 'Uniform' : 'Stationery'}: ${what}`.slice(0, 200);
    const charge = await chargeLearner(tx, { schoolId: user.schoolId, actorId: user.id, studentId: v.studentId, part: 'INVENTORY', kind, description, currency: currency!, amountCents: total, sourceType: 'FacStockSale', sourceId: randomUUID() });
    const ids: string[] = [];
    for (const i of items) {
      const qty = merged.get(i.id)!;
      const pool = await positionOf(tx, user.schoolId, i.id, store.id);
      const drawn = await plan(tx, user.schoolId, i.id, store.id, qty, i.name);
      for (const d of drawn) {
        const m = await tx.facStockMovement.create({
          data: {
            schoolId: user.schoolId, itemId: i.id, storeId: store.id, lotId: d.lotId, type: 'SALE', qty: -d.qty, unitCostCents: pool.avgCents, currency: pool.currency ?? currency!,
            studentId: v.studentId, chargeId: charge.chargeId, ledgerEntryId: charge.ledgerEntryId, createdById: user.id,
          },
          select: { id: true },
        });
        ids.push(m.id);
      }
    }
    // Finance is off: paying on the spot settles the ledger entry straight away.
    if (v.payment === 'NOW' && charge.where === 'LEDGER' && charge.ledgerEntryId) {
      await tx.facLedgerEntry.update({ where: { id: charge.ledgerEntryId }, data: { status: 'SETTLED', settledAt: new Date() } });
    }
    await audit(tx, user, 'FAC_STOCK_SELL', 'FacStockItem', items[0]!.id, `Sold to a learner from ${store.name}: ${what} (${total} cents ${currency})`, undefined, {
      studentId: v.studentId, storeId: store.id, totalCents: total, currency, charge: charge.where, chargeId: charge.chargeId, ledgerEntryId: charge.ledgerEntryId, payment: v.payment, movements: ids,
    } as never);
    const fundId = charge.chargeId ? (await tx.finCharge.findUnique({ where: { id: charge.chargeId }, select: { fundId: true } }))?.fundId ?? null : null;
    return { totalCents: total, currency: currency!, chargedTo: charge.where, chargeId: charge.chargeId, ledgerEntryId: charge.ledgerEntryId, movements: ids, fundId };
  });

  // Paid now, through Finance: a cash payment against that charge, with its official receipt. If it cannot be recorded the charge stays
  // on the learner's account and the screen says so.
  let paid = v.payment === 'NOW' && sale.chargedTo === 'LEDGER';
  let paymentError: string | null = null;
  if (v.payment === 'NOW' && sale.chargedTo === 'FINANCE') {
    try {
      await recordPayment(user, { studentId: v.studentId, currency: sale.currency, method: 'CASH', chargeId: sale.chargeId, lines: [{ fundId: sale.fundId, amount: sale.totalCents / 100 }] });
      paid = true;
    } catch (e) {
      paymentError = e instanceof Error ? e.message : 'The payment could not be recorded';
    }
  }
  if (v.payment === 'NOW' && sale.chargedTo === 'LEGACY') paymentError = 'This school records payments on the older accounting screens. The charge is on the learner\'s account; record the payment there.';
  return { ...sale, paid, paymentError };
}

export const TransferSchema = z.object({ fromStoreId: idSchema, toStoreId: idSchema, itemId: idSchema, qty: qtySchema, note: optText(200) });

/** Moves stock between stores at its average cost; batches with the earliest expiry go first and keep their expiry date. */
export async function transferStock(user: Actor, raw: unknown) {
  need(user, 'facilities.inventory.issue');
  const v = TransferSchema.parse(raw);
  if (v.fromStoreId === v.toStoreId) throw new ServiceError('Choose two different stores', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const [from, to, item] = await Promise.all([storeOf(tx, user.schoolId, v.fromStoreId), storeOf(tx, user.schoolId, v.toStoreId), itemOf(tx, user.schoolId, v.itemId)]);
    if (!qtyOk(item.unit, v.qty)) throw new ServiceError(`${item.name} is counted in whole ${item.unit.toLowerCase()}s`, 422);
    const pool = await positionOf(tx, user.schoolId, item.id, from.id);
    const dest = await positionOf(tx, user.schoolId, item.id, to.id);
    const currency = pool.currency ?? 'USD';
    if (dest.qty > 0 && dest.currency && dest.currency !== currency) throw new ServiceError(`${to.name} holds ${item.name} costed in ${dest.currency}; stock costed in ${currency} cannot be mixed with it`, 409);
    const drawn = await plan(tx, user.schoolId, item.id, from.id, v.qty, item.name);
    const group = randomUUID();
    const expiries = new Map((await tx.facStockLot.findMany({ where: { schoolId: user.schoolId, itemId: item.id, storeId: from.id }, select: { id: true, expiry: true } })).map((l) => [l.id, l.expiry]));
    for (const d of drawn) {
      await tx.facStockMovement.create({ data: { schoolId: user.schoolId, itemId: item.id, storeId: from.id, lotId: d.lotId, type: 'TRANSFER', qty: -d.qty, unitCostCents: pool.avgCents, currency, transferGroupId: group, reason: v.note ?? `To ${to.name}`, createdById: user.id } });
      let toLot: string | null = null;
      const expiry = d.lotId ? expiries.get(d.lotId) ?? null : null;
      if (expiry) {
        toLot = ((await tx.facStockLot.findFirst({ where: { schoolId: user.schoolId, itemId: item.id, storeId: to.id, expiry } })) ?? (await tx.facStockLot.create({ data: { schoolId: user.schoolId, itemId: item.id, storeId: to.id, expiry } }))).id;
      }
      await tx.facStockMovement.create({ data: { schoolId: user.schoolId, itemId: item.id, storeId: to.id, lotId: toLot, type: 'TRANSFER', qty: d.qty, unitCostCents: pool.avgCents, currency, transferGroupId: group, reason: v.note ?? `From ${from.name}`, createdById: user.id } });
    }
    await audit(tx, user, 'FAC_STOCK_TRANSFER', 'FacStockItem', item.id, `Moved ${v.qty} ${item.name} from ${from.name} to ${to.name}`, undefined, { fromStoreId: from.id, toStoreId: to.id, qty: v.qty, transferGroupId: group } as never);
    return { transferGroupId: group };
  });
}

// ─── Write-offs (the Head approves) ─────────────────────────────────────────

export const WriteoffSchema = z.object({ storeId: idSchema, itemId: idSchema, lotId: idSchema.optional(), qty: qtySchema, writeoffReason: z.enum(['EXPIRED', 'DAMAGED', 'STOLEN', 'OTHER']), reason: textSchema('the reason', 3, 300) });

/** Asks for stock to be written off. Nothing moves until someone with the write-off permission, who is not the asker, approves. */
export async function requestWriteoff(user: Actor, raw: unknown) {
  need(user, 'facilities.inventory.issue', 'facilities.inventory.count');
  const v = WriteoffSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const [store, item] = await Promise.all([storeOf(tx, user.schoolId, v.storeId), itemOf(tx, user.schoolId, v.itemId)]);
    if (!qtyOk(item.unit, v.qty)) throw new ServiceError(`${item.name} is counted in whole ${item.unit.toLowerCase()}s`, 422);
    if (v.lotId && !(await tx.facStockLot.findFirst({ where: { id: v.lotId, schoolId: user.schoolId, itemId: item.id, storeId: store.id }, select: { id: true } }))) throw new ServiceError('Batch not found', 404);
    const have = (await positionOf(tx, user.schoolId, item.id, store.id)).qty;
    if (v.qty > have + 1e-9) throw new ServiceError(`Only ${have} ${item.name} in ${store.name}`, 409);
    const r = await tx.facWriteoffRequest.create({ data: { schoolId: user.schoolId, storeId: store.id, itemId: item.id, lotId: v.lotId ?? null, qty: v.qty, writeoffReason: v.writeoffReason, reason: v.reason, requestedById: user.id } });
    await audit(tx, user, 'FAC_STOCK_WRITEOFF', 'FacWriteoffRequest', r.id, `Asked to write off ${v.qty} ${item.name} (${v.writeoffReason.toLowerCase()}): ${v.reason}`, undefined, { storeId: store.id, itemId: item.id, qty: v.qty, writeoffReason: v.writeoffReason, status: 'PENDING' } as never);
    await tellApprovers(tx, user, 'facilities.inventory.writeoff', { title: 'Stock write-off to approve', body: `${v.qty} ${item.name} from ${store.name}: ${v.reason}`, link: '/facilities/inventory/approvals' });
    return { id: r.id };
  });
}

export const DecideSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: optText(300) });

export async function decideWriteoff(user: Actor, id: string, raw: unknown) {
  need(user, 'facilities.inventory.writeoff');
  const v = DecideSchema.parse(raw);
  if (v.decision === 'REJECT' && (v.reason ?? '').trim().length < 3) throw new ServiceError('Say why the write-off is refused', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.facWriteoffRequest.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!r) throw new ServiceError('Write-off request not found', 404);
    if (r.status !== 'PENDING') throw new ServiceError('This request was already decided', 409);
    if (r.requestedById === user.id) throw new ServiceError('You cannot approve your own write-off. Ask the Head or another approver.', 403);
    const item = await tx.facStockItem.findUniqueOrThrow({ where: { id: r.itemId } });
    if (v.decision === 'REJECT') {
      await tx.facWriteoffRequest.update({ where: { id }, data: { status: 'REJECTED', decidedById: user.id, decidedAt: new Date(), decisionReason: v.reason! } });
      await audit(tx, user, 'FAC_STOCK_WRITEOFF', 'FacWriteoffRequest', id, `Refused the write-off of ${r.qty} ${item.name}: ${v.reason}`, { status: 'PENDING' }, { status: 'REJECTED', reason: v.reason ?? null });
      return { status: 'REJECTED' as const };
    }
    const pool = await positionOf(tx, user.schoolId, r.itemId, r.storeId);
    const drawn = r.lotId ? [{ lotId: r.lotId, qty: r.qty }] : await plan(tx, user.schoolId, r.itemId, r.storeId, r.qty, item.name);
    let first: string | null = null;
    for (const d of drawn) {
      const m = await tx.facStockMovement.create({
        data: { schoolId: user.schoolId, itemId: r.itemId, storeId: r.storeId, lotId: d.lotId, type: 'WRITEOFF', qty: -d.qty, unitCostCents: pool.avgCents, currency: pool.currency ?? 'USD', writeoffReason: r.writeoffReason, reason: r.reason, approvedById: user.id, approvedAt: new Date(), createdById: r.requestedById },
        select: { id: true },
      });
      first = first ?? m.id;
    }
    await tx.facWriteoffRequest.update({ where: { id }, data: { status: 'APPROVED', decidedById: user.id, decidedAt: new Date(), movementId: first } });
    await audit(tx, user, 'FAC_STOCK_WRITEOFF', 'FacWriteoffRequest', id, `Approved the write-off of ${r.qty} ${item.name} (${r.writeoffReason.toLowerCase()})`, { status: 'PENDING' }, { status: 'APPROVED', movementId: first, valueCents: Math.round(r.qty * pool.avgCents) } as never);
    return { status: 'APPROVED' as const };
  });
}

export async function listWriteoffs(user: Actor, status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
  need(user, 'facilities.inventory.writeoff', 'facilities.inventory.issue', 'facilities.inventory.count');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.facWriteoffRequest.findMany({ where: { schoolId: user.schoolId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 });
    const [items, stores, people] = await Promise.all([
      tx.facStockItem.findMany({ where: { id: { in: rows.map((r) => r.itemId) } }, select: { id: true, name: true, size: true } }),
      tx.facStore.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } }),
      tx.user.findMany({ where: { id: { in: rows.flatMap((r) => [r.requestedById, r.decidedById ?? '']) } }, select: { id: true, fullName: true } }),
    ]);
    const nm = (list: { id: string; name?: string; fullName?: string }[]) => new Map(list.map((x) => [x.id, x.name ?? x.fullName ?? '']));
    const iN = nm(items); const sN = nm(stores); const pN = nm(people);
    return rows.map((r) => ({
      id: r.id, item: iN.get(r.itemId) ?? '', store: sN.get(r.storeId) ?? '', qty: r.qty, writeoffReason: r.writeoffReason, reason: r.reason, status: r.status,
      requestedBy: pN.get(r.requestedById) ?? '', requestedById: r.requestedById, decidedBy: r.decidedById ? pN.get(r.decidedById) ?? '' : null, decisionReason: r.decisionReason, createdAt: r.createdAt.toISOString(),
    }));
  });
}

// ─── Stock counts ────────────────────────────────────────────────────────────

export async function startCount(user: Actor, raw: unknown) {
  need(user, 'facilities.inventory.count');
  const { storeId } = z.object({ storeId: idSchema }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const store = await storeOf(tx, user.schoolId, storeId);
    if (await tx.facStockCount.findFirst({ where: { schoolId: user.schoolId, storeId, status: { in: ['OPEN', 'SUBMITTED'] } }, select: { id: true } })) throw new ServiceError(`${store.name} already has a count in progress`, 409);
    const held = (await positionsForStore(tx, user.schoolId, storeId)).filter((p) => p.qty > 0);
    const count = await tx.facStockCount.create({ data: { schoolId: user.schoolId, storeId, createdById: user.id } });
    if (held.length > 0) await tx.facStockCountLine.createMany({ data: held.map((p) => ({ schoolId: user.schoolId, countId: count.id, itemId: p.itemId, expectedQty: p.qty })) });
    await audit(tx, user, 'FAC_STOCK_COUNT', 'FacStockCount', count.id, `Started a count of ${store.name} (${held.length} items on the sheet)`, undefined, { storeId, lines: held.length });
    return { id: count.id };
  });
}

export async function listCounts(user: Actor) {
  need(user, 'facilities.inventory.count', 'facilities.inventory.writeoff');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const [rows, stores] = await Promise.all([tx.facStockCount.findMany({ where: { schoolId: user.schoolId }, orderBy: { countedAt: 'desc' }, take: 60 }), tx.facStore.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } })]);
    const sN = new Map(stores.map((s) => [s.id, s.name]));
    return rows.map((c) => ({ id: c.id, store: sN.get(c.storeId) ?? '', status: c.status, needsApproval: c.needsApproval, countedAt: c.countedAt.toISOString(), createdById: c.createdById, submittedById: c.submittedById }));
  });
}

export async function getCount(user: Actor, id: string) {
  need(user, 'facilities.inventory.count', 'facilities.inventory.writeoff');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.facStockCount.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!c) throw new ServiceError('Count not found', 404);
    const [lines, store, all] = await Promise.all([
      tx.facStockCountLine.findMany({ where: { countId: id, schoolId: user.schoolId } }),
      tx.facStore.findUniqueOrThrow({ where: { id: c.storeId } }),
      movements(tx, user.schoolId, { storeId: c.storeId }),
    ]);
    const items = await tx.facStockItem.findMany({ where: { id: { in: lines.map((l) => l.itemId) } }, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
    const pos = positions(all);
    const byItem = new Map(lines.map((l) => [l.itemId, l]));
    return {
      id: c.id, store: store.name, status: c.status, needsApproval: c.needsApproval, createdById: c.createdById, submittedById: c.submittedById,
      lines: items.map((i) => {
        const l = byItem.get(i.id)!;
        const p = pos.get(key(i.id, c.storeId));
        const now = p?.qty ?? 0;
        const diff = l.countedQty == null ? null : round3(l.countedQty - now);
        return { itemId: i.id, name: i.name, size: i.size, unit: i.unit, expectedQty: l.expectedQty, countedQty: l.countedQty, difference: diff, valueCents: diff == null ? null : Math.round(Math.abs(diff) * (p?.avgCents ?? 0)), currency: (p?.currency ?? null) as Cur | null };
      }),
    };
  });
}

export const CountLinesSchema = z.object({ lines: z.array(z.object({ itemId: idSchema, countedQty: z.number().min(0).max(1_000_000) })).min(1).max(500) });

export async function saveCountLines(user: Actor, id: string, raw: unknown) {
  need(user, 'facilities.inventory.count');
  const v = CountLinesSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.facStockCount.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!c) throw new ServiceError('Count not found', 404);
    if (c.status !== 'OPEN') throw new ServiceError('This count was already submitted', 409);
    for (const l of v.lines) {
      const item = await itemOf(tx, user.schoolId, l.itemId);
      if (l.countedQty > 0 && !qtyOk(item.unit, l.countedQty)) throw new ServiceError(`${item.name} is counted in whole ${item.unit.toLowerCase()}s`, 422);
      const line = await tx.facStockCountLine.findFirst({ where: { countId: id, itemId: l.itemId, schoolId: user.schoolId } });
      if (line) await tx.facStockCountLine.update({ where: { id: line.id }, data: { countedQty: l.countedQty } });
      else await tx.facStockCountLine.create({ data: { schoolId: user.schoolId, countId: id, itemId: l.itemId, expectedQty: (await positionOf(tx, user.schoolId, l.itemId, c.storeId)).qty, countedQty: l.countedQty } });
    }
    return { saved: v.lines.length };
  });
}

/** Turns the counted differences into ADJUSTMENT movements (they are posted against what is on hand now). */
async function postCount(tx: Db, user: Actor, countId: string, approvedById: string | null) {
  const c = await tx.facStockCount.findUniqueOrThrow({ where: { id: countId } });
  const lines = await tx.facStockCountLine.findMany({ where: { countId, schoolId: user.schoolId, countedQty: { not: null } } });
  let posted = 0;
  for (const l of lines) {
    const pool = await positionOf(tx, user.schoolId, l.itemId, c.storeId);
    const diff = round3(l.countedQty! - pool.qty);
    if (diff === 0) continue;
    const item = await tx.facStockItem.findUniqueOrThrow({ where: { id: l.itemId } });
    const reason = `Stock count ${isoOf(c.countedAt)}: counted ${l.countedQty}, system had ${pool.qty}`;
    const base = { schoolId: user.schoolId, itemId: l.itemId, storeId: c.storeId, type: 'ADJUSTMENT' as const, unitCostCents: pool.avgCents, currency: (pool.currency ?? 'USD') as Cur, reason, countId, approvedById, approvedAt: approvedById ? new Date() : null, createdById: user.id };
    let firstId: string | null = null;
    if (diff > 0) {
      const m = await tx.facStockMovement.create({ data: { ...base, qty: diff }, select: { id: true } });
      firstId = m.id;
    } else {
      for (const d of await plan(tx, user.schoolId, l.itemId, c.storeId, -diff, item.name)) {
        const m = await tx.facStockMovement.create({ data: { ...base, lotId: d.lotId, qty: -d.qty }, select: { id: true } });
        firstId = firstId ?? m.id;
      }
    }
    await tx.facStockCountLine.update({ where: { id: l.id }, data: { movementId: firstId } });
    posted++;
  }
  return posted;
}

/** Submits the sheet. Differences worth no more than the school's limit are posted at once; above it, the Head approves first. */
export async function submitCount(user: Actor, id: string) {
  need(user, 'facilities.inventory.count');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.facStockCount.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!c) throw new ServiceError('Count not found', 404);
    if (c.status !== 'OPEN') throw new ServiceError('This count was already submitted', 409);
    const lines = await tx.facStockCountLine.findMany({ where: { countId: id, schoolId: user.schoolId, countedQty: { not: null } } });
    if (lines.length === 0) throw new ServiceError('Count at least one item before submitting', 422);
    const settings = await loadFacSettings(tx, user.schoolId);
    const all = positions(await movements(tx, user.schoolId, { storeId: c.storeId }));
    const value: Record<Cur, number> = { USD: 0, ZIG: 0 };
    for (const l of lines) {
      const p = all.get(key(l.itemId, c.storeId));
      const diff = Math.abs(round3(l.countedQty! - (p?.qty ?? 0)));
      value[(p?.currency ?? 'USD') as Cur] += Math.round(diff * (p?.avgCents ?? 0));
    }
    const needsApproval = value.USD > settings.adjustmentLimitUsdCents || value.ZIG > settings.adjustmentLimitZigCents;
    if (!needsApproval) {
      const posted = await postCount(tx, user, id, null);
      await tx.facStockCount.update({ where: { id }, data: { status: 'CLOSED', submittedAt: new Date(), submittedById: user.id, closedAt: new Date(), needsApproval: false } });
      await audit(tx, user, 'FAC_STOCK_ADJUST', 'FacStockCount', id, `Counted stock posted: ${posted} differences, worth ${value.USD} cents USD and ${value.ZIG} cents ZiG`, { status: 'OPEN' }, { status: 'CLOSED', posted, valueUsdCents: value.USD, valueZigCents: value.ZIG });
      return { status: 'CLOSED' as const, posted, valueCents: value, needsApproval: false };
    }
    await tx.facStockCount.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date(), submittedById: user.id, needsApproval: true } });
    await audit(tx, user, 'FAC_STOCK_COUNT', 'FacStockCount', id, `Submitted a count whose differences need approval (${value.USD} cents USD, ${value.ZIG} cents ZiG)`, { status: 'OPEN' }, { status: 'SUBMITTED', valueUsdCents: value.USD, valueZigCents: value.ZIG });
    await tellApprovers(tx, user, 'facilities.inventory.writeoff', { title: 'Stock count differences to approve', link: '/facilities/inventory/approvals' });
    return { status: 'SUBMITTED' as const, posted: 0, valueCents: value, needsApproval: true };
  });
}

export async function decideCount(user: Actor, id: string, raw: unknown) {
  need(user, 'facilities.inventory.writeoff');
  const v = DecideSchema.parse(raw);
  if (v.decision === 'REJECT' && (v.reason ?? '').trim().length < 3) throw new ServiceError('Say why the count is refused', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.facStockCount.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!c) throw new ServiceError('Count not found', 404);
    if (c.status !== 'SUBMITTED') throw new ServiceError('This count is not waiting for approval', 409);
    if (c.submittedById === user.id) throw new ServiceError('You cannot approve a count you submitted. Ask the Head or another approver.', 403);
    if (v.decision === 'REJECT') {
      await tx.facStockCount.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } });
      await audit(tx, user, 'FAC_STOCK_COUNT', 'FacStockCount', id, `Refused the count differences: ${v.reason}`, { status: 'SUBMITTED' }, { status: 'CLOSED', reason: v.reason ?? null });
      return { status: 'CLOSED' as const, posted: 0 };
    }
    const posted = await postCount(tx, user, id, user.id);
    await tx.facStockCount.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date(), closedAt: new Date() } });
    await audit(tx, user, 'FAC_STOCK_ADJUST', 'FacStockCount', id, `Approved the count: ${posted} differences posted`, { status: 'SUBMITTED' }, { status: 'APPROVED', posted });
    return { status: 'APPROVED' as const, posted };
  });
}

// ─── Reorder ─────────────────────────────────────────────────────────────────

/** One click: a draft purchase request in Finance for the items below their reorder level (twice the reorder level, less what is on hand). */
export async function reorderRequest(user: Actor, raw: unknown) {
  need(user, 'facilities.inventory.manage', 'facilities.inventory.receive');
  const { itemIds } = z.object({ itemIds: z.array(idSchema).min(1).max(30) }).parse(raw);
  const { rows } = await stockTable(user);
  const picked = rows.filter((r) => itemIds.includes(r.itemId) && r.low);
  if (picked.length === 0) throw new ServiceError('None of those items is below its reorder level', 409);
  const currencies = new Set(picked.map((p) => p.costCurrency ?? p.priceCurrency ?? 'USD'));
  if (currencies.size > 1) throw new ServiceError('The items are costed in different currencies. Reorder them separately.', 422);
  const currency = Array.from(currencies)[0] as Cur;
  const fund = await getScopedDb(user.schoolId, user.id).$tx(async (tx) => (await ensureFunds(tx, user.schoolId)).find((f) => f.code === 'GENERAL' && f.active) ?? null);
  if (!fund) throw new ServiceError('The school has no General fund to raise the request in', 409);
  return createRequest(user, {
    title: `Reorder: ${picked.slice(0, 3).map((p) => p.name).join(', ')}${picked.length > 3 ? ` and ${picked.length - 3} more` : ''}`,
    type: 'PURCHASE_ORDER', department: 'Stores', justification: 'These items are at or below their reorder level.', fundId: fund.id, currency,
    items: picked.map((p) => ({ description: `${p.name}${p.size ? ` (${p.size})` : ''}`, quantity: Math.max(1, Math.ceil(p.reorderLevel * 2 - p.qty)), unit: Math.max(1, p.avgCents || p.priceCents || 100) / 100 })),
  });
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export async function inventoryReports(user: Actor, f: { from?: string; to?: string } = {}) {
  viewer(user);
  const today = todayInHarare();
  const to = f.to ?? today;
  const from = f.from ?? isoOf(new Date(toDay(to).getTime() - 90 * 864e5));
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const settings = await loadFacSettings(tx, user.schoolId);
    const [items, stores, all, lots, boarders] = await Promise.all([
      tx.facStockItem.findMany({ where: { schoolId: user.schoolId } }),
      tx.facStore.findMany({ where: { schoolId: user.schoolId } }),
      tx.facStockMovement.findMany({ where: { schoolId: user.schoolId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      tx.facStockLot.findMany({ where: { schoolId: user.schoolId, expiry: { not: null } } }),
      tx.student.count({ where: { schoolId: user.schoolId, status: 'ACTIVE', boarding: 'BOARDER' } }),
    ]);
    const item = new Map(items.map((i) => [i.id, i]));
    const store = new Map(stores.map((s) => [s.id, s.name]));
    const pos = positions(all as unknown as Mv[]);

    // Stock value per store, per currency (never added across currencies).
    const valueByStore: Record<string, Record<Cur, number>> = {};
    for (const p of Array.from(pos.values())) {
      const name = store.get(p.storeId) ?? '';
      valueByStore[name] ??= { USD: 0, ZIG: 0 };
      valueByStore[name]![(p.currency ?? 'USD') as Cur] += p.valueCents;
    }

    const lowStock = Array.from(pos.values()).filter((p) => { const i = item.get(p.itemId); return i?.active && i.reorderLevel > 0 && p.qty <= i.reorderLevel; })
      .map((p) => ({ itemId: p.itemId, item: item.get(p.itemId)!.name, store: store.get(p.storeId) ?? '', qty: p.qty, reorderLevel: item.get(p.itemId)!.reorderLevel }));

    const horizon = new Date(toDay(today).getTime() + settings.expiryWarningDays * 864e5);
    const lotQty = new Map<string, number>();
    for (const m of all) if (m.lotId) lotQty.set(m.lotId, round3((lotQty.get(m.lotId) ?? 0) + m.qty));
    const expiring = lots.filter((l) => l.expiry! <= horizon && (lotQty.get(l.id) ?? 0) > 0)
      .map((l) => ({ item: item.get(l.itemId)?.name ?? '', store: store.get(l.storeId) ?? '', expiry: isoOf(l.expiry!), qty: lotQty.get(l.id)!, expired: l.expiry! < toDay(today) }))
      .sort((a, b) => a.expiry.localeCompare(b.expiry));

    const inRange = all.filter((m) => isoOf(m.createdAt) >= from && isoOf(m.createdAt) <= to);
    const usage = new Map<string, number>();
    const issues = new Map<string, number>();
    const sizes = new Map<string, number>();
    const foodWeeks = new Map<string, number>();
    for (const m of inRange) {
      const i = item.get(m.itemId);
      if (!i || m.qty >= 0) continue;
      if (m.type === 'ISSUE' || m.type === 'SALE') {
        const k = `${isoOf(m.createdAt).slice(0, 7)}|${i.name}`;
        usage.set(k, round3((usage.get(k) ?? 0) - m.qty));
      }
      if (m.type === 'ISSUE') {
        const d = m.department || m.receiverName || 'Unassigned';
        const k = `${d}|${i.name}`;
        issues.set(k, round3((issues.get(k) ?? 0) - m.qty));
        if (i.category === 'FOOD') {
          const wk = isoWeek(m.createdAt);
          foodWeeks.set(wk, round3((foodWeeks.get(wk) ?? 0) - m.qty));
        }
      }
      if (m.type === 'SALE' && i.category === 'UNIFORMS') {
        const k = `${i.name}|${i.size ?? '-'}|${i.gender ?? '-'}`;
        sizes.set(k, round3((sizes.get(k) ?? 0) - m.qty));
      }
    }
    const split = (k: string) => k.split('|');
    const variances = inRange.filter((m) => m.type === 'ADJUSTMENT' && m.countId).map((m) => ({ date: isoOf(m.createdAt), item: item.get(m.itemId)?.name ?? '', store: store.get(m.storeId) ?? '', qty: m.qty, valueCents: Math.round(Math.abs(m.qty) * m.unitCostCents), currency: m.currency as Cur }));
    return {
      from, to, boarders,
      stockValue: Object.entries(valueByStore).map(([storeName, v]) => ({ store: storeName, usdCents: v.USD, zigCents: v.ZIG })),
      lowStock, expiring, days: settings.expiryWarningDays,
      usageByMonth: Array.from(usage).map(([k, qty]) => ({ month: split(k)[0]!, item: split(k)[1]!, qty })).sort((a, b) => a.month.localeCompare(b.month) || a.item.localeCompare(b.item)),
      foodPerBoarderPerWeek: Array.from(foodWeeks).map(([week, qty]) => ({ week, qty, perBoarder: boarders > 0 ? round3(qty / boarders) : null })).sort((a, b) => a.week.localeCompare(b.week)),
      issuesByDepartment: Array.from(issues).map(([k, qty]) => ({ department: split(k)[0]!, item: split(k)[1]!, qty })).sort((a, b) => a.department.localeCompare(b.department)),
      uniformSalesBySize: Array.from(sizes).map(([k, qty]) => ({ item: split(k)[0]!, size: split(k)[1]!, gender: split(k)[2]!, qty })).sort((a, b) => a.item.localeCompare(b.item) || a.size.localeCompare(b.size)),
      countVariances: variances,
    };
  });
}

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - y0.getTime()) / 864e5 + 1) / 7)).padStart(2, '0')}`;
}

/**
 * Takes stock out of the store with this name for another part (medicine given in the sick bay, goods sold at the tuck shop). The
 * stock rules are the same as for any issue: first-expiring batches go first, nothing goes below zero, every movement is kept.
 */
export async function drawFromStore(
  tx: Db, user: Actor,
  o: { storeName: string; itemId: string; qty: number; type: 'ISSUE' | 'SALE'; receiverName?: string; studentId?: string; reason?: string; chargeId?: string | null; ledgerEntryId?: string | null },
): Promise<{ movementIds: string[]; unitCostCents: number; currency: Cur; itemName: string }> {
  await ensureStores(tx, user.schoolId);
  const store = await tx.facStore.findFirst({ where: { schoolId: user.schoolId, name: o.storeName, active: true } });
  if (!store) throw new ServiceError(`The ${o.storeName} store is not set up`, 409);
  const item = await itemOf(tx, user.schoolId, o.itemId);
  if (!qtyOk(item.unit, o.qty)) throw new ServiceError(`${item.name} is counted in whole ${item.unit.toLowerCase()}s`, 422);
  const pool = await positionOf(tx, user.schoolId, item.id, store.id);
  const drawn = await plan(tx, user.schoolId, item.id, store.id, o.qty, item.name);
  const ids: string[] = [];
  for (const d of drawn) {
    const m = await tx.facStockMovement.create({
      data: {
        schoolId: user.schoolId, itemId: item.id, storeId: store.id, lotId: d.lotId, type: o.type, qty: -d.qty, unitCostCents: pool.avgCents, currency: pool.currency ?? 'USD',
        receiverName: o.receiverName ?? null, studentId: o.studentId ?? null, reason: o.reason ?? null, chargeId: o.chargeId ?? null, ledgerEntryId: o.ledgerEntryId ?? null, createdById: user.id,
      },
      select: { id: true },
    });
    ids.push(m.id);
  }
  return { movementIds: ids, unitCostCents: pool.avgCents, currency: (pool.currency ?? 'USD') as Cur, itemName: item.name };
}

/** What a named store holds right now (items with stock only), for the sick bay and the tuck shop screens. */
export async function storeStock(tx: Db, schoolId: string, storeName: string) {
  await ensureStores(tx, schoolId);
  const store = await tx.facStore.findFirst({ where: { schoolId, name: storeName, active: true }, select: { id: true } });
  if (!store) return [];
  const [items, all] = await Promise.all([tx.facStockItem.findMany({ where: { schoolId, active: true }, orderBy: { name: 'asc' } }), movements(tx, schoolId, { storeId: store.id })]);
  const pos = positions(all);
  return items
    .map((i) => ({ itemId: i.id, name: i.name, size: i.size, unit: i.unit, barcode: i.barcode, priceCents: i.priceCents, priceCurrency: i.priceCurrency as Cur | null, reorderLevel: i.reorderLevel, qty: round3(Array.from(pos.values()).filter((p) => p.itemId === i.id).reduce((s, p) => s + p.qty, 0)) }))
    .filter((r) => r.qty > 0);
}
