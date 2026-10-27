// Assets and maintenance: the register (a tag and a QR label for each), registering from a purchase request so the cost is never retyped,
// transfers the new custodian confirms, recurring service and fault reports, disposal (the Head approves, the Owner too above the school's
// limit, and only once), straight-line depreciation and the annual verification round.
//
// A disposed asset is never changed again and an asset can only be disposed of once; the database says so as well.
import { z } from 'zod';
import type { FacAssetCondition, FacAssetStatus, FacDisposalMethod, Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import * as guards from '@/lib/access/guards';
import { proofKeyBelongsTo } from '@/lib/proof-of-payment';
import { notifyUsers } from '@/lib/system/notifications';
import {
  addDays, assertPartOn, audit, centsSchema, currencySchema, idSchema, isoDateSchema, isoOf, loadFacSettings, need, nextFacNumber, optText, padNumber, tellApprovers, textSchema, todayInHarare, toDay, type Actor, type Cur,
} from '@/lib/facilities/common';
import { recordFacilityExpense } from '@/lib/facilities/money';
import { bookValueCents, dueSoon, nextDue } from '@/lib/facilities/asset-math';

export const DEFAULT_CATEGORIES: { name: string; years: number | null }[] = [
  { name: 'Furniture', years: 10 }, { name: 'ICT', years: 3 }, { name: 'Laboratory', years: 10 }, { name: 'Kitchen', years: 8 }, { name: 'Vehicles', years: 5 },
  { name: 'Buildings', years: null }, { name: 'Sports', years: 5 }, { name: 'Agriculture', years: 8 }, { name: 'Other', years: null },
];
export const CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR'] as const;
export const EDITABLE_STATUS = ['IN_USE', 'IN_STORAGE', 'UNDER_REPAIR', 'LOST'] as const;
export const METHODS = ['SOLD', 'SCRAPPED', 'DONATED', 'STOLEN', 'LOST'] as const;

const ANY = ['facilities.assets.view', 'facilities.assets.manage', 'facilities.assets.maintain', 'facilities.assets.dispose', 'facilities.assets.verify'] as const;
const viewer = (user: Actor) => need(user, ...ANY);
const asOfNow = () => new Date();

// ─── Categories ──────────────────────────────────────────────────────────────

async function ensureCategories(tx: Db, schoolId: string) {
  if ((await tx.facAssetCategory.count({ where: { schoolId } })) === 0) {
    await tx.facAssetCategory.createMany({ data: DEFAULT_CATEGORIES.map((c) => ({ schoolId, name: c.name, depreciationYears: c.years })), skipDuplicates: true });
  }
  return tx.facAssetCategory.findMany({ where: { schoolId }, orderBy: { name: 'asc' } });
}

export async function listCategories(user: Actor) {
  viewer(user);
  return getScopedDb(user.schoolId, user.id).$tx((tx) => ensureCategories(tx, user.schoolId));
}

export const CategorySchema = z.object({ id: idSchema.optional(), name: textSchema('the category', 2, 60), depreciationYears: z.number().int().min(1).max(100).nullable().optional(), active: z.boolean().optional() });

export async function saveCategory(user: Actor, raw: unknown) {
  need(user, 'facilities.assets.manage');
  const v = CategorySchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureCategories(tx, user.schoolId);
    if (await tx.facAssetCategory.findFirst({ where: { schoolId: user.schoolId, name: v.name, ...(v.id ? { id: { not: v.id } } : {}) }, select: { id: true } })) throw new ServiceError(`There is already a category called ${v.name}`, 409);
    if (!v.id) {
      const c = await tx.facAssetCategory.create({ data: { schoolId: user.schoolId, name: v.name, depreciationYears: v.depreciationYears ?? null } });
      await audit(tx, user, 'FAC_ASSET_SAVE', 'FacAssetCategory', c.id, `Added the asset category ${v.name}`, undefined, { name: v.name, depreciationYears: v.depreciationYears ?? null });
      return { id: c.id };
    }
    const before = await tx.facAssetCategory.findFirst({ where: { id: v.id, schoolId: user.schoolId } });
    if (!before) throw new ServiceError('Category not found', 404);
    await tx.facAssetCategory.update({ where: { id: v.id }, data: { name: v.name, depreciationYears: v.depreciationYears === undefined ? before.depreciationYears : v.depreciationYears, active: v.active ?? before.active } });
    await audit(tx, user, 'FAC_ASSET_SAVE', 'FacAssetCategory', v.id, `Changed the asset category ${v.name}`, { name: before.name, depreciationYears: before.depreciationYears }, { name: v.name, depreciationYears: v.depreciationYears ?? before.depreciationYears });
    return { id: v.id };
  });
}

// ─── Registering ─────────────────────────────────────────────────────────────

const AssetFields = {
  name: textSchema('the name', 2, 120),
  categoryId: idSchema,
  location: textSchema('where it is', 1, 80),
  custodianId: idSchema.nullable().optional(),
  costCents: z.number().int().min(0).max(2_000_000_000).default(0),
  currency: currencySchema.default('USD'),
  purchasedAt: isoDateSchema.nullable().optional(),
  supplierId: idSchema.nullable().optional(),
  requestId: idSchema.nullable().optional(),
  expenseId: idSchema.nullable().optional(),
  condition: z.enum(CONDITIONS).default('NEW'),
  serial: optText(80),
  warrantyEnd: isoDateSchema.nullable().optional(),
  photoKey: optText(200),
  notes: optText(500),
};

export const RegisterSchema = z.object({ ...AssetFields, count: z.number().int().min(1).max(500).default(1) });

async function checkLinks(tx: Db, schoolId: string, v: { categoryId: string; custodianId?: string | null; supplierId?: string | null; photoKey?: string }) {
  if (!(await tx.facAssetCategory.findFirst({ where: { id: v.categoryId, schoolId, active: true }, select: { id: true } }))) throw new ServiceError('Asset category not found', 404);
  if (v.custodianId && !(await tx.employee.findFirst({ where: { id: v.custodianId, schoolId }, select: { id: true } }))) throw new ServiceError('Custodian not found', 404);
  if (v.supplierId && !(await tx.supplier.findFirst({ where: { id: v.supplierId, schoolId }, select: { id: true } }))) throw new ServiceError('Supplier not found', 404);
  if (v.photoKey && !proofKeyBelongsTo(v.photoKey, schoolId)) throw new ServiceError('That photo does not belong to this school', 422);
}

async function newTag(tx: Db, schoolId: string): Promise<string> {
  return `AST-${padNumber(await nextFacNumber(tx, schoolId, 'AST'))}`;
}

/** Adds one asset, or many identical ones (120 desks) each with its own tag. */
export async function registerAsset(user: Actor, raw: unknown) {
  need(user, 'facilities.assets.manage');
  const v = RegisterSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureCategories(tx, user.schoolId);
    await checkLinks(tx, user.schoolId, v);
    const tags: string[] = [];
    for (let i = 0; i < v.count; i++) {
      const tag = await newTag(tx, user.schoolId);
      const a = await tx.facAsset.create({
        data: {
          schoolId: user.schoolId, tag, name: v.name, categoryId: v.categoryId, location: v.location, custodianId: v.custodianId ?? null, costCents: v.costCents, currency: v.currency,
          purchasedAt: v.purchasedAt ? toDay(v.purchasedAt) : null, supplierId: v.supplierId ?? null, requestId: v.requestId ?? null, expenseId: v.expenseId ?? null, condition: v.condition as FacAssetCondition,
          serial: v.count === 1 ? v.serial ?? null : null, warrantyEnd: v.warrantyEnd ? toDay(v.warrantyEnd) : null, photoKey: v.photoKey ?? null, notes: v.notes ?? null,
        },
      });
      tags.push(a.tag);
      if (v.count === 1) await audit(tx, user, 'FAC_ASSET_SAVE', 'FacAsset', a.id, `Registered ${a.tag}: ${v.name} in ${v.location}`, undefined, { tag: a.tag, name: v.name, location: v.location, costCents: v.costCents, currency: v.currency, custodianId: v.custodianId ?? null });
    }
    if (v.count > 1) await audit(tx, user, 'FAC_ASSET_SAVE', 'FacAsset', tags[0]!, `Registered ${v.count} × ${v.name} (${tags[0]} to ${tags[tags.length - 1]}) in ${v.location}`, undefined, { count: v.count, first: tags[0], last: tags[tags.length - 1], name: v.name, costCents: v.costCents, currency: v.currency });
    return { tags };
  });
}

/** Approved and paid purchase requests with their lines and how many of each have been registered (so a line is registered once per unit). */
export async function requestsToRegister(user: Actor) {
  need(user, 'facilities.assets.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const reqs = await tx.finExpenseRequest.findMany({ where: { schoolId: user.schoolId, status: 'DISBURSED' }, include: { items: { orderBy: { id: 'asc' } }, expense: { select: { id: true } } }, orderBy: { createdAt: 'desc' }, take: 60 });
    const done = await tx.facAsset.groupBy({ by: ['requestItemId'], where: { schoolId: user.schoolId, requestItemId: { not: null } }, _count: true });
    const count = new Map(done.map((d) => [d.requestItemId!, d._count]));
    return reqs.map((r) => ({
      id: r.id, requestNumber: r.requestNumber, title: r.title, currency: r.currency as Cur, expenseId: r.expense?.id ?? null, supplierId: r.supplierId,
      lines: r.items.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unitCents: l.unitCents, registered: count.get(l.id) ?? 0, remaining: Math.max(0, l.quantity - (count.get(l.id) ?? 0)) })),
    })).filter((r) => r.lines.some((l) => l.remaining > 0));
  });
}

export const FromRequestSchema = z.object({
  requestItemId: idSchema, count: z.number().int().min(1).max(500), name: optText(120), categoryId: idSchema, location: textSchema('where it is', 1, 80),
  custodianId: idSchema.nullable().optional(), condition: z.enum(CONDITIONS).default('NEW'), warrantyEnd: isoDateSchema.nullable().optional(), photoKey: optText(200), notes: optText(500),
});

/** Registers what a paid purchase request bought: cost, supplier, date and the request itself are filled in from the disbursement. */
export async function registerFromRequest(user: Actor, raw: unknown) {
  need(user, 'facilities.assets.manage');
  const v = FromRequestSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const line = await tx.finExpenseRequestItem.findFirst({ where: { id: v.requestItemId, schoolId: user.schoolId }, include: { request: { include: { expense: { select: { id: true, paidOn: true } } } } } });
    if (!line) throw new ServiceError('Purchase request line not found', 404);
    const req = line.request;
    if (req.status !== 'DISBURSED') throw new ServiceError(`${req.requestNumber} has not been paid yet, so its items cannot be registered`, 409);
    const already = await tx.facAsset.count({ where: { schoolId: user.schoolId, requestItemId: line.id } });
    if (already + v.count > line.quantity) throw new ServiceError(`${line.description}: ${line.quantity} were bought and ${already} are already registered, so ${Math.max(0, line.quantity - already)} can still be added`, 409);
    await ensureCategories(tx, user.schoolId);
    await checkLinks(tx, user.schoolId, { categoryId: v.categoryId, custodianId: v.custodianId, supplierId: req.supplierId, photoKey: v.photoKey });
    const tags: string[] = [];
    for (let i = 0; i < v.count; i++) {
      const tag = await newTag(tx, user.schoolId);
      await tx.facAsset.create({
        data: {
          schoolId: user.schoolId, tag, name: v.name ?? line.description, categoryId: v.categoryId, location: v.location, custodianId: v.custodianId ?? null, costCents: line.unitCents, currency: req.currency,
          purchasedAt: req.expense?.paidOn ?? req.disbursedAt ?? null, supplierId: req.supplierId, requestId: req.id, requestItemId: line.id, expenseId: req.expense?.id ?? null,
          condition: v.condition as FacAssetCondition, warrantyEnd: v.warrantyEnd ? toDay(v.warrantyEnd) : null, photoKey: v.photoKey ?? null, notes: v.notes ?? null,
        },
      });
      tags.push(tag);
    }
    await audit(tx, user, 'FAC_ASSET_SAVE', 'FacAsset', tags[0]!, `Registered ${v.count} × ${v.name ?? line.description} from ${req.requestNumber} (${tags[0]} to ${tags[tags.length - 1]})`, undefined, { requestId: req.id, requestItemId: line.id, count: v.count, costCents: line.unitCents, currency: req.currency, first: tags[0], last: tags[tags.length - 1] });
    return { tags, requestNumber: req.requestNumber, unitCents: line.unitCents, currency: req.currency as Cur };
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export interface AssetRow {
  id: string; tag: string; name: string; category: string; categoryId: string; location: string; custodianId: string | null; custodian: string | null; costCents: number; currency: Cur;
  bookCents: number; condition: string; status: string; serial: string | null; purchasedAt: string | null; warrantyEnd: string | null; photoKey: string | null; notes: string | null; requestId: string | null;
}

const empName = (e: { firstName: string; surname: string } | undefined) => (e ? `${e.firstName} ${e.surname}` : null);

async function rows(tx: Db, schoolId: string, where: Prisma.FacAssetWhereInput, take = 200, skip = 0): Promise<AssetRow[]> {
  const [assets, cats] = await Promise.all([
    tx.facAsset.findMany({ where: { schoolId, ...where }, orderBy: [{ location: 'asc' }, { tag: 'asc' }], take, skip }),
    tx.facAssetCategory.findMany({ where: { schoolId } }),
  ]);
  const emps = await tx.employee.findMany({ where: { id: { in: assets.map((a) => a.custodianId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, surname: true } });
  const now = asOfNow();
  return assets.map((a) => {
    const c = cats.find((x) => x.id === a.categoryId);
    return {
      id: a.id, tag: a.tag, name: a.name, category: c?.name ?? '', categoryId: a.categoryId, location: a.location, custodianId: a.custodianId, custodian: empName(emps.find((e) => e.id === a.custodianId)),
      costCents: a.costCents, currency: a.currency as Cur, bookCents: bookValueCents(a.costCents, a.purchasedAt ?? a.createdAt, c?.depreciationYears ?? null, now), condition: a.condition, status: a.status,
      serial: a.serial, purchasedAt: a.purchasedAt ? isoOf(a.purchasedAt) : null, warrantyEnd: a.warrantyEnd ? isoOf(a.warrantyEnd) : null, photoKey: a.photoKey, notes: a.notes, requestId: a.requestId,
    };
  });
}

export async function listAssets(user: Actor, f: { q?: string; categoryId?: string; location?: string; custodianId?: string; status?: string; page?: number } = {}) {
  viewer(user);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureCategories(tx, user.schoolId);
    const where: Prisma.FacAssetWhereInput = {
      ...(f.categoryId ? { categoryId: f.categoryId } : {}), ...(f.location ? { location: { equals: f.location, mode: 'insensitive' } } : {}), ...(f.custodianId ? { custodianId: f.custodianId } : {}),
      ...(f.status ? { status: f.status as FacAssetStatus } : { status: { not: 'DISPOSED' as const } }),
      ...(f.q ? { OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { tag: { contains: f.q, mode: 'insensitive' } }, { serial: { contains: f.q, mode: 'insensitive' } }] } : {}),
    };
    const [total, list, categories, locations] = await Promise.all([
      tx.facAsset.count({ where: { schoolId: user.schoolId, ...where } }), rows(tx, user.schoolId, where, 50, ((f.page ?? 1) - 1) * 50),
      tx.facAssetCategory.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' } }),
      tx.facAsset.findMany({ where: { schoolId: user.schoolId }, distinct: ['location'], select: { location: true }, orderBy: { location: 'asc' } }),
    ]);
    return { total, rows: list, categories, locations: locations.map((l) => l.location) };
  });
}

/** An asset found by the QR label on it (its tag). */
export async function findByTag(user: Actor, tag: string) {
  viewer(user);
  const t = tag.trim().toUpperCase();
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.facAsset.findFirst({ where: { schoolId: user.schoolId, tag: t }, select: { id: true } });
    if (!a) throw new ServiceError('No asset has that tag', 404);
    return (await rows(tx, user.schoolId, { id: a.id }))[0]!;
  });
}

export async function getAsset(user: Actor, id: string) {
  viewer(user);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const found = await rows(tx, user.schoolId, { id });
    const asset = found[0];
    if (!asset) throw new ServiceError('Asset not found', 404);
    const [transfers, jobs, schedules, disposal, request, people] = await Promise.all([
      tx.facAssetTransfer.findMany({ where: { schoolId: user.schoolId, assetId: id }, orderBy: { createdAt: 'desc' } }),
      tx.facMaintenanceJob.findMany({ where: { schoolId: user.schoolId, assetId: id }, orderBy: { createdAt: 'desc' } }),
      tx.facMaintenanceSchedule.findMany({ where: { schoolId: user.schoolId, assetId: id }, orderBy: { nextDueAt: 'asc' } }),
      tx.facAssetDisposal.findFirst({ where: { schoolId: user.schoolId, assetId: id } }),
      tx.facDisposalRequest.findFirst({ where: { schoolId: user.schoolId, assetId: id, status: 'PENDING' } }),
      tx.employee.findMany({ where: { schoolId: user.schoolId }, select: { id: true, firstName: true, surname: true } }),
    ]);
    const nm = (eid: string | null) => empName(people.find((p) => p.id === eid));
    const users = await tx.user.findMany({ where: { id: { in: [...transfers.map((t) => t.recordedById), ...jobs.map((j) => j.reportedById)] } }, select: { id: true, fullName: true } });
    const un = (uid: string) => users.find((u) => u.id === uid)?.fullName ?? '';
    return {
      asset,
      transfers: transfers.map((t) => ({ id: t.id, fromLocation: t.fromLocation, toLocation: t.toLocation, from: nm(t.fromCustodianId), to: nm(t.toCustodianId), toCustodianId: t.toCustodianId, date: isoOf(t.date), recordedBy: un(t.recordedById), confirmedAt: t.confirmedAt?.toISOString() ?? null })),
      jobs: jobs.map((j) => ({ id: j.id, problem: j.problem, status: j.status, reportedBy: un(j.reportedById), workDone: j.workDone, provider: j.provider, costCents: j.costCents, currency: j.currency as Cur | null, doneAt: j.doneAt?.toISOString() ?? null, createdAt: j.createdAt.toISOString() })),
      schedules: schedules.map((s) => ({ id: s.id, title: s.title, everyMonths: s.everyMonths, everyKm: s.everyKm, nextDueAt: s.nextDueAt ? isoOf(s.nextDueAt) : null, nextDueKm: s.nextDueKm, active: s.active })),
      disposal: disposal ? { method: disposal.method, reason: disposal.reason, date: isoOf(disposal.date), proceedsCents: disposal.proceedsCents, currency: disposal.currency as Cur | null } : null,
      pendingDisposal: request ? { id: request.id, method: request.method, needsOwner: request.needsOwner, headApproved: !!request.headApprovedById, ownerApproved: !!request.ownerApprovedById, requestedById: request.requestedById } : null,
    };
  });
}

// ─── Changing an asset ───────────────────────────────────────────────────────

export const UpdateSchema = z.object({
  id: idSchema, name: textSchema('the name', 2, 120).optional(), condition: z.enum(CONDITIONS).optional(), status: z.enum(EDITABLE_STATUS).optional(), serial: optText(80), warrantyEnd: isoDateSchema.nullable().optional(),
  photoKey: optText(200), notes: optText(500), categoryId: idSchema.optional(),
});

export async function updateAsset(user: Actor, raw: unknown) {
  need(user, 'facilities.assets.manage');
  const v = UpdateSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.facAsset.findFirst({ where: { id: v.id, schoolId: user.schoolId } });
    if (!a) throw new ServiceError('Asset not found', 404);
    if (a.status === 'DISPOSED') throw new ServiceError('A disposed asset cannot be changed', 409);
    if (v.photoKey && !proofKeyBelongsTo(v.photoKey, user.schoolId)) throw new ServiceError('That photo does not belong to this school', 422);
    if (v.categoryId && !(await tx.facAssetCategory.findFirst({ where: { id: v.categoryId, schoolId: user.schoolId }, select: { id: true } }))) throw new ServiceError('Asset category not found', 404);
    const data: Prisma.FacAssetUncheckedUpdateInput = {
      ...(v.name ? { name: v.name } : {}), ...(v.condition ? { condition: v.condition } : {}), ...(v.status ? { status: v.status } : {}), ...(v.serial !== undefined ? { serial: v.serial } : {}),
      ...(v.warrantyEnd !== undefined ? { warrantyEnd: v.warrantyEnd ? toDay(v.warrantyEnd) : null } : {}), ...(v.photoKey ? { photoKey: v.photoKey } : {}), ...(v.notes !== undefined ? { notes: v.notes } : {}),
      ...(v.categoryId ? { categoryId: v.categoryId } : {}),
    };
    if (Object.keys(data).length === 0) throw new ServiceError('Nothing to change', 422);
    await tx.facAsset.update({ where: { id: a.id }, data });
    await audit(tx, user, 'FAC_ASSET_SAVE', 'FacAsset', a.id, `Changed ${a.tag}`, { name: a.name, condition: a.condition, status: a.status, serial: a.serial, notes: a.notes } as never, { name: v.name ?? a.name, condition: v.condition ?? a.condition, status: v.status ?? a.status, serial: v.serial ?? a.serial, notes: v.notes ?? a.notes } as never);
    return { id: a.id };
  });
}

// ─── Transfers ───────────────────────────────────────────────────────────────

export const TransferSchema = z.object({ assetId: idSchema, toLocation: textSchema('the new place', 1, 80).optional(), toCustodianId: idSchema.nullable().optional(), date: isoDateSchema.optional() });

/** Moves an asset to another place or custodian. The history keeps from, to, date and who recorded it; the new custodian confirms on their phone. */
export async function transferAsset(user: Actor, raw: unknown) {
  need(user, 'facilities.assets.manage');
  const v = TransferSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.facAsset.findFirst({ where: { id: v.assetId, schoolId: user.schoolId } });
    if (!a) throw new ServiceError('Asset not found', 404);
    if (a.status === 'DISPOSED') throw new ServiceError('A disposed asset cannot be moved', 409);
    const toLocation = v.toLocation ?? a.location;
    const toCustodian = v.toCustodianId === undefined ? a.custodianId : v.toCustodianId;
    if (toLocation === a.location && toCustodian === a.custodianId) throw new ServiceError('Nothing is changing: choose a new place or a new custodian', 422);
    if (toCustodian && !(await tx.employee.findFirst({ where: { id: toCustodian, schoolId: user.schoolId }, select: { id: true, userId: true } }))) throw new ServiceError('Custodian not found', 404);
    const custodianChanges = toCustodian !== a.custodianId && !!toCustodian;
    const t = await tx.facAssetTransfer.create({
      data: {
        schoolId: user.schoolId, assetId: a.id, fromLocation: a.location, toLocation, fromCustodianId: a.custodianId, toCustodianId: toCustodian, date: toDay(v.date ?? todayInHarare()), recordedById: user.id,
        // A move with no new custodian needs nobody's confirmation.
        confirmedAt: custodianChanges ? null : new Date(), confirmedById: custodianChanges ? null : user.id,
      },
    });
    await tx.facAsset.update({ where: { id: a.id }, data: { location: toLocation, custodianId: toCustodian } });
    if (custodianChanges) {
      const e = await tx.employee.findUniqueOrThrow({ where: { id: toCustodian! }, select: { userId: true } });
      if (e.userId) await notifyUsers(tx, user.schoolId, [e.userId], { title: `Please confirm you have received ${a.tag}`, body: `${a.name}, now at ${toLocation}`, link: '/facilities/assets/mine' });
    }
    await audit(tx, user, 'FAC_ASSET_TRANSFER', 'FacAsset', a.id, `${a.tag} moved from ${a.location} to ${toLocation}`, { location: a.location, custodianId: a.custodianId }, { location: toLocation, custodianId: toCustodian, transferId: t.id } as never);
    return { transferId: t.id, needsConfirmation: custodianChanges };
  });
}

/** The new custodian confirms, on their phone, that they hold the asset. */
export async function confirmTransfer(user: Actor, transferId: string) {
  need(user, 'facilities.assets.view', 'facilities.assets.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const t = await tx.facAssetTransfer.findFirst({ where: { id: transferId, schoolId: user.schoolId } });
    if (!t) throw new ServiceError('Transfer not found', 404);
    if (t.confirmedAt) throw new ServiceError('This transfer was already confirmed', 409);
    const me = await tx.employee.findFirst({ where: { schoolId: user.schoolId, userId: user.id }, select: { id: true } });
    if (!me || me.id !== t.toCustodianId) throw new ServiceError('Only the person it was handed to can confirm they have it', 403);
    await tx.facAssetTransfer.update({ where: { id: t.id }, data: { confirmedAt: new Date(), confirmedById: user.id } });
    const a = await tx.facAsset.findUniqueOrThrow({ where: { id: t.assetId }, select: { tag: true } });
    await audit(tx, user, 'FAC_ASSET_CONFIRM', 'FacAssetTransfer', t.id, `${a.tag} confirmed received at ${t.toLocation}`, { confirmedAt: null }, { confirmedAt: new Date().toISOString() } as never);
    return { id: t.id };
  });
}

/** The assets handed to me that I have not confirmed, and the assets I look after. */
export async function myAssets(user: Actor) {
  need(user, 'facilities.assets.view', 'facilities.assets.manage', 'facilities.assets.maintain', 'facilities.assets.dispose', 'facilities.assets.verify');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const me = await tx.employee.findFirst({ where: { schoolId: user.schoolId, userId: user.id }, select: { id: true } });
    if (!me) return { pending: [], held: [] };
    const [pending, held] = await Promise.all([
      tx.facAssetTransfer.findMany({ where: { schoolId: user.schoolId, toCustodianId: me.id, confirmedAt: null }, orderBy: { createdAt: 'desc' } }),
      rows(tx, user.schoolId, { custodianId: me.id, status: { not: 'DISPOSED' } }),
    ]);
    const assets = await tx.facAsset.findMany({ where: { id: { in: pending.map((p) => p.assetId) } }, select: { id: true, tag: true, name: true } });
    return { pending: pending.map((p) => ({ id: p.id, tag: assets.find((a) => a.id === p.assetId)?.tag ?? '', name: assets.find((a) => a.id === p.assetId)?.name ?? '', toLocation: p.toLocation })), held };
  });
}

// ─── Maintenance ─────────────────────────────────────────────────────────────

export const ScheduleSchema = z.object({
  id: idSchema.optional(), assetId: idSchema, title: textSchema('what is serviced', 2, 120), everyMonths: z.number().int().min(1).max(240).nullable().optional(), everyKm: z.number().int().min(100).max(1_000_000).nullable().optional(),
  remindDaysBefore: z.number().int().min(0).max(180).default(14), lastDoneAt: isoDateSchema.nullable().optional(), lastDoneKm: z.number().int().min(0).nullable().optional(), active: z.boolean().default(true),
}).refine((v) => v.everyMonths || v.everyKm, { message: 'Say how often: every so many months, or every so many kilometres' });

async function odometerOf(tx: Db, schoolId: string, assetId: string): Promise<number | null> {
  return (await tx.facVehicle.findFirst({ where: { schoolId, assetId }, select: { odometerKm: true } }))?.odometerKm ?? null;
}

export async function saveSchedule(user: Actor, raw: unknown) {
  need(user, 'facilities.assets.maintain', 'facilities.assets.manage');
  const v = ScheduleSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.facAsset.findFirst({ where: { id: v.assetId, schoolId: user.schoolId }, select: { id: true, tag: true, status: true } });
    if (!a) throw new ServiceError('Asset not found', 404);
    if (a.status === 'DISPOSED') throw new ServiceError('A disposed asset has no service schedule', 409);
    const km = v.lastDoneKm ?? (await odometerOf(tx, user.schoolId, a.id));
    const due = nextDue({ everyMonths: v.everyMonths ?? null, everyKm: v.everyKm ?? null }, { date: v.lastDoneAt ?? todayInHarare(), km });
    const data = { assetId: a.id, title: v.title, everyMonths: v.everyMonths ?? null, everyKm: v.everyKm ?? null, remindDaysBefore: v.remindDaysBefore, lastDoneAt: v.lastDoneAt ? toDay(v.lastDoneAt) : null, lastDoneKm: v.lastDoneKm ?? null, nextDueAt: due.dueAt ? toDay(due.dueAt) : null, nextDueKm: due.dueKm, active: v.active };
    if (v.id) {
      if (!(await tx.facMaintenanceSchedule.findFirst({ where: { id: v.id, schoolId: user.schoolId }, select: { id: true } }))) throw new ServiceError('Schedule not found', 404);
      await tx.facMaintenanceSchedule.update({ where: { id: v.id }, data });
    }
    const s = v.id ? { id: v.id } : await tx.facMaintenanceSchedule.create({ data: { schoolId: user.schoolId, ...data } });
    await audit(tx, user, 'FAC_MAINTENANCE', 'FacMaintenanceSchedule', s.id, `${a.tag}: ${v.title} ${v.everyMonths ? `every ${v.everyMonths} months` : ''}${v.everyMonths && v.everyKm ? ' or ' : ''}${v.everyKm ? `every ${v.everyKm} km` : ''}`, undefined, { title: v.title, everyMonths: v.everyMonths ?? null, everyKm: v.everyKm ?? null, nextDueAt: due.dueAt, nextDueKm: due.dueKm } as never);
    return { id: s.id, nextDueAt: due.dueAt, nextDueKm: due.dueKm };
  });
}

export const FaultSchema = z.object({ assetId: idSchema, problem: textSchema('the problem', 3, 500), photoKey: optText(200) });

/** Any member of staff reports a fault with an asset: what is wrong, and a photo. The bursar is told. */
export async function reportFault(user: Actor, raw: unknown) {
  const v = FaultSchema.parse(raw);
  if (user.readOnly) throw new ServiceError('Looking is allowed, changing is not, for this account', 403);
  if (v.photoKey && !proofKeyBelongsTo(v.photoKey, user.schoolId)) throw new ServiceError('That photo does not belong to this school', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await assertPartOn(tx, user.schoolId, 'assets');
    const staff = await tx.employee.findFirst({ where: { schoolId: user.schoolId, userId: user.id }, select: { id: true } });
    if (!staff) throw new ServiceError('Faults are reported by members of staff', 403);
    const a = await tx.facAsset.findFirst({ where: { id: v.assetId, schoolId: user.schoolId } });
    if (!a) throw new ServiceError('Asset not found', 404);
    if (a.status === 'DISPOSED') throw new ServiceError('That asset has been disposed of', 409);
    const j = await tx.facMaintenanceJob.create({ data: { schoolId: user.schoolId, assetId: a.id, problem: v.problem, photoKey: v.photoKey ?? null, reportedById: user.id } });
    await audit(tx, user, 'FAC_MAINTENANCE', 'FacMaintenanceJob', j.id, `Fault reported on ${a.tag} (${a.name}): ${v.problem}`, undefined, { assetId: a.id, problem: v.problem });
    await tellApprovers(tx, user, 'facilities.assets.maintain', { title: `Fault reported: ${a.name} (${a.tag})`, body: v.problem.slice(0, 200), link: `/facilities/assets/${a.id}` });
    return { id: j.id };
  });
}

/** The bursar assigns a fault to someone (or to themselves) to see to. */
export async function assignJob(user: Actor, jobId: string, raw: unknown) {
  need(user, 'facilities.assets.maintain');
  const { assignedToId } = z.object({ assignedToId: idSchema }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const j = await tx.facMaintenanceJob.findFirst({ where: { id: jobId, schoolId: user.schoolId } });
    if (!j) throw new ServiceError('Fault not found', 404);
    if (j.status === 'DONE' || j.status === 'CANCELLED') throw new ServiceError('This fault is closed', 409);
    if (!(await tx.user.findFirst({ where: { id: assignedToId, schoolId: user.schoolId, active: true }, select: { id: true } }))) throw new ServiceError('Person not found', 404);
    await tx.facMaintenanceJob.update({ where: { id: j.id }, data: { assignedToId, status: 'ASSIGNED' } });
    await tx.facAsset.updateMany({ where: { id: j.assetId, status: 'IN_USE' }, data: { status: 'UNDER_REPAIR' } });
    await audit(tx, user, 'FAC_MAINTENANCE', 'FacMaintenanceJob', j.id, 'Assigned a fault to be seen to', { assignedToId: j.assignedToId, status: j.status }, { assignedToId, status: 'ASSIGNED' });
    await notifyUsers(tx, user.schoolId, [assignedToId], { title: 'A fault has been assigned to you', body: j.problem.slice(0, 200), link: `/facilities/assets/${j.assetId}` });
    return { id: j.id };
  });
}

export const CompleteSchema = z.object({
  workDone: textSchema('the work done', 3, 500), provider: optText(120), costCents: centsSchema.nullable().optional(), currency: currencySchema.nullable().optional(),
  nextServiceDate: isoDateSchema.nullable().optional(), receiptKey: optText(200),
}).refine((v) => (v.costCents == null) === (v.currency == null), { message: 'A cost needs its currency', path: ['currency'] });

/** Records the work done, who did it and what it cost (the cost becomes a Finance expense), and the next service date. */
export async function completeJob(user: Actor, jobId: string, raw: unknown) {
  need(user, 'facilities.assets.maintain');
  const v = CompleteSchema.parse(raw);
  if (v.receiptKey && !proofKeyBelongsTo(v.receiptKey, user.schoolId)) throw new ServiceError('That receipt does not belong to this school', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const j = await tx.facMaintenanceJob.findFirst({ where: { id: jobId, schoolId: user.schoolId } });
    if (!j) throw new ServiceError('Fault not found', 404);
    if (j.status === 'DONE' || j.status === 'CANCELLED') throw new ServiceError('This fault is already closed', 409);
    const a = await tx.facAsset.findUniqueOrThrow({ where: { id: j.assetId } });
    let expenseId: string | null = null;
    let expenseWhere: string = 'NONE';
    if (v.costCents) {
      const e = await recordFacilityExpense(tx, { schoolId: user.schoolId, actorId: user.id, category: 'Maintenance and repairs', description: `Repair of ${a.name} (${a.tag}): ${v.workDone}`, currency: v.currency as Cur, amountCents: v.costCents, paidOn: toDay(todayInHarare()), payee: v.provider ?? null, receiptKey: v.receiptKey ?? null });
      expenseId = e.expenseId;
      expenseWhere = e.where;
    }
    await tx.facMaintenanceJob.update({ where: { id: j.id }, data: { status: 'DONE', workDone: v.workDone, provider: v.provider ?? null, costCents: v.costCents ?? null, currency: v.currency ?? null, expenseId, doneAt: new Date(), nextServiceDate: v.nextServiceDate ? toDay(v.nextServiceDate) : null } });
    if (a.status === 'UNDER_REPAIR') await tx.facAsset.update({ where: { id: a.id }, data: { status: 'IN_USE' } });
    await markScheduleDone(tx, user.schoolId, a.id, j.scheduleId);
    await audit(tx, user, 'FAC_MAINTENANCE', 'FacMaintenanceJob', j.id, `${a.tag}: work done${v.costCents ? `, cost ${v.costCents} cents ${v.currency}` : ''}`, { status: j.status }, { status: 'DONE', costCents: v.costCents ?? null, currency: v.currency ?? null, provider: v.provider ?? null, expense: expenseWhere, expenseId, nextServiceDate: v.nextServiceDate ?? null } as never);
    return { id: j.id, expense: expenseWhere, expenseId };
  });
}

/** A service that was done: the schedule's next due date and kilometres move on. */
async function markScheduleDone(tx: Db, schoolId: string, assetId: string, scheduleId: string | null) {
  const schedules = await tx.facMaintenanceSchedule.findMany({ where: { schoolId, assetId, active: true, ...(scheduleId ? { id: scheduleId } : {}) } });
  const today = todayInHarare();
  const km = await odometerOf(tx, schoolId, assetId);
  for (const s of schedules) {
    const due = nextDue({ everyMonths: s.everyMonths, everyKm: s.everyKm }, { date: today, km });
    await tx.facMaintenanceSchedule.update({ where: { id: s.id }, data: { lastDoneAt: toDay(today), lastDoneKm: km, nextDueAt: due.dueAt ? toDay(due.dueAt) : null, nextDueKm: due.dueKm } });
  }
}

/** A recurring service done without a fault: records it and moves the schedule on. */
export async function serviceDone(user: Actor, scheduleId: string, raw: unknown) {
  need(user, 'facilities.assets.maintain');
  const v = CompleteSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.facMaintenanceSchedule.findFirst({ where: { id: scheduleId, schoolId: user.schoolId } });
    if (!s) throw new ServiceError('Schedule not found', 404);
    const a = await tx.facAsset.findUniqueOrThrow({ where: { id: s.assetId } });
    if (a.status === 'DISPOSED') throw new ServiceError('A disposed asset has no service schedule', 409);
    let expenseId: string | null = null;
    if (v.costCents) expenseId = (await recordFacilityExpense(tx, { schoolId: user.schoolId, actorId: user.id, category: 'Maintenance and repairs', description: `${s.title}: ${a.name} (${a.tag})`, currency: v.currency as Cur, amountCents: v.costCents, paidOn: toDay(todayInHarare()), payee: v.provider ?? null, receiptKey: v.receiptKey ?? null })).expenseId;
    const j = await tx.facMaintenanceJob.create({ data: { schoolId: user.schoolId, assetId: a.id, scheduleId: s.id, problem: s.title, reportedById: user.id, status: 'DONE', workDone: v.workDone, provider: v.provider ?? null, costCents: v.costCents ?? null, currency: v.currency ?? null, expenseId, doneAt: new Date(), nextServiceDate: v.nextServiceDate ? toDay(v.nextServiceDate) : null } });
    await markScheduleDone(tx, user.schoolId, a.id, s.id);
    await audit(tx, user, 'FAC_MAINTENANCE', 'FacMaintenanceJob', j.id, `${a.tag}: ${s.title} done`, undefined, { scheduleId: s.id, costCents: v.costCents ?? null, currency: v.currency ?? null, expenseId } as never);
    return { id: j.id, expenseId };
  });
}

export async function openJobs(user: Actor) {
  need(user, 'facilities.assets.maintain', 'facilities.assets.manage', 'facilities.assets.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const jobs = await tx.facMaintenanceJob.findMany({ where: { schoolId: user.schoolId, status: { in: ['REPORTED', 'ASSIGNED'] } }, orderBy: { createdAt: 'asc' } });
    const assets = await tx.facAsset.findMany({ where: { id: { in: jobs.map((j) => j.assetId) } }, select: { id: true, tag: true, name: true, location: true } });
    const users = await tx.user.findMany({ where: { id: { in: jobs.flatMap((j) => [j.reportedById, j.assignedToId ?? '']) } }, select: { id: true, fullName: true } });
    const un = (id: string | null) => users.find((u) => u.id === id)?.fullName ?? null;
    return jobs.map((j) => ({ id: j.id, assetId: j.assetId, tag: assets.find((a) => a.id === j.assetId)?.tag ?? '', asset: assets.find((a) => a.id === j.assetId)?.name ?? '', location: assets.find((a) => a.id === j.assetId)?.location ?? '', problem: j.problem, status: j.status, reportedBy: un(j.reportedById), assignedTo: un(j.assignedToId), createdAt: j.createdAt.toISOString() }));
  });
}

/** Reminders before a service is due (by date or kilometres); run every day. Each reminder is sent once per due date. */
export async function maintenanceReminders(tx: Db, schoolId: string): Promise<number> {
  const today = todayInHarare();
  const schedules = await tx.facMaintenanceSchedule.findMany({ where: { schoolId, active: true } });
  if (schedules.length === 0) return 0;
  const assets = await tx.facAsset.findMany({ where: { id: { in: schedules.map((s) => s.assetId) }, status: { not: 'DISPOSED' } }, select: { id: true, tag: true, name: true } });
  const holders = (await tx.user.findMany({
    where: { schoolId, active: true, isSupport: false, userRoles: { some: { role: { permissions: { some: { permissionKey: 'facilities.assets.maintain' } } } } } }, select: { id: true },
  })).map((u) => u.id);
  let sent = 0;
  for (const s of schedules) {
    const a = assets.find((x) => x.id === s.assetId);
    if (!a) continue;
    const km = await odometerOf(tx, schoolId, s.assetId);
    const d = dueSoon({ dueAt: s.nextDueAt ? isoOf(s.nextDueAt) : null, dueKm: s.nextDueKm }, today, s.remindDaysBefore, km);
    if (!d.byDate && !d.byKm && !d.overdue) continue;
    sent += await notifyUsers(tx, schoolId, holders, {
      title: `${d.overdue ? 'Service overdue' : 'Service due soon'}: ${s.title}, ${a.name} (${a.tag})`, body: s.nextDueAt ? `Due ${isoOf(s.nextDueAt)}${s.nextDueKm ? ` or at ${s.nextDueKm} km` : ''}` : `Due at ${s.nextDueKm} km`,
      link: `/facilities/assets/${a.id}`, dedupeKey: `asset-service:${s.id}:${s.nextDueAt ? isoOf(s.nextDueAt) : s.nextDueKm}`,
    });
  }
  return sent;
}

// ─── Disposal ────────────────────────────────────────────────────────────────

export const DisposalRequestSchema = z.object({
  assetId: idSchema, method: z.enum(METHODS), reason: textSchema('the reason', 3, 300), date: isoDateSchema.optional(),
  proceedsCents: centsSchema.nullable().optional(), currency: currencySchema.nullable().optional(),
}).refine((v) => (v.proceedsCents == null) === (v.currency == null), { message: 'Money received needs its currency', path: ['currency'] })
  .refine((v) => v.proceedsCents == null || v.method === 'SOLD', { message: 'Only a sale brings in money', path: ['proceedsCents'] });

/** Asks to dispose of an asset (sold, scrapped, donated, stolen or lost). It waits for the Head, and the Owner too above the school's value limit. */
export async function requestDisposal(user: Actor, raw: unknown) {
  need(user, 'facilities.assets.manage');
  const v = DisposalRequestSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.facAsset.findFirst({ where: { id: v.assetId, schoolId: user.schoolId } });
    if (!a) throw new ServiceError('Asset not found', 404);
    if (a.status === 'DISPOSED' || (await tx.facAssetDisposal.findFirst({ where: { assetId: a.id }, select: { id: true } }))) throw new ServiceError('This asset has already been disposed of. An asset is disposed of only once.', 409);
    if (await tx.facDisposalRequest.findFirst({ where: { assetId: a.id, status: 'PENDING' }, select: { id: true } })) throw new ServiceError('A disposal of this asset is already waiting for approval', 409);
    const s = await loadFacSettings(tx, user.schoolId);
    const limit = a.currency === 'USD' ? s.disposalOwnerLimitUsdCents : s.disposalOwnerLimitZigCents;
    const needsOwner = a.costCents > limit;
    const r = await tx.facDisposalRequest.create({
      data: {
        schoolId: user.schoolId, assetId: a.id, method: v.method as FacDisposalMethod, reason: v.reason, date: toDay(v.date ?? todayInHarare()), proceedsCents: v.proceedsCents ?? null, currency: v.currency ?? null,
        valueCents: a.costCents, valueCurrency: a.currency, needsOwner, requestedById: user.id,
      },
    });
    await audit(tx, user, 'FAC_ASSET_DISPOSE', 'FacDisposalRequest', r.id, `Asked to dispose of ${a.tag} (${a.name}): ${v.method.toLowerCase()}, ${v.reason}`, undefined, { assetId: a.id, method: v.method, costCents: a.costCents, currency: a.currency, needsOwner } as never);
    await tellApprovers(tx, user, 'facilities.assets.dispose', { title: `Asset disposal to approve: ${a.name} (${a.tag})`, body: `${v.method.toLowerCase()}: ${v.reason}`.slice(0, 200), link: '/facilities/assets/disposals' });
    return { id: r.id, needsOwner };
  });
}

export const DecideSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: optText(300) });

/**
 * The Head approves; above the school's limit the Owner approves too, and they are two different people. Nobody approves their own request.
 * The second approval makes the disposal: the asset becomes Disposed and its history is kept.
 */
export async function decideDisposal(user: Actor, id: string, raw: unknown) {
  need(user, 'facilities.assets.dispose');
  const v = DecideSchema.parse(raw);
  if (v.decision === 'REJECT' && (v.reason ?? '').trim().length < 3) throw new ServiceError('Say why the disposal is refused', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.facDisposalRequest.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!r) throw new ServiceError('Disposal request not found', 404);
    if (r.status !== 'PENDING') throw new ServiceError('This request was already decided', 409);
    guards.cannotApproveOwn(user, r.requestedById, 'disposal request');
    const a = await tx.facAsset.findUniqueOrThrow({ where: { id: r.assetId } });
    if (v.decision === 'REJECT') {
      await tx.facDisposalRequest.update({ where: { id }, data: { status: 'REJECTED', rejectedById: user.id, rejectedAt: new Date(), rejectionReason: v.reason! } });
      await audit(tx, user, 'FAC_ASSET_DISPOSE', 'FacDisposalRequest', id, `Refused the disposal of ${a.tag}: ${v.reason}`, { status: 'PENDING' }, { status: 'REJECTED', reason: v.reason ?? null });
      return { status: 'REJECTED' as const };
    }
    if (r.headApprovedById === user.id || r.ownerApprovedById === user.id) throw new ServiceError('You have already approved this. Another person must give the other approval.', 403);
    const isOwner = guards.isOwner(user);
    let head = r.headApprovedById;
    let owner = r.ownerApprovedById;
    // An Owner gives the Owner's approval when one is needed and not yet given; anyone else (or an Owner when nothing else is missing) is the Head's.
    if (isOwner && r.needsOwner && !owner) owner = user.id;
    else if (!head) head = user.id;
    else if (r.needsOwner && !owner) throw new ServiceError('The Head has approved. Above the school\'s limit the Owner must approve too.', 403);
    else throw new ServiceError('This request has all the approvals it needs', 409);
    const complete = !!head && (!r.needsOwner || !!owner);
    await tx.facDisposalRequest.update({ where: { id }, data: { headApprovedById: head, headApprovedAt: head && head === user.id ? new Date() : r.headApprovedAt, ownerApprovedById: owner, ownerApprovedAt: owner && owner === user.id ? new Date() : r.ownerApprovedAt } });
    if (!complete) {
      await audit(tx, user, 'FAC_ASSET_DISPOSE', 'FacDisposalRequest', id, `Approved the disposal of ${a.tag} (${owner === user.id ? 'Owner' : 'Head'}); waiting for the other approval`, { headApprovedById: r.headApprovedById, ownerApprovedById: r.ownerApprovedById }, { headApprovedById: head, ownerApprovedById: owner });
      if (r.needsOwner) await tellApprovers(tx, user, 'facilities.assets.dispose', { title: `Owner approval needed: disposal of ${a.name} (${a.tag})`, link: '/facilities/assets/disposals' });
      return { status: 'PENDING' as const, waitingFor: owner ? 'Head' : 'Owner' };
    }
    const d = await tx.facAssetDisposal.create({
      data: { schoolId: user.schoolId, assetId: a.id, method: r.method, reason: r.reason, date: r.date, proceedsCents: r.proceedsCents, currency: r.currency, headApprovedById: head!, ownerApprovedById: owner, recordedById: r.requestedById },
    });
    await tx.facAsset.update({ where: { id: a.id }, data: { status: 'DISPOSED' } });
    await tx.facDisposalRequest.update({ where: { id }, data: { status: 'APPROVED', disposalId: d.id } });
    await tx.facMaintenanceSchedule.updateMany({ where: { schoolId: user.schoolId, assetId: a.id }, data: { active: false } });
    await audit(tx, user, 'FAC_ASSET_DISPOSE', 'FacAsset', a.id, `${a.tag} (${a.name}) disposed of: ${r.method.toLowerCase()}`, { status: a.status }, { status: 'DISPOSED', method: r.method, reason: r.reason, proceedsCents: r.proceedsCents, currency: r.currency, headApprovedById: head, ownerApprovedById: owner, disposalId: d.id } as never);
    return { status: 'APPROVED' as const, disposalId: d.id };
  });
}

export async function listDisposals(user: Actor, status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
  need(user, 'facilities.assets.dispose', 'facilities.assets.manage', 'facilities.assets.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const reqs = await tx.facDisposalRequest.findMany({ where: { schoolId: user.schoolId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 });
    const assets = await tx.facAsset.findMany({ where: { id: { in: reqs.map((r) => r.assetId) } }, select: { id: true, tag: true, name: true } });
    const users = await tx.user.findMany({ where: { id: { in: reqs.flatMap((r) => [r.requestedById, r.headApprovedById ?? '', r.ownerApprovedById ?? '']) } }, select: { id: true, fullName: true } });
    const un = (uid: string | null) => users.find((u) => u.id === uid)?.fullName ?? null;
    return reqs.map((r) => ({
      id: r.id, assetId: r.assetId, tag: assets.find((a) => a.id === r.assetId)?.tag ?? '', asset: assets.find((a) => a.id === r.assetId)?.name ?? '', method: r.method, reason: r.reason, date: isoOf(r.date),
      proceedsCents: r.proceedsCents, currency: r.currency as Cur | null, valueCents: r.valueCents, valueCurrency: r.valueCurrency as Cur, needsOwner: r.needsOwner, status: r.status,
      requestedBy: un(r.requestedById), requestedById: r.requestedById, headApprovedBy: un(r.headApprovedById), headApprovedById: r.headApprovedById, ownerApprovedBy: un(r.ownerApprovedById), ownerApprovedById: r.ownerApprovedById, rejectionReason: r.rejectionReason,
    }));
  });
}

// ─── Annual verification ─────────────────────────────────────────────────────

export async function startRound(user: Actor, raw: unknown) {
  need(user, 'facilities.assets.verify');
  const { name } = z.object({ name: textSchema('a name', 2, 80) }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (await tx.facVerificationRound.findFirst({ where: { schoolId: user.schoolId, closedAt: null }, select: { id: true } })) throw new ServiceError('A verification round is already open. Close it first.', 409);
    const r = await tx.facVerificationRound.create({ data: { schoolId: user.schoolId, name, createdById: user.id } });
    await audit(tx, user, 'FAC_ASSET_VERIFY', 'FacVerificationRound', r.id, `Opened the verification round ${name}`, undefined, { name });
    return { id: r.id };
  });
}

export const ScanSchema = z.object({ tag: z.string().trim().min(1).max(40), location: textSchema('where you are', 1, 80) });

/** Scans a tag where the asset stands: found in its place, or found in the wrong place. */
export async function scanAsset(user: Actor, roundId: string, raw: unknown) {
  need(user, 'facilities.assets.verify');
  const v = ScanSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const round = await tx.facVerificationRound.findFirst({ where: { id: roundId, schoolId: user.schoolId } });
    if (!round) throw new ServiceError('Verification round not found', 404);
    if (round.closedAt) throw new ServiceError('This round is closed', 409);
    const a = await tx.facAsset.findFirst({ where: { schoolId: user.schoolId, tag: v.tag.toUpperCase() } });
    if (!a) throw new ServiceError('No asset has that tag', 404);
    if (a.status === 'DISPOSED') throw new ServiceError(`${a.tag} was disposed of. It should not be there.`, 409);
    const result = a.location.trim().toLowerCase() === v.location.trim().toLowerCase() ? 'FOUND' : 'WRONG_PLACE';
    const had = await tx.facVerificationScan.findFirst({ where: { roundId, assetId: a.id } });
    if (had) await tx.facVerificationScan.update({ where: { id: had.id }, data: { scannedLocation: v.location, result, scannedById: user.id, scannedAt: new Date() } });
    else await tx.facVerificationScan.create({ data: { schoolId: user.schoolId, roundId, assetId: a.id, scannedLocation: v.location, result, scannedById: user.id } });
    return { tag: a.tag, name: a.name, result, expectedLocation: a.location, already: !!had };
  });
}

/** Found, found in the wrong place, and not found (assets in service that nobody scanned). Closing the round freezes the result. */
export async function roundResult(user: Actor, roundId: string, close = false) {
  need(user, 'facilities.assets.verify', 'facilities.assets.manage', 'facilities.assets.view');
  if (close) need(user, 'facilities.assets.verify');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const round = await tx.facVerificationRound.findFirst({ where: { id: roundId, schoolId: user.schoolId } });
    if (!round) throw new ServiceError('Verification round not found', 404);
    const [scans, assets] = await Promise.all([
      tx.facVerificationScan.findMany({ where: { roundId } }),
      tx.facAsset.findMany({ where: { schoolId: user.schoolId, status: { notIn: ['DISPOSED', 'LOST'] } }, orderBy: [{ location: 'asc' }, { tag: 'asc' }], select: { id: true, tag: true, name: true, location: true } }),
    ]);
    const seen = new Map(scans.map((s) => [s.assetId, s]));
    const line = (a: (typeof assets)[number]) => ({ assetId: a.id, tag: a.tag, name: a.name, expectedLocation: a.location, scannedLocation: seen.get(a.id)?.scannedLocation ?? null });
    const found = assets.filter((a) => seen.get(a.id)?.result === 'FOUND').map(line);
    const wrong = assets.filter((a) => seen.get(a.id)?.result === 'WRONG_PLACE').map(line);
    const notFound = assets.filter((a) => !seen.has(a.id)).map(line);
    if (close && !round.closedAt) {
      await tx.facVerificationRound.update({ where: { id: roundId }, data: { closedAt: new Date() } });
      await audit(tx, user, 'FAC_ASSET_VERIFY', 'FacVerificationRound', roundId, `Closed ${round.name}: ${found.length} found, ${wrong.length} in the wrong place, ${notFound.length} not found`, { closedAt: null }, { found: found.length, wrongPlace: wrong.length, notFound: notFound.length } as never);
    }
    return { id: round.id, name: round.name, closed: !!round.closedAt || close, found, wrongPlace: wrong, notFound };
  });
}

export async function listRounds(user: Actor) {
  need(user, 'facilities.assets.verify', 'facilities.assets.manage', 'facilities.assets.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => (await tx.facVerificationRound.findMany({ where: { schoolId: user.schoolId }, orderBy: { startedAt: 'desc' }, take: 20 })).map((r) => ({ id: r.id, name: r.name, startedAt: r.startedAt.toISOString(), closed: !!r.closedAt })));
}

/** An asset found in the wrong place is moved to where it was scanned (with the transfer history). */
export async function moveToScanned(user: Actor, roundId: string, raw: unknown) {
  need(user, 'facilities.assets.verify');
  const { assetId } = z.object({ assetId: idSchema }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const scan = await tx.facVerificationScan.findFirst({ where: { roundId, assetId, schoolId: user.schoolId, result: 'WRONG_PLACE' } });
    if (!scan) throw new ServiceError('That asset was not found in the wrong place in this round', 404);
    const a = await tx.facAsset.findUniqueOrThrow({ where: { id: assetId } });
    if (a.status === 'DISPOSED') throw new ServiceError('A disposed asset cannot be moved', 409);
    await tx.facAssetTransfer.create({ data: { schoolId: user.schoolId, assetId, fromLocation: a.location, toLocation: scan.scannedLocation, fromCustodianId: a.custodianId, toCustodianId: a.custodianId, date: toDay(todayInHarare()), recordedById: user.id, confirmedAt: new Date(), confirmedById: user.id } });
    await tx.facAsset.update({ where: { id: assetId }, data: { location: scan.scannedLocation } });
    await tx.facVerificationScan.update({ where: { id: scan.id }, data: { result: 'FOUND' } });
    await audit(tx, user, 'FAC_ASSET_TRANSFER', 'FacAsset', assetId, `${a.tag} moved to ${scan.scannedLocation} after the verification round`, { location: a.location }, { location: scan.scannedLocation });
    return { assetId };
  });
}

// ─── Reports ─────────────────────────────────────────────────────────────────

type Totals = { count: number; usdCostCents: number; zigCostCents: number; usdBookCents: number; zigBookCents: number };
const zero = (): Totals => ({ count: 0, usdCostCents: 0, zigCostCents: 0, usdBookCents: 0, zigBookCents: 0 });
const add = (t: Totals, a: AssetRow) => { t.count++; if (a.currency === 'USD') { t.usdCostCents += a.costCents; t.usdBookCents += a.bookCents; } else { t.zigCostCents += a.costCents; t.zigBookCents += a.bookCents; } };

export async function assetReports(user: Actor) {
  viewer(user);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureCategories(tx, user.schoolId);
    const all = await rows(tx, user.schoolId, { status: { not: 'DISPOSED' } }, 5000);
    const group = (key: (a: AssetRow) => string) => {
      const m = new Map<string, Totals>();
      for (const a of all) { const k = key(a); const t = m.get(k) ?? zero(); add(t, a); m.set(k, t); }
      return Array.from(m).map(([name, t]) => ({ name, ...t })).sort((a, b) => a.name.localeCompare(b.name));
    };
    const total = zero();
    for (const a of all) add(total, a);
    const today = todayInHarare();
    const [schedules, jobs, disposals] = await Promise.all([
      tx.facMaintenanceSchedule.findMany({ where: { schoolId: user.schoolId, active: true } }),
      tx.facMaintenanceJob.findMany({ where: { schoolId: user.schoolId, status: 'DONE', costCents: { not: null } } }),
      tx.facAssetDisposal.findMany({ where: { schoolId: user.schoolId }, orderBy: { date: 'desc' }, take: 100 }),
    ]);
    const assetsAll = await tx.facAsset.findMany({ where: { schoolId: user.schoolId }, select: { id: true, tag: true, name: true } });
    const nm = (id: string) => assetsAll.find((a) => a.id === id);
    const dueForService = [];
    for (const s of schedules) {
      const a = all.find((x) => x.id === s.assetId);
      if (!a) continue;
      const d = dueSoon({ dueAt: s.nextDueAt ? isoOf(s.nextDueAt) : null, dueKm: s.nextDueKm }, today, s.remindDaysBefore, await odometerOf(tx, user.schoolId, s.assetId));
      if (d.byDate || d.byKm || d.overdue) dueForService.push({ scheduleId: s.id, assetId: a.id, tag: a.tag, asset: a.name, title: s.title, nextDueAt: s.nextDueAt ? isoOf(s.nextDueAt) : null, nextDueKm: s.nextDueKm, overdue: d.overdue });
    }
    const cost = new Map<string, { usd: number; zig: number; jobs: number }>();
    for (const j of jobs) { const c = cost.get(j.assetId) ?? { usd: 0, zig: 0, jobs: 0 }; if (j.currency === 'USD') c.usd += j.costCents!; else c.zig += j.costCents!; c.jobs++; cost.set(j.assetId, c); }
    return {
      total, byCategory: group((a) => a.category), byLocation: group((a) => a.location), byCustodian: group((a) => a.custodian ?? 'No custodian'),
      dueForService,
      maintenanceCost: Array.from(cost).map(([id, c]) => ({ assetId: id, tag: nm(id)?.tag ?? '', asset: nm(id)?.name ?? '', jobs: c.jobs, usdCents: c.usd, zigCents: c.zig })).sort((a, b) => b.usdCents - a.usdCents),
      disposals: disposals.map((d) => ({ tag: nm(d.assetId)?.tag ?? '', asset: nm(d.assetId)?.name ?? '', method: d.method, reason: d.reason, date: isoOf(d.date), proceedsCents: d.proceedsCents, currency: d.currency as Cur | null })),
      warrantyEnding: all.filter((a) => a.warrantyEnd && a.warrantyEnd >= today && a.warrantyEnd <= addDays(today, 60)).map((a) => ({ tag: a.tag, asset: a.name, warrantyEnd: a.warrantyEnd! })),
    };
  });
}

/** Active staff, for choosing a custodian. */
export async function staffOptions(user: Actor) {
  viewer(user);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) =>
    (await tx.employee.findMany({ where: { schoolId: user.schoolId, status: { notIn: ['RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'] } }, orderBy: [{ firstName: 'asc' }, { surname: 'asc' }], select: { id: true, firstName: true, surname: true } }))
      .map((e) => ({ id: e.id, name: `${e.firstName} ${e.surname}` })));
}
