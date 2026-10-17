// Small pieces every Student Information service uses: input checks, loading the students a user may
// reach, and finding the people who can approve something.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import type { AccessUser, PermissionKey } from '@/lib/access-core';
import type { Db } from '@/lib/scoped-db';
import { isRealIsoDate, todayInHarare } from '@/lib/students/registration';
import { studentScope } from '@/lib/students/scope';

export const idSchema = z.string().trim().min(1).max(64);
export const isoDateSchema = z.string().trim().refine(isRealIsoDate, 'Enter a real date (YYYY-MM-DD)');
export const pastOrTodaySchema = isoDateSchema.refine((d) => d <= todayInHarare(), 'The date cannot be in the future');
export const noteSchema = (max = 500) => z.string().trim().max(max).optional().transform((v) => v || undefined);
export const reasonSchema = (min = 3, max = 300) => z.string().trim().min(min, `Give a reason (at least ${min} characters)`).max(max);

/** A body that failed validation: the same 422 shape the rest of the app uses. */
export function invalid(message: string, status = 422): never {
  throw new ServiceError(message, status);
}

/**
 * Loads students by id, only those in the user's school that the user may reach. A missing or unreachable
 * student is reported as not found, so the existence of other students is never revealed.
 */
export async function loadReachable(tx: Db, user: AccessUser, ids: string[], termId?: string | null) {
  const unique = Array.from(new Set(ids));
  const students = await tx.student.findMany({
    where: { AND: [studentScope(user, termId), { id: { in: unique } }] },
    select: { id: true, fullName: true, firstName: true, surname: true, status: true, currentClassId: true, admissionNumber: true, boarding: true, houseId: true },
  });
  if (students.length !== unique.length) throw new ServiceError('One or more students were not found', 404);
  return students;
}

/** Active people whose roles grant `permission` (or everything). Used to tell approvers that something waits for them. */
export async function approverIds(tx: Db, schoolId: string, permission: PermissionKey, exceptUserId?: string): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: {
      schoolId, active: true, isSupport: false, ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
      userRoles: { some: { role: { permissions: { some: { permissionKey: { in: [permission, '*'] } } } } } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
