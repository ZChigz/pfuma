'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { EmptyState } from '@/components/ui/EmptyState';
import { EXIT_REASON_LABEL } from '@/lib/students/rules';
import { api, fieldMessages, formatDay, problem, Section, StatusBadge, useBusy } from '@/components/students/shared';

const selectCls = 'min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

function useFilters() {
  const router = useRouter(); const pathname = usePathname(); const params = useSearchParams();
  return { params, go: (c: Record<string, string | null>) => { const n = new URLSearchParams(params.toString()); for (const [k, v] of Object.entries(c)) { if (v) n.set(k, v); else n.delete(k); } if (!('page' in c)) n.delete('page'); router.push(`${pathname}?${n.toString()}`, { scroll: false }); } };
}

export interface LeaverRow { exitId: string; studentId: string; fullName: string; admissionNumber: string; status: string; reason: string; lastDay: string; lastClass: string | null; destinationSchool: string | null; letters: { id: string; type: string; referenceNo: string | null }[] }

export function LeaversClient({ rows, total, page, pageSize, years, classes }: { rows: LeaverRow[]; total: number; page: number; pageSize: number; years: number[]; classes: { id: string; name: string }[] }) {
  const { params, go } = useFilters();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select aria-label="Year" value={params.get('year') ?? ''} onChange={(e) => go({ year: e.target.value || null })} className={selectCls}><option value="">All years</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <select aria-label="Reason" value={params.get('reason') ?? ''} onChange={(e) => go({ reason: e.target.value || null })} className={selectCls}><option value="">All reasons</option>{Object.entries(EXIT_REASON_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select aria-label="Last class" value={params.get('classId') ?? ''} onChange={(e) => go({ classId: e.target.value || null })} className={selectCls}><option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      {rows.length === 0 ? <EmptyState title="Nobody has left yet" description="Students who leave the school appear here with their letters." /> : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.exitId} className="rounded-2xl bg-white p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/students/${r.studentId}`} className="font-semibold text-primary hover:underline">{r.fullName}</Link>
                <span className="flex items-center gap-2"><StatusBadge status={r.status} /><span className="font-mono text-xs text-muted">{r.admissionNumber}</span></span>
              </div>
              <p className="mt-1 text-sm text-muted">{EXIT_REASON_LABEL[r.reason as keyof typeof EXIT_REASON_LABEL]} · last day {formatDay(r.lastDay)} · {r.lastClass ?? 'no class'}{r.destinationSchool ? ` · to ${r.destinationSchool}` : ''}</p>
              {r.letters.length > 0 && <p className="mt-1 flex flex-wrap gap-2 text-sm">{r.letters.map((l) => <a key={l.id} href={`/api/students/documents/${l.id}/pdf`} target="_blank" rel="noreferrer" className="font-semibold text-primary underline">{l.referenceNo}</a>)}</p>}
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && <div className="flex items-center justify-between"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>Previous</Button><span className="text-sm text-muted">Page {page} of {pages}</span><Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => go({ page: String(page + 1) })}>Next</Button></div>}
    </div>
  );
}

export interface AlumnusRowData { id: string; studentId: string; fullName: string; admissionNumber: string; yearLeft: number; lastClass: string | null; phone: string | null; email: string | null; destination: string | null; finalResult: { term: string; percentage: number; grade: string | null } | null }

export function AlumniClient({ rows, total, page, pageSize, years, canEdit, canExport }: { rows: AlumnusRowData[]; total: number; page: number; pageSize: number; years: number[]; canEdit: boolean; canExport: boolean }) {
  const { params, go } = useFilters();
  const router = useRouter();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [editing, setEditing] = useState<AlumnusRowData | null>(null);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const exportUrl = `/api/students/alumni/export?${new URLSearchParams([...(params.get('q') ? [['q', params.get('q')!]] : []), ...(params.get('year') ? [['year', params.get('year')!]] : [])]).toString()}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
        <form onSubmit={(e) => { e.preventDefault(); go({ q: q.trim().length >= 2 ? q.trim() : null }); }}><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, admission number or what they went on to" aria-label="Search alumni" className={selectCls} /></form>
        <select aria-label="Year left" value={params.get('year') ?? ''} onChange={(e) => go({ year: e.target.value || null })} className={selectCls}><option value="">All years</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        {canExport && <a href={exportUrl} className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-primary px-5 text-sm font-semibold text-primary hover:bg-tint">Export contact list</a>}
      </div>
      <p className="text-sm text-muted">{total} alumni</p>
      {rows.length === 0 ? <EmptyState title="No alumni yet" description="Students who complete O Level or A Level are added here automatically." /> : (
        <ul className="flex flex-col gap-2">
          {rows.map((a) => (
            <li key={a.id} className="rounded-2xl bg-white p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/students/${a.studentId}`} className="font-semibold text-primary hover:underline">{a.fullName}</Link>
                <span className="flex items-center gap-2"><Badge variant="info" label={`Left ${a.yearLeft}`} />{canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Update</Button>}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{a.lastClass ?? 'Last class not recorded'}{a.finalResult ? ` · final result ${a.finalResult.percentage}%${a.finalResult.grade ? ` (${a.finalResult.grade})` : ''}` : ''}</p>
              <p className="mt-0.5 text-sm text-ink">{[a.phone, a.email].filter(Boolean).join(' · ') || 'No contact details yet'}{a.destination ? ` · ${a.destination}` : ''}</p>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && <div className="flex items-center justify-between"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>Previous</Button><span className="text-sm text-muted">Page {page} of {pages}</span><Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => go({ page: String(page + 1) })}>Next</Button></div>}
      {editing && <EditAlumnus a={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); router.refresh(); }} />}
    </div>
  );
}

function EditAlumnus({ a, onClose, onDone }: { a: AlumnusRowData; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ phone: a.phone ?? '', email: a.email ?? '', destination: a.destination ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();
  async function submit() {
    const r = await run(() => api(`/api/students/alumni/${a.id}`, 'PATCH', { phone: f.phone || undefined, email: f.email || undefined, destination: f.destination || undefined }));
    if (!r) return;
    if (!r.ok) { setErrors({ ...fieldMessages(r), form: problem(r) }); return; }
    toast.success('Saved');
    onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Update ${a.fullName}`} size="sm" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <Input id="al-ph" type="tel" label="Current phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={errors.phone} />
        <Input id="al-em" type="email" label="Current email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={errors.email} />
        <Input id="al-de" label="What they went on to" hint="Further study or work (optional)" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} />
        {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      </div>
    </Modal>
  );
}
export { Section };
