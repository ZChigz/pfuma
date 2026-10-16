import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import type { ScopedDb } from '@/lib/scoped-db';
import type { z } from 'zod';
import type { SchoolDefaultsSchema, SchoolProfileSchema } from '@/lib/validations/system';

export const SCHOOL_PROFILE_SELECT = {
  id: true, name: true, motto: true, logoUrl: true, schoolType: true, responsibleAuthority: true, boarding: true, studentGender: true,
  offersCambridge: true, zimsecCentreNumber: true, emisNumber: true, province: true, district: true, physicalAddress: true,
  postalAddress: true, phone: true, email: true, website: true, headName: true, headSignatureUrl: true,
  // Defaults tab
  defaultCurrency: true, maxClassSize: true, receiptPrefix: true, receiptNextNumber: true, setupChecklistPinned: true,
} as const;

export async function getSchoolProfile(db: ScopedDb, schoolId: string) {
  return db.school.findUnique({ where: { id: schoolId }, select: SCHOOL_PROFILE_SELECT });
}

type Section = 'profile' | 'defaults';

async function saveSection(
  db: ScopedDb,
  actor: { id: string; schoolId: string },
  section: Section,
  data: Record<string, string | number | boolean | null>,
) {
  const before = await getSchoolProfile(db, actor.schoolId);
  if (!before) throw new ServiceError('School not found', 404);
  const changed = Object.keys(data).filter((k) => data[k] !== (before as Record<string, unknown>)[k]);
  const label = section === 'profile' ? 'School profile' : 'Defaults';

  return db.$tx(async (tx) => {
    const after = await tx.school.update({ where: { id: actor.schoolId }, data, select: SCHOOL_PROFILE_SELECT });
    // Only the fields of this section go into the log, so a profile change does not drag defaults along.
    const pick = (row: Record<string, unknown>) => Object.fromEntries(Object.keys(data).map((k) => [k, row[k] ?? null]));
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action: 'UPDATE_SCHOOL_SETTINGS', entityType: 'School', entityId: actor.schoolId,
        detail: changed.length ? `${label}: changed ${changed.join(', ')}` : `${label}: saved with no changes`,
        before: pick(before) as never, after: pick(after) as never,
      },
      tx,
    );
    return after;
  });
}

export async function updateSchoolProfile(db: ScopedDb, actor: { id: string; schoolId: string }, input: z.output<typeof SchoolProfileSchema>) {
  return saveSection(db, actor, 'profile', {
    name: input.name,
    motto: input.motto ?? null,
    logoUrl: input.logoUrl ?? null,
    schoolType: input.schoolType,
    responsibleAuthority: input.responsibleAuthority ?? null,
    boarding: input.boarding,
    studentGender: input.studentGender,
    offersCambridge: input.offersCambridge,
    zimsecCentreNumber: input.zimsecCentreNumber ?? null,
    emisNumber: input.emisNumber ?? null,
    province: input.province ?? null,
    district: input.district,
    physicalAddress: input.physicalAddress,
    postalAddress: input.postalAddress ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    website: input.website ?? null,
    headName: input.headName ?? null,
    headSignatureUrl: input.headSignatureUrl ?? null,
  });
}

export async function updateSchoolDefaults(db: ScopedDb, actor: { id: string; schoolId: string }, input: z.output<typeof SchoolDefaultsSchema>) {
  const before = await getSchoolProfile(db, actor.schoolId);
  if (!before) throw new ServiceError('School not found', 404);
  return saveSection(db, actor, 'defaults', {
    defaultCurrency: input.defaultCurrency,
    maxClassSize: input.maxClassSize,
    receiptPrefix: input.receiptPrefix ?? null,
    // Left out of the request = keep what is there.
    receiptNextNumber: input.receiptNextNumber ?? before.receiptNextNumber,
    setupChecklistPinned: input.setupChecklistPinned ?? before.setupChecklistPinned,
  });
}
