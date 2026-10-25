// Finding a learner from a facilities screen (type a name, or scan the ID card). Any facilities permission may look, because a gate, a
// sick bay, a tuck shop and a library desk all need to know who is standing there; only the few fields the screen needs come back.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { PERMISSION_KEYS, moduleOf, type PermissionKey } from '@/lib/access-core';
import { getScopedDb } from '@/lib/scoped-db';
import { need, type Actor } from '@/lib/facilities/common';
import { parseScan } from '@/lib/facilities/scan';

export const ANY_FACILITIES: PermissionKey[] = PERMISSION_KEYS.filter((k) => moduleOf(k) === 'facilities');

const QuerySchema = z.object({ q: z.string().trim().max(80).optional(), code: z.string().trim().max(80).optional(), boarders: z.boolean().optional() });

export interface LearnerHit { id: string; name: string; admissionNumber: string; className: string | null; boarding: 'DAY' | 'BOARDER'; gender: string | null; photoUrl: string | null }

export async function searchLearners(user: Actor, raw: unknown): Promise<LearnerHit[]> {
  need(user, ...ANY_FACILITIES);
  const v = QuerySchema.parse(raw);
  const code = v.code ? parseScan(v.code).value : '';
  const q = v.q ?? '';
  if (code.length < 1 && q.length < 2) return [];
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.student.findMany({
      where: {
        schoolId: user.schoolId, status: 'ACTIVE', ...(v.boarders ? { boarding: 'BOARDER' as const } : {}),
        ...(code ? { admissionNumber: { equals: code, mode: 'insensitive' as const } } : { OR: [{ fullName: { contains: q, mode: 'insensitive' as const } }, { admissionNumber: { contains: q, mode: 'insensitive' as const } }] }),
      },
      select: { id: true, fullName: true, admissionNumber: true, boarding: true, gender: true, photoUrl: true, currentClass: { select: { name: true } } },
      orderBy: { fullName: 'asc' }, take: 10,
    });
    if (code && rows.length === 0) throw new ServiceError('No learner has that number', 404);
    return rows.map((s) => ({ id: s.id, name: s.fullName, admissionNumber: s.admissionNumber, className: s.currentClass?.name ?? null, boarding: s.boarding, gender: s.gender, photoUrl: s.photoUrl }));
  });
}
