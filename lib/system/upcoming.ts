import type { ScopedDb } from '@/lib/scoped-db';

export const UPCOMING_COUNT = 5;

/** The next calendar events from today on (an event that is on right now counts), soonest first. */
export async function loadUpcomingEvents(db: ScopedDb, schoolId: string, now = new Date()) {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return db.calendarEvent.findMany({
    where: { schoolId, endDate: { gte: today } },
    orderBy: [{ startDate: 'asc' }, { title: 'asc' }, { id: 'asc' }],
    take: UPCOMING_COUNT,
    select: { id: true, title: true, kind: true, startDate: true, endDate: true },
  });
}
