// The facilities job, every 15 minutes: late exeat alerts and service reminders for assets. One school's failure does not stop the others.
import { prisma } from '@/lib/prisma';
import { getScopedDb } from '@/lib/scoped-db';
import { exeatAlerts } from '@/lib/facilities/exeats';
import { maintenanceReminders } from '@/lib/facilities/assets';

export async function runFacilitiesSchedule() {
  const schools = await prisma.schoolModule.findMany({ where: { module: { startsWith: 'facilities.' }, enabled: true }, distinct: ['schoolId'], select: { schoolId: true } });
  const out: Record<string, unknown> = {};
  for (const s of schools) {
    try {
      out[s.schoolId] = await getScopedDb(s.schoolId).$tx(async (tx) => ({ exeats: await exeatAlerts(tx, s.schoolId), service: await maintenanceReminders(tx, s.schoolId) }));
    } catch (e) {
      out[s.schoolId] = { error: (e as Error).message };
    }
  }
  return { schools: schools.length, results: out };
}
