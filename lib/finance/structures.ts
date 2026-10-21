// Fee setup. Three things: the funds money belongs to, the school's list of fee items (each in a fund, recurring or one-off), and the
// fee structure of a term: lines saying what each group of learners pays. The bursar prepares a structure, the Head approves it, and only an
// approved structure can be billed. After billing it is never edited: a change is a new version and the difference is billed as an adjustment.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import {
  activeFund, amountSchema, assertCurrencyOn, audit, currencySchema, ensureFunds, idSchema, need, nameMap, nameOf, resolveTerm, tellApprovers, textSchema, type Actor,
} from '@/lib/finance/common';
import { roundToDollar, type Cur } from '@/lib/finance/money';

// ─── The school's list of fee items ──────────────────────────────────────────

export interface FeeItemView { id: string; name: string; fundId: string; fundName: string; recurring: boolean; active: boolean }

export async function listCatalog(user: Actor): Promise<FeeItemView[]> {
  need(user, 'finance.fees.view', 'finance.fees.manage', 'finance.billing.run', 'finance.charges.create');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureFunds(tx, user.schoolId);
    const rows = await tx.feeItem.findMany({ where: { schoolId: user.schoolId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    const funds = new Map((await tx.fund.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } })).map((f) => [f.id, f.name]));
    return rows.map((r) => ({ id: r.id, name: r.name, fundId: r.fundId, fundName: funds.get(r.fundId) ?? '', recurring: r.recurring, active: r.active }));
  });
}

const flag = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);
export const CatalogItemSchema = z.object({ name: textSchema('a name', 1, 60), fundId: idSchema, recurring: flag.default(true), active: flag.default(true) });

export async function saveCatalogItem(user: Actor, id: string | null, raw: unknown) {
  need(user, 'finance.fees.manage');
  const input = (id ? CatalogItemSchema.partial() : CatalogItemSchema).parse(raw) as z.infer<typeof CatalogItemSchema>;
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureFunds(tx, user.schoolId);
    if (input.fundId) await activeFund(tx, user.schoolId, input.fundId);
    if (input.name && (await tx.feeItem.findFirst({ where: { schoolId: user.schoolId, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } }))) {
      throw new ServiceError(`There is already a fee item called ${input.name}`, 409);
    }
    if (!id) {
      const n = await tx.feeItem.count({ where: { schoolId: user.schoolId } });
      const r = await tx.feeItem.create({ data: { schoolId: user.schoolId, name: input.name, fundId: input.fundId, recurring: input.recurring, active: input.active, sortOrder: n } });
      await audit(tx, user, 'SAVE_FEE_CATALOG', 'FeeItem', r.id, `Added fee item ${r.name}`, undefined, { name: r.name, fundId: r.fundId, recurring: r.recurring });
      return { id: r.id };
    }
    const before = await tx.feeItem.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!before) throw new ServiceError('Fee item not found', 404);
    if (input.fundId && input.fundId !== before.fundId && (await tx.finFeeItem.count({ where: { schoolId: user.schoolId, catalogItemId: id } }))) {
      throw new ServiceError('This fee item is already used in a fee structure, so its fund cannot change. Add a new fee item.', 409);
    }
    const after = await tx.feeItem.update({ where: { id }, data: { name: input.name, fundId: input.fundId, recurring: input.recurring, active: input.active } });
    await audit(tx, user, 'SAVE_FEE_CATALOG', 'FeeItem', id, `Changed fee item ${before.name}`, { name: before.name, fundId: before.fundId, recurring: before.recurring, active: before.active }, { name: after.name, fundId: after.fundId, recurring: after.recurring, active: after.active });
    return { id };
  });
}

// ─── Fee structures ──────────────────────────────────────────────────────────

export interface LineView {
  id: string;
  catalogItemId: string | null;
  name: string;
  fundId: string;
  fundName: string;
  currency: Cur;
  amountCents: number;
  levelIds: string[];
  levelNames: string[];
  boarding: 'DAY' | 'BOARDER' | null;
  classIds: string[];
  classNames: string[];
  combinationIds: string[];
  combinationNames: string[];
  /** "Form 1 to Form 4 · day scholars" in words. */
  audience: string;
  charged: number;
}

export interface StructureView {
  id: string;
  termId: string;
  termName: string;
  termStatus: string;
  version: number;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'SUPERSEDED';
  note: string | null;
  createdBy: string | null;
  submittedBy: string | null;
  approvedBy: string | null;
  billed: boolean;
  lines: LineView[];
}

const lineLevels = (l: { levelId: string | null; levelIds: string[] }) => (l.levelIds.length ? l.levelIds : l.levelId ? [l.levelId] : []);

export async function describeLines(tx: Db, schoolId: string, lines: { id: string; catalogItemId: string | null; name: string; fundId: string; currency: Cur; amountCents: number; levelId: string | null; levelIds: string[]; boarding: 'DAY' | 'BOARDER' | null; classIds: string[]; combinationIds: string[]; _count?: { charges: number } }[]): Promise<LineView[]> {
  const [levels, classes, combos, funds] = await Promise.all([
    tx.level.findMany({ where: { schoolId }, select: { id: true, name: true, order: true } }),
    tx.schoolClass.findMany({ where: { schoolId }, select: { id: true, name: true } }),
    tx.subjectCombination.findMany({ where: { schoolId }, select: { id: true, name: true } }),
    tx.fund.findMany({ where: { schoolId }, select: { id: true, name: true } }),
  ]);
  const lv = new Map(levels.map((l) => [l.id, l]));
  const nameOfMap = (rows: { id: string; name: string }[]) => new Map(rows.map((r) => [r.id, r.name]));
  const cl = nameOfMap(classes); const cm = nameOfMap(combos); const fd = nameOfMap(funds);
  return lines.map((l) => {
    const ids = lineLevels(l);
    const levelNames = ids.map((i) => lv.get(i)?.name ?? '').filter(Boolean);
    const orders = ids.map((i) => lv.get(i)?.order ?? 0).sort((a, b) => a - b);
    const contiguous = orders.length > 1 && orders.every((o, i) => i === 0 || o === orders[i - 1]! + 1);
    const forms = ids.length === 0 ? 'All forms' : contiguous ? `${levelNames[0]} to ${levelNames[levelNames.length - 1]}` : levelNames.join(', ');
    const classNames = l.classIds.map((i) => cl.get(i) ?? '').filter(Boolean);
    const combinationNames = l.combinationIds.map((i) => cm.get(i) ?? '').filter(Boolean);
    const parts = [forms, l.boarding === 'DAY' ? 'day scholars' : l.boarding === 'BOARDER' ? 'boarders' : '', classNames.length ? classNames.join(', ') : '', combinationNames.length ? combinationNames.join(', ') : ''].filter(Boolean);
    return {
      id: l.id, catalogItemId: l.catalogItemId, name: l.name, fundId: l.fundId, fundName: fd.get(l.fundId) ?? '', currency: l.currency, amountCents: l.amountCents, levelIds: ids, levelNames,
      boarding: l.boarding, classIds: l.classIds, classNames, combinationIds: l.combinationIds, combinationNames, audience: parts.join(' · '), charged: l._count?.charges ?? 0,
    };
  });
}

async function toView(tx: Db, schoolId: string, s: { id: string; termId: string; version: number; status: StructureView['status']; note: string | null; createdById: string; submittedById: string | null; approvedById: string | null; billedAt: Date | null; lines: Parameters<typeof describeLines>[2] }): Promise<StructureView> {
  const term = await tx.academicTerm.findFirst({ where: { id: s.termId, schoolId }, select: { name: true, status: true } });
  const names = await nameMap(tx, schoolId, [s.createdById, s.submittedById, s.approvedById]);
  return {
    id: s.id, termId: s.termId, termName: term?.name ?? '', termStatus: term?.status ?? '', version: s.version, status: s.status, note: s.note, createdBy: nameOf(names, s.createdById),
    submittedBy: nameOf(names, s.submittedById), approvedBy: nameOf(names, s.approvedById), billed: !!s.billedAt, lines: await describeLines(tx, schoolId, s.lines),
  };
}

const linesInclude = { lines: { orderBy: [{ createdAt: 'asc' as const }], include: { _count: { select: { charges: true } } } } };

export async function listStructures(user: Actor, termId?: string) {
  need(user, 'finance.fees.view', 'finance.fees.manage', 'finance.fees.approve', 'finance.billing.run', 'finance.charges.create');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const rows = await tx.finFeeStructure.findMany({ where: { schoolId: user.schoolId, termId: term.id }, orderBy: { version: 'desc' }, include: linesInclude });
    const views = await Promise.all(rows.map((r) => toView(tx, user.schoolId, r as never)));
    return { term: { id: term.id, name: term.name, status: term.status }, structures: views };
  });
}

export async function getStructure(user: Actor, id: string) {
  need(user, 'finance.fees.view', 'finance.fees.manage', 'finance.fees.approve', 'finance.billing.run', 'finance.charges.create');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.finFeeStructure.findFirst({ where: { id, schoolId: user.schoolId }, include: linesInclude });
    if (!s) throw new ServiceError('Fee structure not found', 404);
    return toView(tx, user.schoolId, s as never);
  });
}

/** The approved structure of a term (the one that is billed), if there is one. */
export async function approvedStructure(tx: Db, schoolId: string, termId: string) {
  return tx.finFeeStructure.findFirst({ where: { schoolId, termId, status: 'APPROVED' }, include: { lines: { where: { active: true }, orderBy: { createdAt: 'asc' } } } });
}

export const NewStructureSchema = z.object({
  termId: idSchema.optional(),
  // Start from the approved structure of this term (a new version), or from another term's (optionally raised by a percentage).
  copyFromTermId: idSchema.optional(),
  increasePct: z.number().min(0).max(1000).optional(),
  note: z.string().trim().max(200).optional(),
});

/** Starts a draft: empty, a copy of last term's with an optional percentage increase (rounded to the nearest dollar), or a new version of this term's. */
export async function createStructure(user: Actor, raw: unknown) {
  need(user, 'finance.fees.manage');
  const input = NewStructureSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, input.termId);
    if (term.status === 'CLOSED') throw new ServiceError(`${term.name} is closed, so its fees cannot be changed`, 409);
    await ensureFunds(tx, user.schoolId);
    const existing = await tx.finFeeStructure.findMany({ where: { schoolId: user.schoolId, termId: term.id }, select: { id: true, version: true, status: true } });
    if (existing.some((e) => e.status === 'DRAFT' || e.status === 'SUBMITTED')) throw new ServiceError('There is already a fee structure being prepared for this term. Finish or delete it first.', 409);
    const version = existing.reduce((m, e) => Math.max(m, e.version), 0) + 1;

    let source: Awaited<ReturnType<typeof approvedStructure>> | null = null;
    let pct = 0;
    if (input.copyFromTermId && input.copyFromTermId !== term.id) {
      source = await approvedStructure(tx, user.schoolId, input.copyFromTermId);
      if (!source) throw new ServiceError('That term has no approved fee structure to copy', 404);
      pct = input.increasePct ?? 0;
    } else if (version > 1) {
      source = await approvedStructure(tx, user.schoolId, term.id);
    }

    const s = await tx.finFeeStructure.create({ data: { schoolId: user.schoolId, termId: term.id, version, note: input.note ?? (source ? (pct ? `Copied with a ${pct}% increase` : 'Copied') : null), createdById: user.id } });
    if (source?.lines.length) {
      await tx.finFeeItem.createMany({
        data: source.lines.map((l) => ({
          schoolId: user.schoolId, termId: term.id, structureId: s.id, catalogItemId: l.catalogItemId, levelId: l.levelId, levelIds: l.levelIds, classIds: l.classIds, combinationIds: l.combinationIds,
          boarding: l.boarding, fundId: l.fundId, name: l.name, currency: l.currency, amountCents: pct ? roundToDollar(Math.round(l.amountCents * (1 + pct / 100))) : l.amountCents, createdById: user.id,
        })),
      });
    }
    await audit(tx, user, 'SAVE_FEE_STRUCTURE', 'FinFeeStructure', s.id, `Started fee structure version ${version} for ${term.name}`, undefined, { termId: term.id, version, copiedFrom: source?.id ?? null, increasePct: pct, lines: source?.lines.length ?? 0 });
    return { id: s.id, version };
  });
}

export const LineSchema = z.object({
  catalogItemId: idSchema,
  amount: amountSchema,
  currency: currencySchema,
  levelIds: z.array(idSchema).max(10).default([]),
  boarding: z.enum(['DAY', 'BOARDER']).nullable().optional(),
  classIds: z.array(idSchema).max(60).default([]),
  combinationIds: z.array(idSchema).max(20).default([]),
});

async function draftOf(tx: Db, schoolId: string, id: string) {
  const s = await tx.finFeeStructure.findFirst({ where: { id, schoolId }, include: { lines: true } });
  if (!s) throw new ServiceError('Fee structure not found', 404);
  if (s.status !== 'DRAFT') throw new ServiceError('Only a draft fee structure can be changed. Make a new version.', 409);
  return s;
}

async function checkAudience(tx: Db, schoolId: string, a: z.infer<typeof LineSchema>) {
  if (a.levelIds.length && (await tx.level.count({ where: { schoolId, id: { in: a.levelIds } } })) !== a.levelIds.length) throw new ServiceError('Form not found', 404);
  if (a.classIds.length && (await tx.schoolClass.count({ where: { schoolId, id: { in: a.classIds } } })) !== a.classIds.length) throw new ServiceError('Class not found', 404);
  if (a.combinationIds.length && (await tx.subjectCombination.count({ where: { schoolId, id: { in: a.combinationIds } } })) !== a.combinationIds.length) throw new ServiceError('Subject combination not found', 404);
}

export async function saveLine(user: Actor, structureId: string, lineId: string | null, raw: unknown) {
  need(user, 'finance.fees.manage');
  const input = LineSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await draftOf(tx, user.schoolId, structureId);
    const item = await tx.feeItem.findFirst({ where: { id: input.catalogItemId, schoolId: user.schoolId } });
    if (!item || !item.active) throw new ServiceError('Fee item not found', 404);
    await activeFund(tx, user.schoolId, item.fundId);
    await assertCurrencyOn(tx, user.schoolId, input.currency);
    await checkAudience(tx, user.schoolId, input);
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
    const dup = s.lines.find((l) => l.id !== lineId && l.catalogItemId === item.id && l.currency === input.currency && (l.boarding ?? null) === (input.boarding ?? null)
      && same(lineLevels(l), input.levelIds) && same(l.classIds, input.classIds) && same(l.combinationIds, input.combinationIds));
    if (dup) throw new ServiceError(`${item.name} is already set for that group in this fee structure`, 409);
    const data = {
      catalogItemId: item.id, name: item.name, fundId: item.fundId, currency: input.currency, amountCents: input.amount, levelId: input.levelIds.length === 1 ? input.levelIds[0]! : null,
      levelIds: input.levelIds, boarding: input.boarding ?? null, classIds: input.classIds, combinationIds: input.combinationIds,
    };
    const saved = lineId
      ? await tx.finFeeItem.update({ where: { id: lineId }, data })
      : await tx.finFeeItem.create({ data: { ...data, schoolId: user.schoolId, termId: s.termId, structureId: s.id, createdById: user.id } });
    await audit(tx, user, 'SAVE_FEE_ITEM', 'FinFeeItem', saved.id, `${lineId ? 'Changed' : 'Added'} fee line ${item.name} in version ${s.version}`, undefined, { structureId: s.id, name: item.name, currency: input.currency, amountCents: input.amount, levelIds: input.levelIds, boarding: input.boarding ?? null });
    return { id: saved.id };
  });
}

export async function deleteLine(user: Actor, structureId: string, lineId: string) {
  need(user, 'finance.fees.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await draftOf(tx, user.schoolId, structureId);
    const l = await tx.finFeeItem.findFirst({ where: { id: lineId, structureId, schoolId: user.schoolId } });
    if (!l) throw new ServiceError('Fee line not found', 404);
    await audit(tx, user, 'SAVE_FEE_ITEM', 'FinFeeItem', lineId, `Removed fee line ${l.name} from a draft`, { name: l.name, amountCents: l.amountCents, currency: l.currency }, { removed: true });
    await tx.finFeeItem.delete({ where: { id: lineId } });
    return { id: lineId };
  });
}

export async function deleteStructure(user: Actor, id: string) {
  need(user, 'finance.fees.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await draftOf(tx, user.schoolId, id);
    await audit(tx, user, 'SAVE_FEE_STRUCTURE', 'FinFeeStructure', id, `Deleted draft fee structure version ${s.version}`, { version: s.version, status: 'DRAFT', lines: s.lines.length }, { deleted: true });
    await tx.finFeeItem.deleteMany({ where: { structureId: id } });
    await tx.finFeeStructure.delete({ where: { id } });
    return { id };
  });
}

export async function submitStructure(user: Actor, id: string) {
  need(user, 'finance.fees.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await draftOf(tx, user.schoolId, id);
    if (s.lines.length === 0) throw new ServiceError('Add at least one fee line before submitting', 422);
    await tx.finFeeStructure.update({ where: { id }, data: { status: 'SUBMITTED', submittedById: user.id, submittedAt: new Date() } });
    await audit(tx, user, 'SUBMIT_FEE_STRUCTURE', 'FinFeeStructure', id, `Submitted fee structure version ${s.version} for approval`, { status: 'DRAFT' }, { status: 'SUBMITTED', lines: s.lines.length });
    await tellApprovers(tx, user, 'finance.fees.approve', { title: 'Fee structure to approve', body: `Version ${s.version}`, link: '/finance/fees' });
    return { id };
  });
}

export async function returnStructure(user: Actor, id: string) {
  need(user, 'finance.fees.manage', 'finance.fees.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.finFeeStructure.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!s) throw new ServiceError('Fee structure not found', 404);
    if (s.status !== 'SUBMITTED') throw new ServiceError('Only a submitted fee structure can be taken back', 409);
    await tx.finFeeStructure.update({ where: { id }, data: { status: 'DRAFT' } });
    await audit(tx, user, 'SAVE_FEE_STRUCTURE', 'FinFeeStructure', id, `Took fee structure version ${s.version} back to draft`, { status: 'SUBMITTED' }, { status: 'DRAFT' });
    return { id };
  });
}

/** The Head approves; the person who prepared or submitted it cannot. A newer version replaces the one billed so far. */
export async function approveStructure(user: Actor, id: string) {
  need(user, 'finance.fees.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.finFeeStructure.findFirst({ where: { id, schoolId: user.schoolId }, include: { lines: true } });
    if (!s) throw new ServiceError('Fee structure not found', 404);
    if (s.status !== 'SUBMITTED') throw new ServiceError('Only a submitted fee structure can be approved', 409);
    if (s.createdById === user.id || s.submittedById === user.id) throw new ServiceError('You prepared this fee structure, so someone else must approve it.', 403);
    const term = await resolveTerm(tx, user.schoolId, s.termId);
    if (term.status === 'CLOSED') throw new ServiceError(`${term.name} is closed, so its fees cannot be changed`, 409);
    const previous = await tx.finFeeStructure.findFirst({ where: { schoolId: user.schoolId, termId: s.termId, status: 'APPROVED' } });
    if (previous) await tx.finFeeStructure.update({ where: { id: previous.id }, data: { status: 'SUPERSEDED' } });
    await tx.finFeeStructure.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() } });
    await audit(tx, user, 'APPROVE_FEE_STRUCTURE', 'FinFeeStructure', id, `Approved fee structure version ${s.version} for ${term.name}`, { status: 'SUBMITTED' },
      { status: 'APPROVED', approvedById: user.id, supersedes: previous?.id ?? null, lines: s.lines.length });
    return { id, supersedes: previous?.id ?? null };
  });
}

// ─── Fee schedule (what the notice board shows) ──────────────────────────────

export interface ScheduleRow { group: string; item: string; fund: string; currency: Cur; amountCents: number }

/** The approved structure of a term as one table: by who pays, one row per fee. */
export async function feeSchedule(user: Actor, termId?: string) {
  need(user, 'finance.fees.view', 'finance.fees.manage', 'finance.fees.approve', 'finance.billing.run');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const s = await approvedStructure(tx, user.schoolId, term.id);
    if (!s) throw new ServiceError(`${term.name} has no approved fee structure yet`, 404);
    const school = await tx.school.findUnique({ where: { id: user.schoolId }, select: { name: true, logoUrl: true, address: true, phone: true } });
    const lines = await describeLines(tx, user.schoolId, s.lines.map((l) => ({ ...l, _count: undefined })) as never);
    const rows: ScheduleRow[] = lines.map((l) => ({ group: l.audience || 'Everyone', item: l.name, fund: l.fundName, currency: l.currency, amountCents: l.amountCents }));
    rows.sort((a, b) => a.group.localeCompare(b.group) || a.item.localeCompare(b.item));
    return { school: school?.name ?? '', logoUrl: school?.logoUrl ?? null, address: school?.address ?? null, phone: school?.phone ?? null, term: term.name, version: s.version, rows };
  });
}
