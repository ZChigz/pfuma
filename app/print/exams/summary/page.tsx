import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { ServiceError } from '@/lib/api';
import { resultsSummary } from '@/lib/exams/analytics';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PrintBar } from '@/components/academics/PrintBar';

export const metadata = { title: 'Results summary · Pfuma' };

// The one-page results summary for staff and board meetings.
export default async function PrintResultsSummary({ searchParams }: { searchParams: { source?: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.analytics.view')) return <AccessDenied />;
  const { term } = await getViewTerm(user.schoolId, getScopedDb(user.schoolId, user.id));
  if (!term) notFound();
  try {
    const s = await resultsSummary(user, { termId: term.id, source: searchParams.source === 'verified' ? 'verified' : 'published' });
    return (
      <article className="mx-auto max-w-[190mm] text-[11px]">
        <PrintBar title="Results summary" />
        <header className="mb-3 border-b border-ink pb-2">
          <p className="text-lg font-bold">{s.school}</p>
          <h1 className="text-xl font-bold">Results summary: {s.term}</h1>
          <p className={s.label === 'Published results' ? 'text-sm' : 'text-sm font-bold text-danger'}>{s.label}</p>
        </header>
        {s.panels.map((p) => (
          <section key={p.panel} className="mb-4 break-inside-avoid">
            <h2 className="mb-1 text-sm font-bold">{p.title}</h2>
            <table className="w-full border-collapse">
              <thead><tr className="border-b-2 border-ink text-left">{p.columns.slice(0, 9).map((c) => <th key={c} className="py-0.5 pr-2">{c}</th>)}</tr></thead>
              <tbody>{p.rows.slice(0, p.panel === 'top' ? 30 : 24).map((r, i) => <tr key={i} className="border-b border-line">{r.slice(0, 9).map((c, j) => <td key={j} className="py-0.5 pr-2 tabular-nums">{c ?? ''}</td>)}</tr>)}</tbody>
            </table>
          </section>
        ))}
        <p className="mt-2 text-[10px] text-muted">Printed from Pfuma. Pass rate counts results at or above the pass grade.</p>
      </article>
    );
  } catch (err) {
    if (err instanceof ServiceError && err.status === 403) return <AccessDenied />;
    throw err;
  }
}
