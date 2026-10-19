'use client';

// Exam periods of the term, a form to start a new one, and the signed-in teacher's own invigilation duties.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { Notice, Section, api, fieldClass, labelClass, problem } from '@/components/exams/shared';
import type { Duty } from '@/lib/exams/invigilation';
import type { PeriodRow } from '@/lib/exams/timetable';

const VARIANT: Record<string, BadgeVariant> = { DRAFT: 'neutral', PENDING: 'warning', APPROVED: 'success' };
const LABEL: Record<string, string> = { DRAFT: 'Being written', PENDING: 'Waiting for the Deputy', APPROVED: 'Approved' };

export function PeriodsClient({ termId, termName, periods, duties, levels, types, canManage }: {
  termId: string; termName: string; periods: PeriodRow[]; duties: Duty[]; levels: { id: string; name: string }[]; types: { id: string; name: string }[]; canManage: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState({ name: '', startDate: '', endDate: '', typeId: types.find((t) => t.name === 'End-of-term exam')?.id ?? types[0]?.id ?? '', levelIds: [] as string[] });
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api('/api/exams/timetable/periods', 'POST', { termId, ...f });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Exam period created. Add its papers next.');
    router.push(`/exams/timetable/${(r.body.data as { id: string }).id}`);
  }

  return (
    <div className="flex flex-col gap-4">
      {duties.length > 0 && (
        <Section title="My invigilation duties" hint="Your duties in approved exam timetables.">
          <ul className="flex flex-col gap-2 text-sm">
            {duties.map((d) => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2"><span><strong>{d.paper}</strong> · {d.room}</span><span className="text-muted">{d.date}, {d.startTime} to {d.endTime}</span></li>)}
          </ul>
        </Section>
      )}
      <Section title={`Exam periods: ${termName}`}>
        {periods.length === 0 ? <p className="text-sm text-muted">No exam period yet.</p> : (
          <ul className="flex flex-col gap-3">
            {periods.map((p) => (
              <li key={p.id}>
                <Link href={`/exams/timetable/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-4 py-3 hover:ring-2 hover:ring-primary/30">
                  <div><div className="font-semibold text-ink">{p.name}</div><div className="text-sm text-muted">{p.startDate} to {p.endDate} · {p.levels.map((l) => l.name).join(', ')} · {p.papers} paper{p.papers === 1 ? '' : 's'}</div></div>
                  <Badge variant={VARIANT[p.status] ?? 'neutral'} label={LABEL[p.status] ?? p.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {canManage && (
        <Section title="New exam period" hint="For example &quot;Term 3 end-of-term exams 2026&quot; or &quot;Form 4 mocks&quot;. Normal lessons are suspended for the forms that sit it, on its days.">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5 lg:col-span-2"><label htmlFor="ep-name" className={labelClass}>Name</label><input id="ep-name" className={fieldClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="ep-start" className={labelClass}>First day</label><input id="ep-start" type="date" className={fieldClass} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} required /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="ep-end" className={labelClass}>Last day</label><input id="ep-end" type="date" className={fieldClass} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} required /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="ep-type" className={labelClass}>Marks feed</label><select id="ep-type" className={fieldClass} value={f.typeId} onChange={(e) => setF({ ...f, typeId: e.target.value })}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            <fieldset className="sm:col-span-2 lg:col-span-3"><legend className={labelClass}>Forms that sit it</legend>
              <div className="mt-1 flex flex-wrap gap-2">{levels.map((l) => (
                <label key={l.id} className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-3 text-sm ${f.levelIds.includes(l.id) ? 'border-primary bg-tint text-ink' : 'border-line text-muted'}`}>
                  <input type="checkbox" className="h-4 w-4" checked={f.levelIds.includes(l.id)} onChange={(e) => setF({ ...f, levelIds: e.target.checked ? [...f.levelIds, l.id] : f.levelIds.filter((x) => x !== l.id) })} />{l.name}
                </label>
              ))}</div></fieldset>
            <div className="sm:col-span-2 lg:col-span-4"><Button type="submit" loading={busy} disabled={f.levelIds.length === 0}>Create</Button></div>
          </form>
        </Section>
      )}
      {!canManage && periods.length === 0 && <Notice tone="info">The Exams Officer schedules the exam periods. Approved timetables show here.</Notice>}
    </div>
  );
}
