import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { assignmentGrid, assignmentSet, gapsReport, listAssignments, teacherWorkload } from '@/lib/academics/assignments';
import { listGroups } from '@/lib/academics/groups';
import { getViewTerm } from '@/lib/system/view-term';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { AssignmentsClient } from '@/components/academics/AssignmentsClient';

export const metadata = { title: 'Teacher assignments · Pfuma' };

export default async function AssignmentsPage() {
  const { user, can } = await getAccess();
  if (!can('academics.assignments.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const header = <PageHeader title="Teacher assignments" description="Who teaches which subject to which class, for how many periods. The timetable, schemes and marks are built from these." breadcrumbs={[{ label: 'Academics' }, { label: 'Teacher assignments' }]} />;
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" description="Set up an academic year and its terms in School Settings first." cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;

  const manage = can('academics.assignments.manage');
  const [grid, workload, gaps, groups, set, list, teachers, subjects, levels] = await Promise.all([
    assignmentGrid(user, term.id),
    teacherWorkload(user, term.id),
    gapsReport(user, term.id),
    listGroups(user, term.id),
    manage || can('academics.assignments.approve') ? assignmentSet(user, term.id) : Promise.resolve(null),
    listAssignments(user, { termId: term.id }),
    manage ? db.user.findMany({ where: { active: true, isSupport: false, userRoles: { some: { role: { key: 'TEACHER' } } } }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } }) : Promise.resolve([]),
    db.subject.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, levels: { select: { levelId: true, type: true } } } }),
    db.level.findMany({ where: { active: true }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      <AssignmentsClient
        term={grid.term} grid={grid} workload={workload} gaps={gaps} groups={groups.groups} set={set}
        assignments={list.assignments.map((a) => ({ id: a.id, teacherId: a.teacherId, coTeacherId: a.coTeacherId, periodsPerWeek: a.periodsPerWeek, doublesPerWeek: a.doublesPerWeek, subjectId: a.subjectId, classId: a.classId, groupId: a.groupId, target: a.target, subjectName: a.subjectName, teacherName: a.teacherName, approved: a.approved }))}
        teachers={teachers} subjects={subjects.map((s) => ({ id: s.id, name: s.name, electiveLevelIds: s.levels.filter((l) => l.type === 'ELECTIVE').map((l) => l.levelId) }))} levels={levels}
        flags={{ manage, approve: can('academics.assignments.approve') }}
      />
    </div>
  );
}
