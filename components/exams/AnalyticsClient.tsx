'use client';

// The analytics panels. Pick a panel and the filters (term, exam or a single assessment, form, class, subject, gender); every panel
// exports to Excel as shown. The Head can switch to verified marks before publishing: the panel is then clearly labelled "Not yet published".
import { useCallback, useEffect, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Notice, Section, Tabs, Td, Th, api, fieldClass, labelClass, problem } from '@/components/exams/shared';
import { toast } from '@/components/ui/Toast';
import type { PanelKey, PanelResult } from '@/lib/exams/analytics';

const TITLE: Record<PanelKey, string> = { overview: 'Overview', subjects: 'Subjects', teachers: 'Teachers', grades: 'Grades', trend: 'Trend', top: 'Top students', atRisk: 'At risk', valueAdded: 'Value added', board: 'ZIMSEC results' };
const COLOURS = ['#14613f', '#2563eb', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#65a30d', '#be185d', '#475569', '#ca8a04', '#0f766e', '#7c3aed'];

export function AnalyticsClient({ panels, initial, termId, terms, levels, classes, subjects, assessments, canVerified }: {
  panels: PanelKey[]; initial: PanelResult; termId: string; terms: { id: string; name: string }[]; levels: { id: string; name: string }[]; classes: { id: string; name: string; levelId: string }[];
  subjects: { id: string; name: string }[]; assessments: { id: string; label: string }[]; canVerified: boolean;
}) {
  const [panel, setPanel] = useState<PanelKey>(panels[0]!);
  const [f, setF] = useState({ termId, levelId: '', classId: '', subjectId: '', gender: '', assessmentId: '', source: 'published' });
  const [data, setData] = useState<PanelResult>(initial);
  const [loading, setLoading] = useState(false);
  const [first, setFirst] = useState(true);

  const query = useCallback(() => {
    const q = new URLSearchParams({ panel });
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
    return q.toString();
  }, [panel, f]);

  useEffect(() => {
    if (first && panel === panels[0] && f.termId === termId && !f.levelId && !f.classId && !f.subjectId && !f.gender && !f.assessmentId && f.source === 'published') { setFirst(false); return; }
    setFirst(false);
    let live = true;
    setLoading(true);
    void api(`/api/exams/analytics?${query()}`).then((r) => {
      if (!live) return;
      setLoading(false);
      if (!r.ok) return toast.error(problem(r));
      setData(r.body.data as PanelResult);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, f]);

  const numericMax = data.columns.map((_, i) => Math.max(0, ...data.rows.map((r) => (typeof r[i] === 'number' ? (r[i] as number) : 0))));
  const barColumns = new Set(data.columns.map((c, i) => (/%|mean|average/i.test(c) && numericMax[i]! > 0 ? i : -1)).filter((i) => i >= 0));
  const classOptions = classes.filter((c) => !f.levelId || c.levelId === f.levelId);

  return (
    <div className="flex flex-col gap-4">
      <Tabs tabs={panels.map((p) => ({ id: p, label: TITLE[p] }))} value={panel} onChange={setPanel} label="Analytics panels" />
      <div className="grid gap-3 rounded-2xl bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5"><label htmlFor="an-term" className={labelClass}>Term</label><select id="an-term" className={fieldClass} value={f.termId} onChange={(e) => setF({ ...f, termId: e.target.value })}>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="an-exam" className={labelClass}>Exam</label><select id="an-exam" className={fieldClass} value={f.assessmentId} onChange={(e) => setF({ ...f, assessmentId: e.target.value })}><option value="">Term marks</option>{assessments.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="an-level" className={labelClass}>Form</label><select id="an-level" className={fieldClass} value={f.levelId} onChange={(e) => setF({ ...f, levelId: e.target.value, classId: '' })}><option value="">All forms</option>{levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="an-class" className={labelClass}>Class</label><select id="an-class" className={fieldClass} value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })}><option value="">All classes</option>{classOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="an-subj" className={labelClass}>Subject</label><select id="an-subj" className={fieldClass} value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })}><option value="">All subjects</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="an-gender" className={labelClass}>Gender</label><select id="an-gender" className={fieldClass} value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="">Everyone</option><option value="M">Boys</option><option value="F">Girls</option></select></div>
        {canVerified && <div className="flex flex-col gap-1.5"><label htmlFor="an-src" className={labelClass}>Results</label><select id="an-src" className={fieldClass} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="published">Published only</option><option value="verified">Verified marks (not yet published)</option></select></div>}
        <div className="flex items-end gap-2">
          <a className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-primary bg-white px-4 text-sm font-semibold text-primary hover:bg-tint" href={`/api/exams/analytics/export?${query()}`}>Export to Excel</a>
          <a className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-primary bg-white px-4 text-sm font-semibold text-primary hover:bg-tint" href={`/print/exams/summary${f.source === 'verified' ? '?source=verified' : ''}`} target="_blank" rel="noreferrer">Print summary</a>
        </div>
      </div>

      {data.notYetPublished && <Notice tone="danger"><strong>Not yet published.</strong> These are verified marks that have not been published. Do not share them.</Notice>}

      <Section title={`${data.title}: ${data.term}`} hint={data.label}>
        <div aria-busy={loading} className={loading ? 'opacity-50' : undefined}>
          {panel === 'trend' && data.series && data.series.length > 0 && (
            <div className="mb-4 h-72 w-full" role="img" aria-label="Line chart of the mean term mark in each term">
              <ResponsiveContainer>
                <LineChart data={data.rows.map((r) => Object.fromEntries(data.columns.map((c, i) => [c, r[i]])))} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e3e9e4" />
                  <XAxis dataKey="Term" tick={{ fontSize: 12 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 12 }} /><Tooltip /><Legend />
                  {data.series.map((s, i) => <Line key={s.name} type="monotone" dataKey={s.name} stroke={COLOURS[i % COLOURS.length]} strokeWidth={2} dot connectNulls />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {data.rows.length === 0 ? <p className="text-sm text-muted">Nothing to show for these filters.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead><tr>{data.columns.map((c) => <Th key={c}>{c}</Th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {data.rows.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, i) => (
                        <Td key={i} className={typeof c === 'number' ? 'tabular-nums' : undefined}>
                          {c === null ? <span className="text-muted">-</span> : c}
                          {barColumns.has(i) && typeof c === 'number' && numericMax[i]! > 0 && c >= 0 && <span className="mt-1 block h-1.5 w-24 overflow-hidden rounded-full bg-canvas" aria-hidden="true"><span className="block h-full bg-primary" style={{ width: `${Math.min(100, (c / Math.max(100, numericMax[i]!)) * 100)}%` }} /></span>}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.notes.length > 0 && <ul className="mt-3 flex flex-col gap-1 text-xs text-muted">{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>
      </Section>
    </div>
  );
}
