import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { myDuties } from '@/lib/exams/invigilation';
import { mySheets, termProgress, verificationQueue } from '@/lib/exams/sheets';
import { listPeriods } from '@/lib/exams/timetable';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata = { title: 'Examinations · Pfuma' };

function Card({ href, title, big, text }: { href: string; title: string; big?: string; text: string }) {
  return (
    <Link href={href} className="block rounded-2xl bg-white p-5 hover:ring-2 hover:ring-primary/30">
      <h2 className="text-sm font-semibold text-muted">{title}</h2>
      {big && <p className="mt-1 text-3xl font-bold tabular-nums text-ink">{big}</p>}
      <p className="mt-1 text-sm text-ink">{text}</p>
    </Link>
  );
}

export default async function ExamsHome() {
  const { user, can } = await getAccess();
  const any = ['exams.marks.enter', 'exams.marks.view', 'exams.marks.verify', 'exams.marks.unlock', 'exams.setup.manage', 'exams.results.view', 'exams.timetable.manage', 'exams.zimsec.manage', 'exams.analytics.view', 'exams.comments.class', 'exams.comments.head'] as const;
  if (!any.some((k) => can(k))) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const header = <PageHeader title="Examinations" description="Marks, results, report cards, the exam timetable and the board entries." breadcrumbs={[{ label: 'Examinations' }]} />;
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" description="Set up an academic year and its terms in School Settings first." cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;

  const [mine, queue, progress, duties, periods] = await Promise.all([
    can('exams.marks.enter') ? mySheets(user, { termId: term.id }) : Promise.resolve(null),
    can('exams.marks.verify') ? verificationQueue(user, term.id) : Promise.resolve(null),
    can('exams.marks.unlock') || can('exams.marks.view') || can('exams.setup.manage') ? termProgress(user, term.id) : Promise.resolve(null),
    can('exams.marks.enter') ? myDuties(user, { upcomingOnly: true }) : Promise.resolve([]),
    can('exams.timetable.manage') || can('exams.timetable.approve') ? listPeriods(user, term.id) : Promise.resolve([]),
  ]);
  const toDo = mine ? mine.items.filter((i) => ['NOT_STARTED', 'IN_PROGRESS', 'RETURNED', 'UNLOCKED'].includes(i.status)).length : 0;
  const returned = mine ? mine.items.filter((i) => i.status === 'RETURNED').length : 0;

  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      <p className="text-sm text-muted">{term.name}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mine && <Card href="/exams/marks" title="My marks" big={`${toDo} to do`} text={returned ? `${returned} sheet${returned === 1 ? ' was' : 's were'} returned to you with a comment.` : `${mine.items.length} class${mine.items.length === 1 ? '' : 'es'} this term.`} />}
        {queue && <Card href="/exams/verify" title="To verify" big={String(queue.items.length)} text={queue.items.length ? 'Mark sheets are waiting for you.' : 'Nothing is waiting.'} />}
        {progress && <Card href="/exams/progress" title="Mark sheets verified" big={`${progress.verified} of ${progress.total}`} text={progress.overdue.length ? `${progress.overdue.length} teacher${progress.overdue.length === 1 ? ' has' : 's have'} overdue sheets.` : 'Nothing is overdue.'} />}
        {can('exams.setup.manage') && <Card href="/exams/setup" title="Assessment setup" text="Weighting plans, assessment types, the papers set for every class and the dates." />}
        {(can('exams.results.view') || can('exams.results.publish')) && <Card href="/exams/results" title="Results and report cards" text="Publish a class, print report cards and the class results sheet." />}
        {(can('exams.comments.class') || can('exams.comments.head')) && <Card href="/exams/comments" title="Comments" text="The class teacher's comment and the Head's remark on each report card." />}
        {(can('exams.projects.manage') || can('exams.assessments.create')) && <Card href="/exams/projects" title="School-based projects" text="Project templates with stages and rubrics." />}
        {(can('exams.timetable.manage') || can('exams.timetable.approve')) && <Card href="/exams/timetable" title="Exam timetable" big={periods.length ? `${periods.length} period${periods.length === 1 ? '' : 's'}` : undefined} text={periods.some((p) => p.status === 'PENDING') ? 'A timetable is waiting for approval.' : 'Schedule papers, invigilation and seating.'} />}
        {(can('exams.zimsec.manage') || can('exams.zimsec.approve') || can('exams.zimsec.results_import')) && <Card href="/exams/board" title="ZIMSEC and Cambridge" text="Entry lists, fees, candidate numbers and released results." />}
        {can('exams.analytics.view') && <Card href="/exams/analytics" title="Analytics" text="Subjects, classes, who needs help, and whether results are improving." />}
      </div>
      {duties.length > 0 && (
        <section className="rounded-2xl bg-white p-5">
          <h2 className="text-base font-semibold text-ink">My invigilation duties</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {duties.slice(0, 8).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
                <span><strong>{d.paper}</strong> · {d.room}</span>
                <span className="text-muted">{d.date}, {d.startTime} to {d.endTime}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
