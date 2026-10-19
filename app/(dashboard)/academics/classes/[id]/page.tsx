import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { classAttendanceSummary } from '@/lib/academics/attendance';
import { classHeader, classStudents, classSubjectTeachers } from '@/lib/academics/classes';
import { loadSettings } from '@/lib/academics/common';
import { timetableView } from '@/lib/academics/timetable';
import { getViewTerm } from '@/lib/system/view-term';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { ClassDetailClient } from '@/components/academics/ClassDetailClient';
import { ClosedNotice } from '@/components/academics/shared';

export const metadata = { title: 'Class · Pfuma' };

export default async function ClassDetailPage({ params }: { params: { id: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.classes.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  if (!term) notFound();
  try {
    const header = await classHeader(user, params.id, term.id);
    const [students, subjects, week, attendance, settings] = await Promise.all([
      classStudents(user, params.id, term.id),
      classSubjectTeachers(user, params.id, term.id),
      can('academics.timetable.view') ? timetableView(user, { termId: term.id, view: 'class', id: params.id }) : Promise.resolve(null),
      can('academics.attendance.view') ? classAttendanceSummary(user, params.id, term.id).catch(() => null) : Promise.resolve(null),
      db.$tx((tx) => loadSettings(tx, user.schoolId)),
    ]);
    return (
      <div className="flex flex-col gap-4 pb-8">
        <PageHeader
          title={header.name}
          description={`${header.term.name} · ${header.students} students (${header.boys} boys, ${header.girls} girls) · capacity ${header.capacity} · class teacher: ${header.classTeacher ?? 'none yet'}`}
          breadcrumbs={[{ label: 'Academics' }, { label: 'Classes', href: '/academics/classes' }, { label: header.name }]}
        />
        {header.term.status === 'CLOSED' && <ClosedNotice termName={header.term.name} />}
        <ClassDetailClient
          classId={params.id}
          students={students.students}
          subjects={subjects.rows}
          gaps={subjects.gaps}
          week={week ? { days: week.days, cells: week.cells, timetable: week.timetable } : null}
          attendance={attendance}
          threshold={settings.attendanceThresholdPct}
          canPrint
        />
      </div>
    );
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  }
}
