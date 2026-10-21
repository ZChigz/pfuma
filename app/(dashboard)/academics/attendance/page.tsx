import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { dailySheet, dailySummary, myLessons, truancyList } from '@/lib/academics/attendance';
import { seesAllClasses, todayInHarare, toDay } from '@/lib/academics/common';
import { schoolDayInfo } from '@/lib/academics/school-days';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { AttendanceSummaryClient } from '@/components/academics/AttendanceSummaryClient';
import { RegisterClient } from '@/components/academics/RegisterClient';
import { Section } from '@/components/academics/shared';
import { primaryLink, linkButton } from '@/components/academics/styles';

export const metadata = { title: 'Attendance · Pfuma' };

export default async function AttendancePage({ searchParams }: { searchParams: { classId?: string; date?: string; session?: string; tab?: string } }) {
  const { user, can } = await getAccess();
  const canMark = can('academics.attendance.mark');
  const canView = can('academics.attendance.view');
  if (!canMark && !canView) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const today = todayInHarare();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : today;
  const header = <PageHeader title="Attendance" description="Mark today's register, see who has marked theirs, and who is absent." breadcrumbs={[{ label: 'Academics' }, { label: 'Attendance' }]} />;

  // One register open: the phone-first marking screen.
  if (searchParams.classId) {
    try {
      const sheet = await dailySheet(user, searchParams.classId, date, searchParams.session === 'PM' ? 'PM' : 'AM');
      return (
        <div className="flex flex-col gap-3">
          <nav className="text-sm"><Link href="/academics/attendance" className="font-semibold text-primary hover:underline">← All registers</Link></nav>
          {sheet.sessions.length > 1 && (
            <div className="flex gap-2" role="group" aria-label="Session">
              {sheet.sessions.map((s) => <Link key={s} href={`?classId=${searchParams.classId}&date=${date}&session=${s}`} className={s === sheet.session ? primaryLink : linkButton}>{s === 'AM' ? 'Morning' : 'Afternoon'}</Link>)}
            </div>
          )}
          <RegisterClient key={`${sheet.classId}|${sheet.date}|${sheet.session}`} sheet={sheet} />
        </div>
      );
    } catch (err) {
      if (err instanceof ServiceError) return <div className="flex flex-col gap-4">{header}<EmptyState title="Register not available" description={err.message} cta={{ label: 'All registers', href: '/academics/attendance' }} /></div>;
      throw err;
    }
  }

  const day = await schoolDayInfo(db, user, today);
  const wide = seesAllClasses(user);
  const [mine, lessons, summary, truancy] = await Promise.all([
    canMark && day.term
      ? db.classTeacher.findMany({ where: { termId: day.term.id, ...(wide && !searchParams.tab ? {} : { userId: user.id }) }, select: { classId: true, class: { select: { name: true } } }, orderBy: { class: { name: 'asc' } } })
      : Promise.resolve([]),
    canMark ? myLessons(user, today) : Promise.resolve({ enabled: false, date: today, lessons: [] }),
    canView && searchParams.tab !== 'mark' ? dailySummary(user, date) : Promise.resolve(null),
    canView ? truancyList(user, date) : Promise.resolve([]),
  ]);
  const marked = day.term && mine.length
    ? new Set((await db.attendanceRegister.findMany({ where: { termId: day.term.id, date: toDay(today), session: 'AM', slotId: null, classId: { in: mine.map((m) => m.classId) } }, select: { classId: true } })).map((r) => r.classId))
    : new Set<string | null>();

  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      {canMark && (
        <Section title="Mark today's register" hint={day.isSchoolDay ? 'Everyone starts present. You only tap the exceptions.' : 'There is no register today.'}>
          {!day.isSchoolDay && <p className="text-sm text-muted">{day.reason === 'HOLIDAY' ? `Today is a public holiday${day.holidayName ? ` (${day.holidayName})` : ''}.` : day.reason === 'WEEKEND' ? 'It is the weekend.' : 'Today is outside the term.'}</p>}
          {day.isSchoolDay && mine.length === 0 && <p className="text-sm text-muted">You are not the class teacher of a class this term. Ask an administrator to make you one in Classes.</p>}
          <ul className="flex flex-col gap-2">
            {day.isSchoolDay && mine.map((m) => (
              <li key={m.classId} className="flex items-center justify-between gap-3 rounded-xl bg-canvas p-3">
                <span className="font-semibold text-ink">{m.class.name}</span>
                <span className="flex items-center gap-3">
                  {marked.has(m.classId) ? <Badge variant="success" label="Marked" /> : <Badge variant="danger" label="Not marked" />}
                  <Link href={`?classId=${m.classId}`} className={marked.has(m.classId) ? linkButton : primaryLink}>{marked.has(m.classId) ? 'Open' : 'Mark now'}</Link>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {canMark && lessons.enabled && lessons.lessons.length > 0 && (
        <Section title="My lessons today" hint="Open a lesson to mark who is there.">
          <ul className="flex flex-col gap-2">
            {lessons.lessons.map((l) => (
              <li key={l.slotId} className="flex items-center justify-between gap-3 rounded-xl bg-canvas p-3">
                <span><b className="text-ink">{l.subject}</b> · {l.target}<span className="block text-xs text-muted">Period {l.periodNo}, {l.start}–{l.end}</span></span>
                <span className="flex items-center gap-3">{l.marked && <Badge variant="success" label="Marked" />}<Link href={`/academics/attendance/lesson?slotId=${l.slotId}&date=${today}`} className={l.marked ? linkButton : primaryLink}>{l.marked ? 'Open' : 'Mark'}</Link></span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {summary && <AttendanceSummaryClient summary={summary} truancy={truancy} canRemind={can('academics.attendance.correct')} today={today} />}
    </div>
  );
}
