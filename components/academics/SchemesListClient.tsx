'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { api, ClosedNotice, problem, Section, Td, Th } from '@/components/academics/shared';

interface Row { assignmentId: string; subject: string; target: string; teacher: string; department: string | null; departmentId: string | null; status: 'NONE' | 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED'; late: boolean; coverage: number | null; due: number }
const STATUS = { NONE: ['neutral', 'Not started'], DRAFT: ['warning', 'Draft'], SUBMITTED: ['info', 'Submitted'], APPROVED: ['success', 'Approved'], RETURNED: ['danger', 'Returned'] } as const;

export function SchemesListClient({ term, dueDate, rows, wide, departments, canSetDue, query }: {
  term: { id: string; name: string; status: string }; dueDate: string | null; rows: Row[]; wide: boolean; departments: { id: string; name: string }[]; canSetDue: boolean; query: { status?: string; departmentId?: string };
}) {
  const router = useRouter();
  const [due, setDue] = useState(dueDate ?? '');
  const [busy, setBusy] = useState(false);
  const late = rows.filter((r) => r.late);

  async function saveDue() {
    setBusy(true);
    const r = await api('/api/academics/schemes/due-date', 'POST', { termId: term.id, dueDate: due || null });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(due ? `Schemes are due on ${due}` : 'Due date cleared');
    router.refresh();
  }
  const go = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ ...(query.status ? { status: query.status } : {}), ...(query.departmentId ? { departmentId: query.departmentId } : {}), ...patch });
    for (const [k, v] of Array.from(q)) if (!v) q.delete(k);
    router.push(`?${q}`);
  };

  return (
    <div className="flex flex-col gap-4">
      {term.status === 'CLOSED' && <ClosedNotice termName={term.name} />}
      {canSetDue && term.status !== 'CLOSED' && (
        <Section title="When schemes are due" hint="Set by the Head, for example the end of week 1. The head of department sees who is late.">
          <div className="flex flex-wrap items-end gap-3"><div className="w-48"><Input id="due" type="date" label="Due date" value={due} onChange={(e) => setDue(e.target.value)} /></div><Button onClick={saveDue} loading={busy}>Save</Button></div>
        </Section>
      )}
      {wide && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-52"><Select id="f-status" label="Status" value={query.status ?? ''} onChange={(e) => go({ status: e.target.value })} placeholder="All" options={Object.entries(STATUS).map(([v, [, l]]) => ({ value: v, label: l }))} /></div>
          <div className="w-60"><Select id="f-dept" label="Department" value={query.departmentId ?? ''} onChange={(e) => go({ departmentId: e.target.value })} placeholder="All" options={departments.map((d) => ({ value: d.id, label: d.name }))} /></div>
          {late.length > 0 && <p className="pb-2 text-sm font-semibold text-danger">{late.length} late</p>}
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl bg-white">
        <table className="min-w-full divide-y divide-line">
          <caption className="sr-only">Schemes of work of {term.name}</caption>
          <thead><tr><Th>Subject</Th><Th>Class</Th>{wide && <Th>Teacher</Th>}{wide && <Th>Department</Th>}<Th>Status</Th><Th className="text-right">Coverage</Th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && <tr><Td className="py-8 text-center text-muted">No assignments to show. Schemes of work are written for each teacher assignment.</Td></tr>}
            {rows.map((r) => (
              <tr key={r.assignmentId} className="hover:bg-rowhover">
                <Td><Link href={`/academics/schemes/${r.assignmentId}`} className="font-semibold text-primary hover:underline">{r.subject}</Link></Td>
                <Td>{r.target}</Td>
                {wide && <Td>{r.teacher}</Td>}{wide && <Td className="text-muted">{r.department ?? '—'}</Td>}
                <Td><span className="flex items-center gap-2"><Badge variant={STATUS[r.status][0]} label={STATUS[r.status][1]} />{r.late && <Badge variant="danger" label="Late" />}</span></Td>
                <Td className="text-right tabular-nums">{r.coverage === null ? '—' : `${r.coverage}%`}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
