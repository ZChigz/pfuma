'use client';

// Library stocktake on the shelf: scan each book you can see. Finishing lists the copies that should be there but were not scanned.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { api, fieldClass, problem } from '@/components/finance/shared';
import { ScanButton } from '@/components/facilities/Scanner';

export function StocktakeClient({ id, closed, scanned }: { id: string; closed: boolean; scanned: number }) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [count, setCount] = useState(scanned);
  const [last, setLast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function scan(code: string): Promise<boolean> {
    const r = await api(`/api/facilities/library/stocktakes/${id}/scan`, 'POST', { barcode: code });
    if (!r.ok) { toast.error(problem(r)); return false; }
    const d = r.body.data as { title: string; accessionNo: string; already: boolean };
    if (!d.already) setCount((n) => n + 1);
    setLast(`${d.title} · ${d.accessionNo}${d.already ? ' (already scanned)' : ''}`);
    return true;
  }

  async function finish() {
    setBusy(true);
    const r = await api(`/api/facilities/library/stocktakes/${id}/finish`, 'POST', {});
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Stocktake finished');
    router.refresh();
  }

  if (closed) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input aria-label="Book barcode" className={fieldClass} placeholder="Scan or type the book's number" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={async (e) => { if (e.key === 'Enter' && typed.trim() && (await scan(typed.trim()))) setTyped(''); }} />
        <ScanButton label="Scan" title="Scan the shelf" prompt="the barcode inside the book" continuous onScan={scan} />
      </div>
      <p role="status" className="text-sm text-muted">{count} scanned{last ? ` · last: ${last}` : ''}</p>
      <Button className="min-h-[52px]" loading={busy} onClick={() => void finish()}>Finish and list what is missing</Button>
    </div>
  );
}
