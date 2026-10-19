import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { entryList } from '@/lib/exams/board';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { BoardClient } from '@/components/exams/BoardClient';

export const metadata = { title: 'Entry list · Pfuma' };

export default async function BoardSessionPage({ params }: { params: { sessionId: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.zimsec.manage') && !can('exams.zimsec.approve') && !can('exams.zimsec.results_import') && !can('exams.analytics.view')) return <AccessDenied />;
  try {
    const list = await entryList(user, params.sessionId);
    const levels = await getScopedDb(user.schoolId, user.id).level.findMany({ where: { active: true }, orderBy: { order: 'asc' }, select: { id: true, name: true } });
    const s = list.session;
    return (
      <div className="flex flex-col gap-4 pb-8">
        <PageHeader
          title={`${s.board} ${s.session}`} description={`${s.category === 'O_LEVEL' ? 'O Level' : 'A Level'} · centre ${s.centreNumber} · ${s.currency} ${s.feePerSubject} per subject${s.fixedFee ? ` + ${s.fixedFee}` : ''}`}
          breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'Board entries', href: '/exams/board' }, { label: `${s.board} ${s.session}` }]}
        />
        <BoardClient list={list} levels={levels} flags={{ manage: can('exams.zimsec.manage'), approve: can('exams.zimsec.approve'), results: can('exams.zimsec.results_import') }} />
      </div>
    );
  } catch (err) {
    if (err instanceof ServiceError) return <EmptyState title="This session is not available" description={err.message} cta={{ label: 'Board entries', href: '/exams/board' }} />;
    throw err;
  }
}
