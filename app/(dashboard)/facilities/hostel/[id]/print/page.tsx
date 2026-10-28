import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { roomList } from '@/lib/facilities/hostel';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { PrintButton, Td, Th } from '@/components/finance/shared';

export const metadata = { title: 'Room list · Pfuma' };

/** The room list to print and put on the notice board: room, bed, learner, class, guardian phone. */
export default async function RoomListPage({ params }: { params: { id: string } }) {
  const { user, can } = await getAccess();
  if (!can('facilities.hostel.view') || !can('students.guardians.view')) return <AccessDenied />;
  const data = await roomList(user, params.id).catch((e) => { if (e instanceof ServiceError && (e.status === 404 || e.status === 403)) return null; throw e; });
  if (!data) notFound();
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={`${data.hostel.name}: room list`} description={`${data.rows.length} boarders`} actions={<div className="print:hidden"><PrintButton label="Print" /></div>} />
      <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-sm"><thead><tr><Th>Room</Th><Th>Bed</Th><Th>Learner</Th><Th>Class</Th><Th>Guardian</Th><Th>Phone</Th></tr></thead><tbody>
        {data.rows.map((r) => <tr key={`${r.room}-${r.bed}`} className="border-t border-line"><Td>{r.room}</Td><Td>{r.bed}</Td><Td>{r.learner}<div className="text-xs text-muted">{r.admissionNumber}</div></Td><Td>{r.className ?? '—'}</Td><Td>{r.guardian ?? '—'}</Td><Td>{r.guardianPhone ?? '—'}</Td></tr>)}
      </tbody></table></div>
    </div>
  );
}
