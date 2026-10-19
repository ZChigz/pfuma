import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { reviewSheet } from '@/lib/exams/sheets';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { ReviewClient } from '@/components/exams/ReviewClient';

export const metadata = { title: 'Review marks · Pfuma' };

export default async function ReviewPage({ params }: { params: { assignmentId: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.marks.verify') && !can('exams.marks.unlock') && !can('exams.marks.view') && !can('exams.marks.enter')) return <AccessDenied />;
  try {
    const review = await reviewSheet(user, params.assignmentId);
    const g = review.grid;
    return (
      <div className="flex flex-col gap-4 pb-8">
        <PageHeader
          title={`${g.className} ${g.subjectName}`} description={`${g.termName}. The marks, how the class compares with the other classes of the subject, and everything that has happened to this sheet.`}
          breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: can('exams.marks.verify') ? 'Verify marks' : 'My marks', href: can('exams.marks.verify') ? '/exams/verify' : '/exams/marks' }, { label: `${g.className} ${g.subjectName}` }]}
        />
        <ReviewClient review={review} flags={{ unlock: can('exams.marks.unlock'), verify: can('exams.marks.verify') || can('exams.marks.unlock') }} />
      </div>
    );
  } catch (err) {
    if (err instanceof ServiceError) return <EmptyState title="This mark sheet is not available" description={err.message} cta={{ label: 'Examinations', href: '/exams' }} />;
    throw err;
  }
}
