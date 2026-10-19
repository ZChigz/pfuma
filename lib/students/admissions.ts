// Admissions: from the first enquiry to the first day, turning an accepted applicant into a student without retyping.
//   Applied → Shortlisted → Tested → Offered → Accepted → Enrolled, plus Waitlisted, Rejected and Declined.
//  • An intake ("Form 1, 2027") has places, dates, an application fee and a requirements list.
//  • Offers need the Head's approval (students.admissions.approve): the approver is recorded and the offer letter filed.
//  • Accepting records the date (and, when Finance is on, whether the deposit is paid).
//  • Enrolling makes a Student with a new admission number and an Enrollment in the chosen class; the application stays
//    linked to the student, and its documents move to the student's file.
//  • Transfers in during the year skip all this: Add student with entry type Transfer in, approved by the Head.
import type { ApplicationStage, GuardianRelationship, Prisma } from '@prisma/client';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { can, type AccessUser } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { dateOnly } from '@/lib/academic/terms';
import { idSchema, isoDateSchema, noteSchema } from '@/lib/students/common';
import { admitTx, AdmitStudentSchema, checkAdmission, type AdmitStudentInput } from '@/lib/students/admit';
import { loadLetterhead, nextReference, UploadDocumentSchema, documentKeyBelongsTo, DOCUMENT_TYPE_LABEL, type LetterSnapshot } from '@/lib/students/documents';
import { custom, isoDateField, mobilePhone, normalizeName, optionalText, personName, RELATIONSHIPS, todayInHarare } from '@/lib/students/registration';
import { isValidBirthCert, normaliseBirthCert } from '@/lib/students/rules';
import { withAdmissionNumberRetry } from '@/lib/students/server';

type Actor = AccessUser & { fullName?: string };

export const STAGES = ['APPLIED', 'SHORTLISTED', 'TESTED', 'OFFERED', 'ACCEPTED', 'ENROLLED', 'WAITLISTED', 'REJECTED', 'DECLINED'] as const satisfies readonly ApplicationStage[];
export const STAGE_LABEL: Record<ApplicationStage, string> = {
  APPLIED: 'Applied', SHORTLISTED: 'Shortlisted', TESTED: 'Tested / interviewed', OFFERED: 'Offered', ACCEPTED: 'Accepted', ENROLLED: 'Enrolled',
  WAITLISTED: 'Waitlisted', REJECTED: 'Rejected', DECLINED: 'Declined',
};
/** The path an applicant follows when all goes well. */
export const PIPELINE: readonly ApplicationStage[] = ['APPLIED', 'SHORTLISTED', 'TESTED', 'OFFERED', 'ACCEPTED', 'ENROLLED'];
const SIDE: readonly ApplicationStage[] = ['WAITLISTED', 'REJECTED', 'DECLINED'];
const FINAL: readonly ApplicationStage[] = ['ENROLLED', 'REJECTED', 'DECLINED'];

export interface StageStep { stage: ApplicationStage; at: string; byId: string; note?: string }

/**
 * Whether an applicant may move from one stage to another. Forward along the pipeline (stages may be skipped, because not
 * every school tests), to Waitlisted / Rejected / Declined from any stage that is not final, and back from the waiting
 * list. Enrolled, Rejected and Declined are final. Enrolling is its own action, never a plain move.
 */
export function canMove(from: ApplicationStage, to: ApplicationStage): string | null {
  if (from === to) return 'The applicant is already at that stage';
  if (FINAL.includes(from)) return `${STAGE_LABEL[from]} applicants cannot be moved`;
  if (to === 'ENROLLED') return 'Use Enrol to turn the applicant into a student';
  if (SIDE.includes(to)) return null;
  if (from === 'WAITLISTED') return null;
  return PIPELINE.indexOf(to) > PIPELINE.indexOf(from) ? null : 'Applicants only move forward';
}

// ─── Intakes ─────────────────────────────────────────────────────────────────

export const IntakeSchema = z
  .object({
    name: z.string().trim().min(3, 'Name the intake, e.g. Form 1, 2027').max(60),
    levelId: idSchema,
    year: z.number().int().min(2000).max(2200),
    places: z.number().int().min(1, 'There must be at least one place').max(2000),
    applicationOpens: isoDateSchema.optional(),
    applicationCloses: isoDateSchema.optional(),
    testDate: isoDateSchema.optional(),
    reportingDate: isoDateSchema.optional(),
    applicationFee: z.number().min(0).max(100000).default(0),
    feeCurrency: z.enum(['USD', 'ZIG']).default('USD'),
    requirements: z.array(z.string().trim().min(2).max(120)).max(30).default([]),
    closed: z.boolean().default(false),
  })
  .refine((v) => !v.applicationOpens || !v.applicationCloses || v.applicationCloses >= v.applicationOpens, { path: ['applicationCloses'], message: 'Applications cannot close before they open' });
export type IntakeInput = z.input<typeof IntakeSchema>;

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export async function saveIntake(user: Actor, rawInput: IntakeInput, intakeId?: string) {
  const input = IntakeSchema.parse(rawInput);
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const level = await tx.level.findFirst({ where: { id: input.levelId, schoolId } });
    if (!level) throw new ServiceError('Form not found', 404);
    const clash = await tx.intake.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' }, ...(intakeId ? { id: { not: intakeId } } : {}) } });
    if (clash) throw new ServiceError(`There is already an intake called ${clash.name}`, 409);
    const data = {
      name: input.name, levelId: input.levelId, year: input.year, places: input.places, applicationFee: input.applicationFee, feeCurrency: input.feeCurrency,
      requirements: input.requirements, closed: input.closed,
      applicationOpens: input.applicationOpens ? dateOnly(input.applicationOpens) : null, applicationCloses: input.applicationCloses ? dateOnly(input.applicationCloses) : null,
      testDate: input.testDate ? dateOnly(input.testDate) : null, reportingDate: input.reportingDate ? dateOnly(input.reportingDate) : null,
    };
    if (!intakeId) {
      const row = await tx.intake.create({ data: { schoolId, ...data } });
      await logAudit({ schoolId, actorId: user.id, action: 'CREATE_INTAKE', entityType: 'Intake', entityId: row.id, detail: `${row.name}, ${row.places} places`, after: { ...input } as Prisma.InputJsonValue }, tx);
      return row;
    }
    const before = await tx.intake.findFirst({ where: { id: intakeId } });
    if (!before) throw new ServiceError('Intake not found', 404);
    if (input.places < (await tx.application.count({ where: { intakeId, stage: { in: ['OFFERED', 'ACCEPTED', 'ENROLLED'] } } }))) {
      throw new ServiceError('There are already more offers than that many places', 409);
    }
    const row = await tx.intake.update({ where: { id: intakeId }, data });
    await logAudit(
      { schoolId, actorId: user.id, action: 'UPDATE_INTAKE', entityType: 'Intake', entityId: row.id, detail: row.name, before: { name: before.name, places: before.places, closed: before.closed }, after: { name: row.name, places: row.places, closed: row.closed } },
      tx,
    );
    return row;
  });
}

export async function listIntakes(user: AccessUser) {
  const db = getScopedDb(user.schoolId, user.id);
  const rows = await db.intake.findMany({ orderBy: [{ year: 'desc' }, { name: 'asc' }], include: { level: { select: { name: true } }, applications: { select: { stage: true } } } });
  return rows.map((i) => {
    const count = (...s: ApplicationStage[]) => i.applications.filter((a) => s.includes(a.stage)).length;
    return {
      id: i.id, name: i.name, levelId: i.levelId, level: i.level.name, year: i.year, places: i.places, closed: i.closed, applicationFee: i.applicationFee.toNumber(), feeCurrency: i.feeCurrency,
      applicationOpens: day(i.applicationOpens), applicationCloses: day(i.applicationCloses), testDate: day(i.testDate), reportingDate: day(i.reportingDate), requirements: i.requirements,
      applications: i.applications.length, offers: count('OFFERED', 'ACCEPTED', 'ENROLLED'), enrolled: count('ENROLLED'),
    };
  });
}

// ─── Applications ────────────────────────────────────────────────────────────

export const ApplicationSchema = z
  .object({
    intakeId: idSchema,
    firstName: personName('First name(s)'),
    surname: personName('Surname'),
    gender: z.enum(['M', 'F'], { error: 'Please select Male or Female' }),
    dateOfBirth: isoDateField('Date of birth', {}),
    birthCertificateNumber: z.string().optional().transform((raw, ctx) => {
      const v = (raw ?? '').trim();
      if (!v) return null;
      if (!isValidBirthCert(v)) { custom(ctx, 'Birth certificate number should look like 63-123456 A 42'); return null; }
      return normaliseBirthCert(v);
    }),
    previousSchool: optionalText('Previous school', 100),
    boarding: z.enum(['DAY', 'BOARDER']).default('DAY'),
    guardianName: personName('Guardian name'),
    guardianRelationship: z.enum(RELATIONSHIPS).default('GUARDIAN'),
    guardianPhone: z.string().transform((raw, ctx) => {
      const p = mobilePhone('Guardian phone', true).safeParse(raw);
      if (!p.success) { custom(ctx, 'Enter a Zimbabwean mobile number such as 0771234567'); return ''; }
      return p.data!;
    }),
    guardianPhone2: mobilePhone('Second phone', false),
    guardianEmail: optionalText('Email', 100, { re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Email must look like name@example.com' }),
    address: optionalText('Address', 200),
    // Grade 7 units (lower is better), or O Level passes and points.
    entryResults: z.object({
      grade7Units: z.number().int().min(4).max(36).optional(),
      oLevelPasses: z.number().int().min(0).max(14).optional(),
      oLevelPoints: z.number().int().min(0).max(60).optional(),
    }).optional(),
    testScore: z.number().min(0).max(100).nullable().optional(),
    interviewNotes: noteSchema(1000),
  })
  .superRefine((v, ctx) => {
    if (!v.guardianName.includes(' ')) custom(ctx, "Enter the guardian's first name and surname", ['guardianName']);
  });
export type ApplicationInput = z.input<typeof ApplicationSchema>;

const appendStep = (history: unknown, step: StageStep): Prisma.InputJsonValue => [...((history as StageStep[] | null) ?? []), step] as unknown as Prisma.InputJsonValue;

export async function createApplication(user: Actor, rawInput: ApplicationInput) {
  const input = ApplicationSchema.parse(rawInput);
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const intake = await tx.intake.findFirst({ where: { id: input.intakeId, schoolId }, include: { level: { select: { name: true } } } });
    if (!intake) throw new ServiceError('Intake not found', 404);
    if (intake.closed) throw new ServiceError(`${intake.name} is closed to new applications`, 409);
    const today = todayInHarare();
    if (intake.applicationCloses && day(intake.applicationCloses)! < today) throw new ServiceError(`Applications for ${intake.name} closed on ${day(intake.applicationCloses)}`, 409);
    const dup = await tx.application.findFirst({
      where: { intakeId: intake.id, firstName: { equals: input.firstName, mode: 'insensitive' }, surname: { equals: input.surname, mode: 'insensitive' }, dateOfBirth: dateOnly(input.dateOfBirth) },
    });
    if (dup) throw new ServiceError(`${input.firstName} ${input.surname} has already applied for ${intake.name}`, 409);
    const step: StageStep = { stage: 'APPLIED', at: new Date().toISOString(), byId: user.id };
    const app = await tx.application.create({
      data: {
        schoolId, intakeId: intake.id, firstName: input.firstName, surname: input.surname, gender: input.gender, dateOfBirth: dateOnly(input.dateOfBirth),
        birthCertificateNumber: input.birthCertificateNumber, previousSchool: input.previousSchool, boarding: input.boarding, guardianName: input.guardianName,
        guardianRelationship: input.guardianRelationship as GuardianRelationship, guardianPhone: input.guardianPhone, guardianPhone2: input.guardianPhone2, guardianEmail: input.guardianEmail?.toLowerCase() ?? null,
        address: input.address, entryResults: (input.entryResults ?? undefined) as Prisma.InputJsonValue | undefined, testScore: input.testScore ?? null, interviewNotes: input.interviewNotes ?? null,
        stage: 'APPLIED', stageHistory: [step] as unknown as Prisma.InputJsonValue,
      },
    });
    await logAudit({ schoolId, actorId: user.id, action: 'CREATE_APPLICATION', entityType: 'Application', entityId: app.id, detail: `${app.firstName} ${app.surname} applied for ${intake.name}`, after: { intakeId: intake.id, stage: 'APPLIED' } }, tx);
    return app;
  });
}

export const UpdateApplicationSchema = z.object({
  testScore: z.number().min(0).max(100).nullable().optional(),
  interviewNotes: noteSchema(1000),
  entryResults: z.object({ grade7Units: z.number().int().min(4).max(36).optional(), oLevelPasses: z.number().int().min(0).max(14).optional(), oLevelPoints: z.number().int().min(0).max(60).optional() }).optional(),
  targetClassId: idSchema.nullable().optional(),
}).strict();

/** Test score, interview notes, results and the class the applicant is meant for. */
export async function updateApplication(user: Actor, appId: string, rawInput: z.input<typeof UpdateApplicationSchema>) {
  const input = UpdateApplicationSchema.parse(rawInput);
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const before = await tx.application.findFirst({ where: { id: appId, schoolId } });
    if (!before) throw new ServiceError('Application not found', 404);
    if (before.stage === 'ENROLLED') throw new ServiceError('The applicant is already a student', 409);
    if (input.targetClassId && !(await tx.schoolClass.findFirst({ where: { id: input.targetClassId, schoolId }, select: { id: true } }))) throw new ServiceError('Class not found', 404);
    const data: Prisma.ApplicationUncheckedUpdateInput = {};
    if (input.testScore !== undefined) data.testScore = input.testScore;
    if (input.interviewNotes !== undefined) data.interviewNotes = input.interviewNotes ?? null;
    if (input.entryResults !== undefined) data.entryResults = input.entryResults as Prisma.InputJsonValue;
    if (input.targetClassId !== undefined) data.targetClassId = input.targetClassId;
    if (Object.keys(data).length === 0) throw new ServiceError('Nothing to change', 422);
    await tx.application.update({ where: { id: appId }, data });
    await logAudit({ schoolId, actorId: user.id, action: 'UPDATE_APPLICATION', entityType: 'Application', entityId: appId, detail: `${before.firstName} ${before.surname}: ${Object.keys(data).join(', ')}`, after: { changed: Object.keys(data) } }, tx);
    return { changed: Object.keys(data) };
  });
}

// ─── Moving applicants between stages ────────────────────────────────────────

export const MoveSchema = z.object({
  applicationIds: z.array(idSchema).min(1, 'Choose at least one applicant').max(500),
  to: z.enum(STAGES),
  note: noteSchema(300),
});

/** Offer letter data, filed as a generated document with a reference number. */
async function fileOfferLetter(tx: Db, user: Actor, app: { id: string; firstName: string; surname: string; intakeId: string }) {
  const intake = await tx.intake.findUniqueOrThrow({ where: { id: app.intakeId }, include: { level: { select: { name: true } } } });
  const referenceNo = await nextReference(tx, user.schoolId, 'LETTER_OFFER');
  const today = todayInHarare();
  const reporting = day(intake.reportingDate);
  const snapshot: LetterSnapshot = {
    type: 'LETTER_OFFER', referenceNo, issuedOn: today, school: await loadLetterhead(tx, user.schoolId), student: null,
    body: {
      applicantName: `${app.firstName} ${app.surname}`, intakeName: intake.name, className: intake.level.name,
      reportingDate: reporting, reportingDateLong: reporting ? new Date(`${reporting}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'to be confirmed',
      requirements: intake.requirements,
    },
  };
  await tx.studentDocument.create({
    data: { schoolId: user.schoolId, applicationId: app.id, type: 'LETTER_OFFER', title: `Offer letter ${referenceNo}`, generated: true, referenceNo, date: dateOnly(today), snapshot: snapshot as unknown as Prisma.InputJsonValue, uploadedById: user.id },
  });
  return referenceNo;
}

/**
 * Moves applicants to a stage. Offers need the Head's approval (students.admissions.approve): the person who moves
 * them to Offered must hold it, and is recorded as the approver; the offer letter is filed with a reference number. The
 * number of offers can never pass the places in the intake. All or nothing.
 */
export async function moveApplications(user: Actor, rawInput: z.input<typeof MoveSchema>) {
  const input = MoveSchema.parse(rawInput);
  const { schoolId } = user;
  if (input.to === 'ACCEPTED') throw new ServiceError('Use Accept to record that the offer was accepted', 422);
  if (input.to === 'OFFERED' && !can(user, 'students.admissions.approve')) throw new ServiceError('Offers need the Head\'s approval. Ask someone who may approve admissions to make the offer.', 403);
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const ids = Array.from(new Set(input.applicationIds));
    const apps = await tx.application.findMany({ where: { id: { in: ids }, schoolId }, include: { intake: true } });
    if (apps.length !== ids.length) throw new ServiceError('One or more applicants were not found', 404);
    for (const a of apps) {
      const problem = canMove(a.stage, input.to);
      if (problem) throw new ServiceError(`${a.firstName} ${a.surname}: ${problem}`, 409);
    }
    if (input.to === 'OFFERED') {
      for (const intakeId of Array.from(new Set(apps.map((a) => a.intakeId)))) {
        const mine = apps.filter((a) => a.intakeId === intakeId);
        const places = mine[0]!.intake.places;
        const already = await tx.application.count({ where: { intakeId, stage: { in: ['OFFERED', 'ACCEPTED', 'ENROLLED'] }, id: { notIn: ids } } });
        if (already + mine.length > places) throw new ServiceError(`${mine[0]!.intake.name} has ${places} places and ${already} offers already made, so only ${Math.max(places - already, 0)} more can be made`, 409);
      }
    }
    const when = new Date();
    for (const a of apps) {
      const data: Prisma.ApplicationUncheckedUpdateInput = { stage: input.to, stageHistory: appendStep(a.stageHistory, { stage: input.to, at: when.toISOString(), byId: user.id, note: input.note }) };
      if (input.to === 'OFFERED') {
        data.offerApprovedById = user.id;
        data.offerApprovedAt = when;
        data.offerReference = await fileOfferLetter(tx, user, a);
      }
      if (input.to === 'ACCEPTED') {
        data.acceptedAt = when;
      }
      await tx.application.update({ where: { id: a.id }, data });
      await logAudit(
        {
          schoolId, actorId: user.id, action: input.to === 'OFFERED' ? 'APPROVE_OFFER' : 'MOVE_APPLICATION', entityType: 'Application', entityId: a.id,
          detail: `${a.firstName} ${a.surname}: ${STAGE_LABEL[a.stage]} → ${STAGE_LABEL[input.to]}${input.note ? `. ${input.note}` : ''}`,
          before: { stage: a.stage }, after: { stage: input.to, ...(input.to === 'OFFERED' ? { approvedById: user.id } : {}) },
        },
        tx,
      );
    }
    return { moved: apps.length, to: input.to };
  });
}

export const AcceptSchema = z.object({ acceptedOn: isoDateSchema.optional(), depositPaid: z.boolean().optional() });

/** Records the acceptance date and, when Finance is on, whether the acceptance deposit has been paid. */
export async function acceptOffer(user: Actor, appId: string, rawInput: z.input<typeof AcceptSchema> = {}) {
  const input = AcceptSchema.parse(rawInput);
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const a = await tx.application.findFirst({ where: { id: appId, schoolId } });
    if (!a) throw new ServiceError('Application not found', 404);
    if (a.stage !== 'OFFERED') throw new ServiceError('Only an applicant who has been offered a place can accept it', 409);
    const financeOff = await tx.schoolModule.findFirst({ where: { schoolId, module: 'finance', enabled: false } });
    if (financeOff && input.depositPaid !== undefined) throw new ServiceError('The deposit is recorded when the Finance module is on', 409);
    const when = input.acceptedOn ?? todayInHarare();
    if (when > todayInHarare()) throw new ServiceError('The acceptance date cannot be in the future', 422);
    await tx.application.update({
      where: { id: appId },
      data: { stage: 'ACCEPTED', acceptedAt: dateOnly(when), depositPaid: financeOff ? null : input.depositPaid ?? false, stageHistory: appendStep(a.stageHistory, { stage: 'ACCEPTED', at: new Date().toISOString(), byId: user.id }) },
    });
    await logAudit({ schoolId, actorId: user.id, action: 'MOVE_APPLICATION', entityType: 'Application', entityId: appId, detail: `${a.firstName} ${a.surname}: accepted on ${when}`, before: { stage: 'OFFERED' }, after: { stage: 'ACCEPTED', acceptedOn: when, depositPaid: financeOff ? null : input.depositPaid ?? false } }, tx);
    return { acceptedOn: when };
  });
}

// ─── Enrol ───────────────────────────────────────────────────────────────────

export const EnrolSchema = z.object({ classId: idSchema, acknowledgedWarnings: z.array(z.string().max(40)).max(10).default([]), dryRun: z.boolean().default(false) });

function applicationToStudent(a: Prisma.ApplicationGetPayload<object>, classId: string, levelOrder: number): AdmitStudentInput {
  return {
    firstName: a.firstName, surname: a.surname, gender: a.gender, dateOfBirth: day(a.dateOfBirth)!, birthCertificateNumber: a.birthCertificateNumber ?? undefined,
    admissionDate: todayInHarare(), classId, boarding: a.boarding, entryType: levelOrder === 1 ? 'NEW_FORM_1' : levelOrder === 5 ? 'NEW_LOWER_6' : 'TRANSFER_IN',
    previousSchool: a.previousSchool ?? undefined, entryResults: (a.entryResults ?? undefined) as AdmitStudentInput['entryResults'], address: a.address ?? undefined,
    guardians: [{
      fullName: normalizeName(a.guardianName), relationship: a.guardianRelationship, phone: a.guardianPhone, phone2: a.guardianPhone2 ?? undefined,
      email: a.guardianEmail ?? undefined, address: a.address ?? undefined, isPrimary: true, isFeePayer: true, receivesSms: true, canCollect: true,
    }],
  } as AdmitStudentInput;
}

/**
 * Turns an accepted applicant into a student: the details are carried over, a new admission number and an Enrollment in the
 * chosen class are made, the application stays linked, and its documents move to the student's file. The warnings (age,
 * class full) are shown first (dryRun) and must be acknowledged. The Head's approval of the offer stands in for approving a
 * transfer in, so a person who may manage admissions can enrol.
 */
export async function enrolApplicant(user: Actor, appId: string, rawInput: z.input<typeof EnrolSchema>) {
  const input = EnrolSchema.parse(rawInput);
  const { schoolId } = user;
  const run = async (tx: Db) => {
    const a = await tx.application.findFirst({ where: { id: appId, schoolId }, include: { intake: { include: { level: true } } } });
    if (!a) throw new ServiceError('Application not found', 404);
    if (a.studentId || a.stage === 'ENROLLED') throw new ServiceError('The applicant is already a student', 409);
    if (a.stage !== 'ACCEPTED') throw new ServiceError('Only an applicant who has accepted the offer can be enrolled', 409);
    const klass = await tx.schoolClass.findFirst({ where: { id: input.classId, schoolId }, include: { level: true } });
    if (!klass) throw new ServiceError('Class not found', 404);
    if (klass.levelId !== a.intake.levelId) throw new ServiceError(`${a.firstName} ${a.surname} was offered a place in ${a.intake.level.name}; choose a ${a.intake.level.name} class`, 422);
    const draft = AdmitStudentSchema.parse(applicationToStudent(a, klass.id, a.intake.level.order));
    if (input.dryRun) return { dryRun: true as const, check: await checkAdmission(user, draft, tx) };

    const student = await admitTx(tx, user, draft, input.acknowledgedWarnings, { skipApprovalCheck: true, note: `Enrolled from application ${a.id}` });
    await tx.application.update({
      where: { id: a.id },
      data: { stage: 'ENROLLED', studentId: student.id, targetClassId: klass.id, stageHistory: appendStep(a.stageHistory, { stage: 'ENROLLED', at: new Date().toISOString(), byId: user.id }) },
    });
    await tx.studentDocument.updateMany({ where: { applicationId: a.id, studentId: null }, data: { studentId: student.id } });
    await logAudit(
      { schoolId, actorId: user.id, action: 'ENROL_APPLICANT', entityType: 'Application', entityId: a.id, detail: `${a.firstName} ${a.surname} enrolled as ${student.admissionNumber} in ${klass.name}`, before: { stage: 'ACCEPTED' }, after: { stage: 'ENROLLED', studentId: student.id, classId: klass.id } },
      tx,
    );
    return { dryRun: false as const, student };
  };
  if (input.dryRun) return getScopedDb(schoolId, user.id).$tx(run);
  return withAdmissionNumberRetry(() => getScopedDb(schoolId, user.id).$tx(run));
}

// ─── Board, ranking, report ──────────────────────────────────────────────────

export interface ApplicantRow {
  id: string; fullName: string; gender: 'M' | 'F'; age: number | null; stage: ApplicationStage; previousSchool: string | null;
  grade7Units: number | null; oLevelPasses: number | null; oLevelPoints: number | null; testScore: number | null;
  guardianName: string; guardianPhone: string; offerReference: string | null; studentId: string | null; appliedAt: string; acceptedAt: string | null; depositPaid: boolean | null;
}

export const RANK_BY = ['units', 'score', 'points'] as const;
export type RankBy = (typeof RANK_BY)[number];

/**
 * Sorting for the ranking view. Grade 7 units: lower is better. Test score and O Level points: higher is better.
 * Applicants without the value go last. Rejected and declined applicants are not ranked.
 */
export function rankApplicants<T extends Pick<ApplicantRow, 'grade7Units' | 'testScore' | 'oLevelPoints' | 'stage' | 'fullName'>>(rows: T[], by: RankBy, places: number) {
  const value = (r: T) => (by === 'units' ? r.grade7Units : by === 'score' ? r.testScore : r.oLevelPoints);
  const better = (a: number, b: number) => (by === 'units' ? a - b : b - a);
  const ranked = rows.filter((r) => r.stage !== 'REJECTED' && r.stage !== 'DECLINED');
  ranked.sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null && y === null) return a.fullName.localeCompare(b.fullName);
    if (x === null) return 1;
    if (y === null) return -1;
    return better(x, y) || a.fullName.localeCompare(b.fullName);
  });
  return ranked.map((r, i) => ({ ...r, rank: i + 1, withinPlaces: i + 1 <= places }));
}

export async function listApplicants(user: AccessUser, intakeId: string): Promise<{ intake: { id: string; name: string; places: number; level: string; reportingDate: string | null }; applicants: ApplicantRow[] }> {
  const db = getScopedDb(user.schoolId, user.id);
  const intake = await db.intake.findFirst({ where: { id: intakeId }, include: { level: { select: { name: true } } } });
  if (!intake) throw new ServiceError('Intake not found', 404);
  const rows = await db.application.findMany({ where: { intakeId }, orderBy: [{ surname: 'asc' }, { firstName: 'asc' }] });
  const today = todayInHarare();
  return {
    intake: { id: intake.id, name: intake.name, places: intake.places, level: intake.level.name, reportingDate: day(intake.reportingDate) },
    applicants: rows.map((a) => {
      const r = (a.entryResults ?? {}) as { grade7Units?: number; oLevelPasses?: number; oLevelPoints?: number };
      const birth = day(a.dateOfBirth)!;
      const age = Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - (today.slice(5) < birth.slice(5) ? 1 : 0);
      return {
        id: a.id, fullName: `${a.firstName} ${a.surname}`, gender: a.gender, age, stage: a.stage, previousSchool: a.previousSchool, grade7Units: r.grade7Units ?? null,
        oLevelPasses: r.oLevelPasses ?? null, oLevelPoints: r.oLevelPoints ?? null, testScore: a.testScore?.toNumber() ?? null, guardianName: a.guardianName, guardianPhone: a.guardianPhone,
        offerReference: a.offerReference, studentId: a.studentId, appliedAt: a.createdAt.toISOString(), acceptedAt: day(a.acceptedAt), depositPaid: a.depositPaid,
      };
    }),
  };
}

export interface IntakeReport {
  intake: string;
  places: number;
  stages: { key: 'applications' | 'offers' | 'acceptances' | 'enrolments'; label: string; total: number; male: number; female: number; /** Share of the previous stage that got here. */ conversion: number | null }[];
}

/** Applications, offers, acceptances and enrolments by gender, with the conversion at each stage. */
export async function intakeReport(user: AccessUser, intakeId: string): Promise<IntakeReport> {
  const db = getScopedDb(user.schoolId, user.id);
  const intake = await db.intake.findFirst({ where: { id: intakeId } });
  if (!intake) throw new ServiceError('Intake not found', 404);
  const rows = await db.application.findMany({ where: { intakeId }, select: { gender: true, stage: true, stageHistory: true } });
  const reached = (stage: ApplicationStage) => rows.filter((r) => r.stage === stage || ((r.stageHistory as StageStep[] | null) ?? []).some((h) => h.stage === stage));
  const sets = [
    { key: 'applications' as const, label: 'Applications', rows },
    { key: 'offers' as const, label: 'Offers', rows: reached('OFFERED') },
    { key: 'acceptances' as const, label: 'Acceptances', rows: reached('ACCEPTED') },
    { key: 'enrolments' as const, label: 'Enrolments', rows: reached('ENROLLED') },
  ];
  return {
    intake: intake.name, places: intake.places,
    stages: sets.map((s, i) => ({
      key: s.key, label: s.label, total: s.rows.length, male: s.rows.filter((r) => r.gender === 'M').length, female: s.rows.filter((r) => r.gender === 'F').length,
      conversion: i === 0 ? null : sets[i - 1]!.rows.length ? Math.round((s.rows.length / sets[i - 1]!.rows.length) * 1000) / 10 : null,
    })),
  };
}

/** The offer letter of an application, for printing again. */
export async function offerLetterId(user: AccessUser, appId: string) {
  const db = getScopedDb(user.schoolId, user.id);
  const doc = await db.studentDocument.findFirst({ where: { applicationId: appId, type: 'LETTER_OFFER' }, orderBy: { createdAt: 'desc' }, select: { id: true, referenceNo: true } });
  if (!doc) throw new ServiceError('No offer letter has been made for this applicant', 404);
  return doc;
}

// ─── Documents of an applicant ───────────────────────────────────────────────
// Birth certificate, Grade 7 or O Level results slip and so on. They sit on the application and move to the student's file on enrolment.

export async function uploadApplicationDocument(user: Actor, appId: string, rawInput: z.input<typeof UploadDocumentSchema>) {
  const input = UploadDocumentSchema.parse(rawInput);
  const { schoolId } = user;
  if (!documentKeyBelongsTo(input.fileKey, schoolId)) throw new ServiceError('That file does not belong to this school', 422);
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const a = await tx.application.findFirst({ where: { id: appId, schoolId } });
    if (!a) throw new ServiceError('Application not found', 404);
    const doc = await tx.studentDocument.create({
      data: {
        schoolId, applicationId: appId, studentId: a.studentId, type: input.type, title: input.title, fileKey: input.fileKey, mimeType: input.mimeType, sizeBytes: input.sizeBytes,
        date: input.date ? dateOnly(input.date) : null, expiryDate: input.expiryDate ? dateOnly(input.expiryDate) : null, notes: input.notes ?? null, uploadedById: user.id,
      },
    });
    await logAudit({ schoolId, actorId: user.id, action: 'UPLOAD_DOCUMENT', entityType: 'StudentDocument', entityId: doc.id, detail: `${a.firstName} ${a.surname} (applicant): ${DOCUMENT_TYPE_LABEL[input.type]} — ${input.title}` }, tx);
    return doc;
  });
}
