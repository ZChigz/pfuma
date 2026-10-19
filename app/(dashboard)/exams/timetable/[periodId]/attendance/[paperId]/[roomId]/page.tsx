import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { attendanceSheet } from '@/lib/exams/invigilation';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { AttendanceClient } from '@/components/exams/AttendanceClient';

export const metadata = { title: 'Exam attendance · Pfuma' };

export default async function ExamAttendancePage({ params }: { params: { periodId: string; paperId: string; roomId: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.marks.enter') && !can('exams.invigilation.manage') && !can('exams.timetable.manage') && !can('exams.timetable.approve')) return <AccessDenied />;
  try {
    const sheet = await attendanceSheet(user, params.paperId, params.roomId);
    return (
      <div className="flex flex-col gap-4 pb-8">
        <PageHeader
          title={`${sheet.paper}: ${sheet.room}`} description={`${sheet.date}, ${sheet.session.toLowerCase()}. Mark who sat the paper. A student marked absent gets AB on this paper automatically.`}
          breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'Timetable', href: '/exams/timetable' }, { label: 'Period', href: `/exams/timetable/${params.periodId}` }, { label: 'Attendance' }]}
          actions={<a className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary hover:bg-tint" href={`/print/exams/attendance?paperId=${params.paperId}&roomId=${params.roomId}`} target="_blank" rel="noreferrer">Print sheet</a>}
        />
        <AttendanceClient sheet={sheet} />
      </div>
    );
  } catch (err) {
    if (err instanceof ServiceError) return <EmptyState title="This sheet is not available" description={err.message} cta={{ label: 'Exam timetable', href: '/exams/timetable' }} />;
    throw err;
  }
}
