import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { listCalendar } from '@/lib/system/calendar';
import { isIsoDate, viewRange, type CalendarView } from '@/lib/system/calendar-grid';
import { KIND_ORDER } from '@/lib/system/calendar-types';
import { getViewTerm } from '@/lib/system/view-term';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { CalendarClient } from '@/components/system/CalendarClient';

export const metadata = { title: 'Calendar · Pfuma' };

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CalendarPage({ searchParams }: { searchParams: SP }) {
  const { user, can } = await getAccess();
  if (!can('system.calendar.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);

  const today = new Date().toISOString().slice(0, 10);
  const viewParam = first(searchParams.view);
  const view: CalendarView = viewParam === 'week' || viewParam === 'list' ? viewParam : 'month';
  const dateParam = first(searchParams.date);
  const date = isIsoDate(dateParam) ? dateParam : today;
  const typeParam = first(searchParams.type);
  const type = KIND_ORDER.includes(typeParam as never) ? (typeParam as (typeof KIND_ORDER)[number]) : undefined;

  const { from, to } = viewRange(view, date);
  const [items, levels, classes, { term }] = await Promise.all([
    listCalendar(db, user, from, to, { type: type as never }),
    db.level.findMany({ where: { schoolId: user.schoolId }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
    db.schoolClass.findMany({ where: { schoolId: user.schoolId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    getViewTerm(user.schoolId, db),
  ]);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="Calendar"
        description="Term dates, public holidays and school events in one place"
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Calendar' }]}
      />
      <CalendarClient
        view={view}
        date={date}
        today={today}
        type={type ?? ''}
        items={items}
        levels={levels}
        classes={classes}
        pdfTermId={term?.id ?? null}
        canCreate={can('system.calendar.create')}
        canUpdate={can('system.calendar.edit')}
        canDelete={can('system.calendar.delete')}
        canExport={can('system.calendar.export')}
      />
    </div>
  );
}
