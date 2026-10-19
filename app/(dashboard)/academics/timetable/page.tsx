import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { isFull, reachableClassIds } from '@/lib/academics/common';
import { timetableState } from '@/lib/academics/timetable';
import { lessonSuspensions } from '@/lib/exams/timetable';
import { getViewTerm } from '@/lib/system/view-term';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { TimetableClient } from '@/components/academics/TimetableClient';
import { linkButton } from '@/components/academics/shared';

export const metadata = { title: 'Timetable · Pfuma' };

export default async function TimetablePage() {
  const { user, can } = await getAccess();
  if (!can('academics.timetable.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const edit = can('academics.timetable.edit');
  const approve = can('academics.timetable.approve');
  const seesAll = isFull(user) || edit || approve;
  const header = (
    <PageHeader
      title="Timetable" description="Build the week from the teacher assignments. The system refuses clashes, so a published timetable can always be taught."
      breadcrumbs={[{ label: 'Academics' }, { label: 'Timetable' }]}
      actions={
        <>
          <Link href="/academics/timetable/my-day" className={linkButton}>My day</Link>
          {can('academics.timetable.cover') && <Link href="/academics/timetable/cover" className={linkButton}>Cover lessons</Link>}
          {edit && <Link href="/academics/timetable/setup" className={linkButton}>Periods and rooms</Link>}
        </>
      }
    />
  );
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" description="Set up an academic year and its terms in School Settings first." cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;

  const reach = await db.$tx((tx) => reachableClassIds(tx, user, term.id));
  const [state, classes, teachers, rooms] = await Promise.all([
    timetableState(user, term.id),
    db.schoolClass.findMany({ where: { active: true, level: { active: true }, ...(reach === 'all' ? {} : { id: { in: reach } }) }, orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }], select: { id: true, name: true } }),
    seesAll ? db.user.findMany({ where: { active: true, isSupport: false, userRoles: { some: { role: { key: 'TEACHER' } } } }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } }) : Promise.resolve([{ id: user.id, fullName: user.fullName }]),
    seesAll ? db.room.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const kind = seesAll ? 'class' : 'teacher';
  // Normal lessons are suspended for the forms that sit an approved exam period, on its days (Examinations).
  const suspended = await db.$tx((tx) => lessonSuspensions(tx, user.schoolId, term.id));
  const levelNames = new Map((await db.level.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]));
  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      {suspended.map((p) => (
        <div key={p.name} role="status" className="rounded-xl border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn">
          <strong>{p.name}:</strong> lessons are suspended for {p.levelIds.map((id) => levelNames.get(id) ?? '').filter(Boolean).join(', ')} from {p.startDate} to {p.endDate}{p.days.length ? ` (exam days: ${p.days.join(', ')})` : ''}.
        </div>
      ))}
      <TimetableClient
        termId={term.id} state={state} classes={classes} teachers={teachers} rooms={rooms} myId={user.id}
        initialKind={kind} initialId={kind === 'class' ? classes[0]?.id ?? null : user.id} flags={{ edit, approve, seesAll }}
      />
    </div>
  );
}
