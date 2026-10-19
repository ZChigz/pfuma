import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { loadGrid } from '@/lib/exams/marks';
import { rubricFor } from '@/lib/exams/projects';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { RubricClient } from '@/components/exams/RubricClient';

export const metadata = { title: 'Project rubric · Pfuma' };

export default async function RubricPage({ params, searchParams }: { params: { assignmentId: string }; searchParams: { assessmentId?: string; stageId?: string; studentId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.marks.enter') && !can('exams.marks.view') && !can('exams.marks.verify')) return <AccessDenied />;
  try {
    const grid = await loadGrid(user, params.assignmentId);
    const stageCols = grid.columns.filter((c) => c.rubric);
    const col = stageCols.find((c) => c.assessmentId === searchParams.assessmentId && c.stageId === searchParams.stageId) ?? stageCols[0];
    if (!col) return <EmptyState title="No rubric" description="This class has no project stage that is marked with a rubric." cta={{ label: 'Back to the grid', href: `/exams/marks/${params.assignmentId}` }} />;
    const student = grid.students.find((s) => s.id === searchParams.studentId) ?? grid.students[0];
    if (!student) return <EmptyState title="No students" description="No students take this subject in this class." cta={{ label: 'Back to the grid', href: `/exams/marks/${params.assignmentId}` }} />;
    const rubric = await rubricFor(user, params.assignmentId, col.assessmentId, col.stageId!, student.id);
    return (
      <div className="flex flex-col gap-4 pb-8">
        <PageHeader
          title={`${col.title}: ${col.stageName}`} description={`${grid.className} ${grid.subjectName}. Click a level for each criterion; the total is worked out for you.`}
          breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'My marks', href: '/exams/marks' }, { label: `${grid.className} ${grid.subjectName}`, href: `/exams/marks/${params.assignmentId}` }, { label: 'Rubric' }]}
        />
        <RubricClient
          assignmentId={params.assignmentId} assessmentId={col.assessmentId} stageId={col.stageId!} rubric={rubric} canEdit={grid.canEdit} needsReason={grid.sheet.needsReason}
          students={grid.students.map((s) => ({ id: s.id, name: s.name }))}
          stages={stageCols.map((c) => ({ assessmentId: c.assessmentId, stageId: c.stageId!, label: `${c.title}: ${c.stageName}` }))}
        />
      </div>
    );
  } catch (err) {
    if (err instanceof ServiceError) return <EmptyState title="This rubric is not available" description={err.message} cta={{ label: 'My marks', href: '/exams/marks' }} />;
    throw err;
  }
}
