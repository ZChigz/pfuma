import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { getScheme } from '@/lib/academics/curriculum';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PrintBar } from '@/components/academics/PrintBar';

export const metadata = { title: 'Scheme of work · Pfuma' };

// The familiar scheme-book layout on A4 landscape: week, topic and sub-topics, objectives, activities, resources, assessment, remarks.
export default async function PrintScheme({ searchParams }: { searchParams: { assignmentId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.schemes.view')) return <AccessDenied />;
  try {
    const d = await getScheme(user, searchParams.assignmentId ?? '');
    const school = await getScopedDb(user.schoolId, user.id).school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { name: true } });
    return (
      <article>
        <PrintBar title={`Scheme of work: ${d.assignment.subject}, ${d.assignment.target}`} landscape />
        <header className="mb-3 border-b border-ink pb-2">
          <p className="text-base font-bold">{school.name}</p>
          <h1 className="text-xl font-bold">Scheme of work — {d.assignment.subject}, {d.assignment.target}</h1>
          <p className="text-sm">Teacher: {d.assignment.teacher} · {d.assignment.termName}{d.scheme ? ` · ${d.scheme.status.toLowerCase()}` : ''}{d.coverage.pct !== null ? ` · coverage ${d.coverage.pct}%` : ''}</p>
        </header>
        <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr className="border-y-2 border-ink text-left">
              <th className="w-14 p-1">Week</th><th className="w-48 p-1">Topic and sub-topics</th><th className="p-1">Objectives</th><th className="p-1">Activities</th><th className="w-32 p-1">Resources</th><th className="w-28 p-1">Assessment</th><th className="w-40 p-1">Record of work</th>
            </tr>
          </thead>
          <tbody>
            {d.weeks.map((w) => (
              <tr key={w.id} className="border-b border-line align-top">
                <td className="p-1 font-semibold">{w.weekNo}<span className="block font-normal text-muted">{w.startDate.slice(5)}</span></td>
                <td className="p-1">{w.topics.map((t) => <span key={t.id} className="block">{t.parent ? `${t.parent} › ` : ''}{t.title}</span>)}</td>
                <td className="whitespace-pre-wrap p-1">{w.objectives}</td>
                <td className="whitespace-pre-wrap p-1">{w.activities}</td>
                <td className="whitespace-pre-wrap p-1">{w.resources}</td>
                <td className="whitespace-pre-wrap p-1">{w.assessment}</td>
                <td className="p-1">{w.record ? <>{w.topics.length ? `${w.record.coveredTopicIds.length} of ${w.topics.length} covered. ` : ''}{w.record.extraNotes}{w.record.problems ? ` Problems: ${w.record.problems}` : ''}</> : w.due ? 'Not recorded' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <footer className="mt-6 grid grid-cols-3 gap-8 text-xs"><p className="border-t border-ink pt-1">Teacher</p><p className="border-t border-ink pt-1">Head of department</p><p className="border-t border-ink pt-1">Head</p></footer>
      </article>
    );
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  }
}
