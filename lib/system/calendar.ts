import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import type { ScopedDb } from '@/lib/scoped-db';
import type { CalendarEventKind } from '@prisma/client';

export interface EventInput {
  title: string;
  kind: CalendarEventKind;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  notes?: string | null;
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export type CalendarItem = {
  id: string;
  source: 'event' | 'term';
  title: string;
  kind: CalendarEventKind | 'TERM';
  startDate: string;
  endDate: string;
  notes: string | null;
};

/** Events and term dates that touch [from, to]. Terms are read-only here; they are managed under Academic calendar. */
export async function listCalendar(db: ScopedDb, schoolId: string, from: string, to: string): Promise<CalendarItem[]> {
  const overlap = { startDate: { lte: day(to) }, endDate: { gte: day(from) } };
  const [events, terms] = await Promise.all([
    db.calendarEvent.findMany({ where: { schoolId, ...overlap }, orderBy: [{ startDate: 'asc' }, { title: 'asc' }] }),
    db.academicTerm.findMany({ where: { schoolId, ...overlap }, orderBy: { startDate: 'asc' } }),
  ]);
  return [
    ...terms.map((t) => ({ id: t.id, source: 'term' as const, title: t.name, kind: 'TERM' as const, startDate: iso(t.startDate), endDate: iso(t.endDate), notes: null })),
    ...events.map((e) => ({ id: e.id, source: 'event' as const, title: e.title, kind: e.kind, startDate: iso(e.startDate), endDate: iso(e.endDate), notes: e.notes })),
  ].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
}

export async function createEvent(db: ScopedDb, actor: { id: string; schoolId: string }, input: EventInput) {
  return db.$tx(async (tx) => {
    const e = await tx.calendarEvent.create({
      data: { schoolId: actor.schoolId, title: input.title, kind: input.kind, startDate: day(input.startDate), endDate: day(input.endDate), notes: input.notes ?? null, createdById: actor.id },
    });
    await logAudit(
      { schoolId: actor.schoolId, actorId: actor.id, action: 'CREATE_CALENDAR_EVENT', entityType: 'CalendarEvent', entityId: e.id, detail: `${e.title} (${input.startDate} to ${input.endDate})` },
      tx,
    );
    return e;
  });
}

export async function updateEvent(db: ScopedDb, actor: { id: string; schoolId: string }, id: string, input: EventInput) {
  const before = await db.calendarEvent.findUnique({ where: { id } });
  if (!before) throw new ServiceError('Event not found', 404);
  return db.$tx(async (tx) => {
    const e = await tx.calendarEvent.update({
      where: { id },
      data: { title: input.title, kind: input.kind, startDate: day(input.startDate), endDate: day(input.endDate), notes: input.notes ?? null },
    });
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action: 'UPDATE_CALENDAR_EVENT', entityType: 'CalendarEvent', entityId: id, detail: e.title,
        before: { title: before.title, kind: before.kind, startDate: iso(before.startDate), endDate: iso(before.endDate), notes: before.notes },
        after: { title: e.title, kind: e.kind, startDate: iso(e.startDate), endDate: iso(e.endDate), notes: e.notes },
      },
      tx,
    );
    return e;
  });
}

export async function deleteEvent(db: ScopedDb, actor: { id: string; schoolId: string }, id: string) {
  const before = await db.calendarEvent.findUnique({ where: { id } });
  if (!before) throw new ServiceError('Event not found', 404);
  await db.$tx(async (tx) => {
    await tx.calendarEvent.delete({ where: { id } });
    await logAudit(
      { schoolId: actor.schoolId, actorId: actor.id, action: 'DELETE_CALENDAR_EVENT', entityType: 'CalendarEvent', entityId: id, detail: before.title },
      tx,
    );
  });
}
