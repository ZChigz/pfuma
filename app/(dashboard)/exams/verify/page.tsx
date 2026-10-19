import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { verificationQueue } from '@/lib/exams/sheets';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata = { title: 'Verify marks · Pfuma' };

export default async function VerifyQueuePage() {
  const { user, can } = await getAccess();
  if (!can('exams.marks.verify') && !can('exams.marks.unlock')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const header = <PageHeader title="Verify marks" description="Mark sheets that teachers have submitted, waiting for you to check them." breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'Verify marks' }]} />;
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" description="Set up an academic year and its terms in School Settings first." cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;
  const q = await verificationQueue(user, term.id);
  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      {q.items.length === 0 ? (
        <EmptyState title="Nothing to verify" description={`No submitted mark sheets are waiting for you in ${q.termName}.`} />
      ) : (
        <ul className="flex flex-col gap-3">
          {q.items.map((i) => (
            <li key={i.assignmentId}>
              <Link href={`/exams/verify/${i.assignmentId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-4 hover:ring-2 hover:ring-primary/30 sm:p-5">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-ink">{i.className} {i.subject}</h2>
                  <p className="text-sm text-muted">{i.teacher}{i.department ? ` · ${i.department}` : ''}{i.submittedAt ? ` · submitted ${i.submittedAt.slice(0, 10)}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">{i.verifyOverdue && <Badge variant="danger" label="Overdue" />}<Badge variant="warning" label="Review" /></div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
