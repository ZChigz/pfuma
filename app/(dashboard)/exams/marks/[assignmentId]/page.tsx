import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { loadGrid } from '@/lib/exams/marks';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { MarkGridClient } from '@/components/exams/MarkGridClient';

export const metadata = { title: 'Enter marks · Pfuma' };

export default async function MarkGridPage({ params }: { params: { assignmentId: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.marks.enter') && !can('exams.marks.view') && !can('exams.marks.verify')) return <AccessDenied />;
  try {
    const grid = await loadGrid(user, params.assignmentId);
    return (
      <div className="flex flex-col gap-4 pb-8">
        <PageHeader
          title={`${grid.className} ${grid.subjectName}`} description="Enter marks for each student. They are saved as you type, even without a signal."
          breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'My marks', href: '/exams/marks' }, { label: `${grid.className} ${grid.subjectName}` }]}
          actions={
            <>
              {can('exams.assessments.create') && <Link href={`/exams/marks/${grid.assignmentId}/assessments`} className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary hover:bg-tint">Assessments</Link>}
              <Link href={`/exams/verify/${grid.assignmentId}`} className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary hover:bg-tint">Review &amp; history</Link>
            </>
          }
        />
        <MarkGridClient key={`${grid.assignmentId}|${grid.sheet.status}`} grid={grid} />
      </div>
    );
  } catch (err) {
    if (err instanceof ServiceError) return <EmptyState title="This class is not available" description={err.message} cta={{ label: 'My marks', href: '/exams/marks' }} />;
    throw err;
  }
}
