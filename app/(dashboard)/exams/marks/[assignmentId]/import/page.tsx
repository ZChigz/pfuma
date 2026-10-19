import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { loadGrid } from '@/lib/exams/marks';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { ImportClient } from '@/components/exams/ImportClient';

export const metadata = { title: 'Import marks · Pfuma' };

export default async function ImportPage({ params }: { params: { assignmentId: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.marks.enter')) return <AccessDenied />;
  try {
    const grid = await loadGrid(user, params.assignmentId);
    const targets = grid.columns.filter((c) => !c.rubric).map((c) => ({ key: c.key, assessmentId: c.assessmentId, stageId: c.stageId, label: c.stageName ? `${c.title}: ${c.stageName}` : c.title, max: c.max }));
    return (
      <div className="flex flex-col gap-4 pb-8">
        <PageHeader
          title="Import marks" description="Download a template for one assessment, fill it in offline, upload it, check the errors and confirm."
          breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'My marks', href: '/exams/marks' }, { label: `${grid.className} ${grid.subjectName}`, href: `/exams/marks/${grid.assignmentId}` }, { label: 'Import' }]}
        />
        <ImportClient assignmentId={grid.assignmentId} targets={targets} canEdit={grid.canEdit} needsReason={grid.sheet.needsReason} />
      </div>
    );
  } catch (err) {
    if (err instanceof ServiceError) return <EmptyState title="This class is not available" description={err.message} cta={{ label: 'My marks', href: '/exams/marks' }} />;
    throw err;
  }
}
