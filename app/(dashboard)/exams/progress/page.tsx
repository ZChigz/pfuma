import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { termProgress } from '@/lib/exams/sheets';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProgressClient } from '@/components/exams/ProgressClient';

export const metadata = { title: 'Mark sheet progress · Pfuma' };

export default async function ProgressPage() {
  const { user, can } = await getAccess();
  if (!can('exams.marks.unlock') && !can('exams.marks.view') && !can('exams.setup.manage')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const header = <PageHeader title="Mark sheet progress" description="How many mark sheets are verified this term, and who is late." breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'Progress' }]} />;
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" description="Set up an academic year and its terms in School Settings first." cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;
  const p = await termProgress(user, term.id);
  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      <ProgressClient progress={p} canRemind={can('exams.marks.unlock') || can('exams.setup.manage')} />
    </div>
  );
}
