import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getLessonPlan } from '@/lib/academics/curriculum';
import { loadSettings, todayInHarare } from '@/lib/academics/common';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { LessonPlanClient } from '@/components/academics/LessonPlanClient';

export const metadata = { title: 'Lesson plan · Pfuma' };

// An optional page (school setting): objectives, introduction, development, conclusion and evaluation for one lesson.
export default async function LessonPlanPage({ searchParams }: { searchParams: { slotId?: string; date?: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.schemes.edit') && !can('academics.schemes.view')) return <AccessDenied />;
  const settings = await getScopedDb(user.schoolId, user.id).$tx((tx) => loadSettings(tx, user.schoolId));
  const header = <PageHeader title="Lesson plan" description="One simple form for each lesson." breadcrumbs={[{ label: 'Academics' }, { label: 'Timetable', href: '/academics/timetable' }, { label: 'Lesson plan' }]} />;
  if (!settings.lessonPlans) return <div className="flex flex-col gap-4">{header}<EmptyState title="Lesson plans are switched off" description="An administrator can switch them on in Academics settings." /></div>;
  if (!searchParams.slotId) return <div className="flex flex-col gap-4">{header}<EmptyState title="Choose a lesson" description="Open a lesson from My day." cta={{ label: 'My day', href: '/academics/timetable/my-day' }} /></div>;
  const date = searchParams.date ?? todayInHarare();
  const plan = await getLessonPlan(user, searchParams.slotId, date).catch(() => null);
  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      <LessonPlanClient slotId={searchParams.slotId} date={date} plan={plan?.content ?? null} canEdit={can('academics.schemes.edit')} />
    </div>
  );
}
