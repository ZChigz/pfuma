'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface Term {
  id: string;
  name: string;
  termNumber: number;
  status: 'PLANNED' | 'OPEN' | 'CLOSED';
  startDate: string;
  endDate: string;
  students: number;
}

interface Year {
  id: string;
  year: number;
  startDate: string;
  endDate: string;
  terms: Term[];
}

const STATUS_VARIANT = { OPEN: 'success', PLANNED: 'neutral', CLOSED: 'info' } as const;

export function AcademicCalendar({ years }: { years: Year[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [newYearOpen, setNewYearOpen] = useState(false);
  const [newYear, setNewYear] = useState(String((years[0]?.year ?? new Date().getFullYear()) + 1));
  const [editing, setEditing] = useState<Term | null>(null);
  const [dates, setDates] = useState({ startDate: '', endDate: '' });
  const [confirm, setConfirm] = useState<{ term: Term; action: 'open' | 'close' } | null>(null);

  const openTerm = years.flatMap((y) => y.terms).find((t) => t.status === 'OPEN');

  async function call(url: string, init: RequestInit, success: string) {
    setBusy(true);
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Something went wrong');
        return false;
      }
      toast.success(success);
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function createYear() {
    const ok = await call('/api/admin/academic/years', { method: 'POST', body: JSON.stringify({ year: Number(newYear) }) }, `${newYear} created with Terms 1–3`);
    if (ok) setNewYearOpen(false);
  }

  async function saveDates() {
    if (!editing) return;
    const ok = await call(`/api/admin/academic/terms/${editing.id}`, { method: 'PATCH', body: JSON.stringify(dates) }, `${editing.name} dates saved`);
    if (ok) setEditing(null);
  }

  async function runConfirm() {
    if (!confirm) return;
    const ok = await call(`/api/admin/academic/terms/${confirm.term.id}?action=${confirm.action}`, { method: 'POST' },
      `${confirm.term.name} ${confirm.action === 'open' ? 'opened' : 'closed'}`);
    if (ok) setConfirm(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink">
          Current term: <span className="font-semibold">{openTerm?.name ?? 'none open'}</span>
        </p>
        <Button onClick={() => setNewYearOpen(true)}>+ New academic year</Button>
      </div>

      {years.length === 0 && (
        <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">No academic years yet.</p>
      )}

      {years.map((y) => (
        <section key={y.id} className="rounded-2xl bg-white p-5">
          <h2 className="mb-3 text-base font-semibold text-ink">{y.year} <span className="text-xs font-normal text-muted">({y.startDate} to {y.endDate})</span></h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-ink">
              <thead className="border-b border-line">
                <tr>
                  {['Term', 'Dates', 'Status', 'Students', ''].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-xs font-medium text-subtle">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {y.terms.map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2.5 font-medium">{t.name}</td>
                    <td className="px-3 py-2.5 text-muted">{t.startDate} → {t.endDate}</td>
                    <td className="px-3 py-2.5"><Badge label={t.status.charAt(0) + t.status.slice(1).toLowerCase()} variant={STATUS_VARIANT[t.status]} /></td>
                    <td className="px-3 py-2.5 tabular-nums">{t.students}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-2">
                        {t.status !== 'CLOSED' && (
                          <Button size="sm" variant="ghost" onClick={() => { setDates({ startDate: t.startDate, endDate: t.endDate }); setEditing(t); }}>
                            Edit dates
                          </Button>
                        )}
                        {t.status === 'PLANNED' && (
                          <Button size="sm" variant="secondary" disabled={!!openTerm} onClick={() => setConfirm({ term: t, action: 'open' })}
                            title={openTerm ? `Close ${openTerm.name} first` : undefined}>
                            Open
                          </Button>
                        )}
                        {t.status === 'OPEN' && (
                          <Button size="sm" variant="danger" onClick={() => setConfirm({ term: t, action: 'close' })}>Close</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <Modal
        open={newYearOpen}
        onClose={() => setNewYearOpen(false)}
        title="New academic year"
        footer={<><Button variant="secondary" onClick={() => setNewYearOpen(false)} disabled={busy}>Cancel</Button><Button onClick={createYear} loading={busy}>Create</Button></>}
      >
        <div className="flex flex-col gap-3">
          <Input id="newYear" label="Year" type="number" min={2000} max={2100} value={newYear} onChange={(e) => setNewYear(e.target.value)} />
          <p className="text-xs text-muted">Creates Terms 1–3 as planned terms with default dates (Jan–Apr, May–Aug, Sep–Dec). You can change the dates afterwards.</p>
        </div>
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Dates for ${editing.name}` : ''}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button><Button onClick={saveDates} loading={busy}>Save</Button></>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input id="termStart" label="Start date" type="date" value={dates.startDate} onChange={(e) => setDates((d) => ({ ...d, startDate: e.target.value }))} />
          <Input id="termEnd" label="End date" type="date" value={dates.endDate} onChange={(e) => setDates((d) => ({ ...d, endDate: e.target.value }))} />
        </div>
      </Modal>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm ? `${confirm.action === 'open' ? 'Open' : 'Close'} ${confirm.term.name}?` : ''}
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button><Button variant={confirm?.action === 'close' ? 'danger' : 'primary'} onClick={runConfirm} loading={busy}>{confirm?.action === 'open' ? 'Open term' : 'Close term'}</Button></>}
      >
        {confirm?.action === 'open' ? (
          <p className="text-sm text-muted">
            Students still active in the previous term are carried into the same class. For Term 1 of a new year, every student must first be promoted, kept back, graduated or withdrawn on the Promotions page.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Closing ends the term: marks can no longer be entered for it and it cannot be reopened. Until you open the next term, admissions and class moves are paused.
          </p>
        )}
      </Modal>
    </div>
  );
}
