import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { RANK_BY, intakeReport, listApplicants, rankApplicants, type RankBy } from '@/lib/students/admissions';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { IntakeClient } from '@/components/students/IntakeClient';

export const metadata = { title: 'Intake · Pfuma' };

export default async function IntakePage({ params, searchParams }: { params: { intakeId: string }; searchParams: { by?: string } }) {
  const { user, can } = await getAccess();
  if (!can('students.admissions.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const by: RankBy = (RANK_BY as readonly string[]).includes(searchParams.by ?? '') ? (searchParams.by as RankBy) : 'units';
  let data;
  try { data = await listApplicants(user, params.intakeId); } catch (e) { if (e instanceof ServiceError && e.status === 404) notFound(); throw e; }
  const intakeRow = await db.intake.findUniqueOrThrow({ where: { id: params.intakeId }, select: { levelId: true } });
  const [report, classes, financeOff] = await Promise.all([
    intakeReport(user, params.intakeId),
    db.schoolClass.findMany({ where: { levelId: intakeRow.levelId, active: true }, orderBy: { stream: 'asc' }, select: { id: true, name: true } }),
    db.schoolModule.findFirst({ where: { module: 'finance', enabled: false } }),
  ]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={data.intake.name} description={`${data.intake.places} places${data.intake.reportingDate ? `, reporting ${data.intake.reportingDate}` : ''}`} breadcrumbs={[{ label: 'Admissions', href: '/students/admissions' }, { label: data.intake.name }]} />
      <IntakeClient
        intake={data.intake} applicants={data.applicants} ranking={rankApplicants(data.applicants, by, data.intake.places)} rankedBy={by} report={report} classes={classes}
        canManage={can('students.admissions.manage')} canApprove={can('students.admissions.approve')} financeOn={!financeOff}
      />
    </div>
  );
}
