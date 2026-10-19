import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { mySheets } from '@/lib/exams/sheets';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SheetBadge } from '@/components/exams/shared';

export const metadata = { title: 'My marks · Pfuma' };

export default async function MyMarksPage({ searchParams }: { searchParams: { all?: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.marks.enter') && !can('exams.marks.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const header = <PageHeader title="My marks" description="Your classes and subjects, with how many marks are entered for each assessment." breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'My marks' }]} />;
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" description="Set up an academic year and its terms in School Settings first." cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;
  const wide = searchParams.all === '1' && (can('exams.marks.view') || can('exams.marks.unlock'));
  const data = await mySheets(user, { termId: term.id, all: wide });
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader
        title="My marks" description={`${data.termName}. Your classes and subjects, with how many marks are entered for each assessment.`}
        breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'My marks' }]}
        actions={can('exams.marks.view') ? <Link href={wide ? '/exams/marks' : '/exams/marks?all=1'} className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary hover:bg-tint">{wide ? 'Only mine' : 'Everyone\'s'}</Link> : undefined}
      />
      {(data.deadlines.entryDue || data.deadlines.submitDue || data.deadlines.verifyDue) && (
        <p className="rounded-xl bg-white px-4 py-3 text-sm text-ink">
          Dates for this term: marks entered by <strong>{data.deadlines.entryDue ?? 'not set'}</strong>, submitted by <strong>{data.deadlines.submitDue ?? 'not set'}</strong>, verified by <strong>{data.deadlines.verifyDue ?? 'not set'}</strong>.
        </p>
      )}
      {data.items.length === 0 ? (
        <EmptyState title="No classes yet" description="You have not been given any classes to teach this term. The Deputy assigns teachers to classes and subjects under Academics." cta={{ label: 'Teacher assignments', href: '/academics/assignments' }} />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.items.map((i) => (
            <li key={i.assignmentId}>
              <Link href={`/exams/marks/${i.assignmentId}`} className="block rounded-2xl bg-white p-4 hover:ring-2 hover:ring-primary/30 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-ink">{i.className} {i.subject}</h2>
                    <p className="text-sm text-muted">{i.students} students{wide ? ` · ${i.teacher}` : ''}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {i.entryOverdue && <Badge variant="danger" label="Marks overdue" />}
                    {i.submitOverdue && <Badge variant="danger" label="Submission overdue" />}
                    <SheetBadge status={i.status} />
                  </div>
                </div>
                {i.assessments.length > 0 ? (
                  <ul className="mt-3 flex flex-col gap-1 text-sm text-ink">
                    {i.assessments.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3">
                        <span className="truncate">{i.className} {i.subject}, {a.title}: <strong>{a.entered} of {a.expected} entered</strong></span>
                        <span className="h-1.5 w-24 flex-shrink-0 overflow-hidden rounded-full bg-canvas" aria-hidden="true"><span className="block h-full bg-primary" style={{ width: `${a.expected ? Math.round((a.entered / a.expected) * 100) : 0}%` }} /></span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-3 text-sm text-muted">No assessments yet. Open the class to create the first one.</p>}
                {i.returnedComment && <p className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger"><strong>Returned:</strong> {i.returnedComment}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
