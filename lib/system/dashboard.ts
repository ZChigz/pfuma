// Numbers for the dashboard, for the term being VIEWED (which may not be the open one).
import type { ScopedDb } from '@/lib/scoped-db';
import { termMoney } from '@/lib/finance/external';

const DAY = 864e5;
export interface ViewTerm { id: string; name: string; startDate: Date; endDate: Date; status: string }

export interface MoneyByCurrency { USD: number; ZIG: number }
const emptyMoney = (): MoneyByCurrency => ({ USD: 0, ZIG: 0 });

export interface TermProgress {
  /** 0–100, how far through the term today is. */
  percent: number;
  /** Negative once the term has ended; null before it starts. */
  daysLeft: number | null;
  state: 'upcoming' | 'running' | 'ended';
}

export function termProgress(term: { startDate: Date; endDate: Date }, now = new Date()): TermProgress {
  const start = term.startDate.getTime();
  const end = term.endDate.getTime() + DAY; // the end date itself is a school day
  const t = now.getTime();
  if (t < start) return { percent: 0, daysLeft: null, state: 'upcoming' };
  if (t >= end) return { percent: 100, daysLeft: Math.ceil((end - t) / DAY), state: 'ended' };
  return { percent: Math.round(((t - start) / (end - start)) * 100), daysLeft: Math.ceil((end - t) / DAY), state: 'running' };
}

export async function getDashboardData(
  db: ScopedDb,
  schoolId: string,
  term: ViewTerm | null,
  opts: { finance: boolean; audit: boolean; now?: Date },
) {
  const now = opts.now ?? new Date();
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);

  const verifiedWindow = term ? { gte: term.startDate, lt: new Date(term.endDate.getTime() + DAY) } : undefined;

  const [enrolled, classes, staff, upcoming, money, recent] = await Promise.all([
    term ? db.enrollment.count({ where: { schoolId, termId: term.id } }) : Promise.resolve(0),
    db.schoolClass.count({ where: { schoolId, active: true } }),
    db.user.count({ where: { schoolId, active: true, isSupport: false } }),
    db.calendarEvent.findMany({ where: { schoolId, endDate: { gte: today } }, orderBy: [{ startDate: 'asc' }, { title: 'asc' }], take: 5 }),
    // From the Finance module for a school that runs its money there, else the first accounting tables.
    opts.finance ? db.$tx((tx) => termMoney(tx, schoolId, term, verifiedWindow)) : Promise.resolve(null),
    opts.audit
      ? db.auditLog.findMany({
          where: { schoolId, action: { notIn: ['DATA_CREATE', 'DATA_UPDATE', 'DATA_DELETE'] } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 6,
          select: { id: true, action: true, detail: true, entityType: true, createdAt: true, actor: { select: { fullName: true } } },
        })
      : Promise.resolve([]),
  ]);

  return {
    enrolled,
    classes,
    staff,
    upcoming,
    billed: money?.billed ?? emptyMoney(),
    collected: money?.collected ?? emptyMoney(),
    pendingPayments: money?.pending ?? 0,
    recent,
    progress: term ? termProgress(term, now) : null,
  };
}
