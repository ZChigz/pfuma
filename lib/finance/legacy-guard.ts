// The first accounting screens (/bursar, /head/fees, /api/accounting/*) and the Finance module both record fees, payments and
// spending. Once a school runs its money in Finance (its FinSettings row says legacyRetired) the older screens step aside and stop
// writing, so the two never disagree about a balance. They can still be looked at. A school with no Finance settings row yet
// (nobody has opened Finance, and the data migration has not reached it) keeps using them.
import { ServiceError } from '@/lib/api';

// Anything that can read the Finance settings row: the school-scoped client or one of its transactions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SettingsReader = { finSettings: { findUnique: (args: any) => PromiseLike<{ legacyRetired: boolean } | null> } };

export const LEGACY_FINANCE_MESSAGE = 'This school keeps its fees, payments and spending in the Finance module now, so the older accounting screens no longer record anything. Open Finance in the sidebar.';

export async function legacyRetired(db: SettingsReader, schoolId: string): Promise<boolean> {
  const row = await db.finSettings.findUnique({ where: { schoolId }, select: { legacyRetired: true } });
  return !!row?.legacyRetired;
}

/** Call at the top of every older accounting route that writes. */
export async function assertLegacyWritable(db: SettingsReader, schoolId: string): Promise<void> {
  if (await legacyRetired(db, schoolId)) throw new ServiceError(LEGACY_FINANCE_MESSAGE, 409);
}
