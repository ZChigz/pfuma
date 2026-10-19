import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { todayInHarare } from '@/lib/academics/common';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { CoverClient } from '@/components/academics/CoverClient';

export const metadata = { title: 'Cover lessons · Pfuma' };

export default async function CoverPage() {
  const { user, can } = await getAccess();
  if (!can('academics.timetable.cover')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const teachers = await db.user.findMany({ where: { active: true, isSupport: false, userRoles: { some: { role: { key: 'TEACHER' } } } }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } });
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Cover lessons" description="When a teacher is absent, give each of their lessons to a free teacher." breadcrumbs={[{ label: 'Academics' }, { label: 'Timetable', href: '/academics/timetable' }, { label: 'Cover lessons' }]} />
      <CoverClient teachers={teachers} today={todayInHarare()} />
    </div>
  );
}
