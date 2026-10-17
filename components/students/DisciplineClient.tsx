'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import type { DisciplineReport } from '@/lib/students/discipline';
import { IncidentModal } from '@/components/students/actions';
import { ExpulsionModal } from '@/components/students/profile/DisciplineTab';
import { api, formatDay, problem, Section, useBusy } from '@/components/students/shared';

type Pending = { id: string; type: string; studentId: string; studentName: string; className: string | null; startDate: string | null; endDate: string | null; notes: string | null; category: string; severity: string; description: string; requestedBy: string };
const CATEGORY: Record<string, string> = {
  LATE_COMING: 'Late coming', ABSENT_WITHOUT_LEAVE: 'Absent without leave', UNIFORM: 'Uniform', HOMEWORK: 'Homework', DISRESPECT: 'Disrespect', BULLYING: 'Bullying', FIGHTING: 'Fighting', THEFT: 'Theft',
  VANDALISM: 'Vandalism', SUBSTANCE_USE: 'Substance use', PHONE_USE: 'Phone use', ABSCONDING: 'Absconding / out of bounds', EXAM_DISHONESTY: 'Exam dishonesty', OTHER: 'Other',
};

function Bars({ rows, label }: { rows: { key: string; label: string; count: number }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) return <p className="text-sm text-muted">No incidents this term.</p>;
  return (
    <ul aria-label={label} className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-2 text-sm">
          <span className="truncate text-ink">{r.label}</span>
          <span className="h-3 rounded-full bg-canvas" role="presentation"><span className="block h-3 rounded-full bg-primary" style={{ width: `${(r.count / max) * 100}%` }} /></span>
          <span className="text-right font-semibold text-ink">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function DisciplineClient({ report, pending, canRecord, canApprove, termName }: { report: DisciplineReport; pending: Pending[]; canRecord: boolean; canApprove: boolean; termName: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const [recording, setRecording] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const { busy, run } = useBusy();
  useEffect(() => { if (params.get('new') === '1' && canRecord) setRecording(true); }, [params, canRecord]);

  async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
    const r = await run(() => api(`/api/students/discipline/actions/${id}`, 'POST', { decision }));
    if (r && !r.ok) toast.error(problem(r)); else { toast.success(decision === 'APPROVE' ? 'Suspension approved' : 'Suspension declined'); router.refresh(); }
  }

  return (
    <div className="flex flex-col gap-4">
      {canRecord && <div><Button onClick={() => setRecording(true)}>Record incident</Button></div>}
      {canApprove && (
        <Section title={`Waiting for the Head (${pending.length})`}>
          {pending.length === 0 ? <p className="text-sm text-muted">No suspensions or expulsion recommendations are waiting.</p> : (
            <ul className="flex flex-col divide-y divide-line">
              {pending.map((p) => (
                <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm"><Link href={`/students/${p.studentId}?tab=discipline`} className="font-semibold text-primary hover:underline">{p.studentName}</Link> <span className="text-muted">{p.className}</span> <Badge variant={p.type === 'SUSPENSION' ? 'warning' : 'danger'} label={p.type === 'SUSPENSION' ? 'Suspension' : 'Expulsion recommended'} /></p>
                    <p className="text-xs text-muted">{CATEGORY[p.category]} · {p.type === 'SUSPENSION' ? `${formatDay(p.startDate)} to ${formatDay(p.endDate)} · ` : ''}requested by {p.requestedBy}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-ink">{p.description}</p>
                  </div>
                  <div className="flex gap-2">
                    {p.type === 'SUSPENSION' ? (<><Button size="sm" loading={busy} onClick={() => decide(p.id, 'APPROVE')}>Approve</Button><Button size="sm" variant="secondary" loading={busy} onClick={() => decide(p.id, 'REJECT')}>Decline</Button></>) : <Button size="sm" onClick={() => setDeciding(p.id)}>Record the decision</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
      <p className="text-xs text-muted">Reports for {termName ?? 'the current term'}. You see the students you teach{canApprove ? ', or everyone if you are the Head' : ''}.</p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Incidents by category"><Bars label="By category" rows={report.byCategory.map((c) => ({ key: c.category, label: CATEGORY[c.category] ?? c.category, count: c.count }))} /></Section>
        <Section title="Incidents by class"><Bars label="By class" rows={report.byClass.map((c) => ({ key: c.className, label: c.className, count: c.count }))} /></Section>
        <Section title="Incidents by month"><Bars label="By month" rows={report.byMonth.map((c) => ({ key: c.month, label: c.month, count: c.count }))} /></Section>
        <Section title="Three or more incidents this term">
          {report.repeaters.length === 0 ? <p className="text-sm text-muted">Nobody.</p> : (
            <ul className="flex flex-col divide-y divide-line">{report.repeaters.map((r) => <li key={r.studentId} className="flex items-center justify-between gap-2 py-2 text-sm"><Link href={`/students/${r.studentId}?tab=discipline`} className="font-medium text-primary hover:underline">{r.fullName}</Link><span className="text-muted">{r.className} · {r.count} incidents</span></li>)}</ul>
          )}
        </Section>
      </div>
      <Section title={`Open suspensions (${report.openSuspensions.length})`}>
        {report.openSuspensions.length === 0 ? <p className="text-sm text-muted">None.</p> : (
          <ul className="flex flex-col divide-y divide-line">{report.openSuspensions.map((s) => <li key={s.actionId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><Link href={`/students/${s.studentId}?tab=discipline`} className="font-medium text-primary hover:underline">{s.fullName}</Link><span className="text-muted">{formatDay(s.startDate)} to {formatDay(s.endDate)}</span><Badge variant={s.status === 'PENDING' ? 'warning' : 'success'} label={s.status === 'PENDING' ? 'Waiting for the Head' : 'Approved'} /></li>)}</ul>
        )}
      </Section>
      {recording && <IncidentModal open initial={[]} onClose={() => setRecording(false)} onDone={() => router.refresh()} />}
      {deciding && <ExpulsionModal id={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); router.refresh(); }} />}
    </div>
  );
}
