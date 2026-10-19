import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { classComments } from '@/lib/exams/publish';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { CommentsClient } from '@/components/exams/CommentsClient';

export const metadata = { title: 'Class comments · Pfuma' };

export default async function ClassCommentsPage({ params }: { params: { classId: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.comments.class') && !can('exams.comments.head') && !can('exams.results.view')) return <AccessDenied />;
  try {
    const { term } = await getViewTerm(user.schoolId, getScopedDb(user.schoolId, user.id));
    const data = await classComments(user, params.classId, term?.id);
    return (
      <div className="flex flex-col gap-4 pb-8">
        <PageHeader
          title={`${data.className}: comments`} description={`${data.termName}${data.classTeacher ? ` · class teacher ${data.classTeacher}` : ''}. Each student's results are beside the comment box. Comments are limited to 300 characters to fit the card.`}
          breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'Comments', href: '/exams/comments' }, { label: data.className }]}
        />
        <CommentsClient data={data} />
      </div>
    );
  } catch (err) {
    if (err instanceof ServiceError) return <EmptyState title="This class is not available" description={err.message} cta={{ label: 'Comments', href: '/exams/comments' }} />;
    throw err;
  }
}
