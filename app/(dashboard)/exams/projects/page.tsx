import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { listTemplates } from '@/lib/exams/projects';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProjectsClient } from '@/components/exams/ProjectsClient';

export const metadata = { title: 'School-based projects · Pfuma' };

export default async function ProjectsPage() {
  const { user, can } = await getAccess();
  if (!can('exams.projects.manage') && !can('exams.assessments.create')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const [templates, subjects, levels] = await Promise.all([
    listTemplates(user),
    db.subject.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.level.findMany({ where: { active: true }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="School-based projects" description="A project has stages, each with its own maximum mark or a rubric. Teachers start a project for their class from a template; the total counts like any other assessment." breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'Projects' }]} />
      <ProjectsClient templates={templates} subjects={subjects} levels={levels} canManage={can('exams.projects.manage')} />
    </div>
  );
}
