// The school calendar: stored events (with repeats), the preloaded public holidays and
// the term dates that come from Academic Terms. Every other module should read dates
// through listCalendar so there is one place they live.
import type { CalendarAudience, CalendarEventKind, CalendarRepeat, Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import type { ScopedDb } from '@/lib/scoped-db';
import { zimbabweHolidays } from '@/lib/system/holidays';
import { allOccurrences, expand, type Recurring } from '@/lib/system/recurrence';

type Actor = { id: string; schoolId: string };

export interface EventInput {
  title: string;
  kind: CalendarEventKind;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  audience: CalendarAudience;
  audienceLevelIds: string[];
  audienceClassIds: string[];
  location?: string | null;
  notes?: string | null;
  repeat: CalendarRepeat;
  repeatUntil: string | null;
}

export interface CalendarItem {
  /** Unique per occurrence, for React keys. */
  key: string;
  /** The stored event (or term) id; every occurrence of a series shares it. */
  id: string;
  source: 'event' | 'term';
  kind: CalendarEventKind | 'TERM';
  title: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  notes: string | null;
  audience: CalendarAudience;
  audienceLevelIds: string[];
  audienceClassIds: string[];
  repeat: CalendarRepeat;
  repeatUntil: string | null;
  occurrence: number;
  /** First and last day of the stored event itself (an occurrence of a series moves; these do not). */
  seriesStart: string;
  seriesEnd: string;
  /** A preloaded public holiday. It can be edited or deleted like any event. */
  preloaded: boolean;
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

// ─── Public holidays ─────────────────────────────────────────────────────────

/**
 * Loads the public holidays of each year the first time that year is needed. A marker row
 * records it, so a holiday an administrator later deletes is not put back. Safe to call
 * from two requests at once: the second one's insert of the marker fails and is ignored.
 */
export async function ensureHolidays(db: ScopedDb, actor: Actor, years: number[]) {
  for (const year of Array.from(new Set(years)).filter((y) => y >= 2000 && y <= 2100)) {
    if (await db.calendarHolidayYear.findUnique({ where: { schoolId_year: { schoolId: actor.schoolId, year } } })) continue;
    try {
      await db.$tx(async (tx) => {
        await tx.calendarHolidayYear.create({ data: { schoolId: actor.schoolId, year } });
        const holidays = zimbabweHolidays(year);
        await tx.calendarEvent.createMany({
          data: holidays.map((h) => ({
            schoolId: actor.schoolId, title: h.name, kind: 'PUBLIC_HOLIDAY' as const, startDate: day(h.date), endDate: day(h.date),
            autoKey: `${h.key}:${year}`, createdById: actor.id,
          })),
          skipDuplicates: true,
        });
        await logAudit(
          {
            schoolId: actor.schoolId, actorId: actor.id, action: 'CREATE_CALENDAR_EVENT', entityType: 'CalendarEvent', entityId: `holidays:${year}`,
            detail: `Loaded ${holidays.length} public holidays for ${year}`,
          },
          tx,
        );
      });
    } catch (e) {
      // Another request loaded the same year first.
      if ((e as { code?: string }).code !== 'P2002') throw e;
    }
  }
}

const yearsIn = (from: string, to: string) => {
  const out: number[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) out.push(y);
  return out;
};

// ─── Reading ─────────────────────────────────────────────────────────────────

type EventRow = Prisma.CalendarEventGetPayload<object>;

const rowRecurring = (e: EventRow): Recurring => ({
  startDate: iso(e.startDate), endDate: iso(e.endDate), repeat: e.repeat, repeatUntil: e.repeatUntil ? iso(e.repeatUntil) : null,
});

export function eventItems(e: EventRow, from: string, to: string): CalendarItem[] {
  return expand(rowRecurring(e), from, to).map((o) => ({
    key: `${e.id}:${o.index}`,
    id: e.id,
    source: 'event' as const,
    kind: e.kind,
    title: e.title,
    startDate: o.startDate,
    endDate: o.endDate,
    allDay: e.allDay,
    startTime: e.startTime,
    endTime: e.endTime,
    location: e.location,
    notes: e.notes,
    audience: e.audience,
    audienceLevelIds: e.audienceLevelIds,
    audienceClassIds: e.audienceClassIds,
    repeat: e.repeat,
    repeatUntil: e.repeatUntil ? iso(e.repeatUntil) : null,
    occurrence: o.index,
    seriesStart: iso(e.startDate),
    seriesEnd: iso(e.endDate),
    preloaded: e.autoKey !== null,
  }));
}

const termItem = (id: string, name: string, edge: 'begins' | 'ends', date: string): CalendarItem => ({
  key: `${id}:${edge}`, id: `${id}:${edge}`, source: 'term', kind: 'TERM', title: `${name} ${edge}`, startDate: date, endDate: date,
  allDay: true, startTime: null, endTime: null, location: null, notes: null, audience: 'ALL_STAFF', audienceLevelIds: [], audienceClassIds: [],
  repeat: 'NONE', repeatUntil: null, occurrence: 0, seriesStart: date, seriesEnd: date, preloaded: false,
});

/** Everything on the calendar between two days: events (repeats worked out), public holidays and term dates. */
export async function listCalendar(
  db: ScopedDb,
  actor: Actor,
  from: string,
  to: string,
  opts: { type?: CalendarEventKind | 'TERM' } = {},
): Promise<CalendarItem[]> {
  await ensureHolidays(db, actor, yearsIn(from, to));
  const [events, terms] = await Promise.all([
    db.calendarEvent.findMany({
      where: {
        schoolId: actor.schoolId,
        startDate: { lte: day(to) },
        OR: [{ endDate: { gte: day(from) } }, { repeat: { not: 'NONE' }, repeatUntil: { gte: day(from) } }],
        ...(opts.type && opts.type !== 'TERM' ? { kind: opts.type } : {}),
      },
    }),
    opts.type && opts.type !== 'TERM' ? Promise.resolve([]) : db.academicTerm.findMany({ where: { schoolId: actor.schoolId } }),
  ]);

  const items = [
    ...terms.flatMap((t) => [termItem(t.id, t.name, 'begins', iso(t.startDate)), termItem(t.id, t.name, 'ends', iso(t.endDate))]),
    ...(opts.type === 'TERM' ? [] : events.flatMap((e) => eventItems(e, from, to))),
  ].filter((i) => i.startDate <= to && i.endDate >= from);

  return items.sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title));
}

export async function getEvent(db: ScopedDb, id: string) {
  const e = await db.calendarEvent.findUnique({ where: { id } });
  if (!e) throw new ServiceError('Event not found', 404);
  return e;
}

// ─── Warnings (shown to the person, who may still go ahead) ──────────────────

export async function eventWarnings(db: ScopedDb, actor: Actor, ev: EventInput, selfId?: string): Promise<string[]> {
  if (ev.kind === 'PUBLIC_HOLIDAY') return [];
  const occurrences = allOccurrences(ev);
  if (occurrences.length === 0) return [];
  const first = occurrences[0].startDate;
  const last = occurrences[occurrences.length - 1].endDate;
  await ensureHolidays(db, actor, yearsIn(first, last));

  const [holidays, terms] = await Promise.all([
    db.calendarEvent.findMany({
      where: { schoolId: actor.schoolId, kind: 'PUBLIC_HOLIDAY', startDate: { lte: day(last) }, endDate: { gte: day(first) }, ...(selfId ? { id: { not: selfId } } : {}) },
      select: { title: true, startDate: true, endDate: true },
    }),
    db.academicTerm.findMany({ where: { schoolId: actor.schoolId }, select: { startDate: true, endDate: true } }),
  ]);

  const warnings: string[] = [];
  const clashes = new Set<string>();
  for (const o of occurrences) {
    for (const h of holidays) if (iso(h.startDate) <= o.endDate && iso(h.endDate) >= o.startDate) clashes.add(h.title);
  }
  if (clashes.size > 0) {
    const names = Array.from(clashes).slice(0, 3).join(', ');
    warnings.push(`This clashes with a public holiday: ${names}${clashes.size > 3 ? ' and more' : ''}.`);
  }

  if (terms.length > 0) {
    const ranges = terms.map((t) => ({ s: iso(t.startDate), e: iso(t.endDate) }));
    const outside = occurrences.filter((o) => !ranges.some((r) => o.startDate >= r.s && o.endDate <= r.e));
    if (outside.length > 0) {
      warnings.push(occurrences.length === 1 ? 'This falls outside term dates.' : `${outside.length} of its ${occurrences.length} dates fall outside term dates.`);
    }
  }
  return warnings;
}

// ─── Writing ─────────────────────────────────────────────────────────────────

/** Forms and classes named as the audience must belong to this school. */
async function checkAudience(db: ScopedDb, schoolId: string, input: EventInput) {
  if (input.audience === 'FORMS') {
    const n = await db.level.count({ where: { schoolId, id: { in: input.audienceLevelIds } } });
    if (n !== input.audienceLevelIds.length) throw new ServiceError('One of the forms was not found', 404);
  }
  if (input.audience === 'CLASSES') {
    const n = await db.schoolClass.count({ where: { schoolId, id: { in: input.audienceClassIds } } });
    if (n !== input.audienceClassIds.length) throw new ServiceError('One of the classes was not found', 404);
  }
}

const data = (input: EventInput) => ({
  title: input.title, kind: input.kind, startDate: day(input.startDate), endDate: day(input.endDate),
  allDay: input.allDay, startTime: input.startTime, endTime: input.endTime,
  audience: input.audience, audienceLevelIds: input.audienceLevelIds, audienceClassIds: input.audienceClassIds,
  location: input.location ?? null, notes: input.notes ?? null, repeat: input.repeat, repeatUntil: input.repeatUntil ? day(input.repeatUntil) : null,
});

const snapshot = (e: EventRow) => ({
  title: e.title, kind: e.kind, startDate: iso(e.startDate), endDate: iso(e.endDate), allDay: e.allDay, startTime: e.startTime, endTime: e.endTime,
  audience: e.audience, location: e.location, notes: e.notes, repeat: e.repeat, repeatUntil: e.repeatUntil ? iso(e.repeatUntil) : null,
});

export type SaveResult = { saved: true; event: EventRow } | { saved: false; warnings: string[] };

export async function createEvent(db: ScopedDb, actor: Actor, input: EventInput, acknowledged = false): Promise<SaveResult> {
  await checkAudience(db, actor.schoolId, input);
  const warnings = await eventWarnings(db, actor, input);
  if (warnings.length > 0 && !acknowledged) return { saved: false, warnings };

  const event = await db.$tx(async (tx) => {
    const e = await tx.calendarEvent.create({ data: { schoolId: actor.schoolId, createdById: actor.id, ...data(input) } });
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action: 'CREATE_CALENDAR_EVENT', entityType: 'CalendarEvent', entityId: e.id,
        detail: `${e.title} (${input.startDate} to ${input.endDate})${warnings.length ? ' — saved after warning' : ''}`, after: snapshot(e),
      },
      tx,
    );
    return e;
  });
  return { saved: true, event };
}

export async function updateEvent(db: ScopedDb, actor: Actor, id: string, input: EventInput, acknowledged = false): Promise<SaveResult> {
  const before = await getEvent(db, id);
  await checkAudience(db, actor.schoolId, input);
  const warnings = await eventWarnings(db, actor, input, id);
  if (warnings.length > 0 && !acknowledged) return { saved: false, warnings };

  const event = await db.$tx(async (tx) => {
    const e = await tx.calendarEvent.update({ where: { id }, data: data(input) });
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action: 'UPDATE_CALENDAR_EVENT', entityType: 'CalendarEvent', entityId: id,
        detail: warnings.length ? `${e.title} — saved after warning` : e.title, before: snapshot(before), after: snapshot(e),
      },
      tx,
    );
    return e;
  });
  return { saved: true, event };
}

export async function deleteEvent(db: ScopedDb, actor: Actor, id: string) {
  const before = await getEvent(db, id);
  await db.$tx(async (tx) => {
    await tx.calendarEvent.delete({ where: { id } });
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action: 'DELETE_CALENDAR_EVENT', entityType: 'CalendarEvent', entityId: id,
        detail: `${before.title}${before.repeat !== 'NONE' ? ' (and its repeats)' : ''}`, before: snapshot(before),
      },
      tx,
    );
  });
}
