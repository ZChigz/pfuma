// Library and textbook issue: the catalogue, copies, members, the desk (lend, return, renew, reserve), fines and losses, textbook sets
// issued to a class, stocktake and reports.
//
// The number of copies of a title is always counted from FacBookCopy, never stored. A fine for a learner is a Finance charge (a ledger
// entry when Finance is off); a copy is on one loan, or with one learner, at a time (the database says so too).
import { z } from 'zod';
import type { FacBookCategory, FacCopyCondition, FacCopySource, Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { notifyUsers } from '@/lib/system/notifications';
import { queueSms, feePayerContacts } from '@/lib/finance/sms';
import {
  addDays, audit, centsSchema, currencySchema, idSchema, isoOf, loadFacSettings, nextFacNumber, need, optText, padNumber, textSchema, todayInHarare, toDay, type Actor, type Cur,
} from '@/lib/facilities/common';
import { chargeLearner, type LearnerChargeResult } from '@/lib/facilities/money';
import { parseScan } from '@/lib/facilities/scan';

export const CATEGORIES = ['FICTION', 'REFERENCE', 'TEXTBOOK', 'PAST_PAPERS'] as const;
export const CONDITIONS = ['NEW', 'GOOD', 'WORN', 'DAMAGED'] as const;

const DAY = 86_400_000;
const ANY_VIEW = ['facilities.library.view', 'facilities.library.manage', 'facilities.library.desk', 'facilities.library.waive', 'facilities.textbooks.issue'] as const;
const viewer = (user: Actor) => need(user, ...ANY_VIEW);

/** The end of a day in Harare (UTC+2): a book due "on the 14th" is on time until midnight. */
const endOfDay = (iso: string) => new Date(`${iso}T23:59:59+02:00`);
const dayOf = (d: Date) => isoOf(new Date(d.getTime() + 2 * 3_600_000));

// ─── Catalogue ───────────────────────────────────────────────────────────────

export const TitleSchema = z.object({
  id: idSchema.optional(),
  title: textSchema('the title', 1, 200),
  authors: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  // The form types authors in one box, separated by commas or semicolons.
  author: optText(200),
  isbn: optText(20),
  publisher: optText(80),
  year: z.number().int().min(1400).max(2100).nullable().optional(),
  edition: optText(40),
  subject: optText(60),
  level: optText(30),
  category: z.enum(CATEGORIES).default('FICTION'),
  shelfLocation: optText(40),
  coverKey: optText(300),
  // Reference books are not lent out; the default follows the category and can be changed.
  lendable: z.boolean().optional(),
  replacementCents: centsSchema.nullable().optional(),
  currency: currencySchema.nullable().optional(),
}).superRefine((v, ctx) => {
  if ((v.replacementCents == null) !== (v.currency == null)) ctx.addIssue({ code: 'custom', path: ['currency'], message: 'A replacement amount needs its currency' });
});

export async function saveTitle(user: Actor, raw: unknown) {
  need(user, 'facilities.library.manage');
  const v = TitleSchema.parse(raw);
  const data = {
    title: v.title, authors: v.authors.length ? v.authors : (v.author ?? '').split(/[;,]/).map((a) => a.trim()).filter(Boolean).slice(0, 8), isbn: v.isbn ?? null, publisher: v.publisher ?? null, year: v.year ?? null, edition: v.edition ?? null, subject: v.subject ?? null, level: v.level ?? null,
    category: v.category as FacBookCategory, shelfLocation: v.shelfLocation ?? null, coverKey: v.coverKey ?? null, lendable: v.lendable ?? v.category !== 'REFERENCE',
    replacementCents: v.replacementCents ?? null, currency: v.currency ?? null,
  };
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (!v.id) {
      const t = await tx.facBookTitle.create({ data: { schoolId: user.schoolId, ...data } });
      await audit(tx, user, 'FAC_BOOK_SAVE', 'FacBookTitle', t.id, `Added the title ${v.title}`, undefined, { title: v.title, isbn: data.isbn, category: v.category });
      return { id: t.id };
    }
    const before = await tx.facBookTitle.findFirst({ where: { id: v.id, schoolId: user.schoolId } });
    if (!before) throw new ServiceError('Title not found', 404);
    await tx.facBookTitle.update({ where: { id: v.id }, data });
    await audit(tx, user, 'FAC_BOOK_SAVE', 'FacBookTitle', v.id, `Changed the title ${v.title}`, { title: before.title, shelfLocation: before.shelfLocation, lendable: before.lendable, replacementCents: before.replacementCents } as never, { title: v.title, shelfLocation: data.shelfLocation, lendable: data.lendable, replacementCents: data.replacementCents } as never);
    return { id: v.id };
  });
}

export const AddCopiesSchema = z.object({
  titleId: idSchema,
  count: z.number().int().min(1).max(500),
  condition: z.enum(CONDITIONS).default('NEW'),
  source: z.enum(['BOUGHT', 'DONATED']).default('BOUGHT'),
  costCents: z.number().int().min(0).max(2_000_000_000).default(0),
  currency: currencySchema.default('USD'),
});

/** Adds physical copies. Each gets the next accession number, which is also its barcode (ACC-00071). */
export async function addCopies(user: Actor, raw: unknown) {
  need(user, 'facilities.library.manage');
  const v = AddCopiesSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const t = await tx.facBookTitle.findFirst({ where: { id: v.titleId, schoolId: user.schoolId } });
    if (!t) throw new ServiceError('Title not found', 404);
    const made: string[] = [];
    for (let i = 0; i < v.count; i++) {
      const no = `ACC-${padNumber(await nextFacNumber(tx, user.schoolId, 'ACC'))}`;
      await tx.facBookCopy.create({ data: { schoolId: user.schoolId, titleId: t.id, accessionNo: no, barcode: no, condition: v.condition as FacCopyCondition, source: v.source as FacCopySource, costCents: v.costCents, currency: v.currency } });
      made.push(no);
    }
    await audit(tx, user, 'FAC_COPY_SAVE', 'FacBookTitle', t.id, `Added ${v.count} copies of ${t.title} (${made[0]} to ${made[made.length - 1]})`, undefined, { count: v.count, first: made[0], last: made[made.length - 1], source: v.source, costCents: v.costCents, currency: v.currency });
    return { accessionNumbers: made };
  });
}

export const UpdateCopySchema = z.object({
  copyId: idSchema,
  condition: z.enum(CONDITIONS).optional(),
  // Taking a copy out of circulation (worn out, given away) says why.
  withdraw: z.boolean().optional(),
  reason: optText(300),
});

export async function updateCopy(user: Actor, raw: unknown) {
  need(user, 'facilities.library.manage');
  const v = UpdateCopySchema.parse(raw);
  if (v.withdraw && (v.reason ?? '').trim().length < 3) throw new ServiceError('Say why the copy is taken out of circulation', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.facBookCopy.findFirst({ where: { id: v.copyId, schoolId: user.schoolId } });
    if (!c) throw new ServiceError('Copy not found', 404);
    if (v.withdraw && (c.status === 'ON_LOAN' || c.status === 'RESERVED')) throw new ServiceError('This copy is out or kept for someone. Take it back first.', 409);
    const data: Prisma.FacBookCopyUncheckedUpdateInput = { ...(v.condition ? { condition: v.condition } : {}), ...(v.withdraw ? { status: 'WITHDRAWN' as const } : {}) };
    if (Object.keys(data).length === 0) throw new ServiceError('Nothing to change', 422);
    await tx.facBookCopy.update({ where: { id: c.id }, data });
    await audit(tx, user, 'FAC_COPY_SAVE', 'FacBookCopy', c.id, `${c.accessionNo}: ${v.withdraw ? `withdrawn (${v.reason})` : `condition ${v.condition}`}`, { condition: c.condition, status: c.status }, { condition: v.condition ?? c.condition, status: v.withdraw ? 'WITHDRAWN' : c.status, reason: v.reason ?? null });
    return { id: c.id };
  });
}

/** Details of a book by its ISBN from the Open Library, to save typing. Nothing is saved; the librarian checks it first. */
export async function lookupIsbn(user: Actor, rawIsbn: string) {
  need(user, 'facilities.library.manage');
  const isbn = rawIsbn.replace(/[^0-9Xx]/g, '');
  if (isbn.length !== 10 && isbn.length !== 13) throw new ServiceError('An ISBN has 10 or 13 digits', 422);
  try {
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('bad status');
    const body = (await res.json()) as Record<string, { title?: string; authors?: { name: string }[]; publishers?: { name: string }[]; publish_date?: string; cover?: { medium?: string } }>;
    const b = body[`ISBN:${isbn}`];
    if (!b?.title) throw new ServiceError('No book with that ISBN was found. Type the details in.', 404);
    const year = Number(/\d{4}/.exec(b.publish_date ?? '')?.[0]);
    return { isbn, title: b.title, authors: (b.authors ?? []).map((a) => a.name), publisher: b.publishers?.[0]?.name ?? null, year: Number.isFinite(year) ? year : null, coverUrl: b.cover?.medium ?? null };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError('The ISBN lookup is not available right now. Type the details in.', 503);
  }
}

export interface CopyCounts { total: number; available: number; onLoan: number; reserved: number; lost: number; withdrawn: number }
const zeroCounts = (): CopyCounts => ({ total: 0, available: 0, onLoan: 0, reserved: 0, lost: 0, withdrawn: 0 });
const COUNT_FIELD = { AVAILABLE: 'available', ON_LOAN: 'onLoan', RESERVED: 'reserved', LOST: 'lost', WITHDRAWN: 'withdrawn' } as const;

/** Copy counts, counted from the copies themselves. */
export function countCopies(copies: { status: keyof typeof COUNT_FIELD }[]): CopyCounts {
  const c = zeroCounts();
  for (const x of copies) { c.total++; c[COUNT_FIELD[x.status]]++; }
  return c;
}

export async function listTitles(user: Actor, f: { q?: string; category?: string; page?: number } = {}) {
  viewer(user);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const where: Prisma.FacBookTitleWhereInput = {
      schoolId: user.schoolId, ...(f.category ? { category: f.category as FacBookCategory } : {}),
      ...(f.q ? { OR: [{ title: { contains: f.q, mode: 'insensitive' } }, { authors: { has: f.q } }, { isbn: { contains: f.q } }, { subject: { contains: f.q, mode: 'insensitive' } }] } : {}),
    };
    const [total, titles] = await Promise.all([tx.facBookTitle.count({ where }), tx.facBookTitle.findMany({ where, orderBy: { title: 'asc' }, skip: ((f.page ?? 1) - 1) * 40, take: 40 })]);
    const copies = await tx.facBookCopy.findMany({ where: { schoolId: user.schoolId, titleId: { in: titles.map((t) => t.id) } }, select: { titleId: true, status: true } });
    return {
      total,
      rows: titles.map((t) => ({ ...t, counts: countCopies(copies.filter((c) => c.titleId === t.id)) })),
    };
  });
}

export async function getTitle(user: Actor, id: string) {
  viewer(user);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const t = await tx.facBookTitle.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!t) throw new ServiceError('Title not found', 404);
    const [copies, reservations] = await Promise.all([
      tx.facBookCopy.findMany({ where: { schoolId: user.schoolId, titleId: id }, orderBy: { accessionNo: 'asc' } }),
      tx.facReservation.count({ where: { schoolId: user.schoolId, titleId: id, fulfilledAt: null, cancelledAt: null } }),
    ]);
    return { title: t, copies, counts: countCopies(copies), reservations };
  });
}

// ─── Members ─────────────────────────────────────────────────────────────────

const LEFT = ['RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'] as const;
const LEFT_REASON = 'Left the school';

/** Every active learner and staff member is a member; leavers are suspended from borrowing (and come back if they return). */
export async function syncMembers(tx: Db, schoolId: string) {
  const [students, staff, members] = await Promise.all([
    tx.student.findMany({ where: { schoolId }, select: { id: true, status: true } }),
    tx.employee.findMany({ where: { schoolId }, select: { id: true, status: true } }),
    tx.facLibraryMember.findMany({ where: { schoolId }, select: { id: true, studentId: true, employeeId: true, suspended: true, suspendedReason: true } }),
  ]);
  const haveS = new Map(members.filter((m) => m.studentId).map((m) => [m.studentId!, m]));
  const haveE = new Map(members.filter((m) => m.employeeId).map((m) => [m.employeeId!, m]));
  const newcomers = [
    ...students.filter((s) => s.status === 'ACTIVE' && !haveS.has(s.id)).map((s) => ({ schoolId, type: 'LEARNER' as const, studentId: s.id })),
    ...staff.filter((e) => !(LEFT as readonly string[]).includes(e.status) && !haveE.has(e.id)).map((e) => ({ schoolId, type: 'STAFF' as const, employeeId: e.id })),
  ];
  if (newcomers.length) await tx.facLibraryMember.createMany({ data: newcomers, skipDuplicates: true });
  const gone = [
    ...students.filter((s) => s.status !== 'ACTIVE').map((s) => haveS.get(s.id)),
    ...staff.filter((e) => (LEFT as readonly string[]).includes(e.status)).map((e) => haveE.get(e.id)),
  ].filter((m): m is NonNullable<typeof m> => !!m && !m.suspended);
  if (gone.length) await tx.facLibraryMember.updateMany({ where: { id: { in: gone.map((m) => m.id) } }, data: { suspended: true, suspendedReason: LEFT_REASON } });
  const back = [
    ...students.filter((s) => s.status === 'ACTIVE').map((s) => haveS.get(s.id)),
    ...staff.filter((e) => !(LEFT as readonly string[]).includes(e.status)).map((e) => haveE.get(e.id)),
  ].filter((m): m is NonNullable<typeof m> => !!m && m.suspended && m.suspendedReason === LEFT_REASON);
  if (back.length) await tx.facLibraryMember.updateMany({ where: { id: { in: back.map((m) => m.id) } }, data: { suspended: false, suspendedReason: null } });
}

export interface MemberView {
  id: string; type: 'LEARNER' | 'STAFF'; name: string; number: string; className: string | null; suspended: boolean; suspendedReason: string | null;
  maxLoans: number; loanDays: number; open: LoanView[]; overdue: number; photoUrl: string | null;
}
export interface LoanView { id: string; copyId: string; accessionNo: string; title: string; outAt: string; dueAt: string; overdueDays: number; renewedCount: number; reserved: boolean }

async function memberView(tx: Db, schoolId: string, memberId: string): Promise<MemberView> {
  const m = await tx.facLibraryMember.findFirst({ where: { id: memberId, schoolId } });
  if (!m) throw new ServiceError('Member not found', 404);
  const settings = await loadFacSettings(tx, schoolId);
  const [student, employee, loans] = await Promise.all([
    m.studentId ? tx.student.findFirst({ where: { id: m.studentId, schoolId }, select: { fullName: true, admissionNumber: true, photoUrl: true, currentClass: { select: { name: true } } } }) : null,
    m.employeeId ? tx.employee.findFirst({ where: { id: m.employeeId, schoolId }, select: { firstName: true, surname: true, employeeNo: true } }) : null,
    tx.facLoan.findMany({ where: { schoolId, memberId, returnedAt: null }, orderBy: { dueAt: 'asc' } }),
  ]);
  const copies = await tx.facBookCopy.findMany({ where: { id: { in: loans.map((l) => l.copyId) } }, select: { id: true, accessionNo: true, titleId: true } });
  const titles = await tx.facBookTitle.findMany({ where: { id: { in: copies.map((c) => c.titleId) } }, select: { id: true, title: true } });
  const reserved = new Set((await tx.facReservation.findMany({ where: { schoolId, titleId: { in: titles.map((t) => t.id) }, fulfilledAt: null, cancelledAt: null }, select: { titleId: true } })).map((r) => r.titleId));
  const now = new Date();
  const open = loans.map((l): LoanView => {
    const c = copies.find((x) => x.id === l.copyId)!;
    const t = titles.find((x) => x.id === c.titleId)!;
    return { id: l.id, copyId: l.copyId, accessionNo: c.accessionNo, title: t.title, outAt: l.outAt.toISOString(), dueAt: l.dueAt.toISOString(), overdueDays: l.dueAt < now ? Math.ceil((now.getTime() - l.dueAt.getTime()) / DAY) : 0, renewedCount: l.renewedCount, reserved: reserved.has(c.titleId) };
  });
  const learner = m.type === 'LEARNER';
  return {
    id: m.id, type: m.type, name: student?.fullName ?? (employee ? `${employee.firstName} ${employee.surname}` : ''), number: student?.admissionNumber ?? employee?.employeeNo ?? '',
    className: student?.currentClass?.name ?? null, suspended: m.suspended, suspendedReason: m.suspendedReason, maxLoans: learner ? settings.learnerMaxLoans : settings.staffMaxLoans,
    loanDays: learner ? settings.learnerLoanDays : settings.staffLoanDays, open, overdue: open.filter((o) => o.overdueDays > 0).length, photoUrl: student?.photoUrl ?? null,
  };
}

/** Finds the member at the desk from the number on the ID card (a learner's admission number or a staff member's number). */
export async function findMember(user: Actor, code: string): Promise<MemberView> {
  need(user, 'facilities.library.desk', 'facilities.library.manage', 'facilities.textbooks.issue', 'facilities.library.view');
  const c = parseScan(code).value;
  if (!c) throw new ServiceError('Nothing was scanned', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await syncMembers(tx, user.schoolId);
    const s = await tx.student.findFirst({ where: { schoolId: user.schoolId, admissionNumber: { equals: c, mode: 'insensitive' } }, select: { id: true } });
    const e = s ? null : await tx.employee.findFirst({ where: { schoolId: user.schoolId, employeeNo: { equals: c, mode: 'insensitive' } }, select: { id: true } });
    if (!s && !e) throw new ServiceError('No learner or staff member has that number', 404);
    const m = await tx.facLibraryMember.findFirst({ where: { schoolId: user.schoolId, ...(s ? { studentId: s.id } : { employeeId: e!.id }) } });
    if (!m) throw new ServiceError('That person is not a library member', 404);
    return memberView(tx, user.schoolId, m.id);
  });
}

export const SuspendSchema = z.object({ memberId: idSchema, suspended: z.boolean(), reason: optText(200) });

export async function setSuspended(user: Actor, raw: unknown) {
  need(user, 'facilities.library.manage');
  const v = SuspendSchema.parse(raw);
  if (v.suspended && (v.reason ?? '').trim().length < 3) throw new ServiceError('Say why borrowing is suspended', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const m = await tx.facLibraryMember.findFirst({ where: { id: v.memberId, schoolId: user.schoolId } });
    if (!m) throw new ServiceError('Member not found', 404);
    await tx.facLibraryMember.update({ where: { id: m.id }, data: { suspended: v.suspended, suspendedReason: v.suspended ? v.reason! : null } });
    await audit(tx, user, 'FAC_COPY_SAVE', 'FacLibraryMember', m.id, v.suspended ? `Suspended borrowing: ${v.reason}` : 'Borrowing allowed again', { suspended: m.suspended }, { suspended: v.suspended });
    return { id: m.id };
  });
}

// ─── The desk ────────────────────────────────────────────────────────────────

async function copyByCode(tx: Db, schoolId: string, code: string) {
  const c = parseScan(code).value;
  if (!c) throw new ServiceError('Nothing was scanned', 422);
  const copy = await tx.facBookCopy.findFirst({ where: { schoolId, OR: [{ barcode: c }, { accessionNo: { equals: c, mode: 'insensitive' } }] } });
  if (!copy) throw new ServiceError('No book has that barcode', 404);
  return copy;
}

export const CheckoutSchema = z.object({ memberId: idSchema, barcode: z.string().trim().min(1).max(80) });

/** Lends a book. The due date comes from the rules for that kind of member. */
export async function checkout(user: Actor, raw: unknown) {
  need(user, 'facilities.library.desk');
  const v = CheckoutSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await syncMembers(tx, user.schoolId);
    const member = await memberView(tx, user.schoolId, v.memberId);
    if (member.suspended) throw new ServiceError(`${member.name} cannot borrow: ${member.suspendedReason ?? 'borrowing is suspended'}`, 409);
    if (member.open.length >= member.maxLoans) throw new ServiceError(`${member.name} already has ${member.open.length} book${member.open.length === 1 ? '' : 's'} out, which is the limit`, 409);
    const copy = await copyByCode(tx, user.schoolId, v.barcode);
    const title = await tx.facBookTitle.findUniqueOrThrow({ where: { id: copy.titleId } });
    if (!title.lendable) throw new ServiceError(`${title.title} is a reference book and is not lent out`, 409);
    if (copy.status === 'ON_LOAN') throw new ServiceError(`${title.title} (${copy.accessionNo}) is already out`, 409);
    if (copy.status === 'LOST' || copy.status === 'WITHDRAWN') throw new ServiceError(`${copy.accessionNo} is ${copy.status.toLowerCase()} and cannot be lent`, 409);
    if (copy.condition === 'DAMAGED') throw new ServiceError(`${copy.accessionNo} is damaged. Repair it or withdraw it first.`, 409);
    // A book kept for someone goes to that person, and only when they have come for it.
    const waiting = await tx.facReservation.findMany({ where: { schoolId: user.schoolId, titleId: title.id, fulfilledAt: null, cancelledAt: null }, orderBy: { reservedAt: 'asc' } });
    if (copy.status === 'RESERVED') {
      if (waiting[0]?.memberId !== v.memberId) throw new ServiceError(`${copy.accessionNo} is kept for someone who reserved it`, 409);
    } else if (waiting.length > 0 && !waiting.some((w) => w.memberId === v.memberId)) {
      const available = await tx.facBookCopy.count({ where: { schoolId: user.schoolId, titleId: title.id, status: 'AVAILABLE' } });
      if (available <= waiting.filter((w) => w.notifiedAt === null).length) throw new ServiceError(`The last free copies of ${title.title} are reserved for other members`, 409);
    }
    const now = new Date();
    const dueIso = addDays(todayInHarare(), member.loanDays);
    const loan = await tx.facLoan.create({ data: { schoolId: user.schoolId, copyId: copy.id, memberId: v.memberId, outAt: now, dueAt: endOfDay(dueIso), checkedOutById: user.id } });
    await tx.facBookCopy.update({ where: { id: copy.id }, data: { status: 'ON_LOAN' } });
    const mine = waiting.find((w) => w.memberId === v.memberId);
    if (mine) await tx.facReservation.update({ where: { id: mine.id }, data: { fulfilledAt: now } });
    await audit(tx, user, 'FAC_LOAN_OUT', 'FacLoan', loan.id, `Lent ${title.title} (${copy.accessionNo}) to ${member.name}, due ${dueIso}`, undefined, { memberId: v.memberId, copyId: copy.id, dueAt: dueIso });
    return { loanId: loan.id, title: title.title, accessionNo: copy.accessionNo, dueDate: dueIso, member: member.name };
  });
}

export interface ReturnResult { loanId: string; title: string; member: string; daysLate: number; fineCents: number; currency: Cur | null; charged: 'FINANCE' | 'LEGACY' | 'LEDGER' | 'RECORDED' | null; reservedFor: string | null }

export const ReturnSchema = z.object({ barcode: z.string().trim().min(1).max(80), condition: z.enum(CONDITIONS).optional() });

/** Takes a book back: shows the days late and the fine, and charges the fine to a learner's account. */
export async function returnBook(user: Actor, raw: unknown): Promise<ReturnResult> {
  need(user, 'facilities.library.desk');
  const v = ReturnSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const copy = await copyByCode(tx, user.schoolId, v.barcode);
    const loan = await tx.facLoan.findFirst({ where: { schoolId: user.schoolId, copyId: copy.id, returnedAt: null } });
    if (!loan) throw new ServiceError(`${copy.accessionNo} is not out on loan`, 409);
    const [title, member, settings] = await Promise.all([
      tx.facBookTitle.findUniqueOrThrow({ where: { id: copy.titleId } }),
      memberView(tx, user.schoolId, loan.memberId),
      loadFacSettings(tx, user.schoolId),
    ]);
    const now = new Date();
    const daysLate = now > loan.dueAt ? Math.ceil((now.getTime() - loan.dueAt.getTime()) / DAY) : 0;
    const fineCents = daysLate * settings.lateFinePerDayCents;
    const currency = settings.lateFineCurrency as Cur;
    let charge: LearnerChargeResult | null = null;
    let charged: ReturnResult['charged'] = null;
    if (fineCents > 0) {
      const m = await tx.facLibraryMember.findUniqueOrThrow({ where: { id: loan.memberId } });
      if (m.studentId) {
        charge = await chargeLearner(tx, { schoolId: user.schoolId, actorId: user.id, studentId: m.studentId, part: 'LIBRARY', kind: 'LIBRARY_FINE', description: `Library fine: ${title.title}, ${daysLate} day${daysLate === 1 ? '' : 's'} late`, currency, amountCents: fineCents, sourceType: 'FacLoan', sourceId: loan.id });
        charged = charge.where;
      } else charged = 'RECORDED';
    }
    await tx.facLoan.update({ where: { id: loan.id }, data: { returnedAt: now, conditionOnReturn: v.condition ?? null, returnedToId: user.id, fineCents, fineCurrency: fineCents > 0 ? currency : null, chargeId: charge?.chargeId ?? null, ledgerEntryId: charge?.ledgerEntryId ?? null } });
    // Back on the shelf, or kept for the first member waiting for it.
    const next = await tx.facReservation.findFirst({ where: { schoolId: user.schoolId, titleId: title.id, fulfilledAt: null, cancelledAt: null, notifiedAt: null }, orderBy: { reservedAt: 'asc' } });
    const damaged = v.condition === 'DAMAGED';
    let reservedFor: string | null = null;
    if (next && !damaged) {
      await tx.facReservation.update({ where: { id: next.id }, data: { notifiedAt: now } });
      const who = await memberView(tx, user.schoolId, next.memberId);
      reservedFor = who.name;
      const holders = await deskHolders(tx, user.schoolId);
      const staffUser = (await tx.facLibraryMember.findUniqueOrThrow({ where: { id: next.memberId } })).employeeId;
      const target = staffUser ? (await tx.employee.findUnique({ where: { id: staffUser }, select: { userId: true } }))?.userId : null;
      await notifyUsers(tx, user.schoolId, target ? [target] : holders, { title: `${title.title} is back for ${who.name}`, body: 'It is kept at the library desk.', link: '/facilities/library/desk' });
    }
    await tx.facBookCopy.update({ where: { id: copy.id }, data: { status: damaged ? 'WITHDRAWN' : reservedFor ? 'RESERVED' : 'AVAILABLE', ...(v.condition ? { condition: v.condition } : {}) } });
    await audit(tx, user, 'FAC_LOAN_RETURN', 'FacLoan', loan.id, `${title.title} (${copy.accessionNo}) returned by ${member.name}${daysLate ? `, ${daysLate} day${daysLate === 1 ? '' : 's'} late, fine ${fineCents} cents ${currency}` : ''}`,
      { returnedAt: null }, { returnedAt: now.toISOString(), daysLate, fineCents, currency: fineCents ? currency : null, charge: charged, chargeId: charge?.chargeId ?? null, ledgerEntryId: charge?.ledgerEntryId ?? null } as never);
    return { loanId: loan.id, title: title.title, member: member.name, daysLate, fineCents, currency: fineCents ? currency : null, charged, reservedFor };
  });
}

async function deskHolders(tx: Db, schoolId: string): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: { schoolId, active: true, isSupport: false, userRoles: { some: { role: { permissions: { some: { permissionKey: { in: ['facilities.library.desk', '*'] } } } } } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Renews once, when the book is not overdue and nobody has reserved the title. */
export async function renewLoan(user: Actor, loanId: string) {
  need(user, 'facilities.library.desk');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const loan = await tx.facLoan.findFirst({ where: { id: loanId, schoolId: user.schoolId } });
    if (!loan) throw new ServiceError('Loan not found', 404);
    if (loan.returnedAt) throw new ServiceError('This book was already returned', 409);
    if (loan.renewedCount >= 1) throw new ServiceError('A book can be renewed once', 409);
    if (loan.dueAt < new Date()) throw new ServiceError('An overdue book cannot be renewed. Take it back first.', 409);
    const copy = await tx.facBookCopy.findUniqueOrThrow({ where: { id: loan.copyId } });
    if (await tx.facReservation.count({ where: { schoolId: user.schoolId, titleId: copy.titleId, fulfilledAt: null, cancelledAt: null } })) throw new ServiceError('Someone has reserved this book, so it cannot be renewed', 409);
    const member = await memberView(tx, user.schoolId, loan.memberId);
    if (member.suspended) throw new ServiceError(`${member.name} cannot borrow: ${member.suspendedReason ?? 'borrowing is suspended'}`, 409);
    const newDue = addDays(dayOf(loan.dueAt), member.loanDays);
    await tx.facLoan.update({ where: { id: loan.id }, data: { dueAt: endOfDay(newDue), renewedCount: 1 } });
    await audit(tx, user, 'FAC_LOAN_RENEW', 'FacLoan', loan.id, `Renewed ${copy.accessionNo} for ${member.name} until ${newDue}`, { dueAt: dayOf(loan.dueAt) }, { dueAt: newDue });
    return { dueDate: newDue };
  });
}

export const ReserveSchema = z.object({ titleId: idSchema, memberId: idSchema });

/** Reserves a title whose copies are all out; the member is told when one comes back. */
export async function reserveTitle(user: Actor, raw: unknown) {
  need(user, 'facilities.library.desk');
  const v = ReserveSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const [title, member] = await Promise.all([tx.facBookTitle.findFirst({ where: { id: v.titleId, schoolId: user.schoolId } }), tx.facLibraryMember.findFirst({ where: { id: v.memberId, schoolId: user.schoolId } })]);
    if (!title) throw new ServiceError('Title not found', 404);
    if (!member) throw new ServiceError('Member not found', 404);
    if (member.suspended) throw new ServiceError('This member cannot borrow', 409);
    if (!title.lendable) throw new ServiceError('Reference books are not lent out', 409);
    if (await tx.facBookCopy.count({ where: { schoolId: user.schoolId, titleId: title.id, status: 'AVAILABLE' } })) throw new ServiceError('A copy is on the shelf. Lend it instead.', 409);
    if (await tx.facBookCopy.count({ where: { schoolId: user.schoolId, titleId: title.id, status: { in: ['ON_LOAN', 'RESERVED'] } } }) === 0) throw new ServiceError('There is no copy to wait for', 409);
    if (await tx.facLoan.findFirst({ where: { schoolId: user.schoolId, memberId: v.memberId, returnedAt: null, copyId: { in: (await tx.facBookCopy.findMany({ where: { titleId: title.id }, select: { id: true } })).map((c) => c.id) } } })) throw new ServiceError('This member already has the book', 409);
    if (await tx.facReservation.findFirst({ where: { schoolId: user.schoolId, titleId: title.id, memberId: v.memberId, fulfilledAt: null, cancelledAt: null }, select: { id: true } })) throw new ServiceError('This member already reserved the book', 409);
    const r = await tx.facReservation.create({ data: { schoolId: user.schoolId, titleId: title.id, memberId: v.memberId } });
    await audit(tx, user, 'FAC_RESERVE', 'FacReservation', r.id, `Reserved ${title.title}`, undefined, { titleId: title.id, memberId: v.memberId });
    return { id: r.id };
  });
}

export async function cancelReservation(user: Actor, id: string) {
  need(user, 'facilities.library.desk');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.facReservation.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!r) throw new ServiceError('Reservation not found', 404);
    if (r.fulfilledAt || r.cancelledAt) throw new ServiceError('This reservation is closed', 409);
    await tx.facReservation.update({ where: { id }, data: { cancelledAt: new Date() } });
    // A copy kept for them goes back on the shelf when nobody else is waiting.
    if (r.notifiedAt) {
      const others = await tx.facReservation.count({ where: { schoolId: user.schoolId, titleId: r.titleId, fulfilledAt: null, cancelledAt: null, id: { not: id } } });
      if (!others) await tx.facBookCopy.updateMany({ where: { schoolId: user.schoolId, titleId: r.titleId, status: 'RESERVED' }, data: { status: 'AVAILABLE' } });
    }
    await audit(tx, user, 'FAC_RESERVE', 'FacReservation', id, 'Cancelled a reservation', { cancelledAt: null }, { cancelledAt: new Date().toISOString() });
    return { id };
  });
}

// ─── Lost or damaged beyond use, and waiving a fine ──────────────────────────

export const LostSchema = z.object({
  loanId: idSchema.optional(), copyId: idSchema.optional(),
  kind: z.enum(['LOST', 'DAMAGED']),
  // A set amount, or by default the copy's cost (or the title's replacement amount).
  amountCents: z.number().int().min(1).max(2_000_000_000).optional(), currency: currencySchema.optional(),
  reason: textSchema('what happened', 3, 300),
}).refine((v) => v.loanId || v.copyId, { message: 'Choose the loan or the copy' });

/** A book lost or damaged beyond use: the copy becomes Lost and the learner is charged the replacement. */
export async function markLost(user: Actor, raw: unknown) {
  need(user, 'facilities.library.desk');
  const v = LostSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const loan = v.loanId
      ? await tx.facLoan.findFirst({ where: { id: v.loanId, schoolId: user.schoolId } })
      : await tx.facLoan.findFirst({ where: { schoolId: user.schoolId, copyId: v.copyId!, returnedAt: null } });
    if (v.loanId && !loan) throw new ServiceError('Loan not found', 404);
    const copy = await tx.facBookCopy.findFirst({ where: { id: loan?.copyId ?? v.copyId!, schoolId: user.schoolId } });
    if (!copy) throw new ServiceError('Copy not found', 404);
    if (copy.status === 'LOST') throw new ServiceError('This copy is already recorded as lost', 409);
    if (loan?.returnedAt) throw new ServiceError('This loan is closed', 409);
    const title = await tx.facBookTitle.findUniqueOrThrow({ where: { id: copy.titleId } });
    const amount = v.amountCents ?? (copy.costCents > 0 ? copy.costCents : title.replacementCents ?? 0);
    const currency = (v.currency ?? (v.amountCents ? 'USD' : copy.costCents > 0 ? copy.currency : title.currency ?? 'USD')) as Cur;
    let charge: LearnerChargeResult | null = null;
    let member: { studentId: string | null } | null = null;
    if (loan) member = await tx.facLibraryMember.findUniqueOrThrow({ where: { id: loan.memberId }, select: { studentId: true } });
    if (member?.studentId) {
      if (amount <= 0) throw new ServiceError('This copy has no cost or replacement amount on record. Enter the amount to charge.', 422);
      charge = await chargeLearner(tx, { schoolId: user.schoolId, actorId: user.id, studentId: member.studentId, part: 'LIBRARY', kind: 'LOST_BOOK', description: `${v.kind === 'LOST' ? 'Lost' : 'Damaged'} book: ${title.title} (${copy.accessionNo})`, currency, amountCents: amount, sourceType: 'FacLoan', sourceId: loan!.id });
    }
    const now = new Date();
    if (loan) await tx.facLoan.update({ where: { id: loan.id }, data: { returnedAt: now, conditionOnReturn: v.kind === 'DAMAGED' ? 'DAMAGED' : null, returnedToId: user.id, fineCents: amount, fineCurrency: amount > 0 ? currency : null, chargeId: charge?.chargeId ?? null, ledgerEntryId: charge?.ledgerEntryId ?? null } });
    await tx.facBookCopy.update({ where: { id: copy.id }, data: { status: 'LOST', ...(v.kind === 'DAMAGED' ? { condition: 'DAMAGED' as const } : {}) } });
    await audit(tx, user, 'FAC_COPY_LOST', 'FacBookCopy', copy.id, `${copy.accessionNo} (${title.title}) ${v.kind === 'LOST' ? 'lost' : 'damaged beyond use'}: ${v.reason}`, { status: copy.status }, { status: 'LOST', amountCents: amount, currency, charge: charge?.where ?? null, chargeId: charge?.chargeId ?? null, ledgerEntryId: charge?.ledgerEntryId ?? null } as never);
    return { copyId: copy.id, amountCents: amount, currency, charged: charge?.where ?? (loan ? 'RECORDED' : null) };
  });
}

export const WaiveSchema = z.object({ loanId: idSchema, reason: textSchema('the reason', 3, 300) });

/** Waives a fine. It needs the reason; the Finance charge is voided (or the ledger entry waived) in the same transaction. */
export async function waiveFine(user: Actor, raw: unknown) {
  need(user, 'facilities.library.waive');
  const v = WaiveSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const loan = await tx.facLoan.findFirst({ where: { id: v.loanId, schoolId: user.schoolId } });
    if (!loan) throw new ServiceError('Loan not found', 404);
    if (loan.fineCents <= 0) throw new ServiceError('There is no fine on this loan', 409);
    if (loan.waivedById) throw new ServiceError('This fine was already waived', 409);
    if (loan.chargeId) {
      const c = await tx.finCharge.findUniqueOrThrow({ where: { id: loan.chargeId }, include: { term: true, voidRow: true } });
      if (!c.voidRow) {
        if (c.term.status === 'CLOSED') throw new ServiceError(`${c.term.name} is closed, so the charge cannot be voided. Ask Finance for a credit note.`, 409);
        const settled = await tx.finPaymentAllocation.count({ where: { schoolId: user.schoolId, chargeId: c.id, payment: { voidRow: null } } });
        if (settled > 0) throw new ServiceError('Part of this fine has been paid. Ask Finance for a credit note or refund.', 409);
        await tx.finVoid.create({ data: { schoolId: user.schoolId, chargeId: c.id, reason: `Library fine waived: ${v.reason}`, voidedById: user.id } });
      }
    }
    if (loan.ledgerEntryId) {
      const e = await tx.facLedgerEntry.findUniqueOrThrow({ where: { id: loan.ledgerEntryId } });
      if (e.sourceType === 'LEGACY_CHARGE') throw new ServiceError('This fine is on the older accounting screens. Remove the charge there.', 409);
      if (e.status === 'SETTLED') throw new ServiceError('This fine was already paid', 409);
      await tx.facLedgerEntry.update({ where: { id: e.id }, data: { status: 'WAIVED', settledAt: new Date() } });
    }
    await tx.facLoan.update({ where: { id: loan.id }, data: { waivedById: user.id, waiveReason: v.reason } });
    await audit(tx, user, 'FAC_FINE_WAIVE', 'FacLoan', loan.id, `Waived a library fine of ${loan.fineCents} cents ${loan.fineCurrency}: ${v.reason}`, { fineCents: loan.fineCents, waived: false }, { waived: true, reason: v.reason, chargeId: loan.chargeId, ledgerEntryId: loan.ledgerEntryId } as never);
    return { id: loan.id };
  });
}

// ─── Textbooks ───────────────────────────────────────────────────────────────

export const SetSchema = z.object({
  id: idSchema.optional(), name: textSchema('the set name', 2, 80), levelId: idSchema.nullable().optional(),
  items: z.array(z.object({ titleId: idSchema, qty: z.number().int().min(1).max(10).default(1) })).min(1, 'Add at least one title').max(30),
  active: z.boolean().optional(),
});

/** A set of textbooks a learner gets together (for example "Form 3 sciences"). */
export async function saveTextbookSet(user: Actor, raw: unknown) {
  need(user, 'facilities.library.manage', 'facilities.textbooks.issue');
  // The form picks up to four books in separate boxes (title0 ... title3); an API caller may send items directly.
  const input = raw && typeof raw === 'object' && !('items' in raw) ? { ...(raw as Record<string, unknown>), items: [0, 1, 2, 3].map((n) => (raw as Record<string, unknown>)[`title${n}`]).filter((t): t is string => typeof t === 'string' && t !== '').map((titleId) => ({ titleId, qty: 1 })) } : raw;
  const v = SetSchema.parse(input);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if ((await tx.facBookTitle.count({ where: { schoolId: user.schoolId, id: { in: v.items.map((i) => i.titleId) } } })) !== new Set(v.items.map((i) => i.titleId)).size) throw new ServiceError('A title in the set was not found', 404);
    if (v.levelId && !(await tx.level.findFirst({ where: { id: v.levelId, schoolId: user.schoolId }, select: { id: true } }))) throw new ServiceError('Level not found', 404);
    if (await tx.facTextbookSet.findFirst({ where: { schoolId: user.schoolId, name: v.name, ...(v.id ? { id: { not: v.id } } : {}) }, select: { id: true } })) throw new ServiceError(`There is already a set called ${v.name}`, 409);
    const data = { name: v.name, levelId: v.levelId ?? null, items: v.items as unknown as Prisma.InputJsonValue, active: v.active ?? true };
    const id = v.id
      ? (await tx.facTextbookSet.findFirst({ where: { id: v.id, schoolId: user.schoolId } }).then(async (s) => { if (!s) throw new ServiceError('Set not found', 404); return (await tx.facTextbookSet.update({ where: { id: s.id }, data })).id; }))
      : (await tx.facTextbookSet.create({ data: { schoolId: user.schoolId, ...data } })).id;
    await audit(tx, user, 'FAC_BOOK_SAVE', 'FacTextbookSet', id, `${v.id ? 'Changed' : 'Made'} the textbook set ${v.name}`, undefined, { name: v.name, titles: v.items.length });
    return { id };
  });
}

export async function listTextbookSets(user: Actor) {
  viewer(user);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sets = await tx.facTextbookSet.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' } });
    const ids = Array.from(new Set(sets.flatMap((s) => (s.items as unknown as { titleId: string }[]).map((i) => i.titleId))));
    const titles = await tx.facBookTitle.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } });
    const t = new Map(titles.map((x) => [x.id, x.title]));
    return sets.map((s) => ({ id: s.id, name: s.name, levelId: s.levelId, active: s.active, items: (s.items as unknown as { titleId: string; qty: number }[]).map((i) => ({ titleId: i.titleId, qty: i.qty, title: t.get(i.titleId) ?? '' })) }));
  });
}

export interface HeldBook { issueId: string; copyId: string; accessionNo: string; title: string; issuedAt: string; missing: boolean }

async function heldBooks(tx: Db, schoolId: string, studentIds: string[]): Promise<Map<string, HeldBook[]>> {
  const issues = await tx.facTextbookIssue.findMany({ where: { schoolId, studentId: { in: studentIds }, returnedAt: null }, orderBy: { issuedAt: 'asc' } });
  const copies = await tx.facBookCopy.findMany({ where: { id: { in: issues.map((i) => i.copyId) } }, select: { id: true, accessionNo: true, titleId: true } });
  const titles = await tx.facBookTitle.findMany({ where: { id: { in: copies.map((c) => c.titleId) } }, select: { id: true, title: true } });
  const out = new Map<string, HeldBook[]>();
  for (const i of issues) {
    const c = copies.find((x) => x.id === i.copyId)!;
    out.set(i.studentId, [...(out.get(i.studentId) ?? []), { issueId: i.id, copyId: c.id, accessionNo: c.accessionNo, title: titles.find((t) => t.id === c.titleId)?.title ?? '', issuedAt: i.issuedAt.toISOString(), missing: !!i.missingAt }]);
  }
  return out;
}

/** The class with what each learner holds of a set, so the librarian can see who still needs which book. */
export async function classIssueSheet(user: Actor, classId: string, setId?: string) {
  need(user, 'facilities.textbooks.issue', 'facilities.library.manage', 'facilities.library.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const klass = await tx.schoolClass.findFirst({ where: { id: classId, schoolId: user.schoolId }, select: { id: true, name: true } });
    if (!klass) throw new ServiceError('Class not found', 404);
    const set = setId ? (await listTextbookSetsTx(tx, user.schoolId)).find((s) => s.id === setId) : null;
    if (setId && !set) throw new ServiceError('Set not found', 404);
    const students = await tx.student.findMany({ where: { schoolId: user.schoolId, currentClassId: classId, status: 'ACTIVE' }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true, admissionNumber: true } });
    const held = await heldBooks(tx, user.schoolId, students.map((s) => s.id));
    return { class: klass, set, students: students.map((s) => ({ ...s, books: held.get(s.id) ?? [] })) };
  });
}

async function listTextbookSetsTx(tx: Db, schoolId: string) {
  const sets = await tx.facTextbookSet.findMany({ where: { schoolId } });
  return sets.map((s) => ({ id: s.id, name: s.name, items: s.items as unknown as { titleId: string; qty: number }[] }));
}

export const IssueTextbookSchema = z.object({
  studentId: idSchema, setId: idSchema.optional(),
  // Scanned one by one, or typed in bulk: a copy number for each.
  barcodes: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
});

/** Gives textbooks to a learner by scanning each copy. A copy is with one learner at a time; no loan limit applies to a textbook set. */
export async function issueTextbooks(user: Actor, raw: unknown) {
  need(user, 'facilities.textbooks.issue');
  const v = IssueTextbookSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const student = await tx.student.findFirst({ where: { id: v.studentId, schoolId: user.schoolId }, select: { id: true, fullName: true, status: true } });
    if (!student) throw new ServiceError('Student not found', 404);
    if (student.status !== 'ACTIVE') throw new ServiceError(`${student.fullName} is not at the school`, 409);
    const set = v.setId ? await tx.facTextbookSet.findFirst({ where: { id: v.setId, schoolId: user.schoolId } }) : null;
    if (v.setId && !set) throw new ServiceError('Set not found', 404);
    const year = await tx.academicYear.findFirst({ where: { schoolId: user.schoolId }, orderBy: { year: 'desc' }, select: { id: true } });
    if (new Set(v.barcodes.map((b) => parseScan(b).value)).size !== v.barcodes.length) throw new ServiceError('The same book was scanned twice', 422);
    const given: { accessionNo: string; title: string }[] = [];
    for (const code of v.barcodes) {
      const copy = await copyByCode(tx, user.schoolId, code);
      const title = await tx.facBookTitle.findUniqueOrThrow({ where: { id: copy.titleId } });
      if (copy.status !== 'AVAILABLE') throw new ServiceError(`${copy.accessionNo} (${title.title}) is ${copy.status === 'ON_LOAN' ? 'with someone else' : copy.status.toLowerCase()}`, 409);
      if (copy.condition === 'DAMAGED') throw new ServiceError(`${copy.accessionNo} is damaged and cannot be issued`, 409);
      const i = await tx.facTextbookIssue.create({ data: { schoolId: user.schoolId, copyId: copy.id, studentId: student.id, setId: set?.id ?? null, yearId: year?.id ?? null, issuedById: user.id, conditionOut: copy.condition } });
      await tx.facBookCopy.update({ where: { id: copy.id }, data: { status: 'ON_LOAN' } });
      await audit(tx, user, 'FAC_TEXTBOOK_ISSUE', 'FacTextbookIssue', i.id, `Issued ${title.title} (${copy.accessionNo}) to ${student.fullName}`, undefined, { studentId: student.id, copyId: copy.id, setId: set?.id ?? null });
      given.push({ accessionNo: copy.accessionNo, title: title.title });
    }
    return { student: student.fullName, issued: given };
  });
}

export const ReturnTextbookSchema = z.object({ barcode: z.string().trim().min(1).max(80), condition: z.enum(CONDITIONS).optional() });

/** A textbook scanned back in at the end of the year or when a learner leaves. */
export async function returnTextbook(user: Actor, raw: unknown) {
  need(user, 'facilities.textbooks.issue');
  const v = ReturnTextbookSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const copy = await copyByCode(tx, user.schoolId, v.barcode);
    const issue = await tx.facTextbookIssue.findFirst({ where: { schoolId: user.schoolId, copyId: copy.id, returnedAt: null } });
    if (!issue) throw new ServiceError(`${copy.accessionNo} is not issued to a learner`, 409);
    const student = await tx.student.findUniqueOrThrow({ where: { id: issue.studentId }, select: { fullName: true } });
    const title = await tx.facBookTitle.findUniqueOrThrow({ where: { id: copy.titleId } });
    const condition = v.condition ?? copy.condition;
    await tx.facTextbookIssue.update({ where: { id: issue.id }, data: { returnedAt: new Date(), returnedById: user.id, conditionIn: condition, missingAt: null } });
    // A book once marked missing that turns up is back on the shelf; the charge stays until Finance credits it.
    await tx.facBookCopy.update({ where: { id: copy.id }, data: { status: condition === 'DAMAGED' ? 'WITHDRAWN' : 'AVAILABLE', condition } });
    await audit(tx, user, 'FAC_TEXTBOOK_RETURN', 'FacTextbookIssue', issue.id, `${title.title} (${copy.accessionNo}) returned by ${student.fullName}`, { returnedAt: null }, { returnedAt: new Date().toISOString(), condition } as never);
    return { student: student.fullName, title: title.title, accessionNo: copy.accessionNo };
  });
}

/** The textbooks a learner still holds (their textbook card). */
export async function textbookCard(user: Actor, studentId: string) {
  need(user, 'facilities.textbooks.issue', 'facilities.library.manage', 'facilities.library.view', 'facilities.library.desk');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.student.findFirst({ where: { id: studentId, schoolId: user.schoolId }, select: { id: true, fullName: true, admissionNumber: true } });
    if (!s) throw new ServiceError('Student not found', 404);
    return { student: s, books: (await heldBooks(tx, user.schoolId, [s.id])).get(s.id) ?? [] };
  });
}

/**
 * The books a leaver has not brought back are marked missing and become replacement charges (the copy's cost, or the title's replacement
 * amount). Run when the textbooks are collected at the end of the year or at leaving.
 */
export async function markTextbooksMissing(user: Actor, raw: unknown) {
  need(user, 'facilities.textbooks.issue');
  const v = z.object({ studentId: idSchema, issueIds: z.array(idSchema).max(30).optional() }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const student = await tx.student.findFirst({ where: { id: v.studentId, schoolId: user.schoolId }, select: { id: true, fullName: true } });
    if (!student) throw new ServiceError('Student not found', 404);
    const issues = await tx.facTextbookIssue.findMany({ where: { schoolId: user.schoolId, studentId: student.id, returnedAt: null, missingAt: null, ...(v.issueIds ? { id: { in: v.issueIds } } : {}) } });
    if (issues.length === 0) throw new ServiceError('Nothing is outstanding', 409);
    const charged: { accessionNo: string; amountCents: number; currency: Cur; where: string }[] = [];
    for (const i of issues) {
      const copy = await tx.facBookCopy.findUniqueOrThrow({ where: { id: i.copyId } });
      const title = await tx.facBookTitle.findUniqueOrThrow({ where: { id: copy.titleId } });
      const amount = copy.costCents > 0 ? copy.costCents : title.replacementCents ?? 0;
      const currency = (copy.costCents > 0 ? copy.currency : title.currency ?? 'USD') as Cur;
      if (amount <= 0) throw new ServiceError(`${title.title} (${copy.accessionNo}) has no cost or replacement amount on record. Add one to the title, then try again.`, 422);
      const c = await chargeLearner(tx, { schoolId: user.schoolId, actorId: user.id, studentId: student.id, part: 'LIBRARY', kind: 'LOST_BOOK', description: `Missing textbook: ${title.title} (${copy.accessionNo})`, currency, amountCents: amount, sourceType: 'FacTextbookIssue', sourceId: i.id });
      await tx.facTextbookIssue.update({ where: { id: i.id }, data: { missingAt: new Date(), chargeId: c.chargeId, ledgerEntryId: c.ledgerEntryId } });
      await tx.facBookCopy.update({ where: { id: copy.id }, data: { status: 'LOST' } });
      await audit(tx, user, 'FAC_COPY_LOST', 'FacTextbookIssue', i.id, `${title.title} (${copy.accessionNo}) not returned by ${student.fullName}: replacement charged`, { missing: false }, { missing: true, amountCents: amount, currency, charge: c.where, chargeId: c.chargeId, ledgerEntryId: c.ledgerEntryId } as never);
      charged.push({ accessionNo: copy.accessionNo, amountCents: amount, currency, where: c.where });
    }
    return { student: student.fullName, charged };
  });
}

/** What the leaving clearance says about the library: books out, textbooks not returned, textbooks already charged as missing. */
export async function libraryClearance(tx: Db, schoolId: string, studentId: string) {
  const memberIds = (await tx.facLibraryMember.findMany({ where: { schoolId, studentId }, select: { id: true } })).map((m) => m.id);
  const [loans, issues] = await Promise.all([
    tx.facLoan.findMany({ where: { schoolId, returnedAt: null, memberId: { in: memberIds } }, select: { copyId: true } }),
    tx.facTextbookIssue.findMany({ where: { schoolId, studentId, returnedAt: null }, select: { copyId: true, missingAt: true } }),
  ]);
  const copyIds = [...loans.map((l) => l.copyId), ...issues.map((i) => i.copyId)];
  const copies = await tx.facBookCopy.findMany({ where: { id: { in: copyIds } }, select: { id: true, titleId: true } });
  const titles = new Map((await tx.facBookTitle.findMany({ where: { id: { in: copies.map((c) => c.titleId) } }, select: { id: true, title: true } })).map((t) => [t.id, t.title]));
  const name = (copyId: string) => titles.get(copies.find((c) => c.id === copyId)?.titleId ?? '') ?? 'a book';
  const unreturned = issues.filter((i) => !i.missingAt);
  const finesOpen = await tx.facLedgerEntry.count({ where: { schoolId, studentId, part: 'LIBRARY', status: 'OPEN' } });
  const parts: string[] = [];
  if (loans.length) parts.push(`${loans.length} library book${loans.length === 1 ? '' : 's'} not returned (${loans.map((l) => name(l.copyId)).slice(0, 3).join(', ')}${loans.length > 3 ? ', …' : ''})`);
  if (unreturned.length) parts.push(`${unreturned.length} textbook${unreturned.length === 1 ? '' : 's'} not returned (${unreturned.map((i) => name(i.copyId)).slice(0, 3).join(', ')}${unreturned.length > 3 ? ', …' : ''})`);
  const missing = issues.length - unreturned.length;
  const note = missing ? `${missing} textbook${missing === 1 ? '' : 's'} marked missing and charged` : '';
  return { clear: parts.length === 0, detail: parts.length ? parts.join('; ') : note ? `Clear (${note})` : 'Clear', finesOpen };
}

// ─── Stocktake ───────────────────────────────────────────────────────────────

export async function startStocktake(user: Actor, raw: unknown) {
  need(user, 'facilities.library.manage');
  const v = z.object({ name: textSchema('a name', 2, 80), shelf: optText(40) }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const open = await tx.facStocktake.findFirst({ where: { schoolId: user.schoolId, closedAt: null }, select: { id: true } });
    if (open) throw new ServiceError('A stocktake is already open. Finish it first.', 409);
    const s = await tx.facStocktake.create({ data: { schoolId: user.schoolId, name: v.name, shelf: v.shelf ?? null, createdById: user.id } });
    await audit(tx, user, 'FAC_STOCKTAKE', 'FacStocktake', s.id, `Started the stocktake ${v.name}${v.shelf ? ` (shelf ${v.shelf})` : ''}`, undefined, { name: v.name, shelf: v.shelf ?? null });
    return { id: s.id };
  });
}

/** A copy scanned on the shelf. Scanning it twice does nothing. */
export async function scanStocktake(user: Actor, id: string, raw: unknown) {
  need(user, 'facilities.library.manage');
  const { barcode } = z.object({ barcode: z.string().trim().min(1).max(80) }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const st = await tx.facStocktake.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!st) throw new ServiceError('Stocktake not found', 404);
    if (st.closedAt) throw new ServiceError('This stocktake is finished', 409);
    const copy = await copyByCode(tx, user.schoolId, barcode);
    const title = await tx.facBookTitle.findUniqueOrThrow({ where: { id: copy.titleId }, select: { title: true } });
    const had = await tx.facStocktakeScan.findFirst({ where: { stocktakeId: id, copyId: copy.id }, select: { id: true } });
    if (!had) await tx.facStocktakeScan.create({ data: { schoolId: user.schoolId, stocktakeId: id, copyId: copy.id } });
    return { accessionNo: copy.accessionNo, title: title.title, status: copy.status, already: !!had };
  });
}

/** The result: copies that should be on the shelf (available) but were not scanned. Finishing it closes the stocktake. */
export async function stocktakeResult(user: Actor, id: string, finish = false) {
  need(user, 'facilities.library.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const st = await tx.facStocktake.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!st) throw new ServiceError('Stocktake not found', 404);
    const scans = await tx.facStocktakeScan.findMany({ where: { stocktakeId: id }, select: { copyId: true } });
    const seen = new Set(scans.map((s) => s.copyId));
    const titles = await tx.facBookTitle.findMany({ where: { schoolId: user.schoolId, ...(st.shelf ? { shelfLocation: { startsWith: st.shelf, mode: 'insensitive' as const } } : {}) }, select: { id: true, title: true, shelfLocation: true } });
    const copies = await tx.facBookCopy.findMany({ where: { schoolId: user.schoolId, titleId: { in: titles.map((t) => t.id) }, status: 'AVAILABLE' }, orderBy: { accessionNo: 'asc' } });
    const notScanned = copies.filter((c) => !seen.has(c.id)).map((c) => ({ copyId: c.id, accessionNo: c.accessionNo, title: titles.find((t) => t.id === c.titleId)?.title ?? '', shelf: titles.find((t) => t.id === c.titleId)?.shelfLocation ?? null }));
    if (finish && !st.closedAt) {
      await tx.facStocktake.update({ where: { id }, data: { closedAt: new Date() } });
      await audit(tx, user, 'FAC_STOCKTAKE', 'FacStocktake', id, `Finished the stocktake ${st.name}: ${seen.size} scanned, ${notScanned.length} missing from the shelf`, { closedAt: null }, { scanned: seen.size, missing: notScanned.length } as never);
    }
    return { id, name: st.name, shelf: st.shelf, closed: !!st.closedAt || finish, scanned: seen.size, expected: copies.length, notScanned };
  });
}

export async function listStocktakes(user: Actor) {
  need(user, 'facilities.library.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => (await tx.facStocktake.findMany({ where: { schoolId: user.schoolId }, orderBy: { startedAt: 'desc' }, take: 20 })).map((s) => ({ id: s.id, name: s.name, shelf: s.shelf, startedAt: s.startedAt.toISOString(), closed: !!s.closedAt })));
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export async function libraryReports(user: Actor, f: { from?: string; to?: string } = {}) {
  viewer(user);
  const today = todayInHarare();
  const to = f.to ?? today;
  const from = f.from ?? addDays(to, -90);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const now = new Date();
    const [open, copies, titles, inRange, issues, lostCopies] = await Promise.all([
      tx.facLoan.findMany({ where: { schoolId: user.schoolId, returnedAt: null }, orderBy: { dueAt: 'asc' } }),
      tx.facBookCopy.findMany({ where: { schoolId: user.schoolId }, select: { id: true, titleId: true, status: true, costCents: true, currency: true, accessionNo: true } }),
      tx.facBookTitle.findMany({ where: { schoolId: user.schoolId }, select: { id: true, title: true } }),
      tx.facLoan.findMany({ where: { schoolId: user.schoolId, outAt: { gte: toDay(from), lt: toDay(addDays(to, 1)) } }, select: { copyId: true } }),
      tx.facTextbookIssue.findMany({ where: { schoolId: user.schoolId, returnedAt: null }, select: { studentId: true, copyId: true, missingAt: true } }),
      tx.facBookCopy.findMany({ where: { schoolId: user.schoolId, status: 'LOST' }, select: { id: true, accessionNo: true, titleId: true, costCents: true, currency: true } }),
    ]);
    const members = await tx.facLibraryMember.findMany({ where: { id: { in: open.map((l) => l.memberId) } } });
    const students = await tx.student.findMany({ where: { id: { in: [...members.map((m) => m.studentId).filter((x): x is string => !!x), ...issues.map((i) => i.studentId)] } }, select: { id: true, fullName: true, currentClass: { select: { name: true } } } });
    const employees = await tx.employee.findMany({ where: { id: { in: members.map((m) => m.employeeId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, surname: true } });
    const copyTitle = new Map(copies.map((c) => [c.id, c.titleId]));
    const titleName = new Map(titles.map((t) => [t.id, t.title]));
    const who = (memberId: string) => {
      const m = members.find((x) => x.id === memberId);
      const s = students.find((x) => x.id === m?.studentId);
      const e = employees.find((x) => x.id === m?.employeeId);
      return { name: s?.fullName ?? (e ? `${e.firstName} ${e.surname}` : ''), group: s?.currentClass?.name ?? (e ? 'Staff' : '') };
    };
    const borrowed = new Map<string, number>();
    for (const l of inRange) { const t = copyTitle.get(l.copyId); if (t) borrowed.set(t, (borrowed.get(t) ?? 0) + 1); }
    const byClass = new Map<string, number>();
    for (const i of issues) { const c = students.find((s) => s.id === i.studentId)?.currentClass?.name ?? 'No class'; byClass.set(c, (byClass.get(c) ?? 0) + 1); }
    const fineLoans = await tx.facLoan.findMany({ where: { schoolId: user.schoolId, fineCents: { gt: 0 }, returnedAt: { gte: toDay(from), lt: toDay(addDays(to, 1)) } }, orderBy: { returnedAt: 'desc' }, take: 100 });
    const fineMembers = await tx.facLibraryMember.findMany({ where: { id: { in: fineLoans.map((l) => l.memberId) } } });
    const fineStudents = await tx.student.findMany({ where: { id: { in: fineMembers.map((m) => m.studentId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
    const lostValue: Record<Cur, number> = { USD: 0, ZIG: 0 };
    for (const c of lostCopies) lostValue[c.currency as Cur] += c.costCents;
    return {
      from, to,
      counts: countCopies(copies),
      out: open.map((l) => ({ loanId: l.id, member: who(l.memberId).name, group: who(l.memberId).group, title: titleName.get(copyTitle.get(l.copyId) ?? '') ?? '', accessionNo: copies.find((c) => c.id === l.copyId)?.accessionNo ?? '', dueAt: dayOf(l.dueAt), overdueDays: l.dueAt < now ? Math.ceil((now.getTime() - l.dueAt.getTime()) / DAY) : 0 })),
      mostBorrowed: Array.from(borrowed).map(([t, n]) => ({ title: titleName.get(t) ?? '', loans: n })).sort((a, b) => b.loans - a.loans).slice(0, 15),
      textbooksByClass: Array.from(byClass).map(([klass, n]) => ({ class: klass, books: n })).sort((a, b) => a.class.localeCompare(b.class)),
      lost: lostCopies.map((c) => ({ accessionNo: c.accessionNo, title: titleName.get(c.titleId) ?? '', costCents: c.costCents, currency: c.currency as Cur })),
      lostValue,
      fines: fineLoans.map((l) => ({ loanId: l.id, member: fineStudents.find((st) => st.id === fineMembers.find((m) => m.id === l.memberId)?.studentId)?.fullName ?? 'Staff member', title: titleName.get(copyTitle.get(l.copyId) ?? '') ?? '', fineCents: l.fineCents, currency: (l.fineCurrency ?? 'USD') as Cur, returnedAt: l.returnedAt ? dayOf(l.returnedAt) : '', waived: !!l.waivedById, waiveReason: l.waiveReason, charged: l.chargeId ? 'Finance' : l.ledgerEntryId ? 'Library ledger' : 'Recorded' })),
    };
  });
}

/** Queues an SMS to the guardian of each learner with an overdue book (once a day per loan). Staff get a notification instead. */
export async function sendOverdueReminders(user: Actor) {
  need(user, 'facilities.library.desk', 'facilities.library.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const overdue = await tx.facLoan.findMany({ where: { schoolId: user.schoolId, returnedAt: null, dueAt: { lt: new Date() } } });
    let sms = 0;
    let staff = 0;
    const today = todayInHarare();
    for (const l of overdue) {
      const m = await tx.facLibraryMember.findUniqueOrThrow({ where: { id: l.memberId } });
      const copy = await tx.facBookCopy.findUniqueOrThrow({ where: { id: l.copyId }, select: { titleId: true } });
      const title = await tx.facBookTitle.findUniqueOrThrow({ where: { id: copy.titleId }, select: { title: true } });
      if (m.studentId) {
        const s = await tx.student.findUniqueOrThrow({ where: { id: m.studentId }, select: { fullName: true } });
        const contacts = await feePayerContacts(tx, user.schoolId, m.studentId);
        sms += await queueSms(tx, user.schoolId, contacts, `${s.fullName} has not returned the library book "${title.title}", due ${dayOf(l.dueAt)}. Please return it to the library.`, { studentId: m.studentId, key: `lib-overdue:${l.id}:${today}` });
      } else if (m.employeeId) {
        const e = await tx.employee.findUnique({ where: { id: m.employeeId }, select: { userId: true } });
        if (e?.userId) staff += await notifyUsers(tx, user.schoolId, [e.userId], { title: `Library book overdue: ${title.title}`, body: `It was due ${dayOf(l.dueAt)}.`, link: '/facilities/library', dedupeKey: `lib-overdue:${l.id}:${today}` });
      }
    }
    await audit(tx, user, 'FAC_EXPORT_REPORT', 'FacLoan', user.schoolId, `Overdue reminders: ${sms} SMS queued, ${staff} staff notified`, undefined, { overdue: overdue.length, sms, staff });
    return { overdue: overdue.length, sms, staff };
  });
}
