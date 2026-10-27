// Notifications that go out on a schedule (the cron route calls this once a day). Running it twice
// never sends twice: each notice carries a dedupeKey and a person gets one per key.
import { prisma } from '@/lib/prisma';
import { getScopedDb } from '@/lib/scoped-db';
import { adminIds, notifyUsers } from '@/lib/system/notifications';
import { evaluateSetup, loadSetupFacts, summarize } from '@/lib/system/setup-checklist';
import { syncSuspensions } from '@/lib/students/discipline';
import { remindRecordOfWork } from '@/lib/academics/curriculum';

const DAY = 864e5;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Harare's calendar date for an instant (servers run in UTC). */
function harareDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The Monday of the week a date falls in: one key per week for the weekly notice. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  return iso(new Date(d.getTime() - back * DAY));
}

export interface ScheduledResult { schools: number; termReminders: number; setupReminders: number; suspensionsStarted: number; suspensionsEnded: number; recordReminders: number; accessSummaries: number }

export async function runScheduledNotifications(now = new Date()): Promise<ScheduledResult> {
  const today = harareDate(now);
  const tomorrow = iso(new Date(new Date(`${today}T00:00:00Z`).getTime() + DAY));
  const week = weekStart(today);
  const result: ScheduledResult = { schools: 0, termReminders: 0, setupReminders: 0, suspensionsStarted: 0, suspensionsEnded: 0, recordReminders: 0, accessSummaries: 0 };

  const schools = await prisma.school.findMany({ where: { status: { not: 'SUSPENDED' } }, select: { id: true } });
  for (const { id: schoolId } of schools) {
    result.schools++;
    const db = getScopedDb(schoolId);

    // "Term opens tomorrow": everyone active in the school.
    const terms = await db.academicTerm.findMany({ where: { startDate: new Date(`${tomorrow}T00:00:00Z`) }, select: { id: true, name: true } });
    if (terms.length > 0) {
      const people = (await db.user.findMany({ where: { active: true, isSupport: false }, select: { id: true } })).map((u) => u.id);
      for (const t of terms) {
        result.termReminders += await db.$tx((tx) =>
          notifyUsers(tx, schoolId, people, {
            type: 'TERM_OPENS_TOMORROW', title: `${t.name} opens tomorrow`, body: 'The new term starts tomorrow.', link: '/system/calendar',
            dedupeKey: `term-opens:${t.id}`,
          }),
        );
      }
    }

    // Suspensions start on their first day and end by themselves the day after their last (Student Information).
    // The audit entries name the person who approved each suspension; any administrator stands in for the connection.
    const stand = (await db.$tx((tx) => adminIds(tx, schoolId)))[0];
    if (stand) {
      const sync = await syncSuspensions(schoolId, stand, today);
      result.suspensionsStarted += sync.started;
      result.suspensionsEnded += sync.ended;
    }

    // Fridays (Academics): teachers whose week is not recorded yet are reminded to record the work covered.
    result.recordReminders += await remindRecordOfWork(schoolId, today);

    // Weekly: the Owner is told which exceptions to access are in force, which end this week, and what waits for a decision.
    const nowAt = now;
    const weekAhead = new Date(nowAt.getTime() + 7 * DAY);
    const [activeExceptions, endingSoon, openRequests, refusals] = await Promise.all([
      db.userPermissionOverride.count({ where: { revokedAt: null, expiresAt: { gt: nowAt } } }),
      db.userPermissionOverride.count({ where: { revokedAt: null, expiresAt: { gt: nowAt, lte: weekAhead } } }),
      db.accessRequest.count({ where: { status: 'PENDING' } }),
      db.auditLog.count({ where: { action: 'ACCESS_DENIED', createdAt: { gte: new Date(nowAt.getTime() - 7 * DAY) } } }),
    ]);
    if (activeExceptions > 0 || openRequests > 0) {
      const owners = (await db.user.findMany({ where: { active: true, isSupport: false, userRoles: { some: { role: { key: 'OWNER' } } } }, select: { id: true } })).map((u) => u.id);
      result.accessSummaries += await db.$tx((tx) =>
        notifyUsers(tx, schoolId, owners, {
          type: 'ACCESS_SUMMARY', title: 'Access exceptions this week',
          body: `${activeExceptions} exception${activeExceptions === 1 ? '' : 's'} in force (${endingSoon} ending this week), ${openRequests} request${openRequests === 1 ? '' : 's'} waiting, ${refusals} refused attempt${refusals === 1 ? '' : 's'} on protected data.`,
          link: '/system/roles?tab=exceptions', dedupeKey: `access-week:${week}`,
        }),
      );
    }

    // Weekly: a setup step is still incomplete, to the administrators.
    const open = await db.academicTerm.findFirst({ where: { status: 'OPEN' }, select: { startDate: true, endDate: true } });
    const steps = evaluateSetup(await loadSetupFacts(db, schoolId, open));
    if (!summarize(steps).complete) {
      const next = steps.find((s) => !s.done)!;
      const left = steps.filter((s) => !s.done).length;
      result.setupReminders += await db.$tx(async (tx) =>
        notifyUsers(tx, schoolId, await adminIds(tx, schoolId), {
          type: 'SETUP_INCOMPLETE', title: `${left} setup step${left === 1 ? ' is' : 's are'} still incomplete`,
          body: `Next: ${next.label}. ${next.hint}`, link: next.href, dedupeKey: `setup-weekly:${week}`,
        }),
      );
    }
  }
  return result;
}
