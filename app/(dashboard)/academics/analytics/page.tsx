import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { analytics } from '@/lib/academics/analytics';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { AnalyticsClient } from '@/components/academics/AnalyticsClient';

export const metadata = { title: 'Academic analytics · Pfuma' };

export default async function AnalyticsPage({ searchParams }: { searchParams: { formId?: string; classId?: string; departmentId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.analytics.view')) return <AccessDenied />;
  const { term } = await getViewTerm(user.schoolId, getScopedDb(user.schoolId, user.id));
  const header = <PageHeader title="Academic analytics" description="Are students attending, are teachers covering the syllabus, and is the teaching load fair?" breadcrumbs={[{ label: 'Academics' }, { label: 'Analytics' }]} />;
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;
  try {
    const data = await analytics(user, { termId: term.id, formId: searchParams.formId, classId: searchParams.classId, departmentId: searchParams.departmentId });
    return <div className="flex flex-col gap-4 pb-8">{header}<AnalyticsClient data={data} canExport={can('academics.analytics.view')} query={searchParams} /></div>;
  } catch (err) {
    if (err instanceof ServiceError) return <div className="flex flex-col gap-4">{header}<EmptyState title="No analytics yet" description={err.message} /></div>;
    throw err;
  }
}
