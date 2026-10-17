import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { promotionState } from '@/lib/students/promotion';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { PromotionClient } from '@/components/students/PromotionClient';

export const metadata = { title: 'Year-end promotion · Pfuma' };

export default async function PromotionPage({ searchParams }: { searchParams: { fromYearId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('students.promotion.manage')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const [state, years] = await Promise.all([promotionState(user, searchParams.fromYearId), db.academicYear.findMany({ orderBy: { year: 'desc' }, select: { id: true, year: true } })]);
  const run = state?.confirmed ? await db.promotionRun.findFirst({ where: { fromYearId: state.fromYear.id, status: 'CONFIRMED' }, select: { id: true } }) : null;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Year-end promotion" description="After Term 3 closes: decide what happens to every student, review, and confirm. It can be saved as a draft and finished later." breadcrumbs={[{ label: 'Student Information' }, { label: 'Promotion' }]} />
      {!state ? (
        <EmptyState title="Nothing to promote yet" description="The promotion starts once Term 3 of a year is closed. Close Term 3 under School Settings, Academic years." />
      ) : (
        <PromotionClient state={state} canApprove={can('students.promotion.approve')} years={years} runId={run?.id ?? null} />
      )}
    </div>
  );
}
