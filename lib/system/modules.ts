import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { ALWAYS_ON_MODULES, MODULE_KEYS } from '@/lib/access-core';
import type { ScopedDb } from '@/lib/scoped-db';

/** Every module with its on/off state. No row means on. */
export async function getModuleStates(db: ScopedDb): Promise<Record<string, boolean>> {
  const rows = await db.schoolModule.findMany({ select: { module: true, enabled: true } });
  const off = new Set(rows.filter((r) => !r.enabled).map((r) => r.module));
  return Object.fromEntries(MODULE_KEYS.map((k) => [k, ALWAYS_ON_MODULES.includes(k) || !off.has(k)]));
}

export async function setModules(db: ScopedDb, actor: { id: string; schoolId: string }, wanted: Record<string, boolean>) {
  for (const [k, on] of Object.entries(wanted)) {
    if (!MODULE_KEYS.includes(k)) throw new ServiceError(`Unknown module "${k}"`, 422);
    if (ALWAYS_ON_MODULES.includes(k) && !on) throw new ServiceError('Dashboard & System cannot be switched off', 422);
  }
  const before = await getModuleStates(db);
  const changes = Object.entries(wanted).filter(([k, on]) => before[k] !== on);
  if (changes.length === 0) return before;

  return db.$tx(async (tx) => {
    for (const [module, enabled] of changes) {
      await tx.schoolModule.upsert({
        where: { schoolId_module: { schoolId: actor.schoolId, module } },
        update: { enabled },
        create: { schoolId: actor.schoolId, module, enabled },
      });
    }
    const after = { ...before, ...Object.fromEntries(changes) };
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action: 'UPDATE_SCHOOL_MODULES', entityType: 'SchoolModule', entityId: actor.schoolId,
        detail: changes.map(([k, on]) => `${k} ${on ? 'on' : 'off'}`).join(', '),
        before, after,
      },
      tx,
    );
    return after as Record<string, boolean>;
  });
}
