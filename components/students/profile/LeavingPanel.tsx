'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { EXIT_REASON_LABEL } from '@/lib/students/rules';
import type { ClearanceItem } from '@/lib/students/leavers';
import { api, Checkbox, formatDay, problem, Section, TextArea, useBusy } from '@/components/students/shared';

export interface OpenLeaving {
  id: string; state: 'STARTED' | 'APPROVED'; reason: string; reasonNote: string | null; lastDay: string; destinationSchool: string | null; destinationDistrict: string | null;
  clearance: ClearanceItem[]; overrideReason: string | null;
}

/** The leaving process on the profile: the clearance checklist, the Head's approval, and finishing. */
export function LeavingPanel({ leaving: l, canManage, canApprove }: { leaving: OpenLeaving; canManage: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [conduct, setConduct] = useState('');
  const [cancel, setCancel] = useState('');
  const { busy, run } = useBusy();
  const outstanding = l.clearance.filter((c) => !c.clear);

  async function step(body: Record<string, unknown>, done?: string) {
    const r = await run(() => api(`/api/students/leaving/${l.id}`, 'POST', body));
    if (!r) return;
    if (!r.ok) { toast.error(problem(r)); return; }
    if (done) toast.success(done);
    router.refresh();
  }

  return (
    <Section title="Leaving the school" className="border-2 border-warn/40">
      <p className="text-sm text-ink">
        <strong>{EXIT_REASON_LABEL[l.reason as keyof typeof EXIT_REASON_LABEL] ?? l.reason}</strong> · last day {formatDay(l.lastDay)}
        {l.destinationSchool ? ` · to ${l.destinationSchool}${l.destinationDistrict ? `, ${l.destinationDistrict}` : ''}` : ''} · <Badge variant={l.state === 'APPROVED' ? 'success' : 'warning'} label={l.state === 'APPROVED' ? 'Approved by the Head' : 'Waiting for the Head'} />
      </p>
      <ul className="mt-3 flex flex-col divide-y divide-line">
        {l.clearance.map((c) => (
          <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="font-medium">{c.label}</span>
            <span className="flex items-center gap-2">
              <span className={c.clear ? 'text-success' : 'text-danger'}>{c.detail}</span>
              {c.source === 'manual' && l.state === 'STARTED' && canManage && <Checkbox label="Ticked" checked={c.clear} disabled={busy} onChange={(v) => step({ action: 'tick', key: c.key, ticked: v })} />}
            </span>
          </li>
        ))}
      </ul>
      {l.overrideReason && <p className="mt-2 text-sm text-muted">Approved with items outstanding because: {l.overrideReason}</p>}
      <div className="mt-3 flex flex-col gap-3">
        {l.state === 'STARTED' && canApprove && (
          <div className="flex flex-col gap-2">
            {outstanding.length > 0 && <TextArea id="lv-over" label={outstanding.length ? `${outstanding.length} item(s) outstanding. Why may the student leave anyway?` : 'Note'} rows={2} value={reason} onChange={setReason} />}
            <div><Button loading={busy} onClick={() => step({ action: 'approve', overrideReason: reason || undefined }, 'Leaving approved')}>Approve the leaving</Button></div>
          </div>
        )}
        {l.state === 'STARTED' && !canApprove && <p className="text-sm text-muted">The Head must approve this leaving before it can be finished.</p>}
        {l.state === 'APPROVED' && canManage && (
          <div className="flex flex-col gap-2">
            {l.reason === 'TRANSFER' && <Input id="lv-conduct" label="Conduct, for the transfer letter" value={conduct} onChange={(e) => setConduct(e.target.value)} hint="Leave empty to state only what the school record shows." />}
            <div><Button loading={busy} onClick={() => step({ action: 'complete', conduct: conduct || undefined }, 'The student has left. The letter is on the Documents tab.')}>Finish the leaving</Button></div>
            <p className="text-xs text-muted">Sets the status, ends the class on the last day, files the {l.reason === 'TRANSFER' ? 'transfer letter' : 'leaving certificate'} and takes the student off class lists.</p>
          </div>
        )}
        {canManage && (
          <details>
            <summary className="min-h-[44px] cursor-pointer text-sm text-muted underline">Cancel this leaving</summary>
            <div className="mt-2 flex flex-col gap-2"><Input id="lv-cancel" label="Why" value={cancel} onChange={(e) => setCancel(e.target.value)} /><div><Button variant="secondary" loading={busy} disabled={cancel.trim().length < 3} onClick={() => step({ action: 'cancel', reason: cancel }, 'Leaving cancelled')}>Cancel the leaving</Button></div></div>
          </details>
        )}
      </div>
    </Section>
  );
}
