// Medical notes are the most sensitive data in the system: few people see them, every view is logged,
// and only the alert line ("Medical alert: severe allergy") is shown widely.
//  • students.medical.view is separate from profile access. Without it a user never gets the details.
//  • Every view of the Medical tab writes MEDICAL_VIEWED, not only changes.
//  • Changes write UPDATE_MEDICAL with the names of the fields that changed, never their values
//    (the row-change audit also hides the values; see the students_module migration).
//  • Medical data is left out of exports unless the user holds students.medical.export (lib/students/export.ts).
import type { MedicationKeeper, Prisma, SickBayOutcome } from '@prisma/client';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import type { AccessUser } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { isoDateSchema, loadReachable, noteSchema } from '@/lib/students/common';

export const CONDITIONS = ['Asthma', 'Epilepsy', 'Diabetes', 'Sickle cell', 'Heart condition', 'Other'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const MEDICAL_AID_PROVIDERS = ['CIMAS', 'PSMAS', 'First Mutual', 'Other'] as const;
export const MEDICATION_KEEPERS = ['STUDENT', 'MATRON', 'OFFICE'] as const satisfies readonly MedicationKeeper[];
export const SICK_BAY_OUTCOMES = ['RETURNED_TO_CLASS', 'SENT_HOME', 'SENT_TO_CLINIC'] as const satisfies readonly SickBayOutcome[];

const phone = z.string().trim().max(30).regex(/^[0-9+()\s-]*$/, 'Use digits, spaces, + and - only').optional().transform((v) => v || undefined);
const text = (max = 120) => z.string().trim().max(max).optional().transform((v) => v || undefined);

export const MedicalSchema = z.object({
  conditions: z.array(z.object({ name: z.enum(CONDITIONS), note: text(200) }).refine((c) => c.name !== 'Other' || !!c.note, { path: ['note'], message: 'Say what the condition is' })).max(20).default([]),
  allergies: z.array(z.object({ name: z.string().trim().min(2, 'Name the allergy').max(80), severity: z.enum(['MILD', 'SEVERE']) })).max(30).default([]),
  medications: z.array(z.object({ name: z.string().trim().min(2, 'Name the medicine').max(80), dose: text(60), whenGiven: text(80), keptBy: z.enum(MEDICATION_KEEPERS).default('STUDENT') })).max(20).default([]),
  bloodGroup: z.enum(BLOOD_GROUPS).nullable().optional(),
  medicalAid: z.object({ provider: z.enum(MEDICAL_AID_PROVIDERS).optional(), number: text(40), mainMember: text(80) }).prefault({}),
  doctor: z.object({ name: text(80), phone }).prefault({}),
  /** Left empty, the emergency contact is the primary guardian. */
  emergency: z.object({ name: text(80), phone, relationship: text(40) }).prefault({}),
  specialNeeds: z.object({ type: text(120), supportNeeded: text(400) }).prefault({}),
  consent: z.object({ emergencyTreatment: z.boolean().nullable().optional(), date: isoDateSchema.optional(), formKey: text(200) }).prefault({}),
  notes: text(1000),
});
export type MedicalInput = z.input<typeof MedicalSchema>;

export interface MedicalView {
  studentId: string;
  conditions: { name: string; note?: string }[];
  allergies: { name: string; severity: 'MILD' | 'SEVERE' }[];
  medications: { id: string; name: string; dose: string | null; whenGiven: string | null; keptBy: MedicationKeeper }[];
  bloodGroup: string | null;
  medicalAid: { provider: string | null; number: string | null; mainMember: string | null };
  doctor: { name: string | null; phone: string | null };
  emergency: { name: string | null; phone: string | null; relationship: string | null; fromPrimaryGuardian: boolean };
  specialNeeds: { type: string | null; supportNeeded: string | null };
  consent: { emergencyTreatment: boolean | null; date: string | null; hasForm: boolean };
  notes: string | null;
  sickBay: { enabled: boolean; visits: { id: string; visitedAt: string; complaint: string; treatment: string | null; outcome: SickBayOutcome; guardianInformed: boolean }[] };
  updatedAt: string | null;
}

async function reachable(tx: Db, user: AccessUser, studentId: string) {
  const open = await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' }, select: { id: true } });
  const [s] = await loadReachable(tx, user, [studentId], open?.id, 'students.medical.view');
  return s!;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * The Medical tab. Opening it is itself an audited event (MEDICAL_VIEWED), written in the same
 * transaction as the read, so there is no way to see the details without leaving a trace.
 */
export async function viewMedical(user: AccessUser, studentId: string): Promise<MedicalView> {
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const student = await reachable(tx, user, studentId);
    const [profile, primary, off, visits] = await Promise.all([
      tx.medicalProfile.findUnique({ where: { studentId }, include: { medications: { orderBy: { createdAt: 'asc' } } } }),
      tx.studentGuardian.findFirst({ where: { studentId, isPrimary: true }, select: { relationship: true, guardian: { select: { fullName: true, phone: true } } } }),
      tx.schoolModule.findMany({ where: { schoolId, enabled: false }, select: { module: true } }),
      tx.sickBayVisit.findMany({ where: { studentId }, orderBy: { visitedAt: 'desc' }, take: 50 }),
    ]);
    // Hostel and sick bay belong to Facilities & Operations, so they follow that module's switch.
    const sickBayOn = !off.some((m) => m.module === 'facilities');
    const ownEmergency = !!(profile?.emergencyName || profile?.emergencyPhone);
    await logAudit(
      { schoolId, actorId: user.id, action: 'MEDICAL_VIEWED', entityType: 'Student', entityId: studentId, detail: `${student.fullName}: medical details viewed` },
      tx,
    );
    return {
      studentId,
      conditions: (profile?.conditions as { name: string; note?: string }[] | undefined) ?? [],
      allergies: (profile?.allergies as { name: string; severity: 'MILD' | 'SEVERE' }[] | undefined) ?? [],
      medications: (profile?.medications ?? []).map((m) => ({ id: m.id, name: m.name, dose: m.dose, whenGiven: m.whenGiven, keptBy: m.keptBy })),
      bloodGroup: profile?.bloodGroup ?? null,
      medicalAid: { provider: profile?.medicalAidProvider ?? null, number: profile?.medicalAidNumber ?? null, mainMember: profile?.medicalAidMainMember ?? null },
      doctor: { name: profile?.doctorName ?? null, phone: profile?.doctorPhone ?? null },
      emergency: ownEmergency
        ? { name: profile?.emergencyName ?? null, phone: profile?.emergencyPhone ?? null, relationship: profile?.emergencyRelationship ?? null, fromPrimaryGuardian: false }
        : { name: primary?.guardian.fullName ?? null, phone: primary?.guardian.phone ?? null, relationship: primary?.relationship.toLowerCase() ?? null, fromPrimaryGuardian: true },
      specialNeeds: { type: profile?.specialNeedsType ?? null, supportNeeded: profile?.supportNeeded ?? null },
      consent: { emergencyTreatment: profile?.consentEmergencyTreatment ?? null, date: day(profile?.consentDate ?? null), hasForm: !!profile?.consentFormKey },
      notes: profile?.notes ?? null,
      sickBay: {
        enabled: sickBayOn,
        visits: sickBayOn ? visits.map((v) => ({ id: v.id, visitedAt: v.visitedAt.toISOString(), complaint: v.complaint, treatment: v.treatment, outcome: v.outcome, guardianInformed: v.guardianInformed })) : [],
      },
      updatedAt: profile?.updatedAt.toISOString() ?? null,
    };
  });
}

const FIELDS = ['conditions', 'allergies', 'medications', 'bloodGroup', 'medicalAid', 'doctor', 'emergency', 'specialNeeds', 'consent', 'notes'] as const;

/** Replaces the medical profile. Returns the names of the sections that changed (never their values). */
export async function saveMedical(user: AccessUser, studentId: string, rawInput: MedicalInput) {
  const input = MedicalSchema.parse(rawInput);
  const { schoolId } = user;
  if (input.consent.formKey && !input.consent.formKey.startsWith(`sdoc:${schoolId}:`)) throw new ServiceError('That file does not belong to this school', 422);

  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const student = await reachable(tx, user, studentId);
    const before = await tx.medicalProfile.findUnique({ where: { studentId }, include: { medications: true } });
    const data = {
      conditions: input.conditions as unknown as Prisma.InputJsonValue,
      allergies: input.allergies as unknown as Prisma.InputJsonValue,
      hasSevereAllergy: input.allergies.some((a) => a.severity === 'SEVERE'),
      bloodGroup: input.bloodGroup ?? null,
      medicalAidProvider: input.medicalAid.provider ?? null, medicalAidNumber: input.medicalAid.number ?? null, medicalAidMainMember: input.medicalAid.mainMember ?? null,
      doctorName: input.doctor.name ?? null, doctorPhone: input.doctor.phone ?? null,
      emergencyName: input.emergency.name ?? null, emergencyPhone: input.emergency.phone ?? null, emergencyRelationship: input.emergency.relationship ?? null,
      specialNeedsType: input.specialNeeds.type ?? null, supportNeeded: input.specialNeeds.supportNeeded ?? null,
      consentEmergencyTreatment: input.consent.emergencyTreatment ?? null,
      consentDate: input.consent.date ? new Date(`${input.consent.date}T00:00:00Z`) : null,
      consentFormKey: input.consent.formKey ?? before?.consentFormKey ?? null,
      notes: input.notes ?? null,
    };
    const profile = before
      ? await tx.medicalProfile.update({ where: { studentId }, data })
      : await tx.medicalProfile.create({ data: { schoolId, studentId, ...data } });
    await tx.medicationEntry.deleteMany({ where: { profileId: profile.id } });
    if (input.medications.length) {
      await tx.medicationEntry.createMany({ data: input.medications.map((m) => ({ schoolId, profileId: profile.id, name: m.name, dose: m.dose ?? null, whenGiven: m.whenGiven ?? null, keptBy: m.keptBy })) });
    }

    const was = before
      ? {
          conditions: before.conditions, allergies: before.allergies, medications: before.medications.map((m) => [m.name, m.dose, m.whenGiven, m.keptBy]).sort(), bloodGroup: before.bloodGroup,
          medicalAid: [before.medicalAidProvider, before.medicalAidNumber, before.medicalAidMainMember], doctor: [before.doctorName, before.doctorPhone],
          emergency: [before.emergencyName, before.emergencyPhone, before.emergencyRelationship], specialNeeds: [before.specialNeedsType, before.supportNeeded],
          consent: [before.consentEmergencyTreatment, before.consentDate?.toISOString().slice(0, 10) ?? null], notes: before.notes,
        }
      : null;
    const now = {
      conditions: data.conditions, allergies: data.allergies, medications: input.medications.map((m) => [m.name, m.dose ?? null, m.whenGiven ?? null, m.keptBy]).sort(), bloodGroup: data.bloodGroup,
      medicalAid: [data.medicalAidProvider, data.medicalAidNumber, data.medicalAidMainMember], doctor: [data.doctorName, data.doctorPhone],
      emergency: [data.emergencyName, data.emergencyPhone, data.emergencyRelationship], specialNeeds: [data.specialNeedsType, data.supportNeeded],
      consent: [data.consentEmergencyTreatment, input.consent.date ?? null], notes: data.notes,
    };
    const changed = FIELDS.filter((f) => !was || JSON.stringify(was[f]) !== JSON.stringify(now[f]));
    await logAudit(
      {
        schoolId, actorId: user.id, action: 'UPDATE_MEDICAL', entityType: 'Student', entityId: studentId,
        detail: `${student.fullName}: medical details ${before ? 'changed' : 'recorded'} (${changed.join(', ') || 'no change'})`,
        after: { changedSections: changed, severeAllergy: data.hasSevereAllergy },
      },
      tx,
    );
    return { changed, hasSevereAllergy: data.hasSevereAllergy };
  });
}

export const SickBayVisitSchema = z.object({
  visitedAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/, 'Enter the date and time'),
  complaint: z.string().trim().min(2, 'Say what the complaint was').max(300),
  treatment: noteSchema(300),
  outcome: z.enum(SICK_BAY_OUTCOMES, { error: 'Say where the student went afterwards' }),
  guardianInformed: z.boolean().default(false),
});

/** A sick bay visit. Only recorded when Facilities & Operations (which holds the hostel) is on. */
export async function recordSickBayVisit(user: AccessUser, studentId: string, rawInput: z.input<typeof SickBayVisitSchema>) {
  const input = SickBayVisitSchema.parse(rawInput);
  const { schoolId } = user;
  const when = new Date(`${input.visitedAt.replace(' ', 'T')}:00+02:00`);
  if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 5 * 60_000) throw new ServiceError('The visit cannot be in the future', 422);
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const off = await tx.schoolModule.findFirst({ where: { schoolId, module: 'facilities', enabled: false } });
    if (off) throw new ServiceError('Sick bay visits are recorded when the Hostel module is on', 409);
    const student = await reachable(tx, user, studentId);
    const v = await tx.sickBayVisit.create({ data: { schoolId, studentId, visitedAt: when, complaint: input.complaint, treatment: input.treatment ?? null, outcome: input.outcome, guardianInformed: input.guardianInformed, recordedById: user.id } });
    await logAudit({ schoolId, actorId: user.id, action: 'UPDATE_MEDICAL', entityType: 'Student', entityId: studentId, detail: `${student.fullName}: sick bay visit recorded`, after: { visitId: v.id, outcome: input.outcome } }, tx);
    return v;
  });
}

/** Whether each student has a severe allergy: the only medical fact shown to people without medical access. */
export async function medicalAlerts(db: Db, studentIds: string[]): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const rows = await db.medicalProfile.findMany({ where: { studentId: { in: studentIds }, hasSevereAllergy: true }, select: { studentId: true } });
  return new Set(rows.map((r) => r.studentId));
}

