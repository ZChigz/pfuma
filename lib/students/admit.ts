// Add student: the four steps of the form (personal details, enrolment, guardians, review and save) validated on
// the server. Only the essentials are required. Warnings (age outside the usual range for the form, class full,
// same name and date of birth) do not block: the person has to say they have seen them. The same birth
// certificate number cannot be saved twice, because it identifies one child.
import type { BoardingType, EntryType, GuardianRelationship, OrphanStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { can, type AccessUser } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { ensureStudentMember } from '@/lib/library';
import { dateOnly } from '@/lib/academic/terms';
import { findOrCreateGuardian, linkGuardian } from '@/lib/students/guardians';
import { idSchema } from '@/lib/students/common';
import {
  ageWarning, custom, isoDateField, mobilePhone, normalizeName, optionalText, personName, RELATIONSHIPS, todayInHarare, MIN_ADMISSION_DATE,
  type RegistrationWarning,
} from '@/lib/students/registration';
import { isValidBirthCert, normaliseBirthCert } from '@/lib/students/rules';
import { nextSequences, takeAdmissionNumber, withAdmissionNumberRetry } from '@/lib/students/server';

export const ENTRY_TYPES = ['NEW_FORM_1', 'NEW_LOWER_6', 'TRANSFER_IN', 'RETURNING'] as const satisfies readonly EntryType[];
export const ENTRY_TYPE_LABEL: Record<EntryType, string> = { NEW_FORM_1: 'New Form 1', NEW_LOWER_6: 'New Lower 6', TRANSFER_IN: 'Transfer in', RETURNING: 'Returning' };
export const ORPHAN_STATUSES = ['NONE', 'SINGLE', 'DOUBLE'] as const satisfies readonly OrphanStatus[];
export const NATIONALITIES = ['Zimbabwean', 'South African', 'Zambian', 'Mozambican', 'Malawian', 'Botswana', 'Other'] as const;
export const HOME_LANGUAGES = ['Shona', 'Ndebele', 'English', 'Kalanga', 'Tonga', 'Venda', 'Nambya', 'Shangani', 'Sotho', 'Other'] as const;
export const RELIGIONS = ['Christian (Anglican)', 'Christian (Catholic)', 'Christian (Methodist)', 'Christian (Apostolic)', 'Christian (Pentecostal)', 'Christian (SDA)', 'Christian (Other)', 'Muslim', 'Traditional', 'None', 'Other'] as const;

// The usual UploadThing hosts only: a photo address typed in by hand must never point somewhere else.
const UPLOADED_IMAGE = /^https:\/\/(utfs\.io|[a-z0-9-]+\.ufs\.sh)\//;

const dropdown = (values: readonly string[]) => z.string().trim().max(60).optional().transform((v) => (v && values.includes(v) ? v : v || undefined));

const certField = z.string().optional().transform((raw, ctx) => {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (!isValidBirthCert(v)) {
    custom(ctx, 'Birth certificate number should look like 63-123456 A 42');
    return null;
  }
  return normaliseBirthCert(v);
});

const GuardianSchema = z
  .object({
    /** Link a guardian who is already in the school (found by phone) instead of typing them again. */
    existingGuardianId: idSchema.optional(),
    fullName: z.string().optional(),
    relationship: z.enum(RELATIONSHIPS, { error: "Please select the guardian's relationship to the student" }),
    relationshipNote: optionalText('Relationship', 30),
    phone: z.string().optional(),
    phone2: z.string().optional(),
    email: optionalText('Email', 100, { re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Email must look like name@example.com' }),
    nationalId: optionalText('National ID', 20, { re: /^[A-Za-z0-9 -]+$/, message: 'National ID can only contain letters, numbers, spaces and -' }),
    occupation: optionalText('Occupation', 60),
    address: optionalText('Address', 200),
    isPrimary: z.boolean().default(false),
    isFeePayer: z.boolean().default(false),
    receivesSms: z.boolean().default(true),
    canCollect: z.boolean().default(true),
    custodyNote: optionalText('Custody note', 200),
  })
  .superRefine((g, ctx) => {
    if (g.relationship === 'OTHER' && !g.relationshipNote) custom(ctx, 'Please type the relationship', ['relationshipNote']);
    if (g.existingGuardianId) return;
    const name = personName('Guardian name').safeParse(g.fullName ?? '');
    if (!name.success) custom(ctx, name.error.issues[0]!.message, ['fullName']);
    else if (!name.data.includes(' ')) custom(ctx, "Enter the guardian's first name and surname", ['fullName']);
    const phone = mobilePhone('Phone', true).safeParse(g.phone);
    if (!phone.success) custom(ctx, phone.error.issues[0]!.message, ['phone']);
    const phone2 = mobilePhone('Second phone', false).safeParse(g.phone2);
    if (!phone2.success) custom(ctx, phone2.error.issues[0]!.message, ['phone2']);
    else if (phone.success && phone2.data && phone2.data === phone.data) custom(ctx, 'The second phone is the same as the first', ['phone2']);
  });

export const AdmitStudentSchema = z
  .object({
    // Step 1: personal details
    firstName: personName('First name(s)'),
    surname: personName('Surname'),
    preferredName: optionalText('Preferred name', 50),
    gender: z.enum(['M', 'F'], { error: 'Please select Male or Female' }),
    dateOfBirth: isoDateField('Date of birth', {}),
    birthCertificateNumber: certField,
    nationality: dropdown(NATIONALITIES),
    homeLanguage: dropdown(HOME_LANGUAGES),
    religion: dropdown(RELIGIONS),
    photoUrl: z.string().trim().max(500).regex(UPLOADED_IMAGE, 'Upload the photo again').optional().or(z.literal('').transform(() => undefined)),
    // Step 2: enrolment
    admissionDate: isoDateField('Admission date', { min: MIN_ADMISSION_DATE, minMessage: 'Admission date must be in 2000 or later' }).default(() => todayInHarare()),
    classId: idSchema,
    boarding: z.enum(['DAY', 'BOARDER']).default('DAY'),
    houseId: idSchema.optional().or(z.literal('').transform(() => undefined)),
    entryType: z.enum(ENTRY_TYPES, { error: 'Choose how the student is joining' }),
    previousSchool: optionalText('Previous school', 100),
    entryResults: z.object({
      grade7Units: z.number().int().min(4, 'Grade 7 units are between 4 and 36').max(36, 'Grade 7 units are between 4 and 36').optional(),
      oLevelPasses: z.number().int().min(0).max(14).optional(),
      oLevelPoints: z.number().int().min(0).max(60).optional(),
    }).optional(),
    isBeam: z.boolean().default(false),
    sponsorName: optionalText('Sponsor name', 80),
    orphanStatus: z.enum(ORPHAN_STATUSES).default('NONE'),
    specialNeeds: z.boolean().default(false),
    specialNeedsNote: optionalText('Special needs note', 300),
    address: optionalText('Address', 200),
    // Step 3: guardians (at least one)
    guardians: z.array(GuardianSchema).min(1, 'Add at least one guardian').max(6),
  })
  .superRefine((d, ctx) => {
    if ((d.entryType === 'TRANSFER_IN' || d.entryType === 'NEW_LOWER_6') && !d.previousSchool) custom(ctx, 'Name the previous school', ['previousSchool']);
    if (d.specialNeeds && !d.specialNeedsNote) custom(ctx, 'Add a note about the support the student needs', ['specialNeedsNote']);
    const primaries = d.guardians.filter((g) => g.isPrimary).length;
    if (primaries !== 1) custom(ctx, primaries === 0 ? 'Choose the primary contact' : 'Only one guardian can be the primary contact', ['guardians']);
    if (d.dateOfBirth && d.admissionDate && d.admissionDate < d.dateOfBirth) custom(ctx, 'Admission date cannot be before the date of birth', ['admissionDate']);
    if (d.entryType === 'NEW_FORM_1' && d.entryResults?.oLevelPasses !== undefined) custom(ctx, 'O Level results are for Lower 6 entry', ['entryResults']);
  });
export type AdmitStudentInput = z.input<typeof AdmitStudentSchema>;
export type AdmitStudentData = z.output<typeof AdmitStudentSchema>;

export const ADMIT_WARNING_CODES = ['AGE_OUT_OF_RANGE', 'CLASS_FULL', 'POSSIBLE_DUPLICATE', 'ENTRY_LEVEL_MISMATCH'] as const;

export interface AdmissionCheck {
  className: string;
  levelName: string;
  classCount: number;
  capacity: number;
  termName: string | null;
  admissionNumberPreview: string;
  warnings: (Omit<RegistrationWarning, 'code'> & { code: (typeof ADMIT_WARNING_CODES)[number] })[];
  /** Same name and date of birth: warn, and offer "Open existing" or "Save anyway". */
  possibleDuplicates: { id: string; fullName: string; admissionNumber: string; className: string | null; status: string }[];
  /** Same birth certificate number: cannot be saved; "Open existing" only. */
  certificateMatch: { id: string; fullName: string; admissionNumber: string } | null;
  /** Guardians already in the school with these phone numbers, and their children here. */
  guardianMatches: { phone: string; guardianId: string; fullName: string; children: { id: string; fullName: string; className: string | null }[] }[];
  needsApproval: boolean;
}

const dayStr = (d: Date) => d.toISOString().slice(0, 10);

async function resolveClass(tx: Db, schoolId: string, classId: string) {
  const klass = await tx.schoolClass.findFirst({ where: { id: classId, schoolId }, include: { level: true } });
  if (!klass) throw new ServiceError('Class not found', 404);
  if (!klass.active || !klass.level.active) throw new ServiceError(`${klass.name} is not in use`, 409);
  return klass;
}

/** What the review step shows: warnings, duplicates, shared guardians, the admission number that will be used. */
export async function checkAdmission(user: AccessUser, data: AdmitStudentData, tx?: Db): Promise<AdmissionCheck> {
  const run = async (db: Db): Promise<AdmissionCheck> => {
    const { schoolId } = user;
    const klass = await resolveClass(db, schoolId, data.classId);
    const term = await db.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' } });
    const classCount = term ? await db.enrollment.count({ where: { classId: klass.id, termId: term.id, status: 'ACTIVE' } }) : 0;

    const warnings: AdmissionCheck['warnings'] = [];
    const age = ageWarning(data.dateOfBirth, klass.level.name);
    if (age) warnings.push({ code: 'AGE_OUT_OF_RANGE', message: age });
    if (classCount + 1 > klass.capacity) {
      warnings.push({ code: 'CLASS_FULL', message: `${klass.name} already has ${classCount} students and its capacity is ${klass.capacity}. Adding this student will make it ${classCount + 1}.` });
    }
    if ((data.entryType === 'NEW_FORM_1' && klass.level.order !== 1) || (data.entryType === 'NEW_LOWER_6' && klass.level.order !== 5)) {
      warnings.push({ code: 'ENTRY_LEVEL_MISMATCH', message: `${ENTRY_TYPE_LABEL[data.entryType]} students normally join ${data.entryType === 'NEW_FORM_1' ? 'Form 1' : 'Form 5 (Lower 6)'}, not ${klass.level.name}.` });
    }

    const dups = await db.student.findMany({
      where: { schoolId, firstName: { equals: data.firstName, mode: 'insensitive' }, surname: { equals: data.surname, mode: 'insensitive' }, dateOfBirth: dateOnly(data.dateOfBirth) },
      select: { id: true, fullName: true, admissionNumber: true, status: true, currentClass: { select: { name: true } } },
    });
    if (dups.length) {
      const d = dups[0]!;
      warnings.push({ code: 'POSSIBLE_DUPLICATE', message: `A student with the same name and date of birth is already registered: ${d.fullName} (${d.admissionNumber})${d.currentClass ? ` in ${d.currentClass.name}` : ''}. Make sure this is not the same child.` });
    }
    const cert = data.birthCertificateNumber
      ? await db.student.findFirst({ where: { schoolId, birthCertificateNumber: data.birthCertificateNumber }, select: { id: true, fullName: true, admissionNumber: true } })
      : null;

    const phones = data.guardians.flatMap((g) => (g.existingGuardianId || !g.phone ? [] : [mobilePhone('Phone', true).parse(g.phone)!]));
    const found = phones.length
      ? await db.guardian.findMany({
          where: { phone: { in: phones } },
          select: { id: true, fullName: true, phone: true, students: { where: { student: { status: { in: ['ACTIVE', 'SUSPENDED'] } } }, select: { student: { select: { id: true, fullName: true, currentClass: { select: { name: true } } } } } } },
        })
      : [];

    const year = Number(data.admissionDate.slice(0, 4));
    const preview = takeAdmissionNumber(await nextSequences(db, schoolId, [year]), year);
    return {
      className: klass.name, levelName: klass.level.name, classCount, capacity: klass.capacity, termName: term?.name ?? null, admissionNumberPreview: preview, warnings,
      possibleDuplicates: dups.map((d) => ({ id: d.id, fullName: d.fullName, admissionNumber: d.admissionNumber, className: d.currentClass?.name ?? null, status: d.status })),
      certificateMatch: cert, needsApproval: data.entryType === 'TRANSFER_IN' && !can(user, 'students.admissions.approve'),
      guardianMatches: found.map((g) => ({ phone: g.phone, guardianId: g.id, fullName: g.fullName, children: g.students.map((x) => ({ id: x.student.id, fullName: x.student.fullName, className: x.student.currentClass?.name ?? null })) })),
    };
  };
  return tx ? run(tx) : run(getScopedDb(user.schoolId, user.id) as unknown as Db);
}

/**
 * Saves the student, their Enrollment in the open term and all their guardians in one transaction, with the audit
 * entries. Warnings must have been acknowledged (by code); a birth certificate already in use cannot be saved.
 */
export async function admitTx(
  tx: Db, user: AccessUser & { fullName?: string }, data: AdmitStudentData, acknowledged: readonly string[] = [],
  opts: { skipApprovalCheck?: boolean; note?: string } = {},
) {
  const { schoolId } = user;
  const check = await checkAdmission(user, data, tx);
  if (check.certificateMatch) {
    throw new ServiceError(`The birth certificate number is already used by ${check.certificateMatch.fullName} (${check.certificateMatch.admissionNumber}).`, 409);
  }
  if (check.needsApproval && !opts.skipApprovalCheck) {
    throw new ServiceError('A transfer in is approved by the Head. Ask the Head (or someone who may approve admissions) to add this student.', 403);
  }
  const unseen = check.warnings.filter((w) => !acknowledged.includes(w.code));
  if (unseen.length) throw new ServiceError(`${unseen[0]!.message} Review the warnings and confirm to save anyway.`, 409);
  if (data.houseId && !(await tx.house.findFirst({ where: { id: data.houseId, schoolId }, select: { id: true } }))) throw new ServiceError('House not found', 404);

  const term = await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' } });
  if (!term) throw new ServiceError('No term is open. Open a term under System, Settings, Academic years first.', 409);
  const klass = await resolveClass(tx, schoolId, data.classId);
  const year = Number(data.admissionDate.slice(0, 4));
  const admissionNumber = takeAdmissionNumber(await nextSequences(tx, schoolId, [year]), year);

  const student = await tx.student.create({
    data: {
      schoolId, admissionNumber, firstName: data.firstName, surname: data.surname, fullName: `${data.firstName} ${data.surname}`, preferredName: data.preferredName,
      gender: data.gender, dateOfBirth: dateOnly(data.dateOfBirth), birthCertificateNumber: data.birthCertificateNumber, nationality: data.nationality,
      homeLanguage: data.homeLanguage, religion: data.religion, photoUrl: data.photoUrl, admissionDate: dateOnly(data.admissionDate), entryType: data.entryType,
      previousSchool: data.previousSchool, entryResults: (data.entryResults ?? undefined) as Prisma.InputJsonValue | undefined, boarding: data.boarding as BoardingType,
      houseId: data.houseId ?? null, isBeam: data.isBeam, sponsorName: data.sponsorName, orphanStatus: data.orphanStatus, specialNeeds: data.specialNeeds,
      specialNeedsNote: data.specialNeeds ? data.specialNeedsNote : null, address: data.address, status: 'ACTIVE', currentClassId: klass.id,
    },
  });
  await ensureStudentMember(tx, schoolId, user.id, student.id);
  const admitted = dateOnly(data.admissionDate);
  await tx.enrollment.create({
    data: { schoolId, studentId: student.id, classId: klass.id, termId: term.id, status: 'ACTIVE', startDate: admitted > term.startDate ? admitted : term.startDate, reason: 'Admitted' },
  });

  const linked = new Set<string>();
  for (const g of data.guardians) {
    let guardianId = g.existingGuardianId;
    if (guardianId) {
      if (!(await tx.guardian.findFirst({ where: { id: guardianId, schoolId }, select: { id: true } }))) throw new ServiceError('Guardian not found', 404);
    } else {
      guardianId = (await findOrCreateGuardian(tx, schoolId, user.id, {
        fullName: normalizeName(g.fullName!), phone: mobilePhone('Phone', true).parse(g.phone)!, altPhone: mobilePhone('Phone', false).parse(g.phone2),
        email: g.email?.toLowerCase() ?? null, nationalId: g.nationalId?.toUpperCase() ?? null, occupation: g.occupation, address: g.address,
      })).id;
    }
    if (linked.has(guardianId)) throw new ServiceError('The same guardian is listed twice', 422);
    linked.add(guardianId);
    await linkGuardian(tx, schoolId, user.id, student.id, guardianId, {
      relationship: g.relationship as GuardianRelationship, relationshipNote: g.relationshipNote, isPrimary: g.isPrimary, isFeePayer: g.isFeePayer,
      canReceiveSms: g.receivesSms, canCollect: g.canCollect, custodyNote: g.custodyNote,
    });
  }

  await logAudit(
    {
      schoolId, actorId: user.id, action: 'ADMIT_STUDENT', entityType: 'Student', entityId: student.id,
      detail: `${admissionNumber} ${student.fullName}, ${klass.name} (${ENTRY_TYPE_LABEL[data.entryType]})${opts.note ? `. ${opts.note}` : ''}${check.warnings.length ? `. Accepted warnings: ${check.warnings.map((w) => w.code).join(', ')}` : ''}`,
      after: { admissionNumber, classId: klass.id, entryType: data.entryType, boarding: data.boarding, guardians: linked.size, warnings: check.warnings.map((w) => w.code), admittedOn: dayStr(admitted) },
    },
    tx,
  );
  return { id: student.id, admissionNumber, fullName: student.fullName, className: klass.name };
}

/** Adds one student from the form: everything in one transaction, retried when a concurrent admission took the same number. */
export async function createStudent(user: AccessUser & { fullName?: string }, input: AdmitStudentInput, acknowledged: readonly string[] = []) {
  const data = AdmitStudentSchema.parse(input);
  return withAdmissionNumberRetry(() => getScopedDb(user.schoolId, user.id).$tx((tx) => admitTx(tx, user, data, acknowledged)));
}
