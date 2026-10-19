import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { analyticsPanel, panelsFor } from '@/lib/exams/analytics';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { AnalyticsClient } from '@/components/exams/AnalyticsClient';

export const metadata = { title: 'Examination analytics · Pfuma' };

export default async function AnalyticsPage() {
  const { user, can } = await getAccess();
  if (!can('exams.analytics.view')) return <AccessDenied />;
  const panels = panelsFor(user);
  if (panels.length === 0) return <AccessDenied message="No analytics panel is open to your role." />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const header = <PageHeader title="Examination analytics" description="Which subjects and classes are slipping, who needs help, and are we improving. Published results only." breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'Analytics' }]} />;
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" description="Set up an academic year and its terms in School Settings first." cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;
  const [first, terms, levels, classes, subjects, assessments] = await Promise.all([
    analyticsPanel(user, panels[0]!, { termId: term.id }),
    db.academicTerm.findMany({ orderBy: { startDate: 'desc' }, select: { id: true, name: true } }),
    db.level.findMany({ where: { active: true }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
    db.schoolClass.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, levelId: true } }),
    db.subject.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.assessment.findMany({ where: { termId: term.id }, orderBy: { title: 'asc' }, select: { id: true, title: true, subject: { select: { name: true } }, level: { select: { name: true } } }, take: 300 }),
  ]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      <AnalyticsClient
        panels={panels} initial={first} termId={term.id} terms={terms} levels={levels} classes={classes} subjects={subjects}
        assessments={assessments.map((a) => ({ id: a.id, label: `${a.title} (${a.subject.name}, ${a.level.name})` }))}
        canVerified={can('exams.results.publish') || (user.roles ?? []).includes('HEAD') || (user.grants ?? []).includes('*')}
      />
    </div>
  );
}
