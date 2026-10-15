import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { listCalendar } from '@/lib/system/calendar';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { CalendarClient } from '@/components/system/CalendarClient';

export const metadata = { title: 'Calendar · Pfuma' };

export default async function CalendarPage({ searchParams }: { searchParams: { year?: string } }) {
  const { user, can } = await getAccess();
  if (!can('system.calendar.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);

  const wanted = Number(searchParams.year);
  const year = Number.isInteger(wanted) && wanted >= 2000 && wanted <= 2100 ? wanted : new Date().getUTCFullYear();
  const items = await listCalendar(db, user.schoolId, `${year}-01-01`, `${year}-12-31`);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="Calendar"
        description="Terms, holidays, exams and school events"
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Calendar' }]}
      />
      <CalendarClient
        year={year}
        items={items}
        canCreate={can('system.calendar.create')}
        canUpdate={can('system.calendar.update')}
        canDelete={can('system.calendar.delete')}
      />
    </div>
  );
}
