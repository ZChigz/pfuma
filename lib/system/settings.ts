import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import type { ScopedDb } from '@/lib/scoped-db';
import type { z } from 'zod';
import type { SchoolSettingsSchema } from '@/lib/validations/system';

export const SCHOOL_PROFILE_SELECT = {
  id: true, name: true, schoolType: true, location: true, address: true, phone: true, email: true,
  motto: true, logoUrl: true, defaultCurrency: true, maxClassSize: true,
  province: true, zimsecCentreNumber: true, receiptPrefix: true, receiptNextNumber: true, setupChecklistPinned: true,
} as const;

export async function getSchoolProfile(db: ScopedDb, schoolId: string) {
  return db.school.findUnique({ where: { id: schoolId }, select: SCHOOL_PROFILE_SELECT });
}

export async function updateSchoolProfile(
  db: ScopedDb,
  actor: { id: string; schoolId: string },
  input: z.output<typeof SchoolSettingsSchema>,
) {
  const before = await getSchoolProfile(db, actor.schoolId);
  if (!before) throw new ServiceError('School not found', 404);

  const data = {
    name: input.name,
    schoolType: input.schoolType,
    location: input.location ?? null,
    address: input.address ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    motto: input.motto ?? null,
    logoUrl: input.logoUrl ?? null,
    defaultCurrency: input.defaultCurrency,
    maxClassSize: input.maxClassSize,
    province: input.province ?? null,
    zimsecCentreNumber: input.zimsecCentreNumber ?? null,
    receiptPrefix: input.receiptPrefix ?? null,
    // Left out of the request = keep what is there.
    receiptNextNumber: input.receiptNextNumber ?? before.receiptNextNumber,
    setupChecklistPinned: input.setupChecklistPinned ?? before.setupChecklistPinned,
  };
  const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => data[k] !== before[k]);

  return db.$tx(async (tx) => {
    const after = await tx.school.update({ where: { id: actor.schoolId }, data, select: SCHOOL_PROFILE_SELECT });
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action: 'UPDATE_SCHOOL_SETTINGS', entityType: 'School', entityId: actor.schoolId,
        detail: changed.length ? `Changed ${changed.join(', ')}` : 'Saved with no changes',
        before: before as never, after: after as never,
      },
      tx,
    );
    return after;
  });
}
