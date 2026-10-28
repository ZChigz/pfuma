'use client';

// The annual asset verification, on the phone: say where you are standing, then scan the tag of each asset. The result tells you at once
// whether it belongs there.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { Notice, api, fieldClass, problem } from '@/components/finance/shared';
import { ScanButton } from '@/components/facilities/Scanner';

export function VerifyClient({ roundId, closed, locations }: { roundId: string; closed: boolean; locations: string[] }) {
  const router = useRouter();
  const [where, setWhere] = useState('');
  const [typed, setTyped] = useState('');
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function scan(code: string): Promise<boolean> {
    if (!where.trim()) { toast.error('Say where you are first'); return false; }
    const r = await api(`/api/facilities/assets/rounds/${roundId}/scan`, 'POST', { tag: code, location: where.trim() });
    if (!r.ok) { toast.error(problem(r)); return false; }
    const d = r.body.data as { tag: string; name: string; result: string; expectedLocation: string };
    setLast(d.result === 'FOUND' ? { ok: true, text: `${d.tag} ${d.name}: in its place` } : { ok: false, text: `${d.tag} ${d.name}: belongs in ${d.expectedLocation}, found in ${where.trim()}` });
    return true;
  }

  async function close() {
    setBusy(true);
    const r = await api(`/api/facilities/assets/rounds/${roundId}/close`, 'POST', {});
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Round closed');
    router.refresh();
  }

  if (closed) return <Notice tone="info">This round is closed.</Notice>;
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Where are you standing?
        <input list="verify-locations" className={fieldClass} value={where} onChange={(e) => setWhere(e.target.value)} placeholder="For example Science lab" />
        <datalist id="verify-locations">{locations.map((l) => <option key={l} value={l} />)}</datalist>
      </label>
      <div className="flex gap-2">
        <input aria-label="Asset tag" className={fieldClass} placeholder="Scan or type the tag, AST-00412" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={async (e) => { if (e.key === 'Enter' && typed.trim() && (await scan(typed.trim()))) setTyped(''); }} />
        <ScanButton label="Scan" title="Scan asset tags" prompt="the QR label on the asset" continuous onScan={scan} />
      </div>
      {last && <p role="status" className={`rounded-xl border p-3 text-sm font-semibold ${last.ok ? 'border-primary text-primary' : 'border-danger text-danger'}`}>{last.text}</p>}
      <Button className="min-h-[52px]" variant="secondary" loading={busy} onClick={() => void close()}>Close the round</Button>
    </div>
  );
}
