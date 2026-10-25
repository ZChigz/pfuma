// Small pieces every Facilities & Operations service uses: the permission check (which honours the school's per-part switches),
// the amounts and dates people type, the school's settings, numbers, and who gets told.
import { z } from 'zod';
import type { FacSettings } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { can, facilityModuleKey, type FacilityPart, type PermissionKey } from '@/lib/access-core';
import type { Db } from '@/lib/scoped-db';
import type { Actor } from '@/lib/academics/common';

export type { Actor };
export { audit, tellApprovers, currencySchema, centsSchema, amountSchema, textSchema, whySchema, idSchema, isoDateSchema, reasonSchema, noteSchema, todayInHarare, toDay, isoOf } from '@/lib/finance/common';
export { addDays } from '@/lib/academics/common';
export { MAX_CENTS, formatMoney, type Cur } from '@/lib/finance/money';

/**
 * Throws 403 unless the person holds at least one of the permissions. Unlike the older `holds`, this is can(): a part the school has
 * switched off, a suspended school and a support session all refuse, so a service cannot be reached by skipping the route.
 */
export function need(user: Actor, ...keys: PermissionKey[]): void {
  if (!keys.some((k) => can(user, k))) throw new ServiceError('Forbidden', 403);
}

/** True unless the school has switched this part (or the whole of Facilities) off. No row means on. */
export async function partOn(tx: Db, schoolId: string, part: FacilityPart): Promise<boolean> {
  const off = await tx.schoolModule.findFirst({ where: { schoolId, enabled: false, module: { in: ['facilities', facilityModuleKey(part)] } }, select: { module: true } });
  return !off;
}

/** For code that runs without a person behind it (a nightly alert): stop quietly when the part is off. */
export async function assertPartOn(tx: Db, schoolId: string, part: FacilityPart): Promise<void> {
  if (!(await partOn(tx, schoolId, part))) throw new ServiceError('That part of Facilities & Operations is switched off for this school', 404);
}

/** The text a person types for a name, a place or a note. */
export const optText = (max = 200) => z.string().trim().max(max).optional().transform((v) => v || undefined);
export const timeSchema = z.string().trim().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Enter a time as HH:MM');

// ─── Settings ────────────────────────────────────────────────────────────────

/** The school's Facilities settings; the row is made with the defaults the first time anyone needs it. */
export async function loadFacSettings(tx: Db, schoolId: string): Promise<FacSettings> {
  const existing = await tx.facSettings.findUnique({ where: { schoolId } });
  if (existing) return existing;
  return tx.facSettings.upsert({ where: { schoolId }, update: {}, create: { schoolId } });
}

// ─── Numbers ─────────────────────────────────────────────────────────────────

/**
 * The next number of a counter (asset tags, accession numbers ...). The counter row is locked while the number is taken, so two people
 * at once never get the same one and none is skipped.
 */
export async function nextFacNumber(tx: Db, schoolId: string, key: string): Promise<number> {
  await tx.facSequence.createMany({ data: [{ schoolId, key, nextNumber: 1 }], skipDuplicates: true });
  const rows = await tx.$queryRaw<{ n: number }[]>`UPDATE "FacSequence" SET "nextNumber" = "nextNumber" + 1, "updatedAt" = now() WHERE "schoolId" = ${schoolId} AND "key" = ${key} RETURNING "nextNumber" - 1 AS "n"`;
  return rows[0]!.n;
}

export const padNumber = (n: number, width = 5) => String(n).padStart(width, '0');
