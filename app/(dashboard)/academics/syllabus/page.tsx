import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { listTemplates, syllabusIndex, syllabusTree } from '@/lib/academics/curriculum';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { SyllabusClient } from '@/components/academics/SyllabusClient';

export const metadata = { title: 'Syllabus · Pfuma' };

export default async function SyllabusPage({ searchParams }: { searchParams: { subjectId?: string; levelId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.schemes.view') && !can('academics.syllabus.manage')) return <AccessDenied />;
  const manage = can('academics.syllabus.manage');
  const index = await syllabusIndex(user);
  let tree = null;
  let templates: Awaited<ReturnType<typeof listTemplates>> = [];
  if (searchParams.subjectId && searchParams.levelId) {
    try {
      tree = await syllabusTree(user, searchParams.subjectId, searchParams.levelId);
      if (manage && tree.count === 0) {
        const level = index.levels.find((l) => l.id === searchParams.levelId);
        templates = await listTemplates(user, { subjectName: tree.subject.name, levelOrder: level?.order });
      }
    } catch (err) { if (!(err instanceof ServiceError)) throw err; }
  }
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Syllabus" description="What must be taught: topics and sub-topics with learning objectives, for each subject and form." breadcrumbs={[{ label: 'Academics' }, { label: 'Schemes of work', href: '/academics/schemes' }, { label: 'Syllabus' }]} />
      <SyllabusClient index={index} selection={{ subjectId: tree ? searchParams.subjectId ?? null : searchParams.subjectId ?? null, levelId: searchParams.levelId ?? null }} tree={tree ? { topics: tree.topics, count: tree.count } : null} templates={templates} canManage={manage} />
    </div>
  );
}
