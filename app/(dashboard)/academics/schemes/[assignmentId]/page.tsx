import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { getScheme } from '@/lib/academics/curriculum';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { SchemeClient } from '@/components/academics/SchemeClient';

export const metadata = { title: 'Scheme of work · Pfuma' };

export default async function SchemePage({ params }: { params: { assignmentId: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.schemes.view')) return <AccessDenied />;
  try {
    const data = await getScheme(user, params.assignmentId);
    return (
      <div className="flex flex-col gap-4 pb-8">
        <PageHeader
          title={`${data.assignment.subject} · ${data.assignment.target}`}
          description={`Scheme of work and record of work. ${data.assignment.teacher}, ${data.assignment.termName}.`}
          breadcrumbs={[{ label: 'Academics' }, { label: 'Schemes of work', href: '/academics/schemes' }, { label: `${data.assignment.shortName} ${data.assignment.target}` }]}
        />
        <SchemeClient key={`${data.scheme?.status}-${data.weeks.length}-${data.weeks.map((w) => w.record?.recordedAt ?? '').join('')}`} data={data} />
      </div>
    );
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  }
}
