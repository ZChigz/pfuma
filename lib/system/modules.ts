import { ALWAYS_ON_MODULES, MODULE_KEYS } from '@/lib/access-core';
import type { ScopedDb } from '@/lib/scoped-db';

// Which modules a school has is decided by Pfuma, in the platform console (lib/platform/schools.ts).
// The school only reads it.

/** Every module with its on/off state. No row means on. */
export async function getModuleStates(db: ScopedDb): Promise<Record<string, boolean>> {
  const rows = await db.schoolModule.findMany({ select: { module: true, enabled: true } });
  const off = new Set(rows.filter((r) => !r.enabled).map((r) => r.module));
  return Object.fromEntries(MODULE_KEYS.map((k) => [k, ALWAYS_ON_MODULES.includes(k) || !off.has(k)]));
}
