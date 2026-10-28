// The sick bay: visits (complaint, temperature, treatment, medicine given, outcome), learners kept to rest, referrals to a clinic, the daily
// medication round for medicine the matron keeps, and the medical alerts shown before any medicine is given.
//
// Privacy: the details of a visit are for the matron and the nurse. Everyone else (a class teacher, the boarding master) sees only the fact
// that a learner is "In sick bay" (see away.ts). Opening a learner's medical alerts here is logged like opening the Medical tab.
import { z } from 'zod';
import type { FacComplaint, FacVisitOutcome, Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { can } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { notifyUsers } from '@/lib/system/notifications';
import { queueSms } from '@/lib/finance/sms';
import { drawFromStore, storeStock } from '@/lib/facilities/inventory';
import { primaryContacts } from '@/lib/facilities/exeats';
import { exeatOn } from '@/lib/facilities/away';
import { approverIds } from '@/lib/students/common';
import { audit, idSchema, isoDateSchema, need, optText, textSchema, todayInHarare, toDay, within, type Actor } from '@/lib/facilities/common';

export const COMPLAINTS = ['HEADACHE', 'FEVER', 'STOMACH_PAIN', 'INJURY', 'MENSTRUAL', 'ASTHMA', 'OTHER'] as const;
export const COMPLAINT_LABEL: Record<(typeof COMPLAINTS)[number], string> = { HEADACHE: 'Headache', FEVER: 'Fever', STOMACH_PAIN: 'Stomach pain', INJURY: 'Injury', MENSTRUAL: 'Menstrual', ASTHMA: 'Asthma', OTHER: 'Other' };
export const OUTCOMES = ['BACK_TO_CLASS', 'REST_IN_SICK_BAY', 'SENT_TO_CLINIC', 'SENT_HOME'] as const;
export const OUTCOME_LABEL: Record<(typeof OUTCOMES)[number], string> = { BACK_TO_CLASS: 'Back to class', REST_IN_SICK_BAY: 'Rest in the sick bay', SENT_TO_CLINIC: 'Sent to a clinic', SENT_HOME: 'Sent home' };
export const SICK_BAY_STORE = 'Sick bay';
const RECORD = 'facilities.sickbay.record' as const;
const VIEW = 'facilities.sickbay.view' as const;
const anySickBay = (u: Actor) => need(u, RECORD, VIEW);
const hm = (d: Date) => new Date(d.getTime() + 2 * 3_600_000).toISOString().slice(11, 16);

// ─── Medical alerts ──────────────────────────────────────────────────────────

export interface Alerts {
  studentId: string; name: string; admissionNumber: string; className: string | null; boarding: string; age: number | null;
  allergies: { name: string; severity: 'MILD' | 'SEVERE' }[]; conditions: { name: string; note?: string }[]; medications: { name: string; dose: string | null; whenGiven: string | null; keptBy: string }[];
  emergency: { name: string | null; phone: string | null }; consentEmergencyTreatment: boolean | null; inSickBay: boolean; severe: boolean;
}

/** What to read before giving a learner anything: allergies first, conditions, the medicines they already take, who to call. Logged. */
export async function medicalAlerts(user: Actor, studentId: string): Promise<Alerts> {
  need(user, RECORD);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await within(tx, user, RECORD, 'Student', studentId);
    const s = await tx.student.findFirst({ where: { id: studentId, schoolId: user.schoolId }, select: { id: true, fullName: true, admissionNumber: true, boarding: true, dateOfBirth: true, currentClass: { select: { name: true } } } });
    if (!s) throw new ServiceError('Student not found', 404);
    const [p, primary, open] = await Promise.all([
      tx.medicalProfile.findUnique({ where: { studentId }, include: { medications: true } }),
      tx.studentGuardian.findFirst({ where: { studentId, isPrimary: true }, select: { guardian: { select: { fullName: true, phone: true } } } }),
      tx.facSickBayVisit.findFirst({ where: { studentId, admittedAt: { not: null }, dischargedAt: null }, select: { id: true } }),
    ]);
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'MEDICAL_VIEWED', entityType: 'Student', entityId: studentId, detail: `${s.fullName}: medical alerts opened in the sick bay` }, tx);
    const allergies = (p?.allergies as { name: string; severity: 'MILD' | 'SEVERE' }[] | undefined) ?? [];
    return {
      studentId, name: s.fullName, admissionNumber: s.admissionNumber, className: s.currentClass?.name ?? null, boarding: s.boarding,
      age: Math.floor((Date.now() - s.dateOfBirth.getTime()) / (365.25 * 86_400_000)),
      allergies, conditions: (p?.conditions as { name: string; note?: string }[] | undefined) ?? [],
      medications: (p?.medications ?? []).map((m) => ({ name: m.name, dose: m.dose, whenGiven: m.whenGiven, keptBy: m.keptBy })),
      emergency: p?.emergencyName || p?.emergencyPhone ? { name: p?.emergencyName ?? null, phone: p?.emergencyPhone ?? null } : { name: primary?.guardian.fullName ?? null, phone: primary?.guardian.phone ?? null },
      consentEmergencyTreatment: p?.consentEmergencyTreatment ?? null, inSickBay: !!open, severe: allergies.some((a) => a.severity === 'SEVERE'),
    };
  });
}

/** A medicine whose name contains the name of an allergy the learner has (penicillin ↔ Penicillin V). */
export function allergyClash(medicine: string, allergies: { name: string; severity: string }[]): string | null {
  const m = medicine.trim().toLowerCase();
  const hit = allergies.find((a) => {
    const n = a.name.trim().toLowerCase();
    return n.length >= 3 && (m.includes(n) || n.includes(m));
  });
  return hit ? hit.name : null;
}

// ─── Visits ──────────────────────────────────────────────────────────────────

const ReferralSchema = z.object({ facility: textSchema('the clinic or hospital', 2, 100), transport: textSchema('how the learner gets there', 2, 100), accompaniedBy: textSchema('who goes with the learner', 2, 100), followUp: optText(200) });

export const VisitSchema = z.object({
  studentId: idSchema, complaint: z.enum(COMPLAINTS), complaintNote: optText(300),
  temperatureC: z.number().min(25).max(45).optional(), observations: optText(500), treatment: optText(500),
  medication: z.array(z.object({ name: textSchema('the medicine', 2, 80), dose: optText(60), stockItemId: idSchema.optional(), qty: z.number().positive().max(1000).optional() })).max(10).default([]),
  // Only when a medicine matches an allergy on the learner's record: who decided, and why.
  allergyOverrideReason: optText(300),
  outcome: z.enum(OUTCOMES), referral: ReferralSchema.optional(),
  // How the guardian was told when no SMS could be sent (Communication off, no phone): phone, in person ...
  guardianTold: optText(60),
}).refine((v) => v.complaint !== 'OTHER' || !!v.complaintNote, { path: ['complaintNote'], message: 'Say what the complaint is' })
  .refine((v) => v.outcome !== 'SENT_TO_CLINIC' || !!v.referral, { path: ['referral'], message: 'Say which clinic, how the learner gets there and who goes with them' });

const SMS_TEXT: Record<string, (name: string, at: string, extra: string) => string> = {
  REST_IN_SICK_BAY: (n, at) => `${n} is resting in the sick bay since ${at}. We will tell you if anything changes.`,
  SENT_TO_CLINIC: (n, at, x) => `${n} was sent to ${x} at ${at}. Please keep your phone on.`,
  SENT_HOME: (n, at) => `${n} was unwell and has been sent home from the sick bay at ${at}. Please see that they are cared for.`,
  BACK_TO_CLASS: (n, at) => `${n} visited the sick bay at ${at} and went back to class.`,
};

/** Records a visit. Medicine from the sick bay store is taken out of stock; a medicine that matches an allergy is refused unless someone says why. */
export async function recordVisit(user: Actor, raw: unknown) {
  need(user, RECORD);
  const v = VisitSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await within(tx, user, RECORD, 'Student', v.studentId);
    const s = await tx.student.findFirst({ where: { id: v.studentId, schoolId: user.schoolId, status: { in: ['ACTIVE', 'SUSPENDED'] } }, select: { id: true, fullName: true } });
    if (!s) throw new ServiceError('Student not found', 404);
    if (await tx.facSickBayVisit.findFirst({ where: { studentId: s.id, admittedAt: { not: null }, dischargedAt: null }, select: { id: true } })) throw new ServiceError(`${s.fullName} is already in the sick bay. Discharge them first.`, 409);
    const profile = await tx.medicalProfile.findUnique({ where: { studentId: s.id }, select: { allergies: true } });
    const allergies = (profile?.allergies as { name: string; severity: string }[] | undefined) ?? [];
    const clashes = v.medication.map((m) => ({ m: m.name, a: allergyClash(m.name, allergies) })).filter((c) => c.a);
    if (clashes.length && !v.allergyOverrideReason) throw new ServiceError(`${s.fullName} is allergic to ${clashes[0]!.a}. ${clashes[0]!.m} is not given unless a reason is recorded.`, 409);

    const now = new Date();
    const given: { name: string; dose: string | null; givenAt: string; stockItemId?: string; movementIds?: string[] }[] = [];
    for (const m of v.medication) {
      let movementIds: string[] | undefined;
      if (m.stockItemId) {
        const out = await drawFromStore(tx, user, { storeName: SICK_BAY_STORE, itemId: m.stockItemId, qty: m.qty ?? 1, type: 'ISSUE', receiverName: s.fullName, studentId: s.id, reason: `Sick bay: ${m.name}` });
        movementIds = out.movementIds;
      }
      given.push({ name: m.name, dose: m.dose ?? null, givenAt: now.toISOString(), ...(m.stockItemId ? { stockItemId: m.stockItemId } : {}), ...(movementIds ? { movementIds } : {}) });
    }

    // The guardian is told by SMS when we can; otherwise someone says how they were told.
    const text = SMS_TEXT[v.outcome]!(s.fullName, hm(now), v.referral?.facility ?? '');
    const notify = v.outcome !== 'BACK_TO_CLASS';
    const queued = notify ? await queueSms(tx, user.schoolId, await primaryContacts(tx, user.schoolId, s.id), text, { studentId: s.id, key: `sickbay:${s.id}:${now.getTime()}` }) : 0;
    if (v.outcome === 'SENT_HOME' && queued === 0 && !v.guardianTold) throw new ServiceError('No SMS could be sent. Say how the guardian was told (phone, in person ...).', 422);
    const informed = queued > 0 || !!v.guardianTold;

    const row = await tx.facSickBayVisit.create({
      data: {
        schoolId: user.schoolId, studentId: s.id, visitedAt: now, complaint: v.complaint as FacComplaint, complaintNote: v.complaintNote ?? null, temperatureC: v.temperatureC ?? null, observations: v.observations ?? null,
        treatment: v.treatment ?? null, medication: given as unknown as Prisma.InputJsonValue, outcome: v.outcome as FacVisitOutcome, referral: v.referral ? (v.referral as unknown as Prisma.InputJsonValue) : undefined,
        guardianInformedAt: informed ? now : null, guardianInformedMethod: informed ? (queued > 0 ? 'SMS' : v.guardianTold!) : null,
        admittedAt: v.outcome === 'REST_IN_SICK_BAY' ? now : null, recordedById: user.id,
      },
    });
    await audit(tx, user, 'FAC_SICKBAY_VISIT', 'FacSickBayVisit', row.id, `${s.fullName}: sick bay visit, ${OUTCOME_LABEL[v.outcome].toLowerCase()}${given.length ? `, ${given.length} medicine${given.length === 1 ? '' : 's'} given` : ''}`, undefined,
      { outcome: v.outcome, complaint: v.complaint, medicines: given.length, allergyOverride: clashes.length ? v.allergyOverrideReason : null, guardianTold: informed ? (queued > 0 ? 'SMS' : v.guardianTold) : null } as never);
    if (clashes.length) await notifyUsers(tx, user.schoolId, [user.id], { title: `Allergy override recorded for ${s.fullName}`, body: v.allergyOverrideReason, link: '/facilities/sickbay' });
    return { id: row.id, admitted: v.outcome === 'REST_IN_SICK_BAY', smsQueued: queued, allergyOverride: clashes.length > 0 };
  });
}

export async function discharge(user: Actor, id: string, raw: unknown) {
  need(user, RECORD);
  const { note } = z.object({ note: optText(300) }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const x = await tx.facSickBayVisit.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!x) throw new ServiceError('Visit not found', 404);
    await within(tx, user, RECORD, 'FacSickBayVisit', id);
    if (!x.admittedAt) throw new ServiceError('This learner was not kept in the sick bay', 409);
    if (x.dischargedAt) throw new ServiceError('This learner was already discharged', 409);
    const now = new Date();
    await tx.facSickBayVisit.update({ where: { id }, data: { dischargedAt: now, observations: note ? [x.observations, `Discharged: ${note}`].filter(Boolean).join('\n') : x.observations } });
    const s = await tx.student.findUniqueOrThrow({ where: { id: x.studentId }, select: { fullName: true } });
    const sms = await queueSms(tx, user.schoolId, await primaryContacts(tx, user.schoolId, x.studentId), `${s.fullName} has left the sick bay (${hm(now)}) and is well enough to be back at school.`, { studentId: x.studentId, key: `sickbay-out:${x.id}` });
    await audit(tx, user, 'FAC_SICKBAY_DISCHARGE', 'FacSickBayVisit', id, `${s.fullName} discharged from the sick bay`, { dischargedAt: null }, { dischargedAt: now.toISOString(), sms } as never);
    return { id, dischargedAt: now.toISOString() };
  });
}

export interface VisitRow {
  id: string; studentId: string; student: string; admissionNumber: string; className: string | null; visitedAt: string; complaint: string; complaintNote: string | null; temperatureC: number | null;
  treatment: string | null; observations: string | null; medication: { name: string; dose: string | null }[]; outcome: string; admittedAt: string | null; dischargedAt: string | null;
  referral: { facility: string; transport: string; accompaniedBy: string; followUp?: string } | null; guardianInformedAt: string | null; guardianInformedMethod: string | null;
}

/** Visits with their details: the matron and the nurse only. */
export async function listVisits(user: Actor, f: { studentId?: string; admittedOnly?: boolean; days?: number } = {}): Promise<VisitRow[]> {
  need(user, RECORD, VIEW);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const since = new Date(Date.now() - (f.days ?? 14) * 86_400_000);
    const rows = await tx.facSickBayVisit.findMany({
      where: { schoolId: user.schoolId, ...(f.studentId ? { studentId: f.studentId } : { visitedAt: { gte: since } }), ...(f.admittedOnly ? { admittedAt: { not: null }, dischargedAt: null } : {}) },
      orderBy: { visitedAt: 'desc' }, take: 300,
    });
    // Details only for learners the person reaches (a matron: her own hostel's boarders).
    const key = can(user, RECORD) ? RECORD : VIEW;
    const kept: typeof rows = [];
    for (const r of rows) {
      try { await within(tx, user, key, 'FacSickBayVisit', r.id); kept.push(r); } catch { /* not theirs to see */ }
    }
    const students = await tx.student.findMany({ where: { id: { in: kept.map((r) => r.studentId) } }, select: { id: true, fullName: true, admissionNumber: true, currentClass: { select: { name: true } } } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'MEDICAL_VIEWED', entityType: 'FacSickBayVisit', entityId: f.studentId ?? 'list', detail: 'Sick bay visits viewed' }, tx);
    return kept.map((r) => {
      const s = students.find((x) => x.id === r.studentId);
      return {
        id: r.id, studentId: r.studentId, student: s?.fullName ?? '', admissionNumber: s?.admissionNumber ?? '', className: s?.currentClass?.name ?? null, visitedAt: r.visitedAt.toISOString(), complaint: r.complaint, complaintNote: r.complaintNote,
        temperatureC: r.temperatureC, treatment: r.treatment, observations: r.observations, medication: (r.medication as { name: string; dose: string | null }[]) ?? [], outcome: r.outcome, admittedAt: r.admittedAt?.toISOString() ?? null,
        dischargedAt: r.dischargedAt?.toISOString() ?? null, referral: (r.referral as VisitRow['referral']) ?? null, guardianInformedAt: r.guardianInformedAt?.toISOString() ?? null, guardianInformedMethod: r.guardianInformedMethod,
      };
    });
  });
}

// ─── The medication round ────────────────────────────────────────────────────

/** "Morning" ... "08:00" ... "after lunch" become a time on the round. */
export function dueTimeOf(whenGiven: string | null): string {
  const w = (whenGiven ?? '').toLowerCase();
  const explicit = /\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/.exec(w);
  if (explicit) return `${explicit[1]!.padStart(2, '0')}:${explicit[2]}`;
  if (/night|bed|evening|supper/.test(w)) return '19:30';
  if (/lunch|midday|noon/.test(w)) return '12:30';
  return '07:00';
}

export interface RoundRow { id: string; studentId: string; student: string; room: string | null; medicine: string; dose: string | null; dueTime: string; givenAt: string | null; givenBy: string | null; missed: boolean; note: string | null }

/** The day's round for medicine the matron or office keeps: one line per learner, medicine and time. Learners away on exeat are left off. */
export async function medicationRound(user: Actor, date?: string): Promise<{ date: string; rows: RoundRow[]; closed: boolean }> {
  need(user, RECORD);
  const day = date ?? todayInHarare();
  if (!isoDateSchema.safeParse(day).success) throw new ServiceError('Enter a valid date', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const round = await tx.facMedicationRound.upsert({ where: { schoolId_date: { schoolId: user.schoolId, date: toDay(day) } }, update: {}, create: { schoolId: user.schoolId, date: toDay(day), createdById: user.id } });
    if (day === todayInHarare()) {
      const entries = await tx.medicationEntry.findMany({ where: { schoolId: user.schoolId, keptBy: { in: ['MATRON', 'OFFICE'] }, profile: { student: { status: 'ACTIVE' } } }, select: { id: true, name: true, dose: true, whenGiven: true, profile: { select: { studentId: true } } } });
      const away = await exeatOn(tx, day, entries.map((e) => e.profile.studentId));
      for (const e of entries) {
        if (away.has(e.profile.studentId)) continue;
        await tx.facMedicationDose.createMany({ data: [{ schoolId: user.schoolId, roundId: round.id, studentId: e.profile.studentId, medicationEntryId: e.id, medicine: e.name, dose: e.dose, dueTime: dueTimeOf(e.whenGiven) }], skipDuplicates: true });
      }
    }
    const all = await tx.facMedicationDose.findMany({ where: { roundId: round.id, schoolId: user.schoolId }, orderBy: [{ dueTime: 'asc' }] });
    const students = await tx.student.findMany({ where: { id: { in: all.map((d) => d.studentId) } }, select: { id: true, fullName: true } });
    const people = await tx.user.findMany({ where: { id: { in: all.map((d) => d.givenById ?? '') } }, select: { id: true, fullName: true } });
    const rows: RoundRow[] = [];
    for (const d of all) {
      try { await within(tx, user, RECORD, 'Student', d.studentId); } catch { continue; }
      rows.push({ id: d.id, studentId: d.studentId, student: students.find((s) => s.id === d.studentId)?.fullName ?? '', room: null, medicine: d.medicine, dose: d.dose, dueTime: d.dueTime, givenAt: d.givenAt?.toISOString() ?? null, givenBy: people.find((p) => p.id === d.givenById)?.fullName ?? null, missed: d.missed, note: d.note });
    }
    rows.sort((a, b) => a.dueTime.localeCompare(b.dueTime) || a.student.localeCompare(b.student));
    return { date: day, rows, closed: rows.length > 0 && rows.every((r) => r.givenAt || r.missed) };
  });
}

/** Ticks a dose as given, by the person holding the phone. A dose given once cannot be ticked twice. */
export async function giveDose(user: Actor, id: string, raw: unknown) {
  need(user, RECORD);
  const { note } = z.object({ note: optText(200) }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const d = await tx.facMedicationDose.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!d) throw new ServiceError('Dose not found', 404);
    await within(tx, user, RECORD, 'Student', d.studentId);
    if (d.givenAt) throw new ServiceError('This dose was already given', 409);
    const s = await tx.student.findUniqueOrThrow({ where: { id: d.studentId }, select: { fullName: true } });
    const p = await tx.medicalProfile.findUnique({ where: { studentId: d.studentId }, select: { allergies: true } });
    const clash = allergyClash(d.medicine, (p?.allergies as { name: string; severity: string }[] | undefined) ?? []);
    if (clash) throw new ServiceError(`${s.fullName} is allergic to ${clash}. Check the medicine before giving it.`, 409);
    await tx.facMedicationDose.update({ where: { id }, data: { givenAt: new Date(), givenById: user.id, missed: false, note: note ?? d.note } });
    await audit(tx, user, 'FAC_MEDICATION_DOSE', 'FacMedicationDose', id, `${s.fullName}: ${d.medicine} given`, undefined, { dueTime: d.dueTime } as never);
    return { id };
  });
}

/** Closes the round: every dose not ticked is flagged missed and the matron and the nurses are told. */
export async function closeRound(user: Actor, raw: unknown) {
  need(user, RECORD);
  const { date } = z.object({ date: isoDateSchema.optional() }).parse(raw);
  const day = date ?? todayInHarare();
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const round = await tx.facMedicationRound.findUnique({ where: { schoolId_date: { schoolId: user.schoolId, date: toDay(day) } } });
    if (!round) throw new ServiceError('There is no round for that day', 404);
    const open = await tx.facMedicationDose.findMany({ where: { roundId: round.id, schoolId: user.schoolId, givenAt: null, missed: false } });
    if (open.length) {
      await tx.facMedicationDose.updateMany({ where: { id: { in: open.map((d) => d.id) } }, data: { missed: true } });
      await audit(tx, user, 'FAC_MEDICATION_DOSE', 'FacMedicationRound', round.id, `Round for ${day} closed with ${open.length} missed dose${open.length === 1 ? '' : 's'}`, undefined, { missed: open.length } as never);
      const people = await approverIds(tx, user.schoolId, RECORD);
      await notifyUsers(tx, user.schoolId, [user.id, ...people], { title: `${open.length} missed medicine dose${open.length === 1 ? '' : 's'} on ${day}`, link: '/facilities/sickbay/round' });
    }
    return { missed: open.length };
  });
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export async function sickBaySummary(user: Actor) {
  anySickBay(user);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const today = toDay(todayInHarare());
    const [inNow, visitsToday, missed, store] = await Promise.all([
      tx.facSickBayVisit.count({ where: { schoolId: user.schoolId, admittedAt: { not: null }, dischargedAt: null } }),
      tx.facSickBayVisit.count({ where: { schoolId: user.schoolId, visitedAt: { gte: today } } }),
      tx.facMedicationDose.count({ where: { schoolId: user.schoolId, missed: true, createdAt: { gte: today } } }),
      tx.facStore.findFirst({ where: { schoolId: user.schoolId, name: SICK_BAY_STORE }, select: { id: true } }),
    ]);
    return { inNow, visitsToday, missedToday: missed, storeId: store?.id ?? null };
  });
}

/** The medicine in the Sick bay store, for the picker on the visit form. */
export async function sickBayMedicine(user: Actor) {
  need(user, RECORD);
  return getScopedDb(user.schoolId, user.id).$tx((tx) => storeStock(tx, user.schoolId, SICK_BAY_STORE));
}
