// Editing a student's own details. The admission number never changes, and neither does the status or the class:
// those move only through their own actions (suspend, leave, rejoin, move class), each with a reason and an audit entry.
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import type { AccessUser } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { getScopedDb } from '@/lib/scoped-db';
import { dateOnly } from '@/lib/academic/terms';
import { idSchema, loadReachable } from '@/lib/students/common';
import { adjustForBoardingChange } from '@/lib/finance/billing';
import { isoDateField, optionalText, personName } from '@/lib/students/registration';
import { isValidBirthCert, normaliseBirthCert } from '@/lib/students/rules';
import { ORPHAN_STATUSES } from '@/lib/students/admit';

const UPLOADED_IMAGE = /^https:\/\/(utfs\.io|[a-z0-9-]+\.ufs\.sh)\//;
// The dropdown lists suggest values; a school may also type its own (e.g. a language not on the list).
const pick = () => z.string().trim().max(60).nullable().optional().transform((v) => v || null);

export const UpdateStudentSchema = z
  .object({
    firstName: personName('First name(s)'),
    surname: personName('Surname'),
    preferredName: optionalText('Preferred name', 50),
    gender: z.enum(['M', 'F']),
    dateOfBirth: isoDateField('Date of birth', {}),
    birthCertificateNumber: z.string().nullable().transform((raw, ctx) => {
      const v = (raw ?? '').trim();
      if (!v) return null;
      if (!isValidBirthCert(v)) { ctx.addIssue({ code: 'custom', message: 'Birth certificate number should look like 63-123456 A 42' }); return null; }
      return normaliseBirthCert(v);
    }),
    nationality: pick(), homeLanguage: pick(), religion: pick(),
    photoUrl: z.string().trim().max(500).regex(UPLOADED_IMAGE, 'Upload the photo again').nullable(),
    previousSchool: optionalText('Previous school', 100),
    address: optionalText('Address', 200),
    boarding: z.enum(['DAY', 'BOARDER']),
    houseId: idSchema.nullable(),
    isBeam: z.boolean(),
    sponsorName: optionalText('Sponsor name', 80),
    orphanStatus: z.enum(ORPHAN_STATUSES),
    specialNeeds: z.boolean(),
    specialNeedsNote: optionalText('Special needs note', 300),
  })
  .partial()
  .strict();
export type UpdateStudentInput = z.input<typeof UpdateStudentSchema>;

/** Fields whose values stay out of the audit entry (the entry says only that they changed). */
const PRIVATE = new Set(['birthCertificateNumber', 'specialNeedsNote']);

export async function updateStudent(user: AccessUser, studentId: string, rawInput: UpdateStudentInput) {
  const input = UpdateStudentSchema.parse(rawInput);
  const { schoolId } = user;
  if (Object.keys(input).length === 0) throw new ServiceError('Nothing to change', 422);

  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const open = await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' }, select: { id: true } });
    await loadReachable(tx, user, [studentId], open?.id, 'students.profiles.edit');
    const before = await tx.student.findUniqueOrThrow({ where: { id: studentId } });

    const data: Prisma.StudentUncheckedUpdateInput = {};
    const set = <K extends keyof UpdateStudentInput>(k: K, v: unknown) => { (data as Record<string, unknown>)[k as string] = v; };
    for (const key of Object.keys(input) as (keyof UpdateStudentInput)[]) {
      const v = input[key];
      if (key === 'dateOfBirth') set(key, dateOnly(v as string));
      else set(key, v === undefined ? null : v);
    }
    const first = (input.firstName ?? before.firstName) as string;
    const last = (input.surname ?? before.surname) as string;
    if (input.firstName !== undefined || input.surname !== undefined) data.fullName = `${first} ${last}`;

    if (input.dateOfBirth && input.dateOfBirth > before.admissionDate.toISOString().slice(0, 10)) throw new ServiceError('The date of birth cannot be after the admission date', 422);
    if (input.birthCertificateNumber) {
      const clash = await tx.student.findFirst({ where: { schoolId, birthCertificateNumber: input.birthCertificateNumber, id: { not: studentId } }, select: { fullName: true, admissionNumber: true } });
      if (clash) throw new ServiceError(`The birth certificate number is already used by ${clash.fullName} (${clash.admissionNumber}).`, 409);
    }
    if (input.houseId && !(await tx.house.findFirst({ where: { id: input.houseId, schoolId }, select: { id: true } }))) throw new ServiceError('House not found', 404);
    if (input.specialNeeds === false) data.specialNeedsNote = null;
    if (input.specialNeeds === true && !(input.specialNeedsNote ?? before.specialNeedsNote)) throw new ServiceError('Add a note about the support the student needs', 422);

    const changed: string[] = [];
    const was: Record<string, unknown> = {};
    const now: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === 'fullName') continue;
      const old = (before as unknown as Record<string, unknown>)[k];
      const same = old instanceof Date && v instanceof Date ? old.getTime() === v.getTime() : old === v;
      if (same) { delete (data as Record<string, unknown>)[k]; continue; }
      changed.push(k);
      was[k] = PRIVATE.has(k) ? '[private]' : old instanceof Date ? old.toISOString().slice(0, 10) : old;
      now[k] = PRIVATE.has(k) ? '[private]' : v instanceof Date ? v.toISOString().slice(0, 10) : v;
    }
    if (changed.length === 0) return { changed: [] as string[] };
    const updated = await tx.student.update({ where: { id: studentId }, data });
    // Day to boarder (or back): the boarding charge is added or reversed from today, if the term has been billed.
    if (changed.includes('boarding') && updated.status === 'ACTIVE') {
      await adjustForBoardingChange(tx, user, studentId, updated.boarding as 'DAY' | 'BOARDER', new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`));
    }
    await logAudit(
      { schoolId, actorId: user.id, action: 'UPDATE_STUDENT', entityType: 'Student', entityId: studentId, detail: `${updated.fullName}: ${changed.join(', ')}`, before: was as Prisma.InputJsonValue, after: now as Prisma.InputJsonValue },
      tx,
    );
    return { changed };
  });
}
