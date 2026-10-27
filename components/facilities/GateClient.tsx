'use client';

// The gate on a phone: scan or type the learner, see their exeat, who may collect them and any custody note (in red), then sign out or in.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { api, problem, Notice, fieldClass } from '@/components/finance/shared';
import { ScanButton } from '@/components/facilities/Scanner';
import type { GateCard } from '@/lib/facilities/exeats';

const CONFIRM = [['PHONE', 'Phoned'], ['SMS', 'SMS'], ['WRITTEN', 'Written note'], ['IN_PERSON', 'In person']] as const;
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function GateClient({ canSign }: { canSign: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [card, setCard] = useState<GateCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<string>('');
  const [o, setO] = useState({ name: '', idNumber: '', phone: '', confirmedBy: '', confirmMethod: 'PHONE', confirmNote: '' });

  async function look(c: string): Promise<boolean> {
    setError(null);
    const r = await api(`/api/facilities/exeats/gate?code=${encodeURIComponent(c.trim())}`, 'GET');
    if (!r.ok) { setCard(null); setError(problem(r)); return false; }
    const g = r.body.data as GateCard;
    setCard(g);
    setPick(g.exeat?.collectorKind === 'GUARDIAN' ? '' : g.collectors.length === 1 ? g.collectors[0]!.guardianId : '');
    return true;
  }

  async function act(kind: 'out' | 'in') {
    if (!card?.exeat) return;
    setBusy(true);
    setError(null);
    const collector = kind === 'in' ? undefined : pick === 'OTHER' ? { kind: 'OTHER', ...o, confirmNote: o.confirmNote || undefined } : pick ? { kind: 'GUARDIAN', guardianId: pick } : undefined;
    const r = await api(`/api/facilities/exeats/sign-${kind}`, 'POST', { exeatId: card.exeat.id, ...(collector ? { collector } : {}) });
    setBusy(false);
    if (!r.ok) { setError(problem(r)); return; }
    toast.success(kind === 'out' ? `${card.student.name} signed out` : `${card.student.name} signed in`);
    setCard(null); setCode(''); setPick('');
    router.refresh();
  }

  const x = card?.exeat ?? null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input aria-label="Admission number or name" className={fieldClass} placeholder="Admission number or name" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void look(code); }} />
        <ScanButton label="Scan" title="Scan the learner card" prompt="the learner's ID card" onScan={(c) => { setCode(c); return look(c); }} />
        <Button className="min-h-[48px]" onClick={() => void look(code)}>Find</Button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {card && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-3">
          <div className="flex items-center gap-3">
            {card.student.photoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={card.student.photoUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
            )}
            <div><p className="text-lg font-bold text-ink">{card.student.name}</p><p className="text-sm text-muted">{card.student.admissionNumber}{card.student.className ? ` · ${card.student.className}` : ''}</p></div>
          </div>
          {card.custodyNotes.map((n) => <p key={n.guardian} role="alert" className="rounded-lg bg-danger-bg p-3 text-sm font-bold text-danger">Custody note, {n.guardian}: {n.note}</p>)}
          {!x && <Notice tone="warn">{card.student.boarding === 'BOARDER' ? 'No approved exeat. This learner may not leave.' : 'A day scholar has no exeat.'}</Notice>}
          {x && (
            <div className="text-sm">
              <p className="font-semibold text-ink">{x.status === 'SIGNED_OUT' ? 'Out since' : 'Approved'}: {when(x.status === 'SIGNED_OUT' && x.signedOutAt ? x.signedOutAt : x.outAt)} · due back {when(x.dueBackAt)}</p>
              <p className="text-muted">{x.reason}</p>
              {x.overdueMinutes > 0 && <p className="font-bold text-danger">{x.overdueMinutes} minutes late</p>}
              {x.status === 'SIGNED_OUT' && x.collector && <p className="text-muted">Collected by {x.collector}</p>}
            </div>
          )}
          {x?.status === 'APPROVED' && canSign && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-ink">Who is collecting?</p>
              <select aria-label="Collector" className={fieldClass} value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">{x.collectorKind === 'PENDING' ? 'Choose the collector' : `As arranged: ${x.collector}`}</option>
                {card.collectors.map((c) => <option key={c.guardianId} value={c.guardianId}>{c.name} ({c.relationship}){c.idNumber ? ` · ID ${c.idNumber}` : ''}</option>)}
                <option value="OTHER">Another adult (primary guardian must confirm)</option>
              </select>
              {pick === 'OTHER' && (
                <div className="grid gap-2">
                  <input aria-label="Collector name" className={fieldClass} placeholder="Full name" value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} />
                  <input aria-label="Collector ID number" className={fieldClass} placeholder="ID number (check the card)" value={o.idNumber} onChange={(e) => setO({ ...o, idNumber: e.target.value })} />
                  <input aria-label="Collector phone" className={fieldClass} inputMode="tel" placeholder="Phone" value={o.phone} onChange={(e) => setO({ ...o, phone: e.target.value })} />
                  <input aria-label="Confirmed by" className={fieldClass} placeholder="Primary guardian who confirmed" value={o.confirmedBy} onChange={(e) => setO({ ...o, confirmedBy: e.target.value })} />
                  <select aria-label="How it was confirmed" className={fieldClass} value={o.confirmMethod} onChange={(e) => setO({ ...o, confirmMethod: e.target.value })}>{CONFIRM.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  {card.primaryPhone && <p className="text-xs text-muted">Primary guardian&apos;s phone: {card.primaryPhone}</p>}
                </div>
              )}
              <Button className="min-h-[56px] text-base" loading={busy} onClick={() => void act('out')}>Sign out</Button>
            </div>
          )}
          {x?.status === 'SIGNED_OUT' && canSign && <Button className="min-h-[56px] text-base" loading={busy} onClick={() => void act('in')}>Sign in (back at school)</Button>}
        </div>
      )}
    </div>
  );
}
