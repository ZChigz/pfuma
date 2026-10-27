import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { SESSION_LABEL, rollCallStatus } from '@/lib/facilities/hostel';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Section } from '@/components/finance/shared';
import { HostelNav } from '@/components/facilities/HostelNav';

export const metadata = { title: 'Roll call · Pfuma' };

export default async function RollCallPage() {
  const { user, can } = await getAccess();
  if (!can('facilities.hostel.rollcall') && !can('facilities.hostel.view')) return <AccessDenied />;
  const status = await rollCallStatus(user);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Roll call" description="Pick the hostel and the session. Everyone starts Present: tap only the exceptions." />
      <HostelNav can={can} current="/facilities/hostel/rollcall" />
      {status.length === 0 && <p className="text-sm text-muted">No hostel to call the roll for.</p>}
      {status.map((h) => (
        <Section key={h.hostelId} title={h.hostel}>
          <div className="grid gap-2 sm:grid-cols-3">{h.sessions.map((s) => (
            <Link key={s.session} href={`/facilities/hostel/rollcall/${h.hostelId}?session=${s.session}`} className="flex min-h-[64px] items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 hover:bg-tint">
              <span className="text-base font-semibold text-ink">{SESSION_LABEL[s.session as keyof typeof SESSION_LABEL]}</span>
              <Badge variant={s.taken ? 'success' : 'warning'} label={s.taken ? `${s.absent} absent, ${s.late} late` : 'Not taken'} />
            </Link>
          ))}</div>
        </Section>
      ))}
    </div>
  );
}
