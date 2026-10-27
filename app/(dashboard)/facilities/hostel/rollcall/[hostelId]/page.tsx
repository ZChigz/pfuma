import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { SESSIONS, SESSION_LABEL, rollCallSheet } from '@/lib/facilities/hostel';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { RollCallClient } from '@/components/facilities/RollCallClient';

export const metadata = { title: 'Roll call · Pfuma' };

export default async function HostelRollCallPage({ params, searchParams }: { params: { hostelId: string }; searchParams: { session?: string; date?: string } }) {
  const { user, can } = await getAccess();
  if (!can('facilities.hostel.rollcall') && !can('facilities.hostel.view')) return <AccessDenied />;
  const session = (SESSIONS as readonly string[]).includes(searchParams.session ?? '') ? (searchParams.session as (typeof SESSIONS)[number]) : 'EVENING';
  const sheet = await rollCallSheet(user, { hostelId: params.hostelId, date: searchParams.date, session }).catch((e) => { if ((e instanceof ServiceError && (e.status === 404 || e.status === 403)) || (e as Error).name === 'ZodError') return null; throw e; });
  if (!sheet) notFound();
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={`${sheet.hostel.name}: ${SESSION_LABEL[session]}`} description={sheet.date} breadcrumbs={[{ label: 'Roll call', href: '/facilities/hostel/rollcall' }, { label: sheet.hostel.name }]} />
      <div className="flex gap-2 overflow-x-auto">{SESSIONS.filter((s) => sheet.sessions.includes(s)).map((s) => (
        <Link key={s} href={`/facilities/hostel/rollcall/${sheet.hostel.id}?session=${s}`} className={`inline-flex min-h-[44px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${s === session ? 'bg-primary text-white' : 'bg-white text-muted'}`}>{SESSION_LABEL[s]}</Link>
      ))}</div>
      <RollCallClient sheet={sheet} editable={can('facilities.hostel.rollcall')} />
    </div>
  );
}
