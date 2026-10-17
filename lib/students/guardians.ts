// Guardians and the student↔guardian links.
// Rules (enforced here; the database additionally allows at most one primary
// per student via "StudentGuardian_one_primary_per_student"):
//  • siblings share one Guardian row — a phone number belongs to one guardian per school;
//  • a linked student always has exactly one primary guardian;
//  • the last guardian of a student cannot be removed.
import type { GuardianRelationship, Prisma } from '@prisma/client';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { z } from 'zod';
import { can, type AccessUser } from '@/lib/access-core';
import { loadReachable } from '@/lib/students/common';
import { mobilePhone, normalizeName, RELATIONSHIPS } from '@/lib/students/registration';

type Tx = Db;

export interface GuardianInput {
  fullName: string;
  phone: string;          // already normalised to +263…
  altPhone?: string | null;
  email?: string | null;
  nationalId?: string | null;
  address?: string | null;
  occupation?: string | null;
}

export interface LinkInput {
  relationship: GuardianRelationship;
  relationshipNote?: string | null;
  isPrimary?: boolean;
  isFeePayer?: boolean;
  canReceiveSms?: boolean;
  canCollect?: boolean;
  custodyNote?: string | null;
}

export async function findOrCreateGuardian(tx: Tx, schoolId: string, actorId: string, input: GuardianInput) {
  const existing = await tx.guardian.findFirst({
    // A phone number belongs to one guardian per school (siblings share the record).
    where: { schoolId, phone: input.phone },
  });
  if (existing) {
    // Fill gaps only; never overwrite details another sibling's record relies on.
    const fill: Prisma.GuardianUpdateInput = {};
    if (!existing.altPhone && input.altPhone) fill.altPhone = input.altPhone;
    if (!existing.email && input.email) fill.email = input.email;
    if (!existing.nationalId && input.nationalId) fill.nationalId = input.nationalId;
    if (!existing.address && input.address) fill.address = input.address;
    if (!existing.occupation && input.occupation) fill.occupation = input.occupation;
    return Object.keys(fill).length ? tx.guardian.update({ where: { id: existing.id }, data: fill }) : existing;
  }
  const created = await tx.guardian.create({ data: { schoolId, ...input } });
  await logAudit(
    { schoolId, actorId, action: 'CREATE_GUARDIAN', entityType: 'Guardian', entityId: created.id, detail: `${created.fullName} ${created.phone}` },
    tx,
  );
  return created;
}

export async function linkGuardian(tx: Tx, schoolId: string, actorId: string, studentId: string, guardianId: string, link: LinkInput) {
  const already = await tx.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId, guardianId } } });
  if (already) throw new ServiceError('This guardian is already linked to the student', 409);

  const count = await tx.studentGuardian.count({ where: { studentId } });
  // The first guardian is always primary.
  const isPrimary = count === 0 ? true : !!link.isPrimary;
  if (isPrimary && count > 0) {
    await tx.studentGuardian.updateMany({ where: { studentId, isPrimary: true }, data: { isPrimary: false } });
  }
  const sg = await tx.studentGuardian.create({
    data: {
      studentId,
      guardianId,
      relationship: link.relationship,
      relationshipNote: link.relationship === 'OTHER' ? link.relationshipNote ?? null : null,
      isPrimary,
      isFeePayer: link.isFeePayer ?? isPrimary,
      canReceiveSms: link.canReceiveSms ?? true,
      canCollect: link.canCollect ?? isPrimary,
      custodyNote: link.custodyNote?.trim() || null,
    },
  });
  await logAudit(
    { schoolId, actorId, action: 'LINK_GUARDIAN', entityType: 'Student', entityId: studentId, detail: `guardian ${guardianId} as ${link.relationship}${isPrimary ? ' (primary)' : ''}` },
    tx,
  );
  return sg;
}

export async function setPrimaryGuardian(schoolId: string, actorId: string, studentId: string, guardianId: string) {
  return getScopedDb(schoolId, actorId).$tx(async (tx) => {
    await requireLink(tx, schoolId, studentId, guardianId);
    await tx.studentGuardian.updateMany({ where: { studentId, isPrimary: true }, data: { isPrimary: false } });
    const sg = await tx.studentGuardian.update({
      where: { studentId_guardianId: { studentId, guardianId } },
      data: { isPrimary: true },
    });
    await logAudit(
      { schoolId, actorId, action: 'SET_PRIMARY_GUARDIAN', entityType: 'Student', entityId: studentId, detail: `guardian ${guardianId}` },
      tx,
    );
    return sg;
  });
}

export async function updateLink(
  schoolId: string,
  actorId: string,
  studentId: string,
  guardianId: string,
  data: { relationship?: GuardianRelationship; relationshipNote?: string | null; isFeePayer?: boolean; canReceiveSms?: boolean; canCollect?: boolean; custodyNote?: string | null },
) {
  return getScopedDb(schoolId, actorId).$tx(async (tx) => {
    await requireLink(tx, schoolId, studentId, guardianId);
    const sg = await tx.studentGuardian.update({ where: { studentId_guardianId: { studentId, guardianId } }, data });
    await logAudit(
      { schoolId, actorId, action: 'UPDATE_GUARDIAN', entityType: 'Student', entityId: studentId, detail: `link to guardian ${guardianId}` },
      tx,
    );
    return sg;
  });
}

export async function unlinkGuardian(schoolId: string, actorId: string, studentId: string, guardianId: string) {
  return getScopedDb(schoolId, actorId).$tx(async (tx) => {
    const link = await requireLink(tx, schoolId, studentId, guardianId);
    const count = await tx.studentGuardian.count({ where: { studentId } });
    if (count <= 1) throw new ServiceError('A student must keep at least one guardian. Add another guardian first.', 409);
    if (link.isPrimary) throw new ServiceError('Make another guardian primary before removing the primary guardian.', 409);
    await tx.studentGuardian.delete({ where: { studentId_guardianId: { studentId, guardianId } } });
    await logAudit(
      { schoolId, actorId, action: 'UNLINK_GUARDIAN', entityType: 'Student', entityId: studentId, detail: `guardian ${guardianId}` },
      tx,
    );
  });
}

export async function updateGuardian(schoolId: string, actorId: string, guardianId: string, data: Partial<GuardianInput>) {
  return getScopedDb(schoolId, actorId).$tx(async (tx) => {
    const g = await tx.guardian.findFirst({ where: { id: guardianId, schoolId } });
    if (!g) throw new ServiceError('Guardian not found', 404);
    if (data.phone && data.phone !== g.phone) {
      const taken = await tx.guardian.findFirst({ where: { schoolId, phone: data.phone, id: { not: guardianId } }, select: { fullName: true } });
      if (taken) throw new ServiceError(`${taken.fullName} already has that phone number. Link that guardian instead.`, 409);
    }
    const updated = await tx.guardian.update({ where: { id: guardianId }, data });
    await logAudit(
      { schoolId, actorId, action: 'UPDATE_GUARDIAN', entityType: 'Guardian', entityId: guardianId, detail: updated.fullName },
      tx,
    );
    return updated;
  });
}

async function requireLink(tx: Tx, schoolId: string, studentId: string, guardianId: string) {
  const link = await tx.studentGuardian.findFirst({
    where: { studentId, guardianId, student: { schoolId } },
  });
  if (!link) throw new ServiceError('This guardian is not linked to the student', 404);
  return link;
}

// The primary guardian's name/phone — used wherever the old parentName/parentPhone were shown.
export const PRIMARY_GUARDIAN_INCLUDE = {
  where: { isPrimary: true },
  take: 1,
  select: {
    relationship: true,
    canReceiveSms: true,
    guardian: { select: { id: true, fullName: true, phone: true } },
  },
} satisfies Prisma.Student$guardiansArgs;

// ─── Add, link and look up (the new Student Information screens) ─────────────

const optionalString = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

export const AddGuardianSchema = z
  .object({
    /** Link someone who is already in the school (found by phone); otherwise give the details below. */
    guardianId: z.string().trim().min(1).max(64).optional(),
    fullName: z.string().trim().max(100).optional(),
    phone: z.string().optional(),
    phone2: z.string().optional(),
    email: optionalString(100),
    nationalId: optionalString(20),
    occupation: optionalString(60),
    address: optionalString(200),
    relationship: z.enum(RELATIONSHIPS, { error: 'Choose the relationship' }),
    relationshipNote: optionalString(30),
    isPrimary: z.boolean().default(false),
    isFeePayer: z.boolean().default(false),
    receivesSms: z.boolean().default(true),
    canCollect: z.boolean().default(true),
    custodyNote: optionalString(200),
  })
  .superRefine((g, ctx) => {
    if (g.relationship === 'OTHER' && !g.relationshipNote) ctx.addIssue({ code: 'custom', path: ['relationshipNote'], message: 'Please type the relationship' });
    if (g.guardianId) return;
    if (!g.fullName || !g.fullName.includes(' ')) ctx.addIssue({ code: 'custom', path: ['fullName'], message: "Enter the guardian's first name and surname" });
    if (!mobilePhone('Phone', true).safeParse(g.phone).success) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Enter a Zimbabwean mobile number such as 0771234567' });
    if (g.phone2 && !mobilePhone('Second phone', false).safeParse(g.phone2).success) ctx.addIssue({ code: 'custom', path: ['phone2'], message: 'Enter a Zimbabwean mobile number such as 0771234567' });
  });

/** Adds a guardian to a student: links one who is already in the school, or creates one (a phone number belongs to one guardian). */
export async function addGuardianToStudent(user: AccessUser, studentId: string, rawInput: z.input<typeof AddGuardianSchema>) {
  const input = AddGuardianSchema.parse(rawInput);
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const open = await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' }, select: { id: true } });
    await loadReachable(tx, user, [studentId], open?.id);
    let guardianId = input.guardianId;
    if (guardianId) {
      if (!(await tx.guardian.findFirst({ where: { id: guardianId, schoolId }, select: { id: true } }))) throw new ServiceError('Guardian not found', 404);
    } else {
      const g = await findOrCreateGuardian(tx, schoolId, user.id, {
        fullName: normalizeName(input.fullName!), phone: mobilePhone('Phone', true).parse(input.phone)!, altPhone: mobilePhone('Phone', false).parse(input.phone2),
        email: input.email?.toLowerCase() ?? null, nationalId: input.nationalId?.toUpperCase() ?? null, occupation: input.occupation, address: input.address,
      });
      guardianId = g.id;
    }
    return linkGuardian(tx, schoolId, user.id, studentId, guardianId, {
      relationship: input.relationship, relationshipNote: input.relationshipNote, isPrimary: input.isPrimary, isFeePayer: input.isFeePayer,
      canReceiveSms: input.receivesSms, canCollect: input.canCollect, custodyNote: input.custodyNote,
    });
  });
}

/**
 * Siblings share one guardian record, so the form searches by phone first: "This guardian already has 2 children here:
 * Tatenda (Form 3 North), Rufaro (Form 1 South). Link?" The ID number is never part of the answer.
 */
export async function lookupGuardianByPhone(user: AccessUser, rawPhone: string) {
  if (!(can(user, 'students.profiles.create') || can(user, 'students.guardians.edit'))) throw new ServiceError('Forbidden', 403);
  const phone = mobilePhone('Phone', true).safeParse(rawPhone);
  if (!phone.success || !phone.data) return null;
  const db = getScopedDb(user.schoolId, user.id);
  const g = await db.guardian.findFirst({
    where: { phone: phone.data },
    select: { id: true, fullName: true, phone: true, students: { where: { student: { status: { in: ['ACTIVE', 'SUSPENDED'] } } }, select: { student: { select: { id: true, fullName: true, currentClass: { select: { name: true } } } } } } },
  });
  if (!g) return null;
  return { guardianId: g.id, fullName: g.fullName, phone: g.phone, children: g.students.map((x) => ({ id: x.student.id, fullName: x.student.fullName, className: x.student.currentClass?.name ?? null })) };
}
