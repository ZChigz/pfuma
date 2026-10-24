// The daily HR job: contracts that ran out become Expired, HR and the Head are reminded 60 and 30 days ahead, and everyone with a duty
// tomorrow is reminded. One school's failure does not stop the others. Notices are sent once however often this runs.
import { prisma } from '@/lib/prisma';
import { getScopedDb } from '@/lib/scoped-db';
import { runContractSchedule } from '@/lib/hr/recruitment';
import { sendDutyReminders } from '@/lib/hr/duties';

export async function runHrSchedule() {
  const schools = await prisma.employee.findMany({ distinct: ['schoolId'], select: { schoolId: true } });
  const out: Record<string, unknown> = {};
  for (const s of schools) {
    try {
      out[s.schoolId] = await getScopedDb(s.schoolId).$tx(async (tx) => ({ contracts: await runContractSchedule(tx, s.schoolId), dutyReminders: await sendDutyReminders(tx, s.schoolId) }));
    } catch (e) {
      out[s.schoolId] = { error: (e as Error).message };
    }
  }
  return { schools: schools.length, results: out };
}
