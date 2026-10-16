'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { defaultTermDates } from '@/lib/academic/rules';
import { rangeText } from '@/lib/system/calendar-types';

export interface TermRow { id: string; name: string; termNumber: number; startDate: string; endDate: string; status: 'PLANNED' | 'OPEN' | 'CLOSED' }
export interface YearRow { id: string; year: number; terms: TermRow[] }

interface Props {
  years: YearRow[];
  // From can() on the server.
  canCreate: boolean;
  canUpdate: boolean;
  canOpen: boolean;
  canClose: boolean;
}

const STATUS = { PLANNED: { label: 'Planned', variant: 'neutral' }, OPEN: { label: 'Open', variant: 'success' }, CLOSED: { label: 'Closed', variant: 'warning' } } as const;

type Dates = { startDate: string; endDate: string };

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}
const firstError = (json: { errors?: Record<string, string[]>; message?: string }, fallback: string) =>
  json.errors ? Object.values(json.errors).flat()[0] : json.message ?? fallback;

export function AcademicTab({ years, canCreate, canUpdate, canOpen, canClose }: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [year, setYear] = useState(String(new Date().getUTCFullYear() + 1));
  const [terms, setTerms] = useState<Dates[]>(() => defaultTerms(new Date().getUTCFullYear() + 1));
  const [editing, setEditing] = useState<TermRow | null>(null);
  const [editDates, setEditDates] = useState<Dates>({ startDate: '', endDate: '' });
  const [confirm, setConfirm] = useState<{ kind: 'open' | 'close'; term: TermRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  function openAdd() {
    const next = (years[0]?.year ?? new Date().getUTCFullYear()) + 1;
    setYear(String(next));
    setTerms(defaultTerms(next));
    setProblem('');
    setAdding(true);
  }

  async function addYear() {
    setBusy(true);
    setProblem('');
    try {
      const { ok, json } = await send('/api/system/academic/years', 'POST', { year: Number(year), terms });
      if (!ok) { setProblem(firstError(json, 'Could not add the year')); return; }
      toast.success(`${year} added with its three terms`);
      setAdding(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveDates() {
    if (!editing) return;
    setBusy(true);
    setProblem('');
    try {
      const { ok, json } = await send(`/api/system/academic/terms/${editing.id}`, 'PATCH', editDates);
      if (!ok) { setProblem(firstError(json, 'Could not change the dates')); return; }
      toast.success(`${editing.name} dates saved`);
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      const { ok, json } = await send(`/api/system/academic/terms/${confirm.term.id}/${confirm.kind}`, 'POST');
      if (!ok) { toast.error(firstError(json, 'That did not work')); setConfirm(null); return; }
      toast.success(`${confirm.term.name} ${confirm.kind === 'open' ? 'is now open' : 'is closed'}`);
      setConfirm(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const anyOpen = years.some((y) => y.terms.some((t) => t.status === 'OPEN'));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-sm text-muted">Each year has three terms. Terms cannot overlap, and only one term is open at a time.</p>
        {canCreate && <Button onClick={openAdd}>Add year</Button>}
      </div>

      {years.length === 0 ? (
        <EmptyState title="No academic year yet" description="Add the year and its three terms to start the school's calendar." action={canCreate ? <Button onClick={openAdd}>Add year</Button> : undefined} />
      ) : (
        years.map((y) => (
          <Card key={y.id} title={String(y.year)} subtitle={`${y.terms.length} terms`}>
            <ul className="divide-y divide-line">
              {y.terms.map((t) => (
                <li key={t.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink">{t.name}</p>
                      <Badge variant={STATUS[t.status].variant} label={STATUS[t.status].label} />
                    </div>
                    <p className="text-sm text-muted">{rangeText(t.startDate, t.endDate)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {canUpdate && t.status !== 'CLOSED' && (
                      <button type="button" onClick={() => { setEditing(t); setEditDates({ startDate: t.startDate, endDate: t.endDate }); setProblem(''); }} className="min-h-[44px] rounded-lg px-3 text-xs font-semibold text-primary hover:bg-tint">
                        Edit dates
                      </button>
                    )}
                    {canOpen && t.status === 'PLANNED' && (
                      <Button size="sm" variant="secondary" disabled={anyOpen} title={anyOpen ? 'Close the open term first' : undefined} onClick={() => setConfirm({ kind: 'open', term: t })}>
                        Open term
                      </Button>
                    )}
                    {canClose && t.status === 'OPEN' && (
                      <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: 'close', term: t })}>Close term</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}

      <Drawer
        open={adding}
        onClose={() => setAdding(false)}
        title="Add academic year"
        footer={<><Button variant="secondary" onClick={() => setAdding(false)} disabled={busy}>Cancel</Button><Button onClick={addYear} loading={busy}>Add year</Button></>}
      >
        <div className="flex flex-col gap-4">
          <Input
            id="y-year" label="Year" type="number" inputMode="numeric" required value={year}
            onChange={(e) => { setYear(e.target.value); const n = Number(e.target.value); if (n >= 2000 && n <= 2100) setTerms(defaultTerms(n)); }}
          />
          {terms.map((t, i) => (
            <fieldset key={i} className="rounded-xl border border-line p-3">
              <legend className="px-1 text-sm font-medium text-ink">Term {i + 1}</legend>
              <div className="grid grid-cols-2 gap-3">
                <Input id={`y-s${i}`} label="Starts" type="date" required value={t.startDate} onChange={(e) => setTerms((all) => all.map((x, j) => (j === i ? { ...x, startDate: e.target.value } : x)))} />
                <Input id={`y-e${i}`} label="Ends" type="date" required value={t.endDate} onChange={(e) => setTerms((all) => all.map((x, j) => (j === i ? { ...x, endDate: e.target.value } : x)))} />
              </div>
            </fieldset>
          ))}
          {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
        </div>
      </Drawer>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `${editing.name}: dates` : ''}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button><Button onClick={saveDates} loading={busy}>Save dates</Button></>}
      >
        <div className="grid grid-cols-2 gap-3">
          <Input id="t-s" label="Starts" type="date" required value={editDates.startDate} onChange={(e) => setEditDates((d) => ({ ...d, startDate: e.target.value }))} />
          <Input id="t-e" label="Ends" type="date" required value={editDates.endDate} onChange={(e) => setEditDates((d) => ({ ...d, endDate: e.target.value }))} />
        </div>
        {problem && <p role="alert" className="mt-3 text-sm text-danger">{problem}</p>}
      </Drawer>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'open' ? `Open ${confirm.term.name}?` : `Close ${confirm?.term.name ?? ''}?`}
        confirmLabel={confirm?.kind === 'open' ? 'Open term' : 'Close term'}
        destructive={confirm?.kind === 'close'}
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={runConfirm}
      >
        {confirm?.kind === 'open'
          ? 'It becomes the term the whole school works in: marks, fees and the calendar follow it. Only one term can be open at a time.'
          : 'Marks and results for this term are locked. Only a director can reopen it afterwards.'}
      </ConfirmDialog>
    </div>
  );
}

function defaultTerms(year: number): Dates[] {
  return [1, 2, 3].map((n) => defaultTermDates(year, n));
}
