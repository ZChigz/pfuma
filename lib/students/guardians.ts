// Guardians and the student↔guardian links.
// Rules (enforced here; the database additionally allows at most one primary
// per student via "StudentGuardian_one_primary_per_student"):
//  • siblings share one Guardian row — matched on phone + name;
//  • a linked student always has exactly one primary guardian;
//  • the last guardian of a student cannot be removed.
import type { GuardianRelationship, Prisma } from '@prisma/client';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';

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
}

export async function findOrCreateGuardian(tx: Tx, schoolId: string, actorId: string, input: GuardianInput) {
  const existing = await tx.guardian.findFirst({
    where: { schoolId, phone: input.phone, fullName: { equals: input.fullName, mode: 'insensitive' } },
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
  data: { relationship?: GuardianRelationship; relationshipNote?: string | null; isFeePayer?: boolean; canReceiveSms?: boolean },
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
