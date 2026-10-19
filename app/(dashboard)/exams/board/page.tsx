import { getAccess } from '@/lib/access';
import { defaultCentre, listSessions } from '@/lib/exams/board';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { SessionsClient } from '@/components/exams/SessionsClient';

export const metadata = { title: 'ZIMSEC and Cambridge · Pfuma' };

export default async function BoardPage() {
  const { user, can } = await getAccess();
  if (!can('exams.zimsec.manage') && !can('exams.zimsec.approve') && !can('exams.zimsec.results_import')) return <AccessDenied />;
  const [sessions, centre] = await Promise.all([listSessions(user), defaultCentre(user)]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="ZIMSEC and Cambridge" description="Each sitting: its subject codes, fees and dates, the candidates' entries, and the released results." breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'Board entries' }]} />
      <SessionsClient sessions={sessions} centre={centre} canManage={can('exams.zimsec.manage')} />
    </div>
  );
}
