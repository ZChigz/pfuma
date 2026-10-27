import type { Db } from '@/lib/scoped-db';

export interface CustodianInput {
  /** A staff user in this school. */
  custodianId?: string | null;
  /** Free text: matched to a staff member by exact name, otherwise kept as a name. */
  custodian?: string | null;
}

export interface Custodian {
  custodianId: string | null;
  custodian: string | null;
}

/** Works out who the custodian is. Returns null when custodianId names nobody in this school. */
export async function resolveCustodian(db: Db, input: CustodianInput): Promise<Custodian | null> {
  if (input.custodianId) {
    const u = await db.user.findFirst({ where: { id: input.custodianId, active: true }, select: { id: true, fullName: true } });
    return u ? { custodianId: u.id, custodian: u.fullName } : null;
  }
  const name = input.custodian?.trim();
  if (!name) return { custodianId: null, custodian: null };
  const matches = await db.user.findMany({
    where: { fullName: { equals: name, mode: 'insensitive' }, active: true },
    select: { id: true, fullName: true },
    take: 2,
  });
  return matches.length === 1
    ? { custodianId: matches[0].id, custodian: matches[0].fullName }
    : { custodianId: null, custodian: name };
}

export const sameCustodian = (a: Custodian, b: Custodian) =>
  a.custodianId !== null || b.custodianId !== null
    ? a.custodianId === b.custodianId
    : (a.custodian ?? '').toLowerCase() === (b.custodian ?? '').toLowerCase();

// ─── The asset register moved to Facilities & Operations ─────────────────────
// Once a school has assets in the Facilities register (the data step copies the old register across), the first asset screens stop
// recording anything, so the two never disagree about where an asset is or whether it was disposed of. They can still be read.

export const ASSETS_MOVED_MESSAGE = 'This school keeps its asset register in Facilities & Operations now, so the older asset screens no longer record anything. Open Facilities, Assets in the sidebar.';

type MovedReader = { facAsset: { count: (args: { where: { schoolId: string } }) => PromiseLike<number> } };

export async function assetsMoved(db: MovedReader, schoolId: string): Promise<boolean> {
  return (await db.facAsset.count({ where: { schoolId } })) > 0;
}
