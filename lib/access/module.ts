// Is a module switched on for a school? Read from SchoolModule and kept for 60 seconds, so a page that asks many times does not read the
// table each time. A switch made on the Pfuma console shows within a minute (or at once, in the process that made it: clearModuleCache).
import { prisma } from '@/lib/prisma';
import { ALWAYS_ON_MODULES, facilityModuleKey, facilityPartOf, moduleOf } from '@/lib/access-core';

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; off: Set<string> }>();

async function switchedOff(schoolId: string, now: number): Promise<Set<string>> {
  const hit = cache.get(schoolId);
  if (hit && now - hit.at < TTL_MS && hit.at <= now) return hit.off;
  const rows = await prisma.schoolModule.findMany({ where: { schoolId, enabled: false }, select: { module: true } });
  const off = new Set(rows.map((r) => r.module).filter((m) => !ALWAYS_ON_MODULES.includes(m)));
  cache.set(schoolId, { at: now, off });
  return off;
}

/**
 * True unless the module of `key` (a permission key such as finance.payments.view, or a module key such as finance or
 * facilities.hostel) is switched off. Switching off the whole of Facilities hides every part of it.
 */
export async function moduleEnabled(schoolId: string, key: string, now = Date.now()): Promise<boolean> {
  const off = await switchedOff(schoolId, now);
  if (off.has(key) || off.has(moduleOf(key))) return false;
  const part = facilityPartOf(key);
  return !(part && off.has(facilityModuleKey(part)));
}

export function clearModuleCache(schoolId?: string): void {
  if (schoolId) cache.delete(schoolId);
  else cache.clear();
}
