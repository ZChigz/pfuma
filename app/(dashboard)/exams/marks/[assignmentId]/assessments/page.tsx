import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { listAssessments } from '@/lib/exams/assessments';
import { listTemplates } from '@/lib/exams/projects';
import { listTypes, resolvePlan } from '@/lib/exams/setup';
import { classNameOf, levelIdOf, loadAssignment } from '@/lib/exams/common';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { AssessmentsClient } from '@/components/exams/AssessmentsClient';

export const metadata = { title: 'Assessments · Pfuma' };

export default async function AssessmentsPage({ params }: { params: { assignmentId: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.assessments.create') && !can('exams.marks.view')) return <AccessDenied />;
  try {
    const db = getScopedDb(user.schoolId, user.id);
    const info = await db.$tx(async (tx) => {
      const a = await loadAssignment(tx, user.schoolId, params.assignmentId);
      const levelId = levelIdOf(a);
      const [plan, topics] = await Promise.all([
        resolvePlan(tx, user.schoolId, a.termId, levelId, a.subjectId),
        tx.syllabusTopic.findMany({ where: { schoolId: user.schoolId, subjectId: a.subjectId, levelId }, orderBy: [{ order: 'asc' }, { title: 'asc' }], select: { id: true, title: true } }),
      ]);
      return { name: `${classNameOf(a)} ${a.subject.name}`, subjectId: a.subjectId, levelId, termName: a.term.name, plan, topics };
    });
    const [assessments, types, templates] = await Promise.all([
      listAssessments(user, params.assignmentId),
      listTypes(user),
      can('exams.assessments.create') ? listTemplates(user, { subjectId: info.subjectId, levelId: info.levelId }) : Promise.resolve([]),
    ]);
    const planTypeIds = new Set(info.plan?.lines.flatMap((l) => l.typeIds) ?? []);
    return (
      <div className="flex flex-col gap-4 pb-8">
        <PageHeader
          title={`Assessments: ${info.name}`} description={`${info.termName}. The tests and projects that make up the term mark. What counts, and how much, is set in the term's weighting plan.`}
          breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'My marks', href: '/exams/marks' }, { label: info.name, href: `/exams/marks/${params.assignmentId}` }, { label: 'Assessments' }]}
        />
        <AssessmentsClient
          assignmentId={params.assignmentId}
          assessments={assessments}
          types={types.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, isProject: t.isProject, commonExam: t.commonExam, inPlan: planTypeIds.has(t.id) }))}
          plan={info.plan ? info.plan.lines.map((l) => ({ label: l.label, weight: l.weight })) : null}
          templates={templates.map((t) => ({ id: t.id, title: t.title, total: t.total, stages: t.stages.length, dueDate: t.dueDate }))}
          topics={info.topics}
          canCreate={can('exams.assessments.create')}
        />
      </div>
    );
  } catch (err) {
    if (err instanceof ServiceError) return <EmptyState title="This class is not available" description={err.message} cta={{ label: 'My marks', href: '/exams/marks' }} />;
    throw err;
  }
}
