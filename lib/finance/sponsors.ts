// Sponsors: someone other than the parent who owes the money (BEAM, a church, an NGO, a company). A discount means the school gives the money up;
// a sponsor award means the sponsor owes it instead of the parent. At billing the covered amount moves from the learner's account to the sponsor's
// (an approved adjustment on the charge plus a claim on the sponsor), and the parent's statement shows only what they still owe.
// Sponsor money is recorded by one person, verified by another, and allocated to the learners and items it covers, oldest first or by hand.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import {
  amountSchema, assertCurrencyOn, audit, currencySchema, dayOf, holds, idSchema, isoDateSchema, nameMap, nameOf, need, nextReceiptNumber, nextSerial, resolveTerm, tellApprovers,
  textSchema, todayInHarare, whySchema, ymd, type Actor,
} from '@/lib/finance/common';
import { approveAdjustments, termsCovered } from '@/lib/finance/discounts';
import { feePayerContacts, queueSms } from '@/lib/finance/sms';
import { percentOf, formatMoney, zeroTotals, type Cur, type Totals } from '@/lib/finance/money';
import { isCash, METHODS, needsReference } from '@/lib/finance/methods';
import { notifyUsers } from '@/lib/system/notifications';

export const SPONSOR_TYPES = ['BEAM', 'CHURCH', 'NGO', 'COMPANY', 'INDIVIDUAL'] as const;
export const SPONSOR_TYPE_LABEL: Record<(typeof SPONSOR_TYPES)[number], string> = { BEAM: 'Government BEAM', CHURCH: 'Church', NGO: 'NGO', COMPANY: 'Company', INDIVIDUAL: 'Individual' };

// ─── Sponsor records ─────────────────────────────────────────────────────────

export const SponsorSchema = z.object({
  name: textSchema('a name', 1, 80), type: z.enum(SPONSOR_TYPES), contactPerson: z.string().trim().max(80).optional(), phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(120).optional().or(z.literal('')), address: z.string().trim().max(200).optional(), active: z.boolean().optional(),
});

export async function listSponsors(user: Actor) {
  need(user, 'finance.sponsors.manage', 'finance.awards.approve', 'finance.reports.view', 'finance.payments.record');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.sponsor.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' }, include: { _count: { select: { awards: true } } } });
    return rows.map((s) => ({ id: s.id, name: s.name, type: s.type, contactPerson: s.contactPerson, phone: s.phone, email: s.email, address: s.address, active: s.active, awards: s._count.awards }));
  });
}

export async function saveSponsor(user: Actor, id: string | null, raw: unknown) {
  need(user, 'finance.sponsors.manage');
  const input = (id ? SponsorSchema.partial() : SponsorSchema).parse(raw) as z.infer<typeof SponsorSchema>;
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (input.name && (await tx.sponsor.findFirst({ where: { schoolId: user.schoolId, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } }))) throw new ServiceError(`There is already a sponsor called ${input.name}`, 409);
    const data = { name: input.name, type: input.type, contactPerson: input.contactPerson || null, phone: input.phone || null, email: input.email || null, address: input.address || null, active: input.active };
    if (!id) {
      const s = await tx.sponsor.create({ data: { ...data, schoolId: user.schoolId, name: input.name, type: input.type } });
      await audit(tx, user, 'SAVE_SPONSOR', 'Sponsor', s.id, `Added sponsor ${s.name}`, undefined, { name: s.name, type: s.type });
      return { id: s.id };
    }
    const before = await tx.sponsor.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!before) throw new ServiceError('Sponsor not found', 404);
    const after = await tx.sponsor.update({ where: { id }, data });
    await audit(tx, user, 'SAVE_SPONSOR', 'Sponsor', id, `Changed sponsor ${before.name}`, { name: before.name, type: before.type, active: before.active }, { name: after.name, type: after.type, active: after.active });
    return { id };
  });
}

// ─── Awards ──────────────────────────────────────────────────────────────────

export const AwardSchema = z.object({
  sponsorId: idSchema, studentId: idSchema, catalogItemIds: z.array(idSchema).max(30).default([]), percent: z.number().min(0.01).max(100).optional(), amount: amountSchema.optional(),
  currency: currencySchema, termFromId: idSchema.optional(), termToId: idSchema.optional(), reference: z.string().trim().max(80).optional(),
}).superRefine((v, ctx) => { if ((v.percent === undefined) === (v.amount === undefined)) ctx.addIssue({ code: 'custom', message: 'Give either a percentage or a fixed amount per term', path: ['percent'] }); });

export async function createAward(user: Actor, raw: unknown) {
  need(user, 'finance.sponsors.manage');
  const input = AwardSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const [sponsor, student] = await Promise.all([
      tx.sponsor.findFirst({ where: { id: input.sponsorId, schoolId: user.schoolId } }),
      tx.student.findFirst({ where: { id: input.studentId, schoolId: user.schoolId }, select: { id: true, fullName: true } }),
    ]);
    if (!sponsor || !sponsor.active) throw new ServiceError('Sponsor not found', 404);
    if (!student) throw new ServiceError('Student not found', 404);
    await assertCurrencyOn(tx, user.schoolId, input.currency);
    const from = input.termFromId ? await tx.academicTerm.findFirst({ where: { id: input.termFromId, schoolId: user.schoolId } }) : await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' } });
    if (!from) throw new ServiceError('Term not found', 404);
    const to = input.termToId ? await tx.academicTerm.findFirst({ where: { id: input.termToId, schoolId: user.schoolId } }) : null;
    if (input.termToId && !to) throw new ServiceError('Term not found', 404);
    if (to && to.startDate < from.startDate) throw new ServiceError('The end term is before the start term', 422);
    if (input.catalogItemIds.length && (await tx.feeItem.count({ where: { schoolId: user.schoolId, id: { in: input.catalogItemIds } } })) !== input.catalogItemIds.length) throw new ServiceError('Fee item not found', 404);
    const a = await tx.sponsorAward.create({
      data: {
        schoolId: user.schoolId, sponsorId: sponsor.id, studentId: student.id, catalogItemIds: input.catalogItemIds, percentBps: input.percent !== undefined ? Math.round(input.percent * 100) : null,
        amountCents: input.amount ?? null, currency: input.currency, termFromId: from.id, termToId: to?.id ?? null, reference: input.reference || null, createdById: user.id,
      },
    });
    await audit(tx, user, 'SAVE_AWARD', 'SponsorAward', a.id, `Asked for ${sponsor.name} to cover fees for ${student.fullName}`, undefined, {
      sponsorId: sponsor.id, studentId: student.id, percentBps: a.percentBps, amountCents: a.amountCents, currency: a.currency, termFromId: from.id, termToId: to?.id ?? null, reference: a.reference,
    });
    await tellApprovers(tx, user, 'finance.awards.approve', { title: 'Sponsor award to approve', body: `${sponsor.name}: ${student.fullName}`, link: '/finance/sponsors' });
    return { id: a.id };
  });
}

/** An approved award reaches charges already made in the terms it covers. */
async function coverExisting(tx: Db, schoolId: string, award: { id: string; sponsorId: string; studentId: string; catalogItemIds: string[]; percentBps: number | null; amountCents: number | null; currency: Cur; termFromId: string; termToId: string | null; createdById: string; reference: string | null }, approverId: string, sponsorName: string) {
  const termIds = await termsCovered(tx, schoolId, { termFromId: award.termFromId, termToId: award.termToId, standing: !award.termToId });
  if (termIds.length === 0) return 0;
  const charges = await tx.finCharge.findMany({
    where: { schoolId, studentId: award.studentId, termId: { in: termIds }, currency: award.currency, voidRow: null, ...(award.catalogItemIds.length ? { catalogItemId: { in: award.catalogItemIds } } : {}) },
    include: { adjustments: { where: { status: { in: ['PENDING', 'APPROVED'] } }, select: { amountCents: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const already = new Set((await tx.sponsorCharge.findMany({ where: { awardId: award.id }, select: { chargeId: true } })).map((x) => x.chargeId));
  const perTermLeft = new Map<string, number>();
  const made: { id: string; chargeId: string; termId: string; fundId: string; cents: number }[] = [];
  for (const c of charges) {
    if (already.has(c.id)) continue;
    const room = c.amountCents - c.adjustments.reduce((s, a) => s + a.amountCents, 0);
    const left = perTermLeft.has(c.termId) ? perTermLeft.get(c.termId)! : (award.amountCents ?? 0);
    const want = award.percentBps !== null ? Math.min(percentOf(room, award.percentBps), room) : Math.min(left, room);
    if (want <= 0) continue;
    if (award.percentBps === null) perTermLeft.set(c.termId, left - want);
    const adj = await tx.finAdjustment.create({ data: { schoolId, chargeId: c.id, kind: 'SPONSOR', amountCents: want, reason: `Covered by ${sponsorName}${award.reference ? ` (${award.reference})` : ''}`, createdById: award.createdById } });
    made.push({ id: adj.id, chargeId: c.id, termId: c.termId, fundId: c.fundId, cents: want });
  }
  await approveAdjustments(tx, schoolId, made, approverId, 'Sponsor award approved');
  if (made.length) {
    await tx.sponsorCharge.createMany({ data: made.map((m) => ({ schoolId, sponsorId: award.sponsorId, awardId: award.id, studentId: award.studentId, chargeId: m.chargeId, adjustmentId: m.id, termId: m.termId, fundId: m.fundId, currency: award.currency, amountCents: m.cents })), skipDuplicates: true });
  }
  return made.length;
}

export async function decideAward(user: Actor, id: string, decision: 'approve' | 'reject', rawNote?: unknown) {
  need(user, 'finance.awards.approve');
  const note = rawNote === undefined || rawNote === '' ? undefined : whySchema(3).parse(rawNote);
  if (decision === 'reject' && !note) throw new ServiceError('Give a reason for rejecting it', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.sponsorAward.findFirst({ where: { id, schoolId: user.schoolId }, include: { sponsor: { select: { name: true } } } });
    if (!a) throw new ServiceError('Award not found', 404);
    if (a.status !== 'PENDING') throw new ServiceError(`This award is ${a.status.toLowerCase()}`, 409);
    if (a.createdById === user.id) throw new ServiceError('You asked for this award, so someone else must decide on it.', 403);
    const status = decision === 'approve' ? 'APPROVED' : 'REJECTED';
    await tx.sponsorAward.update({ where: { id }, data: { status, approvedById: user.id, approvedAt: new Date() } });
    const covered = decision === 'approve' ? await coverExisting(tx, user.schoolId, a as never, user.id, a.sponsor.name) : 0;
    await audit(tx, user, 'DECIDE_AWARD', 'SponsorAward', id, `${decision === 'approve' ? 'Approved' : 'Rejected'} the award from ${a.sponsor.name}`, { status: 'PENDING' }, { status, decidedById: user.id, coveredExistingCharges: covered, note: note ?? null });
    await notifyUsers(tx, user.schoolId, [a.createdById], { type: 'FINANCE', title: `Sponsor award ${status.toLowerCase()}`, link: '/finance/sponsors' });
    return { id, status, covered };
  });
}

export const CancelAwardSchema = z.object({ reason: whySchema(5), fromTermId: idSchema });

/**
 * A learner is removed from the sponsor's list: the award ends and, from the chosen term, whatever the sponsor has not paid moves back to the parent
 * as a new charge. What the sponsor already paid stays covered. The fee payer is told.
 */
export async function cancelAward(user: Actor, id: string, raw: unknown) {
  need(user, 'finance.sponsors.manage', 'finance.awards.approve');
  const input = CancelAwardSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.sponsorAward.findFirst({ where: { id, schoolId: user.schoolId }, include: { sponsor: { select: { name: true } } } });
    if (!a) throw new ServiceError('Award not found', 404);
    if (a.status !== 'APPROVED') throw new ServiceError('Only an approved award can be cancelled', 409);
    const from = await tx.academicTerm.findFirst({ where: { id: input.fromTermId, schoolId: user.schoolId } });
    if (!from) throw new ServiceError('Term not found', 404);
    const open = await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' } });
    const laterTermIds = (await tx.academicTerm.findMany({ where: { schoolId: user.schoolId, startDate: { gte: from.startDate } }, select: { id: true } })).map((t) => t.id);
    const sCharges = await tx.sponsorCharge.findMany({
      where: { schoolId: user.schoolId, awardId: id, cancelled: false, termId: { in: laterTermIds } },
      include: { allocations: { where: { payment: { voidedById: null } }, select: { amountCents: true } } },
    });
    const chargeNames = new Map((await tx.finCharge.findMany({ where: { schoolId: user.schoolId, id: { in: sCharges.map((c) => c.chargeId) } }, select: { id: true, description: true } })).map((c) => [c.id, c.description]));
    const termStatus = new Map((await tx.academicTerm.findMany({ where: { schoolId: user.schoolId, id: { in: laterTermIds } }, select: { id: true, status: true } })).map((t) => [t.id, t.status]));
    let backToParent = 0; const totals = zeroTotals(); let charges = 0;
    for (const sc of sCharges) {
      const paid = sc.allocations.reduce((s, x) => s + x.amountCents, 0);
      const uncovered = sc.amountCents - paid;
      await tx.sponsorCharge.update({ where: { id: sc.id }, data: { cancelled: true } });
      if (uncovered <= 0) continue;
      const termId = termStatus.get(sc.termId) === 'CLOSED' ? open?.id : sc.termId;
      if (!termId) throw new ServiceError('No term is open, so the amount cannot be moved back to the parent. Open a term first.', 409);
      await tx.finCharge.create({
        data: { schoolId: user.schoolId, studentId: sc.studentId, termId, fundId: sc.fundId, description: `${chargeNames.get(sc.chargeId) ?? 'Fee'} (no longer covered by ${a.sponsor.name})`, currency: sc.currency, amountCents: uncovered, source: 'MANUAL', createdById: user.id },
      });
      backToParent += uncovered; totals[sc.currency] += uncovered; charges++;
    }
    await tx.sponsorAward.update({ where: { id }, data: { status: 'CANCELLED', cancelledById: user.id, cancelledAt: new Date(), cancelReason: input.reason } });
    const student = await tx.student.findFirst({ where: { id: a.studentId }, select: { fullName: true } });
    const contacts = await feePayerContacts(tx, user.schoolId, a.studentId);
    const money = (['USD', 'ZIG'] as const).filter((c) => totals[c]).map((c) => formatMoney(totals[c], c)).join(' and ');
    if (money) await queueSms(tx, user.schoolId, contacts, `${a.sponsor.name} no longer covers fees for ${student?.fullName ?? 'your child'}. ${money} is now payable by you. Please contact the school office.`, { studentId: a.studentId, key: `award-cancel:${id}` });
    await audit(tx, user, 'CANCEL_AWARD', 'SponsorAward', id, `Cancelled the award from ${a.sponsor.name} from ${from.name}: ${input.reason}`, { status: 'APPROVED' }, { status: 'CANCELLED', fromTermId: from.id, movedBackToParent: totals, charges });
    await tellApprovers(tx, user, 'finance.sponsors.manage', { title: 'Sponsor award cancelled', body: `${student?.fullName}: ${money || 'nothing moved back'}`, link: '/finance/sponsors' });
    return { id, movedBack: backToParent, charges, totals };
  });
}

export interface AwardRow {
  id: string; sponsorId: string; sponsorName: string; studentId: string; studentName: string; items: string[]; percent: number | null; amountCents: number | null; currency: Cur;
  termFrom: string; termTo: string | null; reference: string | null; status: string; createdBy: string | null; createdById: string; approvedBy: string | null; cancelReason: string | null;
}

export async function listAwards(user: Actor, f: { sponsorId?: string; studentId?: string; status?: string } = {}) {
  need(user, 'finance.sponsors.manage', 'finance.awards.approve', 'finance.accounts.view', 'finance.statements.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.sponsorAward.findMany({
      where: { schoolId: user.schoolId, ...(f.sponsorId ? { sponsorId: f.sponsorId } : {}), ...(f.studentId ? { studentId: f.studentId } : {}), ...(f.status ? { status: f.status as never } : {}) },
      orderBy: { createdAt: 'desc' }, take: 500, include: { sponsor: { select: { name: true } } },
    });
    const [students, terms, items, names] = await Promise.all([
      tx.student.findMany({ where: { schoolId: user.schoolId, id: { in: rows.map((r) => r.studentId) } }, select: { id: true, fullName: true } }),
      tx.academicTerm.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } }),
      tx.feeItem.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } }),
      nameMap(tx, user.schoolId, rows.flatMap((r) => [r.createdById, r.approvedById])),
    ]);
    const sn = new Map(students.map((s) => [s.id, s.fullName])); const tn = new Map(terms.map((t) => [t.id, t.name])); const itn = new Map(items.map((i) => [i.id, i.name]));
    return rows.map<AwardRow>((r) => ({
      id: r.id, sponsorId: r.sponsorId, sponsorName: r.sponsor.name, studentId: r.studentId, studentName: sn.get(r.studentId) ?? '', items: r.catalogItemIds.map((i) => itn.get(i) ?? ''), percent: r.percentBps !== null ? r.percentBps / 100 : null,
      amountCents: r.amountCents, currency: r.currency, termFrom: tn.get(r.termFromId) ?? '', termTo: r.termToId ? (tn.get(r.termToId) ?? null) : null, reference: r.reference, status: r.status,
      createdBy: nameOf(names, r.createdById), createdById: r.createdById, approvedBy: nameOf(names, r.approvedById), cancelReason: r.cancelReason,
    }));
  });
}

// ─── The sponsor's account ───────────────────────────────────────────────────

export interface SponsorTermRow { sponsorId: string; sponsorName: string; termId: string; termName: string; termStart: string; currency: Cur; claimedCents: number; paidCents: number; owedCents: number }

/** What each sponsor owes, by term and currency: claims on its learners less the payments allocated to them. */
export async function sponsorReceivables(tx: Db, schoolId: string, sponsorId?: string): Promise<SponsorTermRow[]> {
  const rows = await tx.sponsorCharge.findMany({
    where: { schoolId, cancelled: false, ...(sponsorId ? { sponsorId } : {}) },
    select: { sponsorId: true, termId: true, currency: true, amountCents: true, sponsor: { select: { name: true } }, allocations: { where: { payment: { voidedById: null } }, select: { amountCents: true } } },
  });
  const terms = new Map((await tx.academicTerm.findMany({ where: { schoolId }, select: { id: true, name: true, startDate: true } })).map((t) => [t.id, t]));
  const map = new Map<string, SponsorTermRow>();
  for (const r of rows) {
    const k = `${r.sponsorId}|${r.termId}|${r.currency}`;
    const t = terms.get(r.termId);
    const row = map.get(k) ?? { sponsorId: r.sponsorId, sponsorName: r.sponsor.name, termId: r.termId, termName: t?.name ?? '', termStart: t ? ymd(t.startDate) : '', currency: r.currency, claimedCents: 0, paidCents: 0, owedCents: 0 };
    row.claimedCents += r.amountCents;
    row.paidCents += r.allocations.reduce((s, a) => s + a.amountCents, 0);
    row.owedCents = row.claimedCents - row.paidCents;
    map.set(k, row);
  }
  return Array.from(map.values()).sort((a, b) => a.sponsorName.localeCompare(b.sponsorName) || a.termStart.localeCompare(b.termStart));
}

/** Sponsor arrears: total owed per currency and the oldest term still unpaid, for each sponsor. */
export async function sponsorArrears(user: Actor) {
  need(user, 'finance.reports.view', 'finance.sponsors.manage', 'finance.dashboard.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await sponsorReceivables(tx, user.schoolId);
    const by = new Map<string, { sponsorId: string; sponsorName: string; owed: Totals; oldestUnpaidTerm: string | null; oldestStart: string; byTerm: SponsorTermRow[] }>();
    for (const r of rows) {
      const s = by.get(r.sponsorId) ?? { sponsorId: r.sponsorId, sponsorName: r.sponsorName, owed: zeroTotals(), oldestUnpaidTerm: null, oldestStart: '9999', byTerm: [] };
      s.byTerm.push(r);
      if (r.owedCents > 0) {
        s.owed[r.currency] += r.owedCents;
        if (r.termStart < s.oldestStart) { s.oldestStart = r.termStart; s.oldestUnpaidTerm = r.termName; }
      }
      by.set(r.sponsorId, s);
    }
    return Array.from(by.values()).filter((s) => s.owed.USD > 0 || s.owed.ZIG > 0).sort((a, b) => a.sponsorName.localeCompare(b.sponsorName));
  });
}

/** The termly claim for one sponsor: every learner, the fee items and the amounts covered (for BEAM, the list the school submits). */
export async function sponsorClaim(user: Actor, sponsorId: string, termId?: string) {
  need(user, 'finance.sponsors.manage', 'finance.reports.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sponsor = await tx.sponsor.findFirst({ where: { id: sponsorId, schoolId: user.schoolId } });
    if (!sponsor) throw new ServiceError('Sponsor not found', 404);
    const term = await resolveTerm(tx, user.schoolId, termId);
    const rows = await tx.sponsorCharge.findMany({
      where: { schoolId: user.schoolId, sponsorId, termId: term.id, cancelled: false }, orderBy: { createdAt: 'asc' },
      include: { allocations: { where: { payment: { voidedById: null } }, select: { amountCents: true } } },
    });
    const chargeNames = new Map((await tx.finCharge.findMany({ where: { schoolId: user.schoolId, id: { in: rows.map((r) => r.chargeId) } }, select: { id: true, description: true } })).map((c) => [c.id, c.description]));
    const students = await tx.student.findMany({ where: { schoolId: user.schoolId, id: { in: rows.map((r) => r.studentId) } }, select: { id: true, fullName: true, admissionNumber: true, currentClass: { select: { name: true } } } });
    const awards = await tx.sponsorAward.findMany({ where: { schoolId: user.schoolId, id: { in: rows.map((r) => r.awardId) } }, select: { id: true, reference: true } });
    const ref = new Map(awards.map((a) => [a.id, a.reference]));
    const sm = new Map(students.map((s) => [s.id, s]));
    const lines = rows.map((r) => ({ studentId: r.studentId, name: sm.get(r.studentId)?.fullName ?? '', admissionNumber: sm.get(r.studentId)?.admissionNumber ?? '', className: sm.get(r.studentId)?.currentClass?.name ?? null, item: chargeNames.get(r.chargeId) ?? '', reference: ref.get(r.awardId) ?? null, currency: r.currency, amountCents: r.amountCents, paidCents: r.allocations.reduce((s, a) => s + a.amountCents, 0) }));
    lines.sort((a, b) => a.name.localeCompare(b.name));
    const totals = zeroTotals(); const paid = zeroTotals();
    for (const l of lines) { totals[l.currency] += l.amountCents; paid[l.currency] += l.paidCents; }
    const school = await tx.school.findUnique({ where: { id: user.schoolId }, select: { name: true } });
    return { school: school?.name ?? '', sponsor: { id: sponsor.id, name: sponsor.name, type: sponsor.type, contactPerson: sponsor.contactPerson, phone: sponsor.phone, email: sponsor.email, address: sponsor.address }, term: { id: term.id, name: term.name }, lines, totals, paid, learners: new Set(lines.map((l) => l.studentId)).size };
  });
}

// ─── Sponsor payments ────────────────────────────────────────────────────────

export const SponsorPaymentSchema = z.object({
  sponsorId: idSchema, currency: currencySchema, amount: amountSchema, method: z.enum(METHODS), reference: z.string().trim().max(80).optional().transform((v) => v || undefined),
  receivedOn: isoDateSchema.optional(), proofKey: z.string().trim().max(200).optional(),
});

export async function recordSponsorPayment(user: Actor, raw: unknown) {
  need(user, 'finance.payments.record');
  const input = SponsorPaymentSchema.parse(raw);
  const today = todayInHarare();
  const receivedOn = input.receivedOn ?? today;
  if (receivedOn > today) throw new ServiceError('The date received cannot be in the future', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sponsor = await tx.sponsor.findFirst({ where: { id: input.sponsorId, schoolId: user.schoolId } });
    if (!sponsor) throw new ServiceError('Sponsor not found', 404);
    await assertCurrencyOn(tx, user.schoolId, input.currency);
    if (needsReference(input.method) && !input.reference) throw new ServiceError('Enter the reference (the bank or transaction reference) for a payment that is not cash', 422);
    if (input.reference && (await tx.sponsorPayment.findFirst({ where: { schoolId: user.schoolId, reference: { equals: input.reference, mode: 'insensitive' }, status: { not: 'REJECTED' } } }))) {
      throw new ServiceError('This reference was already recorded', 409);
    }
    const year = Number(receivedOn.slice(0, 4));
    const cash = isCash(input.method);
    const ackNumber = await nextSerial(tx, user.schoolId, year, 'ACK');
    const receiptNumber = cash ? await nextReceiptNumber(tx, user.schoolId, year) : null;
    const p = await tx.sponsorPayment.create({
      data: { schoolId: user.schoolId, sponsorId: sponsor.id, currency: input.currency, amountCents: input.amount, method: input.method, reference: input.reference, receivedOn: dayOf(receivedOn), receiptNumber, ackNumber, proofKey: input.proofKey || null, status: cash ? 'RECEIVED' : 'PENDING', recordedById: user.id },
    });
    await audit(tx, user, 'RECORD_SPONSOR_PAYMENT', 'SponsorPayment', p.id, `Recorded ${formatMoney(input.amount, input.currency)} from ${sponsor.name}`, undefined, { sponsorId: sponsor.id, currency: input.currency, amountCents: input.amount, method: input.method, status: p.status, receiptNumber, ackNumber });
    await tellApprovers(tx, user, 'finance.payments.verify', { title: 'Sponsor payment to verify', body: sponsor.name, link: '/finance/sponsors' });
    return { id: p.id, receiptNumber, ackNumber };
  });
}

/** Shares a verified sponsor payment over the sponsor's unpaid claims, oldest term first. */
async function allocateSponsor(tx: Db, user: Pick<Actor, 'id' | 'schoolId'>, paymentId: string, splits?: { sponsorChargeId: string; amount: number }[]) {
  const p = await tx.sponsorPayment.findUniqueOrThrow({ where: { id: paymentId } });
  const used = (await tx.sponsorPaymentAllocation.aggregate({ where: { paymentId }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  let left = p.amountCents - used;
  const open = await tx.sponsorCharge.findMany({
    where: { schoolId: user.schoolId, sponsorId: p.sponsorId, currency: p.currency, cancelled: false }, orderBy: { createdAt: 'asc' },
    include: { allocations: { where: { payment: { voidedById: null } }, select: { amountCents: true } } },
  });
  const owed = new Map(open.map((c) => [c.id, c.amountCents - c.allocations.reduce((s, a) => s + a.amountCents, 0)]));
  const rows: { sponsorChargeId: string; amountCents: number }[] = [];
  if (splits) {
    for (const s of splits) {
      if (s.amount > (owed.get(s.sponsorChargeId) ?? 0)) throw new ServiceError('The sponsor owes less than that on one of the charges', 409);
      if (s.amount > left) throw new ServiceError('That is more than the payment holds', 409);
      left -= s.amount; rows.push({ sponsorChargeId: s.sponsorChargeId, amountCents: s.amount });
    }
  } else {
    for (const c of open) {
      if (left <= 0) break;
      const take = Math.min(left, owed.get(c.id) ?? 0);
      if (take > 0) { rows.push({ sponsorChargeId: c.id, amountCents: take }); left -= take; }
    }
  }
  if (rows.length) await tx.sponsorPaymentAllocation.createMany({ data: rows.map((r) => ({ schoolId: user.schoolId, paymentId, sponsorChargeId: r.sponsorChargeId, amountCents: r.amountCents, createdById: user.id })) });
  return rows.reduce((s, r) => s + r.amountCents, 0);
}

export async function verifySponsorPayment(user: Actor, id: string) {
  need(user, 'finance.payments.verify');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const p = await tx.sponsorPayment.findFirst({ where: { id, schoolId: user.schoolId }, include: { sponsor: { select: { name: true } } } });
    if (!p) throw new ServiceError('Payment not found', 404);
    if (p.voidedById) throw new ServiceError('This payment was voided', 409);
    if (p.status !== 'PENDING' && p.status !== 'RECEIVED') throw new ServiceError(`This payment was already ${p.status.toLowerCase()}`, 409);
    if (p.recordedById === user.id) throw new ServiceError('You recorded this payment, so someone else must verify it.', 403);
    const receiptNumber = p.receiptNumber ?? (await nextReceiptNumber(tx, user.schoolId, Number(ymd(p.receivedOn).slice(0, 4))));
    const moved = await tx.sponsorPayment.updateMany({ where: { id, schoolId: user.schoolId, status: { in: ['PENDING', 'RECEIVED'] } }, data: { status: 'VERIFIED', receiptNumber, verifiedById: user.id, verifiedAt: new Date() } });
    if (moved.count !== 1) throw new ServiceError('This payment was just decided by someone else', 409);
    const allocated = await allocateSponsor(tx, user, id);
    await audit(tx, user, 'VERIFY_SPONSOR_PAYMENT', 'SponsorPayment', id, `Verified ${receiptNumber} from ${p.sponsor.name}`, { status: p.status }, { status: 'VERIFIED', verifiedById: user.id, receiptNumber, allocatedCents: allocated });
    return { id, receiptNumber, allocatedCents: allocated, creditCents: p.amountCents - allocated };
  });
}

export async function rejectSponsorPayment(user: Actor, id: string, rawReason: unknown) {
  need(user, 'finance.payments.verify');
  const reason = whySchema(5).parse(rawReason);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const p = await tx.sponsorPayment.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!p) throw new ServiceError('Payment not found', 404);
    if (p.status !== 'PENDING' && p.status !== 'RECEIVED') throw new ServiceError(`This payment was already ${p.status.toLowerCase()}`, 409);
    if (p.recordedById === user.id) throw new ServiceError('You recorded this payment, so someone else must decide on it.', 403);
    await tx.sponsorPayment.update({ where: { id }, data: { status: 'REJECTED', rejectedById: user.id, rejectedAt: new Date(), rejectionReason: reason } });
    await audit(tx, user, 'VERIFY_SPONSOR_PAYMENT', 'SponsorPayment', id, `Rejected a sponsor payment: ${reason}`, { status: p.status }, { status: 'REJECTED', rejectedById: user.id, reason });
    return { id };
  });
}

export async function voidSponsorPayment(user: Actor, id: string, rawReason: unknown) {
  need(user, 'finance.payments.void');
  const reason = whySchema().parse(rawReason);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const p = await tx.sponsorPayment.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!p) throw new ServiceError('Payment not found', 404);
    if (p.voidedById) throw new ServiceError('This payment was already voided', 409);
    if (p.status === 'REJECTED') throw new ServiceError('A rejected payment never counted', 409);
    if (p.recordedById === user.id) throw new ServiceError('You recorded this payment, so someone else must void it.', 403);
    if (await tx.sponsorPaymentAllocation.count({ where: { paymentId: id } })) throw new ServiceError('This payment has been allocated to learners. Its allocations stop counting when it is voided, but the voiding must be done with care: ask the Owner to confirm.', 409);
    await tx.sponsorPayment.update({ where: { id }, data: { voidedById: user.id, voidedAt: new Date(), voidReason: reason } });
    await audit(tx, user, 'VERIFY_SPONSOR_PAYMENT', 'SponsorPayment', id, `Voided a sponsor payment: ${reason}`, { status: p.status }, { voided: true, reason });
    return { id };
  });
}

export const SponsorAllocateSchema = z.object({ splits: z.array(z.object({ sponsorChargeId: idSchema, amount: amountSchema })).min(1).max(200) });

/** Places the unallocated part of a verified sponsor payment by hand. */
export async function allocateSponsorPayment(user: Actor, id: string, raw: unknown) {
  need(user, 'finance.payments.allocate', 'finance.payments.verify');
  const input = SponsorAllocateSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const p = await tx.sponsorPayment.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!p || p.status !== 'VERIFIED' || p.voidedById) throw new ServiceError('Only a verified sponsor payment can be allocated', 409);
    if (p.recordedById === user.id && !holds(user, 'finance.payments.verify')) throw new ServiceError('Forbidden', 403);
    const total = await allocateSponsor(tx, user, id, input.splits.map((s) => ({ sponsorChargeId: s.sponsorChargeId, amount: s.amount })));
    await audit(tx, user, 'ALLOCATE_SPONSOR_PAYMENT', 'SponsorPayment', id, `Allocated ${total} cents to sponsor claims`, undefined, { splits: input.splits.length, cents: total });
    return { id, allocatedCents: total };
  });
}

export async function listSponsorPayments(user: Actor, sponsorId?: string) {
  need(user, 'finance.payments.view', 'finance.payments.record', 'finance.payments.verify', 'finance.sponsors.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.sponsorPayment.findMany({ where: { schoolId: user.schoolId, ...(sponsorId ? { sponsorId } : {}) }, orderBy: [{ receivedOn: 'desc' }, { recordedAt: 'desc' }], take: 200, include: { sponsor: { select: { name: true } }, allocations: { select: { amountCents: true } } } });
    const names = await nameMap(tx, user.schoolId, rows.flatMap((r) => [r.recordedById, r.verifiedById]));
    return rows.map((r) => ({
      id: r.id, sponsorId: r.sponsorId, sponsorName: r.sponsor.name, currency: r.currency as Cur, amountCents: r.amountCents, allocatedCents: r.allocations.reduce((s, a) => s + a.amountCents, 0), method: r.method,
      reference: r.reference, receivedOn: ymd(r.receivedOn), receiptNumber: r.receiptNumber, ackNumber: r.ackNumber, status: r.status, voided: !!r.voidedById, recordedBy: nameOf(names, r.recordedById), recordedById: r.recordedById, verifiedBy: nameOf(names, r.verifiedById),
    }));
  });
}
