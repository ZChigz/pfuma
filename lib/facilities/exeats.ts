// Exeats and visiting days: a boarder leaving for the weekend, a long exeat, a medical or emergency one, and the visitors who come on visiting
// days. The boarding master records an exeat after the guardian calls and approves the ordinary ones; the Head approves long and emergency
// exeats. At the gate the collector is checked against the guardians marked "can collect", or the primary guardian's confirmation is recorded,
// and the guardian is told by SMS when the learner leaves and when they are back. Late returns are reported to the boarding master, and after
// two hours to the Head with the guardian's phone.
import { z } from 'zod';
import type { FacExeatType, Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { can, type PermissionKey } from '@/lib/access-core';
import { scopeWhere } from '@/lib/access/where';
import * as guards from '@/lib/access/guards';
import { notifyUsers } from '@/lib/system/notifications';
import { approverIds } from '@/lib/students/common';
import { queueSms, type Contact } from '@/lib/finance/sms';
import {
  addDays, audit, idSchema, isoOf, loadFacSettings, need, optText, textSchema, todayInHarare, toDay, within, type Actor,
} from '@/lib/facilities/common';
import { parseScan } from '@/lib/facilities/scan';

export const EXEAT_TYPES = ['WEEKEND', 'LONG', 'MEDICAL', 'EMERGENCY', 'SCHOOL_ACTIVITY'] as const;
export const TYPE_LABEL: Record<(typeof EXEAT_TYPES)[number], string> = { WEEKEND: 'Weekend', LONG: 'Long (mid-term or more than 3 nights)', MEDICAL: 'Medical', EMERGENCY: 'Emergency', SCHOOL_ACTIVITY: 'School activity' };
/** The boarding master approves these; the Head approves the others. */
export const HEAD_TYPES: readonly string[] = ['LONG', 'EMERGENCY'];
export const CONFIRM_METHODS = ['PHONE', 'SMS', 'WRITTEN', 'IN_PERSON'] as const;

const DAY = 86_400_000;
const REQUEST_KEYS = ['facilities.exeats.request', 'facilities.exeats.approve', 'facilities.exeats.signout'] as const satisfies readonly PermissionKey[];
const heldKey = (user: Actor): PermissionKey => REQUEST_KEYS.find((k) => can(user, k)) ?? 'facilities.exeats.request';
const harare = (d: Date) => isoOf(new Date(d.getTime() + 2 * 3_600_000));
const hm = (d: Date) => new Date(d.getTime() + 2 * 3_600_000).toISOString().slice(11, 16);

// ─── The person collecting ───────────────────────────────────────────────────

export const CollectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('GUARDIAN'), guardianId: idSchema }),
  z.object({
    kind: z.literal('OTHER'), name: textSchema('the collector\'s name', 3, 80), idNumber: textSchema('their ID number', 5, 30), phone: textSchema('their phone number', 7, 20),
    // The primary guardian confirms that this person may collect: who said so, how, and a note.
    confirmedBy: textSchema('who confirmed (the primary guardian)', 3, 80), confirmMethod: z.enum(CONFIRM_METHODS), confirmNote: optText(200),
  }),
]);
export type Collector = z.infer<typeof CollectorSchema>;

interface Stored { kind: 'GUARDIAN' | 'OTHER' | 'PENDING'; [k: string]: unknown }

/** Checks the collector against the learner's guardians and turns it into the record kept on the exeat. */
async function collectorRecord(tx: Db, schoolId: string, studentId: string, c: Collector | undefined): Promise<Stored> {
  if (!c) return { kind: 'PENDING' };
  if (c.kind === 'GUARDIAN') {
    const link = await tx.studentGuardian.findFirst({ where: { studentId, guardianId: c.guardianId, student: { schoolId } }, select: { canCollect: true, guardian: { select: { fullName: true, phone: true } } } });
    if (!link) throw new ServiceError('That guardian is not on this learner\'s record', 404);
    if (!link.canCollect) throw new ServiceError(`${link.guardian.fullName} is not marked as allowed to collect this learner. Choose another adult and record the primary guardian's confirmation.`, 409);
    return { kind: 'GUARDIAN', guardianId: c.guardianId, name: link.guardian.fullName, phone: link.guardian.phone };
  }
  return { kind: 'OTHER', name: c.name, idNumber: c.idNumber, phone: c.phone, primaryConfirmedBy: c.confirmedBy, confirmMethod: c.confirmMethod, confirmNote: c.confirmNote ?? null, primaryConfirmedAt: new Date().toISOString() };
}

/** What the gate may show of an ID number: the end of it, unless the person may see guardians' ID numbers. */
const maskId = (id: string | null, full: boolean) => (!id ? null : full || id.length <= 4 ? id : `${'•'.repeat(Math.max(0, id.length - 4))}${id.slice(-4)}`);

export async function primaryContacts(tx: Db, schoolId: string, studentId: string): Promise<Contact[]> {
  const links = await tx.studentGuardian.findMany({ where: { studentId, isPrimary: true, canReceiveSms: true, student: { schoolId } }, select: { guardian: { select: { id: true, fullName: true, phone: true } } } });
  return links.map((l) => ({ guardianId: l.guardian.id, name: l.guardian.fullName, phone: l.guardian.phone }));
}

async function boardingMasterOf(tx: Db, studentId: string): Promise<{ userId: string | null; hostel: string | null }> {
  const a = await tx.facBedAllocation.findFirst({ where: { studentId, toDate: null }, select: { bedId: true } });
  if (!a) return { userId: null, hostel: null };
  const bed = await tx.facBed.findUnique({ where: { id: a.bedId }, select: { roomId: true } });
  const room = bed ? await tx.facRoom.findUnique({ where: { id: bed.roomId }, select: { hostelId: true } }) : null;
  const h = room ? await tx.facHostel.findUnique({ where: { id: room.hostelId }, select: { boardingMasterId: true, name: true } }) : null;
  return { userId: h?.boardingMasterId ?? null, hostel: h?.name ?? null };
}

// ─── Recording and approving ─────────────────────────────────────────────────

export const ExeatSchema = z.object({
  studentId: idSchema, type: z.enum(EXEAT_TYPES), outAt: z.coerce.date(), dueBackAt: z.coerce.date(), reason: textSchema('the reason', 3, 300),
  collector: CollectorSchema.optional(),
  // The boarding master records and approves an ordinary exeat in one go.
  approveNow: z.boolean().optional(),
});

const nightsBetween = (out: Date, back: Date) => Math.max(0, Math.round((new Date(`${harare(back)}T00:00:00Z`).getTime() - new Date(`${harare(out)}T00:00:00Z`).getTime()) / DAY));

async function overlapping(tx: Db, schoolId: string, studentId: string, out: Date, back: Date, exceptId?: string) {
  return tx.facExeat.findFirst({
    where: { schoolId, studentId, status: { in: ['REQUESTED', 'APPROVED', 'SIGNED_OUT'] }, outAt: { lt: back }, dueBackAt: { gt: out }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true, type: true },
  });
}

/** The boarding master records an exeat after the guardian calls, writes or messages. */
export async function requestExeat(user: Actor, raw: unknown) {
  need(user, 'facilities.exeats.request');
  const v = ExeatSchema.parse(raw);
  if (v.dueBackAt <= v.outAt) throw new ServiceError('The learner must be due back after they leave', 422);
  if (v.outAt.getTime() < Date.now() - DAY) throw new ServiceError('An exeat cannot start more than a day ago', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.student.findFirst({ where: { id: v.studentId, schoolId: user.schoolId }, select: { id: true, fullName: true, boarding: true, status: true } });
    if (!s) throw new ServiceError('Student not found', 404);
    if (s.boarding !== 'BOARDER') throw new ServiceError(`${s.fullName} is a day scholar. Exeats are for boarders.`, 409);
    await within(tx, user, 'facilities.exeats.request', 'Student', v.studentId);
    if (s.status !== 'ACTIVE') throw new ServiceError(`${s.fullName} is not at the school`, 409);
    const settings = await loadFacSettings(tx, user.schoolId);
    const nights = nightsBetween(v.outAt, v.dueBackAt);
    if (nights > settings.longExeatNights && (v.type === 'WEEKEND' || v.type === 'SCHOOL_ACTIVITY')) throw new ServiceError(`That is ${nights} nights, more than ${settings.longExeatNights}. Record it as a long exeat; the Head approves it.`, 422);
    const clash = await overlapping(tx, user.schoolId, s.id, v.outAt, v.dueBackAt);
    if (clash) throw new ServiceError(`${s.fullName} already has an exeat (${TYPE_LABEL[clash.type].toLowerCase()}) in those dates`, 409);
    const collectedBy = await collectorRecord(tx, user.schoolId, s.id, v.collector);
    const headType = HEAD_TYPES.includes(v.type);
    const approve = !!v.approveNow && !headType;
    const x = await tx.facExeat.create({
      data: {
        schoolId: user.schoolId, studentId: s.id, type: v.type as FacExeatType, outAt: v.outAt, dueBackAt: v.dueBackAt, reason: v.reason, collectedBy: collectedBy as Prisma.InputJsonValue, requestedById: user.id,
        ...(approve ? { status: 'APPROVED' as const, approvedById: user.id, approvedAt: new Date() } : {}),
      },
    });
    await audit(tx, user, approve ? 'FAC_EXEAT_APPROVE' : 'FAC_EXEAT_REQUEST', 'FacExeat', x.id, `${s.fullName}: ${TYPE_LABEL[v.type].toLowerCase()} exeat from ${harare(v.outAt)} to ${harare(v.dueBackAt)}${approve ? ' (recorded and approved)' : ''}`, undefined,
      { studentId: s.id, type: v.type, outAt: v.outAt.toISOString(), dueBackAt: v.dueBackAt.toISOString(), reason: v.reason, collector: collectedBy.kind, status: x.status } as never);
    if (headType) {
      const heads = await approverIds(tx, user.schoolId, 'facilities.exeats.approve', user.id);
      await notifyUsers(tx, user.schoolId, heads, { title: `${TYPE_LABEL[v.type].split(' ')[0]} exeat to approve: ${s.fullName}`, body: `${harare(v.outAt)} to ${harare(v.dueBackAt)}. ${v.reason}`.slice(0, 200), link: '/facilities/exeats' });
    }
    return { id: x.id, status: x.status, needsHead: headType };
  });
}

export const DecideSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: optText(300) });

/** Decides one request. The boarding master decides ordinary exeats, the Head long and emergency ones; nobody decides one they recorded themselves if it is the Head's to decide. */
export async function decideExeat(user: Actor, id: string, raw: unknown) {
  const v = DecideSchema.parse(raw);
  if (v.decision === 'REJECT' && (v.reason ?? '').trim().length < 3) throw new ServiceError('Say why the exeat is refused', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => decideTx(tx, user, id, v));
}

async function decideTx(tx: Db, user: Actor, id: string, v: z.infer<typeof DecideSchema>) {
  const x = await tx.facExeat.findFirst({ where: { id, schoolId: user.schoolId } });
  if (!x) throw new ServiceError('Exeat not found', 404);
  if (x.status !== 'REQUESTED') throw new ServiceError('This exeat was already decided', 409);
  const headType = HEAD_TYPES.includes(x.type);
  if (headType) {
    need(user, 'facilities.exeats.approve');
    guards.cannotApproveOwn(user, x.requestedById, 'exeat request');
  } else {
    need(user, 'facilities.exeats.request', 'facilities.exeats.approve');
    await within(tx, user, can(user, 'facilities.exeats.request') ? 'facilities.exeats.request' : 'facilities.exeats.approve', 'Student', x.studentId);
  }
  const s = await tx.student.findUniqueOrThrow({ where: { id: x.studentId }, select: { fullName: true } });
  if (v.decision === 'REJECT') {
    await tx.facExeat.update({ where: { id }, data: { status: 'REJECTED', rejectedReason: v.reason! } });
    await audit(tx, user, 'FAC_EXEAT_REJECT', 'FacExeat', id, `${s.fullName}: exeat refused: ${v.reason}`, { status: 'REQUESTED' }, { status: 'REJECTED', reason: v.reason ?? null });
    await notifyUsers(tx, user.schoolId, [x.requestedById], { title: `Exeat refused: ${s.fullName}`, body: v.reason ?? undefined, link: '/facilities/exeats' });
    return { status: 'REJECTED' as const };
  }
  await tx.facExeat.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() } });
  await audit(tx, user, 'FAC_EXEAT_APPROVE', 'FacExeat', id, `${s.fullName}: ${TYPE_LABEL[x.type].toLowerCase()} exeat approved`, { status: 'REQUESTED' }, { status: 'APPROVED', approvedById: user.id });
  if (x.requestedById !== user.id) await notifyUsers(tx, user.schoolId, [x.requestedById], { title: `Exeat approved: ${s.fullName}`, link: '/facilities/exeats' });
  return { status: 'APPROVED' as const };
}

/** Decides several at once (a general exeat weekend, a long exeat for a whole form). */
export async function decideMany(user: Actor, raw: unknown) {
  const v = DecideSchema.extend({ ids: z.array(idSchema).min(1).max(300) }).parse(raw);
  if (v.decision === 'REJECT' && (v.reason ?? '').trim().length < 3) throw new ServiceError('Say why the exeats are refused', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    let done = 0;
    for (const id of v.ids) { await decideTx(tx, user, id, v); done++; }
    return { decided: done };
  });
}

export async function cancelExeat(user: Actor, id: string, raw: unknown) {
  need(user, 'facilities.exeats.request', 'facilities.exeats.approve');
  const { reason } = z.object({ reason: textSchema('the reason', 3, 300) }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const x = await tx.facExeat.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!x) throw new ServiceError('Exeat not found', 404);
    await within(tx, user, heldKey(user), 'Student', x.studentId);
    if (x.status !== 'REQUESTED' && x.status !== 'APPROVED') throw new ServiceError(x.status === 'SIGNED_OUT' ? 'The learner has already left. Sign them back in when they return.' : 'This exeat is closed', 409);
    await tx.facExeat.update({ where: { id }, data: { status: 'CANCELLED', rejectedReason: reason } });
    await audit(tx, user, 'FAC_EXEAT_REJECT', 'FacExeat', id, `Exeat cancelled: ${reason}`, { status: x.status }, { status: 'CANCELLED', reason });
    return { id };
  });
}

/** Who will collect: set or changed before the learner leaves. */
export async function setCollector(user: Actor, id: string, raw: unknown) {
  need(user, 'facilities.exeats.request', 'facilities.exeats.signout');
  const c = CollectorSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const x = await tx.facExeat.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!x) throw new ServiceError('Exeat not found', 404);
    await within(tx, user, heldKey(user), 'Student', x.studentId);
    if (x.status !== 'REQUESTED' && x.status !== 'APPROVED') throw new ServiceError('The collector can only be changed before the learner leaves', 409);
    const rec = await collectorRecord(tx, user.schoolId, x.studentId, c);
    await tx.facExeat.update({ where: { id }, data: { collectedBy: rec as Prisma.InputJsonValue } });
    await audit(tx, user, 'FAC_EXEAT_REQUEST', 'FacExeat', id, `Collector set: ${rec.kind === 'GUARDIAN' ? 'a guardian' : 'another adult, confirmed by the primary guardian'}`, undefined, { collector: rec.kind } as never);
    return { id };
  });
}

// ─── Lists ───────────────────────────────────────────────────────────────────

export interface ExeatRow {
  id: string; studentId: string; student: string; admissionNumber: string; className: string | null; type: string; status: string; outAt: string; dueBackAt: string; reason: string;
  collector: string | null; collectorKind: string; requestedBy: string; approvedBy: string | null; signedOutAt: string | null; signedInAt: string | null; overdueMinutes: number; rejectedReason: string | null; requestedById: string; hostel: string | null;
}

export async function listExeats(user: Actor, f: { status?: string; studentId?: string; scope?: 'open' | 'today' | 'all' } = {}): Promise<ExeatRow[]> {
  need(user, ...REQUEST_KEYS);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await exeatAlerts(tx, user.schoolId);
    const where = (await scopeWhere(user, heldKey(user), 'FacExeat', tx)) as Prisma.FacExeatWhereInput;
    const now = new Date();
    const open = f.scope === 'open' || (!f.scope && !f.status && !f.studentId);
    const rows = await tx.facExeat.findMany({
      where: {
        AND: [where, { schoolId: user.schoolId }, f.studentId ? { studentId: f.studentId } : {}, f.status ? { status: f.status as never } : {},
          ...(open ? [{ status: { in: ['REQUESTED', 'APPROVED', 'SIGNED_OUT'] as never[] } }] : []), ...(f.scope === 'today' ? [{ outAt: { lt: new Date(now.getTime() + DAY) }, dueBackAt: { gt: new Date(now.getTime() - DAY) } }] : [])],
      },
      orderBy: [{ outAt: 'asc' }], take: 300,
    });
    const students = await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId) } }, select: { id: true, fullName: true, admissionNumber: true, currentClass: { select: { name: true } } } });
    const users = await tx.user.findMany({ where: { id: { in: rows.flatMap((r) => [r.requestedById, r.approvedById ?? '']) } }, select: { id: true, fullName: true } });
    const un = (id: string | null) => users.find((u) => u.id === id)?.fullName ?? null;
    const hostels = new Map<string, string | null>();
    for (const sid of Array.from(new Set(rows.map((r) => r.studentId)))) hostels.set(sid, (await boardingMasterOf(tx, sid)).hostel);
    return rows.map((r): ExeatRow => {
      const s = students.find((x) => x.id === r.studentId);
      const c = r.collectedBy as unknown as Stored;
      return {
        id: r.id, studentId: r.studentId, student: s?.fullName ?? '', admissionNumber: s?.admissionNumber ?? '', className: s?.currentClass?.name ?? null, type: r.type, status: r.status, outAt: r.outAt.toISOString(), dueBackAt: r.dueBackAt.toISOString(),
        reason: r.reason, collector: c.kind === 'PENDING' ? null : String(c.name ?? ''), collectorKind: c.kind, requestedBy: un(r.requestedById) ?? '', requestedById: r.requestedById, approvedBy: un(r.approvedById), signedOutAt: r.signedOutAt?.toISOString() ?? null,
        signedInAt: r.signedInAt?.toISOString() ?? null, overdueMinutes: r.status === 'SIGNED_OUT' && r.dueBackAt < now ? Math.floor((now.getTime() - r.dueBackAt.getTime()) / 60_000) : 0, rejectedReason: r.rejectedReason, hostel: hostels.get(r.studentId) ?? null,
      };
    });
  });
}

// ─── The gate ────────────────────────────────────────────────────────────────

export interface GateCard {
  student: { id: string; name: string; admissionNumber: string; className: string | null; photoUrl: string | null; boarding: string };
  exeat: ExeatRow | null;
  /** Guardians marked "can collect", with the ID number to check (the end of it unless the person may see ID numbers). */
  collectors: { guardianId: string; name: string; relationship: string; phone: string; idNumber: string | null; isPrimary: boolean }[];
  /** Shown in red at sign-out. */
  custodyNotes: { guardian: string; note: string }[];
  primaryPhone: string | null;
}

/** The learner at the gate (scanned or typed): their exeat, who may collect them, and any custody note. */
export async function gateLookup(user: Actor, rawCode: string): Promise<GateCard> {
  need(user, 'facilities.exeats.signout', 'facilities.exeats.request', 'facilities.exeats.approve');
  const code = parseScan(rawCode).value;
  if (!code) throw new ServiceError('Nothing was scanned', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.student.findFirst({ where: { schoolId: user.schoolId, status: { in: ['ACTIVE', 'SUSPENDED'] }, OR: [{ id: code }, { admissionNumber: { equals: code, mode: 'insensitive' } }, { fullName: { contains: code, mode: 'insensitive' } }] }, select: { id: true, fullName: true, admissionNumber: true, photoUrl: true, boarding: true, currentClass: { select: { name: true } } } });
    if (!s) throw new ServiceError('No learner has that number or name', 404);
    await within(tx, user, heldKey(user), 'Student', s.id);
    const rows = await listExeatsFor(tx, user, s.id);
    const links = await tx.studentGuardian.findMany({ where: { studentId: s.id, student: { schoolId: user.schoolId } }, select: { relationship: true, isPrimary: true, canCollect: true, custodyNote: true, guardian: { select: { id: true, fullName: true, phone: true, nationalId: true } } } });
    const fullIds = can(user, 'students.guardians.view_ids');
    return {
      student: { id: s.id, name: s.fullName, admissionNumber: s.admissionNumber, className: s.currentClass?.name ?? null, photoUrl: s.photoUrl, boarding: s.boarding },
      exeat: rows,
      collectors: links.filter((l) => l.canCollect).map((l) => ({ guardianId: l.guardian.id, name: l.guardian.fullName, relationship: l.relationship, phone: l.guardian.phone, idNumber: maskId(l.guardian.nationalId, fullIds), isPrimary: l.isPrimary })),
      custodyNotes: links.filter((l) => l.custodyNote).map((l) => ({ guardian: l.guardian.fullName, note: l.custodyNote! })),
      primaryPhone: links.find((l) => l.isPrimary)?.guardian.phone ?? null,
    };
  });
}

async function listExeatsFor(tx: Db, user: Actor, studentId: string): Promise<ExeatRow | null> {
  const x = await tx.facExeat.findFirst({ where: { schoolId: user.schoolId, studentId, status: { in: ['APPROVED', 'SIGNED_OUT'] } }, orderBy: [{ status: 'desc' }, { outAt: 'asc' }] });
  if (!x) return null;
  const c = x.collectedBy as unknown as Stored;
  const now = new Date();
  return {
    id: x.id, studentId, student: '', admissionNumber: '', className: null, type: x.type, status: x.status, outAt: x.outAt.toISOString(), dueBackAt: x.dueBackAt.toISOString(), reason: x.reason, collector: c.kind === 'PENDING' ? null : String(c.name ?? ''), collectorKind: c.kind,
    requestedBy: '', requestedById: x.requestedById, approvedBy: null, signedOutAt: x.signedOutAt?.toISOString() ?? null, signedInAt: null, overdueMinutes: x.status === 'SIGNED_OUT' && x.dueBackAt < now ? Math.floor((now.getTime() - x.dueBackAt.getTime()) / 60_000) : 0, rejectedReason: null, hostel: null,
  };
}

export const SignOutSchema = z.object({ exeatId: idSchema, collector: CollectorSchema.optional() });

/** Signs the learner out: the collector is checked, the time is recorded, and the primary guardian gets an SMS with the time (when Communication is on). */
export async function signOut(user: Actor, raw: unknown) {
  need(user, 'facilities.exeats.signout');
  const v = SignOutSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const x = await tx.facExeat.findFirst({ where: { id: v.exeatId, schoolId: user.schoolId } });
    if (!x) throw new ServiceError('Exeat not found', 404);
    await within(tx, user, 'facilities.exeats.signout', 'Student', x.studentId);
    if (x.status === 'SIGNED_OUT') throw new ServiceError('This learner is already signed out', 409);
    if (x.status !== 'APPROVED') throw new ServiceError(x.status === 'REQUESTED' ? 'This exeat has not been approved yet' : `This exeat is ${x.status.toLowerCase()}`, 409);
    const now = new Date();
    if (now.getTime() < x.outAt.getTime() - DAY) throw new ServiceError(`This exeat starts on ${harare(x.outAt)}`, 409);
    if (now > x.dueBackAt) throw new ServiceError('The time this exeat allowed has passed. Record a new one.', 409);
    const s = await tx.student.findUniqueOrThrow({ where: { id: x.studentId }, select: { fullName: true, status: true } });
    if (s.status !== 'ACTIVE') throw new ServiceError(`${s.fullName} is not at the school`, 409);
    const rec = v.collector ? await collectorRecord(tx, user.schoolId, x.studentId, v.collector) : (x.collectedBy as unknown as Stored);
    if (rec.kind === 'PENDING') throw new ServiceError('Say who is collecting the learner: pick a guardian marked as allowed to collect, or another adult with their ID number and the primary guardian\'s confirmation.', 422);
    const updated = await tx.facExeat.update({ where: { id: x.id }, data: { status: 'SIGNED_OUT', signedOutAt: now, signedOutById: user.id, collectedBy: rec as Prisma.InputJsonValue } });
    const sms = await queueSms(tx, user.schoolId, await primaryContacts(tx, user.schoolId, x.studentId), `${s.fullName} left school at ${hm(now)} on ${harare(now)} with ${String(rec.name)}. Due back ${harare(x.dueBackAt)} ${hm(x.dueBackAt)}.`, { studentId: x.studentId, key: `exeat-out:${x.id}` });
    await audit(tx, user, 'FAC_EXEAT_SIGN_OUT', 'FacExeat', x.id, `${s.fullName} signed out at ${hm(now)} with ${String(rec.name)}${rec.kind === 'OTHER' ? ` (ID ${String(rec.idNumber)}, confirmed by ${String(rec.primaryConfirmedBy)} by ${String(rec.confirmMethod).toLowerCase()})` : ''}`,
      { status: 'APPROVED' }, { status: 'SIGNED_OUT', signedOutAt: now.toISOString(), collector: rec.kind, collectorName: rec.name ?? null, sms } as never);
    return { id: updated.id, signedOutAt: now.toISOString(), collector: String(rec.name ?? ''), smsQueued: sms };
  });
}

/** The learner is back: signed in with the time, and the guardian is told. */
export async function signIn(user: Actor, raw: unknown) {
  need(user, 'facilities.exeats.signout');
  const { exeatId } = z.object({ exeatId: idSchema }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const x = await tx.facExeat.findFirst({ where: { id: exeatId, schoolId: user.schoolId } });
    if (!x) throw new ServiceError('Exeat not found', 404);
    await within(tx, user, 'facilities.exeats.signout', 'Student', x.studentId);
    if (x.status !== 'SIGNED_OUT') throw new ServiceError(x.status === 'RETURNED' ? 'This learner is already back' : 'This learner was not signed out', 409);
    const now = new Date();
    const s = await tx.student.findUniqueOrThrow({ where: { id: x.studentId }, select: { fullName: true } });
    await tx.facExeat.update({ where: { id: x.id }, data: { status: 'RETURNED', signedInAt: now, signedInById: user.id } });
    const lateMinutes = now > x.dueBackAt ? Math.floor((now.getTime() - x.dueBackAt.getTime()) / 60_000) : 0;
    const sms = await queueSms(tx, user.schoolId, await primaryContacts(tx, user.schoolId, x.studentId), `${s.fullName} is back at school (${hm(now)} on ${harare(now)}).`, { studentId: x.studentId, key: `exeat-in:${x.id}` });
    await audit(tx, user, 'FAC_EXEAT_SIGN_IN', 'FacExeat', x.id, `${s.fullName} signed in at ${hm(now)}${lateMinutes ? `, ${lateMinutes} minutes late` : ''}`, { status: 'SIGNED_OUT' }, { status: 'RETURNED', signedInAt: now.toISOString(), lateMinutes, sms } as never);
    return { id: x.id, signedInAt: now.toISOString(), lateMinutes, smsQueued: sms };
  });
}

// ─── Late returns ────────────────────────────────────────────────────────────

/**
 * A learner not back by the due time: the boarding master is told; two hours later (the school's setting) the Head is told too, with the
 * guardian's phone. Each is sent once. Run every few minutes, and whenever the exeat list is opened.
 */
export async function exeatAlerts(tx: Db, schoolId: string): Promise<{ boardingMaster: number; head: number }> {
  const now = new Date();
  const settings = await loadFacSettings(tx, schoolId);
  const late = await tx.facExeat.findMany({ where: { schoolId, status: 'SIGNED_OUT', dueBackAt: { lt: now } } });
  let bm = 0;
  let head = 0;
  for (const x of late) {
    const minutes = Math.floor((now.getTime() - x.dueBackAt.getTime()) / 60_000);
    const s = await tx.student.findUniqueOrThrow({ where: { id: x.studentId }, select: { fullName: true } });
    if (!x.overdueAlertedAt) {
      const m = await boardingMasterOf(tx, x.studentId);
      const people = m.userId ? [m.userId] : await approverIds(tx, schoolId, 'facilities.exeats.approve');
      await notifyUsers(tx, schoolId, people, { title: `Not back from exeat: ${s.fullName}`, body: `Due back ${harare(x.dueBackAt)} ${hm(x.dueBackAt)}${m.hostel ? ` (${m.hostel})` : ''}.`, link: '/facilities/exeats', dedupeKey: `exeat-late:${x.id}` });
      await tx.facExeat.update({ where: { id: x.id }, data: { overdueAlertedAt: now } });
      await audit(tx, { id: x.signedOutById ?? x.requestedById, schoolId }, 'FAC_EXEAT_OVERDUE', 'FacExeat', x.id, `${s.fullName} is not back from exeat: the boarding master was told`, undefined, { dueBackAt: x.dueBackAt.toISOString(), minutesLate: minutes });
      bm++;
    }
    if (!x.headAlertedAt && minutes >= settings.exeatHeadAlertMinutes) {
      const phone = (await primaryContacts(tx, schoolId, x.studentId))[0]?.phone ?? (await tx.studentGuardian.findFirst({ where: { studentId: x.studentId, isPrimary: true }, select: { guardian: { select: { phone: true } } } }))?.guardian.phone ?? 'no phone on record';
      await notifyUsers(tx, schoolId, await approverIds(tx, schoolId, 'facilities.exeats.approve'), {
        title: `Still not back from exeat: ${s.fullName}`, body: `${Math.floor(minutes / 60)} h ${minutes % 60} min late. Guardian's phone: ${phone}.`, link: '/facilities/exeats', dedupeKey: `exeat-late-head:${x.id}`,
      });
      await tx.facExeat.update({ where: { id: x.id }, data: { headAlertedAt: now } });
      await audit(tx, { id: x.signedOutById ?? x.requestedById, schoolId }, 'FAC_EXEAT_OVERDUE', 'FacExeat', x.id, `${s.fullName} is ${minutes} minutes late: the Head was told`, undefined, { minutesLate: minutes });
      head++;
    }
  }
  return { boardingMaster: bm, head };
}

// ─── A general exeat weekend from the Calendar ───────────────────────────────

export async function calendarOptions(user: Actor) {
  need(user, 'facilities.exeats.request', 'facilities.exeats.approve', 'facilities.visitors.log');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const today = toDay(todayInHarare());
    const events = await tx.calendarEvent.findMany({ where: { schoolId: user.schoolId, endDate: { gte: today }, kind: { not: 'PUBLIC_HOLIDAY' } }, orderBy: { startDate: 'asc' }, take: 40, select: { id: true, title: true, kind: true, startDate: true, endDate: true } });
    return events.map((e) => ({ id: e.id, title: e.title, kind: e.kind, startDate: isoOf(e.startDate), endDate: isoOf(e.endDate), today: isoOf(e.startDate) <= todayInHarare() && todayInHarare() <= isoOf(e.endDate) }));
  });
}

export const BulkSchema = z.object({
  hostelId: idSchema, calendarEventId: idSchema, studentIds: z.array(idSchema).max(500).optional(),
  outTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).default('08:00'), backTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).default('17:00'),
  apply: z.boolean().default(false),
});

/** A bulk list for a general exeat weekend set on the Calendar: every boarder of the hostel (or the ones chosen) who is not already away. */
export async function bulkExeats(user: Actor, raw: unknown) {
  need(user, 'facilities.exeats.request');
  const v = BulkSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await within(tx, user, 'facilities.exeats.request', 'FacHostel', v.hostelId);
    const ev = await tx.calendarEvent.findFirst({ where: { id: v.calendarEventId, schoolId: user.schoolId } });
    if (!ev) throw new ServiceError('Calendar event not found', 404);
    const out = new Date(`${isoOf(ev.startDate)}T${ev.startTime ?? v.outTime}:00+02:00`);
    const back = new Date(`${isoOf(ev.endDate)}T${ev.endTime ?? v.backTime}:00+02:00`);
    if (back <= out) throw new ServiceError('The event ends before it starts', 422);
    if (back.getTime() < Date.now()) throw new ServiceError('That event is over', 409);
    const settings = await loadFacSettings(tx, user.schoolId);
    const type: FacExeatType = nightsBetween(out, back) > settings.longExeatNights ? 'LONG' : 'WEEKEND';
    const rooms = await tx.facRoom.findMany({ where: { hostelId: v.hostelId, schoolId: user.schoolId }, select: { id: true } });
    const beds = await tx.facBed.findMany({ where: { roomId: { in: rooms.map((r) => r.id) } }, select: { id: true } });
    const stays = await tx.facBedAllocation.findMany({ where: { toDate: null, bedId: { in: beds.map((b) => b.id) } }, select: { studentId: true } });
    const wanted = new Set(v.studentIds ?? stays.map((s) => s.studentId));
    const students = await tx.student.findMany({ where: { schoolId: user.schoolId, id: { in: stays.map((s) => s.studentId).filter((id) => wanted.has(id)) }, status: 'ACTIVE', boarding: 'BOARDER' }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
    const eligible: typeof students = [];
    const skipped: { studentId: string; student: string; why: string }[] = [];
    for (const s of students) {
      const clash = await overlapping(tx, user.schoolId, s.id, out, back);
      if (clash) skipped.push({ studentId: s.id, student: s.fullName, why: 'Already has an exeat in those dates' });
      else eligible.push(s);
    }
    const preview = { event: ev.title, type, outAt: out.toISOString(), dueBackAt: back.toISOString(), learners: eligible.map((s) => ({ studentId: s.id, student: s.fullName })), skipped, needsHead: HEAD_TYPES.includes(type) };
    if (!v.apply) return { ...preview, applied: false };
    if (eligible.length === 0) throw new ServiceError('There is nobody to put on this exeat', 409);
    const approve = !HEAD_TYPES.includes(type);
    await tx.facExeat.createMany({
      data: eligible.map((s) => ({
        schoolId: user.schoolId, studentId: s.id, type, outAt: out, dueBackAt: back, reason: ev.title, collectedBy: { kind: 'PENDING' } as Prisma.InputJsonValue, requestedById: user.id, calendarEventId: ev.id,
        ...(approve ? { status: 'APPROVED' as const, approvedById: user.id, approvedAt: new Date() } : {}),
      })),
    });
    await audit(tx, user, approve ? 'FAC_EXEAT_APPROVE' : 'FAC_EXEAT_REQUEST', 'CalendarEvent', ev.id, `Exeat list for ${ev.title}: ${eligible.length} boarders${approve ? ' approved' : ' sent to the Head'}`, undefined, { hostelId: v.hostelId, type, count: eligible.length, skipped: skipped.length } as never);
    if (!approve) await notifyUsers(tx, user.schoolId, await approverIds(tx, user.schoolId, 'facilities.exeats.approve', user.id), { title: `Long exeat list to approve: ${ev.title}`, body: `${eligible.length} boarders`, link: '/facilities/exeats' });
    return { ...preview, applied: true };
  });
}

// ─── Visitors and visiting days ──────────────────────────────────────────────

export async function visitingDays(user: Actor) {
  need(user, 'facilities.visitors.log', 'facilities.exeats.request');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const today = todayInHarare();
    const events = await tx.calendarEvent.findMany({ where: { schoolId: user.schoolId, kind: 'VISITING_DAY', endDate: { gte: toDay(today) }, startDate: { lte: toDay(addDays(today, 60)) } }, orderBy: { startDate: 'asc' }, select: { id: true, title: true, startDate: true, endDate: true, startTime: true, endTime: true } });
    return events.map((e) => ({ id: e.id, title: e.title, startDate: isoOf(e.startDate), endDate: isoOf(e.endDate), startTime: e.startTime, endTime: e.endTime, today: isoOf(e.startDate) <= today && today <= isoOf(e.endDate) }));
  });
}

export const VisitorSchema = z.object({
  studentId: idSchema, visitorName: textSchema('the visitor\'s name', 3, 80), idNumber: optText(30), phone: optText(20),
  // A guardian on record is let in on a visiting day; anyone else needs the boarding master's approval (given by the boarding master logging them).
  guardianId: idSchema.optional(),
});

/** The visitor log at the gate: who came to see which learner, and when. */
export async function logVisitor(user: Actor, raw: unknown) {
  need(user, 'facilities.visitors.log');
  const v = VisitorSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.student.findFirst({ where: { id: v.studentId, schoolId: user.schoolId }, select: { id: true, fullName: true, boarding: true, status: true } });
    if (!s) throw new ServiceError('Student not found', 404);
    if (s.boarding !== 'BOARDER' || s.status !== 'ACTIVE') throw new ServiceError(`${s.fullName} is not a boarder at the school`, 409);
    await within(tx, user, 'facilities.visitors.log', 'Student', v.studentId);
    const today = todayInHarare();
    const day = await tx.calendarEvent.findFirst({ where: { schoolId: user.schoolId, kind: 'VISITING_DAY', startDate: { lte: toDay(today) }, endDate: { gte: toDay(today) } }, select: { id: true } });
    const master = can(user, 'facilities.exeats.request');
    let approvedById: string | null = null;
    let guardianId: string | null = null;
    if (v.guardianId) {
      const link = await tx.studentGuardian.findFirst({ where: { studentId: s.id, guardianId: v.guardianId, student: { schoolId: user.schoolId } }, select: { guardian: { select: { fullName: true } } } });
      if (!link) throw new ServiceError('That guardian is not on this learner\'s record', 404);
      guardianId = v.guardianId;
      if (!day && !master) throw new ServiceError('Today is not a visiting day. Ask the boarding master to approve the visit.', 409);
    } else {
      if (!master) throw new ServiceError('Only guardians on record may visit. Another visitor needs the boarding master to approve and log the visit.', 403);
      approvedById = user.id;
    }
    const row = await tx.facVisitorLog.create({ data: { schoolId: user.schoolId, studentId: s.id, visitorName: v.visitorName, idNumber: v.idNumber ?? null, phone: v.phone ?? null, guardianId, approvedById, calendarEventId: day?.id ?? null, timeIn: new Date(), loggedById: user.id } });
    await audit(tx, user, 'FAC_VISITOR_LOG', 'FacVisitorLog', row.id, `${v.visitorName} came to see ${s.fullName}${guardianId ? ' (guardian)' : ' (approved by the boarding master)'}`, undefined, { studentId: s.id, guardian: !!guardianId, visitingDay: !!day } as never);
    return { id: row.id, visitingDay: !!day };
  });
}

export async function visitorOut(user: Actor, id: string) {
  need(user, 'facilities.visitors.log');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.facVisitorLog.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!r) throw new ServiceError('Visitor not found', 404);
    await within(tx, user, 'facilities.visitors.log', 'Student', r.studentId);
    if (r.timeOut) throw new ServiceError('This visitor has already left', 409);
    await tx.facVisitorLog.update({ where: { id }, data: { timeOut: new Date() } });
    await audit(tx, user, 'FAC_VISITOR_LOG', 'FacVisitorLog', id, `${r.visitorName} left`, { timeOut: null }, { timeOut: new Date().toISOString() });
    return { id };
  });
}

export async function listVisitors(user: Actor, date?: string) {
  need(user, 'facilities.visitors.log', 'facilities.exeats.request');
  const day = date ?? todayInHarare();
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const from = new Date(`${day}T00:00:00+02:00`);
    const rows = await tx.facVisitorLog.findMany({ where: { schoolId: user.schoolId, timeIn: { gte: from, lt: new Date(from.getTime() + DAY) } }, orderBy: { timeIn: 'desc' } });
    const students = await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId) } }, select: { id: true, fullName: true } });
    return rows.map((r) => ({ id: r.id, visitor: r.visitorName, idNumber: r.idNumber, phone: r.phone, student: students.find((s) => s.id === r.studentId)?.fullName ?? '', guardian: !!r.guardianId, timeIn: r.timeIn.toISOString(), timeOut: r.timeOut?.toISOString() ?? null }));
  });
}
