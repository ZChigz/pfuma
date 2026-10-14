// Server-only helpers for student registration (form + CSV import).
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import {
  ageWarning,
  className as buildClassName,
  DEFAULT_MAX_CLASS_SIZE,
  formatStudentNumber,
  type RegisterStudentData,
  type RegistrationWarning,
} from '@/lib/students/registration';

type Db = Prisma.TransactionClient | typeof prisma;

export function dobToDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export async function getMaxClassSize(schoolId: string, db: Db = prisma): Promise<number> {
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { maxClassSize: true } });
  return school?.maxClassSize ?? DEFAULT_MAX_CLASS_SIZE;
}

// Matches on grade + section first so classes created on the Classes page
// (named e.g. "Form 2East") are reused instead of duplicated.
export async function findClass(schoolId: string, form: string, stream: string, db: Db = prisma) {
  return (
    (await db.schoolClass.findFirst({
      where: { schoolId, grade: form, section: { equals: stream, mode: 'insensitive' } },
      orderBy: { active: 'desc' },
    })) ??
    (await db.schoolClass.findFirst({ where: { schoolId, name: buildClassName(form, stream) } }))
  );
}

export async function findOrCreateClass(
  tx: Prisma.TransactionClient,
  schoolId: string,
  actorId: string,
  form: string,
  stream: string,
) {
  const existing = await findClass(schoolId, form, stream, tx);
  if (existing) return existing;

  const name = buildClassName(form, stream);
  const created = await tx.schoolClass.create({
    data: { schoolId, name, grade: form, section: stream },
  });
  await logAudit(
    { schoolId, actorId, action: 'CREATE_CLASS', entityType: 'SchoolClass', entityId: created.id, detail: `${name} (created during student registration)` },
    tx,
  );
  return created;
}

export async function activeStudentCount(classId: string | null | undefined, db: Db = prisma): Promise<number> {
  if (!classId) return 0;
  return db.student.count({ where: { classId, active: true } });
}

export async function findDuplicate(
  schoolId: string,
  firstName: string,
  surname: string,
  dateOfBirth: string,
  db: Db = prisma,
) {
  return db.student.findFirst({
    where: {
      schoolId,
      firstName:   { equals: firstName, mode: 'insensitive' },
      surname:     { equals: surname,   mode: 'insensitive' },
      dateOfBirth: dobToDate(dateOfBirth),
    },
    select: { id: true, studentNumber: true, fullName: true, class: { select: { name: true } } },
  });
}

export function duplicateMessage(dup: { studentNumber: string | null; fullName: string; class: { name: string } | null }): string {
  const who = dup.studentNumber ? `${dup.fullName} (${dup.studentNumber})` : dup.fullName;
  const where = dup.class ? ` in ${dup.class.name}` : '';
  return `A student with the same name and date of birth is already registered: ${who}${where}. Make sure this is not the same child.`;
}

export function classFullMessage(name: string, current: number, max: number): string {
  return `${name} already has ${current} active students and the class limit is ${max}. Adding this student will make it ${current + 1}.`;
}

export interface RegistrationCheck {
  className: string;
  classExists: boolean;
  classCount: number;
  maxClassSize: number;
  warnings: RegistrationWarning[];
}

export async function checkRegistration(schoolId: string, data: RegisterStudentData): Promise<RegistrationCheck> {
  const [schoolClass, maxClassSize, duplicate] = await Promise.all([
    findClass(schoolId, data.form, data.stream),
    getMaxClassSize(schoolId),
    findDuplicate(schoolId, data.firstName, data.surname, data.dateOfBirth),
  ]);
  const classCount = await activeStudentCount(schoolClass?.id);
  const name = schoolClass?.name ?? data.className;

  const warnings: RegistrationWarning[] = [];
  const age = ageWarning(data.dateOfBirth, data.form);
  if (age) warnings.push({ code: 'AGE_OUT_OF_RANGE', message: age });
  if (data.status === 'ACTIVE' && classCount + 1 > maxClassSize) {
    warnings.push({ code: 'CLASS_FULL', message: classFullMessage(name, classCount, maxClassSize) });
  }
  if (duplicate) warnings.push({ code: 'POSSIBLE_DUPLICATE', message: duplicateMessage(duplicate) });

  return { className: name, classExists: !!schoolClass, classCount, maxClassSize, warnings };
}

// Next free sequence number for each enrollment year, e.g. { 2026: 14 }.
// Sequence numbers are fixed-width, so the lexically largest is the highest.
export async function nextSequences(
  tx: Prisma.TransactionClient,
  schoolId: string,
  years: number[],
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  for (const year of Array.from(new Set(years))) {
    const last = await tx.student.findFirst({
      where: { schoolId, studentNumber: { startsWith: `STU${year}` } },
      orderBy: { studentNumber: 'desc' },
      select: { studentNumber: true },
    });
    const lastSeq = last?.studentNumber ? Number(last.studentNumber.slice(7)) : 0;
    result.set(year, (Number.isFinite(lastSeq) ? lastSeq : 0) + 1);
  }
  return result;
}

export function takeStudentNumber(sequences: Map<number, number>, year: number): string {
  const seq = sequences.get(year) ?? 1;
  if (seq > 9999) throw new StudentNumberExhaustedError(year);
  sequences.set(year, seq + 1);
  return formatStudentNumber(year, seq);
}

export class StudentNumberExhaustedError extends Error {
  constructor(year: number) {
    super(`All 9999 student numbers for ${year} are used`);
  }
}

export function isStudentNumberClash(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
  const target = (e.meta?.target ?? []) as string[] | string;
  return String(target).includes('studentNumber');
}

// Runs fn, retrying when a concurrent registration took the same student number.
export async function withStudentNumberRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts || !isStudentNumberClash(e)) throw e;
    }
  }
}

// Student columns shared by the form and the CSV import.
export function studentRecord(
  schoolId: string,
  classId: string,
  studentNumber: string,
  data: RegisterStudentData,
): Prisma.StudentCreateManyInput {
  return {
    schoolId,
    studentNumber,
    classId,
    grade:                  data.form,
    fullName:               data.fullName,
    firstName:              data.firstName,
    surname:                data.surname,
    gender:                 data.gender,
    dateOfBirth:            dobToDate(data.dateOfBirth),
    enrollmentYear:         data.enrollmentYear,
    parentName:             data.guardianName,
    guardianRelationship:   data.guardianRelationship,
    parentPhone:            data.guardianPhone,
    houseNumber:            data.houseNumber,
    suburb:                 data.suburb,
    city:                   data.city,
    address:                data.address,
    status:                 data.status,
    active:                 data.status === 'ACTIVE',
    birthCertificateNumber: data.birthCertificateNumber,
    previousSchool:         data.previousSchool,
    secondGuardianPhone:    data.secondGuardianPhone,
    medicalNotes:           data.medicalNotes,
    photoUrl:               data.photoUrl,
    portalToken:            crypto.randomUUID(),
  };
}
