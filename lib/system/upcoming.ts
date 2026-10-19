import type { ScopedDb } from '@/lib/scoped-db';
import { ensureHolidays, eventItems } from '@/lib/system/calendar';
import { addDaysIso } from '@/lib/system/recurrence';

export const UPCOMING_COUNT = 5;
/** How far ahead to look for the next five (repeats and holidays included). */
const LOOK_AHEAD_DAYS = 400;

/** The next calendar events from today on (one on right now counts), soonest first. Repeats are worked out. */
export async function loadUpcomingEvents(
  db: ScopedDb,
  actor: { id: string; schoolId: string },
  now = new Date(),
) {
  const today = now.toISOString().slice(0, 10);
  const until = addDaysIso(today, LOOK_AHEAD_DAYS);
  await ensureHolidays(db, actor, [Number(today.slice(0, 4)), Number(until.slice(0, 4))]);
  const rows = await db.calendarEvent.findMany({
    where: {
      schoolId: actor.schoolId,
      startDate: { lte: new Date(`${until}T00:00:00Z`) },
      OR: [{ endDate: { gte: new Date(`${today}T00:00:00Z`) } }, { repeat: { not: 'NONE' }, repeatUntil: { gte: new Date(`${today}T00:00:00Z`) } }],
    },
  });
  return rows
    .flatMap((e) => eventItems(e, today, until))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title))
    .slice(0, UPCOMING_COUNT);
}
