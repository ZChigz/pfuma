import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { resultsOverview } from '@/lib/exams/publish';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { ResultsClient } from '@/components/exams/ResultsClient';

export const metadata = { title: 'Results and report cards · Pfuma' };

export default async function ResultsPage() {
  const { user, can } = await getAccess();
  if (!can('exams.results.view') && !can('exams.results.publish') && !can('exams.reports.view') && !can('exams.comments.class')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const header = <PageHeader title="Results and report cards" description="Publish a class when every mark sheet and comment is done. Then print the report cards and the class results sheet." breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'Results' }]} />;
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" description="Set up an academic year and its terms in School Settings first." cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;
  const data = await resultsOverview(user, term.id);
  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      <ResultsClient data={data} flags={{ publish: can('exams.results.publish'), unpublish: can('exams.results.unpublish'), comments: can('exams.comments.class') || can('exams.comments.head') }} />
    </div>
  );
}
