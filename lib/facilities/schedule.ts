// The facilities job, every 15 minutes: late exeat alerts and service reminders for assets. One school's failure does not stop the others.
import { prisma } from '@/lib/prisma';
import { getScopedDb } from '@/lib/scoped-db';
import { exeatAlerts } from '@/lib/facilities/exeats';
import { documentAlerts } from '@/lib/facilities/transport';
import { walletStatements } from '@/lib/facilities/tuckshop';
import { maintenanceReminders } from '@/lib/facilities/assets';

// Pocket money statements go out once a week, on Friday after 15:00 in Harare (the SMS key makes a second run the same week do nothing).
const isFridayEvening = (now = new Date()) => { const l = new Date(now.getTime() + 2 * 3_600_000); return l.getUTCDay() === 5 && l.getUTCHours() >= 15; };

export async function runFacilitiesSchedule() {
  const schools = await prisma.schoolModule.findMany({ where: { module: { startsWith: 'facilities.' }, enabled: true }, distinct: ['schoolId'], select: { schoolId: true } });
  const out: Record<string, unknown> = {};
  for (const s of schools) {
    try {
      out[s.schoolId] = await getScopedDb(s.schoolId).$tx(async (tx) => ({ exeats: await exeatAlerts(tx, s.schoolId), service: await maintenanceReminders(tx, s.schoolId), papers: await documentAlerts(tx, s.schoolId), statements: isFridayEvening() ? await walletStatements(tx, s.schoolId) : 0 }));
    } catch (e) {
      out[s.schoolId] = { error: (e as Error).message };
    }
  }
  return { schools: schools.length, results: out };
}
