import Link from 'next/link';
import { getHrAccess as getAccess } from '@/lib/hr/access';
import { coverList, dailySummary, getRegister, monthlyAttendance } from '@/lib/hr/attendance';
import { todayInHarare } from '@/lib/hr/common';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Notice, Section, Td, Th } from '@/components/finance/shared';
import { HrNav } from '@/components/hr/HrNav';
import { RegisterForm } from '@/components/hr/RegisterForm';

export const metadata = { title: 'Staff attendance · Pfuma' };

export default async function AttendancePage({ searchParams }: { searchParams: { date?: string } }) {
  const { user, can } = await getAccess();
  if (!can('hr.attendance.mark') && !can('hr.attendance.view')) return <AccessDenied />;
  const today = todayInHarare();
  const date = searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date) ? searchParams.date : today;
  const [reg, sum, cover, month] = await Promise.all([
    getRegister(user, date), dailySummary(user, date), can('hr.attendance.view') || can('hr.duties.manage') ? coverList(user, date).catch(() => null) : null,
    can('hr.attendance.view') ? monthlyAttendance(user, date.slice(0, 7)) : null,
  ]);
  const markable = can('hr.attendance.mark') && date <= today && (date === today || can('hr.attendance.correct'));
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Staff attendance" description="Who is in, who is late and who is away. Everyone starts as present: tap the exceptions." />
      <HrNav can={can} current="/hr/attendance" />
      <form className="flex items-center gap-2" method="get"><input type="date" name="date" defaultValue={date} max={today} aria-label="Day" className="h-11 rounded-xl border border-line bg-white px-3 text-sm" /><button className="h-11 rounded-full bg-primary px-5 text-sm font-semibold text-white">Show</button></form>
      {!reg.working && <Notice tone="info">{reg.closedReason}</Notice>}
      {reg.working && (
        <Section title={`Register for ${date}`} hint={`${sum.total.PRESENT ?? 0} present · ${sum.total.LATE ?? 0} late · ${sum.total.ABSENT ?? 0} absent · ${(sum.total.ON_LEAVE ?? 0) + (sum.total.OFFICIAL_DUTY ?? 0)} away`}>
          {markable ? <RegisterForm date={date} past={date < today} rows={reg.rows} /> : (
            <table className="w-full"><thead><tr><Th>Name</Th><Th>Status</Th><Th>Arrived</Th></tr></thead><tbody>
              {reg.rows.map((r) => (<tr key={r.employeeId} className="border-t border-line"><Td>{r.name}</Td><Td>{r.status.toLowerCase().replace('_', ' ')}</Td><Td>{r.arrivalTime ?? ''}</Td></tr>))}
            </tbody></table>
          )}
        </Section>
      )}
      {cover && cover.absent.length > 0 && (
        <Section title="Cover list" hint="Teachers who are absent or on leave, and the lessons that need cover. Assign cover in Academics, Timetable.">
          <ul className="divide-y divide-line">{cover.absent.map((a) => (<li key={a.employeeId} className="py-2 text-sm"><b>{a.name}</b> · {a.status.toLowerCase().replace('_', ' ')} · <Link className="text-primary underline" href={`/academics/timetable?date=${date}&absent=${a.userId}`}>Arrange cover</Link></li>))}</ul>
        </Section>
      )}
      {month && (
        <Section title={`Attendance in ${date.slice(0, 7)}`} hint={`${month.workingDays} working days`}>
          <div className="overflow-x-auto"><table className="w-full min-w-[34rem]"><thead><tr><Th>Employee</Th><Th className="text-right">Days present</Th><Th className="text-right">Late</Th><Th className="text-right">Absent</Th><Th className="text-right">On leave</Th><Th className="text-right">Rate</Th></tr></thead><tbody>
            {month.rows.map((r) => (<tr key={r.employeeId} className="border-t border-line"><Td>{r.name}</Td><Td className="text-right">{r.daysPresent}</Td><Td className="text-right">{r.late}</Td><Td className="text-right">{r.absent}</Td><Td className="text-right">{r.onLeave}</Td><Td className="text-right">{r.rate ?? '—'}%</Td></tr>))}
          </tbody></table></div>
        </Section>
      )}
    </div>
  );
}
