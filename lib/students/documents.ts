// Student documents: uploads (private, opened through links that expire after 10 minutes), the checklist of
// required documents, and the letters the school writes most often. Every generated letter is saved with a
// reference number and a snapshot of what it said, so a copy can be printed again and checked later.
import type { DocumentType, ExitReason, Prisma } from '@prisma/client';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { can, type AccessUser } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { idSchema, isoDateSchema, loadReachable, noteSchema } from '@/lib/students/common';
import { todayInHarare } from '@/lib/students/registration';
import { EXIT_REASON_LABEL, studentAccess } from '@/lib/students/rules';
import { studentScope } from '@/lib/students/scope';

type Actor = AccessUser & { fullName?: string };

export const SIGNED_LINK_TTL = '10m';
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export const UPLOAD_TYPES = [
  'BIRTH_CERTIFICATE', 'GUARDIAN_ID', 'GRADE7_RESULTS_SLIP', 'OLEVEL_RESULTS_SLIP', 'PREVIOUS_SCHOOL_REPORT',
  'TRANSFER_LETTER_RECEIVED', 'MEDICAL_REPORT', 'PHOTO_CONSENT', 'OTHER',
] as const satisfies readonly DocumentType[];
export const LETTER_TYPES = ['LETTER_ADMISSION', 'LETTER_PROOF_OF_ENROLMENT', 'LETTER_TRANSFER', 'LETTER_TESTIMONIAL', 'LETTER_LEAVING_CERTIFICATE', 'LETTER_OFFER'] as const satisfies readonly DocumentType[];

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  BIRTH_CERTIFICATE: 'Birth certificate', GUARDIAN_ID: 'Guardian ID', GRADE7_RESULTS_SLIP: 'Grade 7 results slip', OLEVEL_RESULTS_SLIP: 'O Level results slip',
  PREVIOUS_SCHOOL_REPORT: 'Previous school report', TRANSFER_LETTER_RECEIVED: 'Transfer letter (from previous school)', MEDICAL_REPORT: 'Medical report',
  PHOTO_CONSENT: 'Photo consent', OTHER: 'Other', LETTER_ADMISSION: 'Admission letter', LETTER_PROOF_OF_ENROLMENT: 'Proof of enrolment',
  LETTER_TRANSFER: 'Transfer letter', LETTER_TESTIMONIAL: 'Testimonial', LETTER_LEAVING_CERTIFICATE: 'School leaving certificate', LETTER_OFFER: 'Offer letter',
};

/** Guardian ID scans need the ID-number permission, medical reports need medical access; the rest follow documents.view. */
export function canOpenDocumentType(user: AccessUser, type: DocumentType): boolean {
  const a = studentAccess(user);
  // An offer letter belongs to the admissions office as much as to the student's file.
  if (type === 'LETTER_OFFER' && can(user, 'students.admissions.view')) return true;
  if (!a.documents) return false;
  if (type === 'GUARDIAN_ID') return a.idNumbers;
  if (type === 'MEDICAL_REPORT') return a.medical;
  return true;
}

// ─── Uploads ─────────────────────────────────────────────────────────────────

export const UploadDocumentSchema = z
  .object({
    type: z.enum(UPLOAD_TYPES, { error: 'Choose the kind of document' }),
    title: z.string().trim().min(2, 'Give the document a title').max(120),
    date: isoDateSchema.optional(),
    expiryDate: isoDateSchema.optional(),
    notes: noteSchema(300),
    fileKey: z.string().trim().min(10).max(200),
    mimeType: z.enum(DOCUMENT_MIME_TYPES, { error: 'Upload a PDF, JPG or PNG' }),
    sizeBytes: z.number().int().positive().max(MAX_DOCUMENT_BYTES, 'The file must be 5 MB or smaller'),
  })
  .refine((v) => !v.date || !v.expiryDate || v.expiryDate >= v.date, { path: ['expiryDate'], message: 'The expiry date cannot be before the document date' });
export type UploadDocumentInput = z.input<typeof UploadDocumentSchema>;

/** The key UploadThing stores a private student file under; it always starts with the school's id. */
export const newDocumentKey = (schoolId: string, uuid: string) => `sdoc:${schoolId}:${uuid}`;
export const documentKeyBelongsTo = (key: string, schoolId: string) => key.startsWith(`sdoc:${schoolId}:`) && key.length > `sdoc:${schoolId}:`.length;

export async function uploadDocument(user: Actor, studentId: string, rawInput: UploadDocumentInput) {
  const input = UploadDocumentSchema.parse(rawInput);
  const { schoolId } = user;
  if (!documentKeyBelongsTo(input.fileKey, schoolId)) throw new ServiceError('That file does not belong to this school', 422);
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const open = await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' }, select: { id: true } });
    const [student] = await loadReachable(tx, user, [studentId], open?.id);
    const doc = await tx.studentDocument.create({
      data: {
        schoolId, studentId, type: input.type, title: input.title, fileKey: input.fileKey, mimeType: input.mimeType, sizeBytes: input.sizeBytes,
        date: input.date ? new Date(`${input.date}T00:00:00Z`) : null, expiryDate: input.expiryDate ? new Date(`${input.expiryDate}T00:00:00Z`) : null,
        notes: input.notes ?? null, uploadedById: user.id,
      },
    });
    await logAudit(
      { schoolId, actorId: user.id, action: 'UPLOAD_DOCUMENT', entityType: 'StudentDocument', entityId: doc.id, detail: `${student!.fullName}: ${DOCUMENT_TYPE_LABEL[input.type]} — ${input.title}`, after: { studentId, type: input.type, sizeBytes: input.sizeBytes } },
      tx,
    );
    return doc;
  });
}

export interface DocumentRow {
  id: string;
  type: DocumentType;
  typeLabel: string;
  title: string;
  date: string | null;
  expiryDate: string | null;
  expired: boolean;
  notes: string | null;
  generated: boolean;
  referenceNo: string | null;
  uploadedBy: string;
  createdAt: string;
  /** False when the viewer may see that the document exists but not open it (Guardian ID, medical report). */
  canOpen: boolean;
}

export interface ChecklistItem { type: DocumentType; label: string; present: boolean; expired: boolean }

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function listDocuments(user: AccessUser, studentId: string): Promise<{ documents: DocumentRow[]; checklist: ChecklistItem[] }> {
  const db = getScopedDb(user.schoolId, user.id);
  const open = await db.academicTerm.findFirst({ where: { status: 'OPEN' }, select: { id: true } });
  const reach = await db.student.findFirst({ where: { AND: [studentScope(user, open?.id), { id: studentId }] }, select: { id: true } });
  if (!reach) throw new ServiceError('Student not found', 404);
  const [rows, school] = await Promise.all([
    db.studentDocument.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' } }),
    db.school.findUnique({ where: { id: user.schoolId }, select: { requiredDocumentTypes: true } }),
  ]);
  const people = await db.user.findMany({ where: { id: { in: rows.map((r) => r.uploadedById) } }, select: { id: true, fullName: true } });
  const nameOf = new Map(people.map((p) => [p.id, p.fullName]));
  const today = todayInHarare();
  const documents = rows.map((r) => ({
    id: r.id, type: r.type, typeLabel: DOCUMENT_TYPE_LABEL[r.type], title: r.title, date: day(r.date), expiryDate: day(r.expiryDate),
    expired: !!r.expiryDate && day(r.expiryDate)! < today, notes: r.notes, generated: r.generated, referenceNo: r.referenceNo,
    uploadedBy: nameOf.get(r.uploadedById) ?? '—', createdAt: r.createdAt.toISOString(), canOpen: canOpenDocumentType(user, r.type),
  }));
  const required = (school?.requiredDocumentTypes ?? []).filter((t): t is DocumentType => (UPLOAD_TYPES as readonly string[]).includes(t));
  const checklist = required.map((type) => {
    const mine = documents.filter((d) => d.type === type && !d.generated);
    return { type, label: DOCUMENT_TYPE_LABEL[type], present: mine.some((d) => !d.expired), expired: mine.length > 0 && mine.every((d) => d.expired) };
  });
  return { documents, checklist };
}

/** The types the school requires, chosen in Settings. */
export const RequiredDocumentsSchema = z.object({ types: z.array(z.enum(UPLOAD_TYPES)).max(UPLOAD_TYPES.length) });

export async function setRequiredDocuments(user: AccessUser, rawInput: z.input<typeof RequiredDocumentsSchema>) {
  const { types } = RequiredDocumentsSchema.parse(rawInput);
  const unique = Array.from(new Set(types));
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const before = await tx.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { requiredDocumentTypes: true } });
    await tx.school.update({ where: { id: user.schoolId }, data: { requiredDocumentTypes: unique } });
    await logAudit(
      { schoolId: user.schoolId, actorId: user.id, action: 'UPDATE_SCHOOL_SETTINGS', entityType: 'School', entityId: user.schoolId, detail: 'Required student documents changed', before: { requiredDocumentTypes: before.requiredDocumentTypes }, after: { requiredDocumentTypes: unique } },
      tx,
    );
    return unique;
  });
}

/**
 * A link to an uploaded file that stops working after 10 minutes. Opening a document is audited.
 * `sign` is passed in so tests (and any other storage) can stand in for UploadThing.
 */
export async function documentLink(
  user: AccessUser, documentId: string, sign: (key: string, expiresIn: string) => Promise<string>,
): Promise<{ url: string; expiresIn: string; fileName: string }> {
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const doc = await tx.studentDocument.findFirst({ where: { id: documentId, schoolId } });
    if (!doc || !doc.studentId) throw new ServiceError('Document not found', 404);
    const open = await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' }, select: { id: true } });
    await loadReachable(tx, user, [doc.studentId], open?.id);
    if (!canOpenDocumentType(user, doc.type)) throw new ServiceError('Forbidden', 403);
    if (!doc.fileKey) throw new ServiceError('This letter is printed from the system, not from a file', 409);
    if (!documentKeyBelongsTo(doc.fileKey, schoolId)) throw new ServiceError('Document not found', 404);
    const url = await sign(doc.fileKey, SIGNED_LINK_TTL);
    await logAudit({ schoolId, actorId: user.id, action: 'VIEW_DOCUMENT', entityType: 'StudentDocument', entityId: doc.id, detail: `${DOCUMENT_TYPE_LABEL[doc.type]} — ${doc.title}` }, tx);
    return { url, expiresIn: SIGNED_LINK_TTL, fileName: doc.title };
  });
}

// ─── Letters ─────────────────────────────────────────────────────────────────

export const LETTER_PREFIX: Record<(typeof LETTER_TYPES)[number], string> = {
  LETTER_ADMISSION: 'ADM', LETTER_PROOF_OF_ENROLMENT: 'POE', LETTER_TRANSFER: 'TRF', LETTER_TESTIMONIAL: 'TES', LETTER_LEAVING_CERTIFICATE: 'LVC', LETTER_OFFER: 'OFR',
};

export interface SchoolLetterhead {
  name: string; motto: string | null; address: string | null; phone: string | null; email: string | null; website: string | null;
  logoUrl: string | null; headName: string | null; headSignatureUrl: string | null; district: string | null; province: string | null;
}

export interface LetterSnapshot {
  type: (typeof LETTER_TYPES)[number];
  referenceNo: string;
  issuedOn: string;
  school: SchoolLetterhead;
  student: { fullName: string; admissionNumber: string; gender: 'M' | 'F' | null; dateOfBirth: string | null } | null;
  /** Everything else the letter says, by type. */
  body: Record<string, string | string[] | null>;
}

export async function loadLetterhead(tx: Db, schoolId: string): Promise<SchoolLetterhead> {
  const s = await tx.school.findUniqueOrThrow({ where: { id: schoolId } });
  return {
    name: s.name, motto: s.motto, address: s.physicalAddress ?? s.address, phone: s.phone, email: s.email, website: s.website,
    logoUrl: s.logoUrl, headName: s.headName, headSignatureUrl: s.headSignatureUrl, district: s.district, province: s.province,
  };
}

/** The next reference number, e.g. TRF-2026-00012. Counted per school; taken inside the caller's transaction. */
export async function nextReference(tx: Db, schoolId: string, type: (typeof LETTER_TYPES)[number], year = Number(todayInHarare().slice(0, 4))) {
  const school = await tx.school.update({ where: { id: schoolId }, data: { letterNextNumber: { increment: 1 } }, select: { letterNextNumber: true } });
  return `${LETTER_PREFIX[type]}-${year}-${String(school.letterNextNumber - 1).padStart(5, '0')}`;
}

export const GenerateLetterSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('LETTER_ADMISSION'), studentId: idSchema, reportingDate: isoDateSchema }),
  z.object({ type: z.literal('LETTER_PROOF_OF_ENROLMENT'), studentId: idSchema, purpose: noteSchema(120) }),
  z.object({ type: z.literal('LETTER_TRANSFER'), studentId: idSchema, conduct: z.string().trim().min(2, 'Say how the student behaved').max(300) }),
  z.object({
    type: z.literal('LETTER_TESTIMONIAL'), studentId: idSchema, conduct: z.string().trim().min(2, 'Say how the student behaved').max(300),
    activities: noteSchema(400), positions: noteSchema(400),
  }),
  z.object({ type: z.literal('LETTER_LEAVING_CERTIFICATE'), studentId: idSchema }),
]);
export type GenerateLetterInput = z.input<typeof GenerateLetterSchema>;

const long = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Generates a letter inside the caller's transaction and files it on the student's Documents tab. */
export async function generateLetterTx(tx: Db, user: Actor, rawInput: GenerateLetterInput) {
  const input = GenerateLetterSchema.parse(rawInput);
  const { schoolId } = user;
  const student = await tx.student.findFirst({
    where: { id: input.studentId, schoolId },
    select: { id: true, fullName: true, admissionNumber: true, gender: true, dateOfBirth: true, admissionDate: true, status: true, currentClass: { select: { id: true, name: true } } },
  });
  if (!student) throw new ServiceError('Student not found', 404);

  const today = todayInHarare();
  const exit = await tx.studentExit.findFirst({ where: { studentId: student.id, state: { in: ['STARTED', 'APPROVED', 'COMPLETED'] } }, orderBy: { createdAt: 'desc' } });
  const lastClassName = async () => {
    if (student.currentClass) return student.currentClass.name;
    const id = exit?.lastClassId;
    return id ? (await tx.schoolClass.findUnique({ where: { id }, select: { name: true } }))?.name ?? null : null;
  };
  const attendedTo = exit ? exit.lastDay.toISOString().slice(0, 10) : today;
  const attendedFrom = student.admissionDate.toISOString().slice(0, 10);
  const body: LetterSnapshot['body'] = {};
  let title: string;

  switch (input.type) {
    case 'LETTER_ADMISSION': {
      if (!student.currentClass) throw new ServiceError('The student has no class yet', 409);
      body.className = student.currentClass.name;
      body.reportingDate = input.reportingDate;
      body.reportingDateLong = long(input.reportingDate);
      title = 'Admission letter';
      break;
    }
    case 'LETTER_PROOF_OF_ENROLMENT': {
      const term = await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' } });
      const enrolment = term ? await tx.enrollment.findUnique({ where: { studentId_termId: { studentId: student.id, termId: term.id } }, include: { class: { select: { name: true } } } }) : null;
      if (!term || !enrolment || enrolment.status !== 'ACTIVE' || !(student.status === 'ACTIVE' || student.status === 'SUSPENDED')) {
        throw new ServiceError('A proof of enrolment can only be issued to a student who is enrolled in a class this term', 409);
      }
      body.className = enrolment.class.name;
      body.termName = term.name;
      body.termStart = term.startDate.toISOString().slice(0, 10);
      body.termEnd = term.endDate.toISOString().slice(0, 10);
      body.purpose = input.purpose ?? null;
      title = 'Proof of enrolment';
      break;
    }
    case 'LETTER_TRANSFER': {
      if (!exit || exit.reason !== 'TRANSFER') throw new ServiceError('Start the leaving process with the reason "Transfer to another school" first', 409);
      const klass = student.currentClass?.id ?? exit.lastClassId;
      const subjects = klass
        ? await tx.subjectAssignment.findMany({ where: { classId: klass }, distinct: ['subjectId'], select: { subject: { select: { name: true } } } })
        : [];
      body.className = await lastClassName();
      body.attendedFrom = attendedFrom;
      body.attendedTo = attendedTo;
      body.subjects = subjects.map((s) => s.subject.name).sort();
      body.conduct = input.conduct;
      body.destinationSchool = exit.destinationSchool;
      body.destinationDistrict = exit.destinationDistrict;
      title = 'Transfer letter';
      break;
    }
    case 'LETTER_TESTIMONIAL': {
      body.className = await lastClassName();
      body.attendedFrom = attendedFrom;
      body.attendedTo = attendedTo;
      body.conduct = input.conduct;
      body.activities = input.activities ?? null;
      body.positions = input.positions ?? null;
      title = 'Testimonial';
      break;
    }
    case 'LETTER_LEAVING_CERTIFICATE': {
      if (!exit) throw new ServiceError('A leaving certificate needs a leaving process', 409);
      body.className = await lastClassName();
      body.attendedFrom = attendedFrom;
      body.attendedTo = attendedTo;
      body.reason = EXIT_REASON_LABEL[exit.reason as ExitReason];
      title = 'School leaving certificate';
      break;
    }
  }

  const referenceNo = await nextReference(tx, schoolId, input.type);
  const snapshot: LetterSnapshot = {
    type: input.type, referenceNo, issuedOn: today, school: await loadLetterhead(tx, schoolId),
    student: { fullName: student.fullName, admissionNumber: student.admissionNumber, gender: student.gender, dateOfBirth: student.dateOfBirth?.toISOString().slice(0, 10) ?? null },
    body,
  };
  const doc = await tx.studentDocument.create({
    data: {
      schoolId, studentId: student.id, type: input.type, title: `${title} ${referenceNo}`, generated: true, referenceNo, date: new Date(`${today}T00:00:00Z`),
      snapshot: snapshot as unknown as Prisma.InputJsonValue, uploadedById: user.id,
    },
  });
  await logAudit(
    { schoolId, actorId: user.id, action: 'GENERATE_LETTER', entityType: 'StudentDocument', entityId: doc.id, detail: `${student.fullName}: ${title} ${referenceNo}`, after: { referenceNo, type: input.type, studentId: student.id } },
    tx,
  );
  return doc;
}

export async function generateLetter(user: Actor, input: GenerateLetterInput) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const open = await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' }, select: { id: true } });
    await loadReachable(tx, user, [(input as { studentId: string }).studentId], open?.id);
    return generateLetterTx(tx, user, input);
  });
}

/** The saved letter, for printing again. The wording is exactly what was issued, whatever has changed since. */
export async function letterSnapshot(user: AccessUser, documentId: string): Promise<LetterSnapshot> {
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const doc = await tx.studentDocument.findFirst({ where: { id: documentId, schoolId, generated: true } });
    if (!doc || !doc.snapshot) throw new ServiceError('Letter not found', 404);
    if (!canOpenDocumentType(user, doc.type)) throw new ServiceError('Forbidden', 403);
    if (doc.studentId) {
      const open = await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' }, select: { id: true } });
      await loadReachable(tx, user, [doc.studentId], open?.id);
    }
    await logAudit({ schoolId, actorId: user.id, action: 'VIEW_DOCUMENT', entityType: 'StudentDocument', entityId: doc.id, detail: `${doc.title} printed` }, tx);
    return doc.snapshot as unknown as LetterSnapshot;
  });
}

/** Checks a reference number printed on a letter: was it issued by this school, to whom, and when. */
export async function verifyLetter(user: AccessUser, referenceNo: string) {
  const ref = z.string().trim().min(5).max(40).parse(referenceNo).toUpperCase();
  const db = getScopedDb(user.schoolId, user.id);
  const doc = await db.studentDocument.findFirst({ where: { referenceNo: ref, generated: true }, include: { student: { select: { fullName: true, admissionNumber: true } } } });
  if (!doc) return { valid: false as const };
  return {
    valid: true as const, referenceNo: ref, type: doc.type, typeLabel: DOCUMENT_TYPE_LABEL[doc.type],
    issuedOn: day(doc.date), studentName: doc.student?.fullName ?? null, admissionNumber: doc.student?.admissionNumber ?? null,
  };
}
