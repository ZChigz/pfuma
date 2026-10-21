import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { myDay } from '@/lib/academics/timetable';
import { todayInHarare } from '@/lib/academics/common';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { Notice } from '@/components/academics/shared';
import { primaryLink, linkButton } from '@/components/academics/styles';

export const metadata = { title: 'My day · Pfuma' };

// The teacher's phone view: today's lessons from the published timetable, cover lessons, and the next lesson highlighted.
export default async function MyDayPage({ searchParams }: { searchParams: { date?: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.timetable.view')) return <AccessDenied />;
  const today = todayInHarare();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : today;
  const d = await myDay(user, date);
  const perLesson = can('academics.attendance.mark');
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="My day" description={new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))} breadcrumbs={[{ label: 'Academics' }, { label: 'Timetable', href: '/academics/timetable' }, { label: 'My day' }]} />
      {!d.schoolDay && <Notice tone="info">{d.reason}</Notice>}
      {d.schoolDay && 'noTimetable' in d && d.noTimetable && <Notice tone="info">No timetable has been published for this day yet.</Notice>}
      {d.schoolDay && d.lessons.length === 0 && !('noTimetable' in d && d.noTimetable) && <Notice tone="info">You have no lessons on this day.</Notice>}
      <ol className="flex flex-col gap-2">
        {d.lessons.map((l, i) => (
          <li key={l.slotId} className={`rounded-2xl p-4 ${i === d.nextIndex ? 'bg-primary text-white' : 'bg-white'} ${l.coveredBy ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold tabular-nums">{l.start}–{l.end} <span className="font-normal opacity-80">· period {l.periodNo}</span></p>
              <div className="flex gap-2">
                {i === d.nextIndex && <Badge variant="gold" label="Next lesson" />}
                {l.isCover && <Badge variant="warning" label={`Cover for ${l.coverFor}`} />}
                {l.coveredBy && <Badge label={`Covered by ${l.coveredBy}`} />}
                {l.isDouble && <Badge variant="info" label="Double" />}
              </div>
            </div>
            <p className="mt-1 text-lg font-bold">{l.subject} · {l.target}</p>
            {l.room && <p className="text-sm opacity-80">{l.room}</p>}
            {perLesson && !l.coveredBy && date <= today && <Link href={`/academics/attendance/lesson?slotId=${l.slotId}&date=${date}`} className={`mt-2 ${i === d.nextIndex ? 'inline-flex min-h-[44px] items-center rounded-full bg-white px-5 text-sm font-semibold text-primary' : l.marked ? linkButton : primaryLink}`}>{l.marked ? 'Open register' : 'Mark register'}</Link>}
          </li>
        ))}
      </ol>
    </div>
  );
}
