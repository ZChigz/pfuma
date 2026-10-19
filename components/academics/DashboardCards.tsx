import Link from 'next/link';
import { can, type AccessUser } from '@/lib/access-core';
import { registerDue } from '@/lib/academics/attendance';
import { myDay } from '@/lib/academics/timetable';
import { todayInHarare } from '@/lib/academics/common';

// On the dashboard of a class teacher or a teacher: "Mark today's register" until it is done, and the next lesson.
export async function AcademicsDashboardCards({ user }: { user: AccessUser & { fullName?: string; roles?: readonly string[] } }) {
  const showRegister = can(user, 'academics.attendance.mark');
  const showDay = can(user, 'academics.timetable.view');
  if (!showRegister && !showDay) return null;
  const [due, day] = await Promise.all([
    showRegister ? registerDue(user).catch(() => []) : Promise.resolve([]),
    showDay ? myDay(user, todayInHarare()).catch(() => null) : Promise.resolve(null),
  ]);
  const next = day && day.nextIndex >= 0 ? day.lessons[day.nextIndex] : null;
  if (due.length === 0 && !next) return null;
  return (
    <section aria-label="Today" className="grid gap-3 sm:grid-cols-2">
      {due.map((d) => (
        <Link key={d.classId} href={`/academics/attendance?classId=${d.classId}`} className="flex min-h-[72px] items-center justify-between gap-3 rounded-2xl bg-primary p-4 text-white hover:bg-primary-hover">
          <span><span className="block text-xs font-semibold uppercase tracking-wide opacity-80">Today</span><span className="text-lg font-bold">Mark today&apos;s register</span><span className="block text-sm opacity-90">{d.className}</span></span>
          <span aria-hidden="true" className="text-2xl">→</span>
        </Link>
      ))}
      {next && (
        <Link href="/academics/timetable/my-day" className="flex min-h-[72px] items-center justify-between gap-3 rounded-2xl bg-white p-4 hover:ring-2 hover:ring-primary/30">
          <span><span className="block text-xs font-semibold uppercase tracking-wide text-muted">Next lesson</span><span className="text-lg font-bold text-ink">{next.subject} · {next.target}</span><span className="block text-sm text-muted">{next.start}–{next.end}{next.room ? ` · ${next.room}` : ''}{next.isCover ? ' · cover' : ''}</span></span>
          <span aria-hidden="true" className="text-2xl text-primary">→</span>
        </Link>
      )}
    </section>
  );
}
