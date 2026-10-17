import { ALWAYS_ON_MODULES, MODULE_KEYS } from '@/lib/access-core';
import { prisma } from '@/lib/prisma';

/** Every module with its on/off state for one school. No row means on. */
export async function getModuleStates(schoolId: string): Promise<Record<string, boolean>> {
  const rows = await prisma.schoolModule.findMany({ where: { schoolId }, select: { module: true, enabled: true } });
  const off = new Set(rows.filter((r) => !r.enabled).map((r) => r.module));
  return Object.fromEntries(MODULE_KEYS.map((k) => [k, ALWAYS_ON_MODULES.includes(k) || !off.has(k)]));
}
