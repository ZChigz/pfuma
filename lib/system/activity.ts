// Turns audit log rows into the sentences on the dashboard:
// "T. Moyo added 42 students, 2 hours ago".
import type { ScopedDb } from '@/lib/scoped-db';

export const FEED_SIZE = 10;
/** Rows read to build the feed; bulk actions (an import writes one row per student) collapse into one line. */
const FETCH = 300;
/** Same person, same action, within this long of each other = one line. */
const GROUP_GAP_MS = 5 * 60 * 1000;

export interface AuditRow { id: string; action: string; detail: string | null; entityType: string; createdAt: Date; actor: { fullName: string } }
export interface FeedItem { id: string; text: string; when: Date; count: number }

/** action → [what one looks like, what many look like with {n}] */
const PHRASES: Record<string, [string, string]> = {
  ADMIT_STUDENT: ['admitted a student', 'added {n} students'],
  CREATE_STUDENT: ['added a student', 'added {n} students'],
  UPDATE_STUDENT: ['updated a student', 'updated {n} students'],
  CREATE_USER: ['added a user', 'added {n} users'],
  UPDATE_USER: ['updated a user', 'updated {n} users'],
  DEACTIVATE_USER: ['deactivated a user', 'deactivated {n} users'],
  REACTIVATE_USER: ['reactivated a user', 'reactivated {n} users'],
  RESET_PASSWORD: ['reset a password', 'reset {n} passwords'],
  CREATE_CLASS: ['created a class', 'created {n} classes'],
  UPDATE_CLASS: ['updated a class', 'updated {n} classes'],
  TRANSFER_CLASS: ['moved a student to another class', 'moved {n} students to other classes'],
  PROMOTE_STUDENT: ['promoted a student', 'promoted {n} students'],
  RECORD_PAYMENT: ['recorded a payment', 'recorded {n} payments'],
  VERIFY_PAYMENT: ['verified a payment', 'verified {n} payments'],
  VOID_PAYMENT: ['voided a payment', 'voided {n} payments'],
  RECORD_EXPENSE: ['recorded an expense', 'recorded {n} expenses'],
  APPLY_CHARGE: ['applied a charge', 'applied {n} charges'],
  RECORD_MARK: ['entered a mark', 'entered {n} marks'],
  VERIFY_MARKS: ['verified marks', 'verified marks {n} times'],
  PUBLISH_RESULTS: ['published results', 'published results {n} times'],
  UPDATE_SCHOOL_SETTINGS: ['changed the school settings', 'changed the school settings {n} times'],
  UPDATE_SCHOOL_MODULES: ['changed which modules are on', 'changed which modules are on {n} times'],
  CREATE_CALENDAR_EVENT: ['added a calendar event', 'added {n} calendar events'],
  UPDATE_CALENDAR_EVENT: ['edited a calendar event', 'edited {n} calendar events'],
  DELETE_CALENDAR_EVENT: ['deleted a calendar event', 'deleted {n} calendar events'],
  OPEN_TERM: ['opened a term', 'opened {n} terms'],
  CLOSE_TERM: ['closed a term', 'closed {n} terms'],
  CREATE_ASSET: ['added an asset', 'added {n} assets'],
  CHECKOUT_BOOK: ['checked out a book', 'checked out {n} books'],
  RETURN_BOOK: ['returned a book', 'returned {n} books'],
  CHANGE_PASSWORD: ['changed their password', 'changed their password {n} times'],
};

const words = (action: string) => action.toLowerCase().replace(/_/g, ' ');

/** "Tendai Moyo" → "T. Moyo"; "Moyo" stays "Moyo". */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Someone';
  if (parts.length === 1) return parts[0];
  return `${parts[0][0].toUpperCase()}. ${parts[parts.length - 1]}`;
}

export function timeAgo(when: Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - when.getTime()) / 1000));
  if (s < 45) return 'just now';
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'} ago`;
  if (s < 3600) return unit(Math.max(1, Math.round(s / 60)), 'minute');
  if (s < 86400) return unit(Math.round(s / 3600), 'hour');
  if (s < 30 * 86400) return unit(Math.round(s / 86400), 'day');
  return `on ${when.toISOString().slice(0, 10)}`;
}

/** Newest first in, newest first out. */
export function buildFeed(rows: AuditRow[], limit = FEED_SIZE): FeedItem[] {
  const groups: { first: AuditRow; last: AuditRow; rows: AuditRow[] }[] = [];
  for (const r of rows) {
    const g = groups.find((x) => x.first.action === r.action && x.first.actor.fullName === r.actor.fullName && x.last.createdAt.getTime() - r.createdAt.getTime() <= GROUP_GAP_MS);
    if (g) { g.rows.push(r); g.last = r; } else groups.push({ first: r, last: r, rows: [r] });
  }
  return groups.slice(0, limit).map((g) => {
    const [one, many] = PHRASES[g.first.action] ?? [words(g.first.action), `${words(g.first.action)} ({n} times)`];
    const n = g.rows.length;
    const detail = n === 1 && g.first.detail && g.first.detail.length <= 60 ? `: ${g.first.detail}` : '';
    return {
      id: g.first.id,
      count: n,
      when: g.first.createdAt,
      text: `${shortName(g.first.actor.fullName)} ${n === 1 ? one : many.replace('{n}', String(n))}${detail}`,
    };
  });
}

export async function loadFeed(db: ScopedDb, schoolId: string): Promise<FeedItem[]> {
  const rows = await db.auditLog.findMany({
    where: { schoolId, action: { notIn: ['DATA_CREATE', 'DATA_UPDATE', 'DATA_DELETE'] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: FETCH,
    select: { id: true, action: true, detail: true, entityType: true, createdAt: true, actor: { select: { fullName: true } } },
  });
  return buildFeed(rows);
}
