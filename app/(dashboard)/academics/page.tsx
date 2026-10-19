import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata = { title: 'Academics · Pfuma' };

// The front page of Academics: only the doors the person may open.
export default async function AcademicsHome() {
  const { can } = await getAccess();
  const doors = [
    { href: '/academics/classes', title: 'Classes', text: 'Class teachers, class lists, subjects and gaps.', show: can('academics.classes.view') },
    { href: '/academics/subjects', title: 'Subjects', text: 'The school\'s subjects, departments and combinations.', show: can('academics.subjects.view') },
    { href: '/academics/student-subjects', title: 'Student subjects', text: 'Which subjects each student takes.', show: can('academics.classes.view') },
    { href: '/academics/assignments', title: 'Teacher assignments', text: 'Who teaches what, workload and gaps.', show: can('academics.assignments.view') },
    { href: '/academics/attendance', title: 'Attendance', text: 'Mark the register, see who is absent.', show: can('academics.attendance.mark') || can('academics.attendance.view') },
    { href: '/academics/timetable', title: 'Timetable', text: 'The week, My day and cover lessons.', show: can('academics.timetable.view') },
    { href: '/academics/schemes', title: 'Schemes of work', text: 'Plans and records of work, week by week.', show: can('academics.schemes.view') },
    { href: '/academics/syllabus', title: 'Syllabus', text: 'Topics and learning objectives.', show: can('academics.schemes.view') || can('academics.syllabus.manage') },
    { href: '/academics/analytics', title: 'Analytics', text: 'Attendance, coverage and teaching load.', show: can('academics.analytics.view') },
    { href: '/academics/settings', title: 'Settings', text: 'Registers, alerts and limits.', show: can('academics.classes.view') },
  ].filter((d) => d.show);
  if (doors.length === 0) return <AccessDenied />;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Academics" description="Classes, subjects, teachers, attendance, the timetable, schemes of work and analytics." breadcrumbs={[{ label: 'Academics' }]} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {doors.map((d) => (
          <li key={d.href}><Link href={d.href} className="flex h-full min-h-[96px] flex-col justify-center rounded-2xl bg-white p-5 hover:ring-2 hover:ring-primary/30"><span className="text-base font-semibold text-ink">{d.title}</span><span className="mt-1 text-sm text-muted">{d.text}</span></Link></li>
        ))}
      </ul>
    </div>
  );
}
