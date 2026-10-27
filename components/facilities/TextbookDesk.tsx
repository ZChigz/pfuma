'use client';

// Textbook issue by class: scan each copy against a learner (or type the copy numbers in bulk), scan books back in at the end of the
// year, and mark what was not brought back as missing (a replacement charge).
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { Field, RowAction, api, fieldClass, problem } from '@/components/finance/shared';
import { ScanButton } from '@/components/facilities/Scanner';

export function IssueBooks({ studentId, name, setId }: { studentId: string; name: string; setId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const add = (raw: string): boolean => {
    const list = raw.split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean);
    if (list.length === 0) return false;
    setCodes((cur) => Array.from(new Set([...cur, ...list])));
    return true;
  };

  async function submit() {
    setBusy(true);
    const r = await api('/api/facilities/textbooks/issue', 'POST', { studentId, ...(setId ? { setId } : {}), barcodes: codes });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(`${(r.body.data as { issued: unknown[] }).issued.length} books issued to ${name}`);
    setCodes([]); setOpen(false);
    router.refresh();
  }

  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Issue books</Button>;
  return (
    <div className="flex min-w-[16rem] flex-col gap-2 rounded-xl border border-line bg-white p-3">
      <Field id={`tb-${studentId}`} label={`Copies for ${name}`} hint="Scan each book, or type the accession numbers separated by spaces.">
        <div className="flex gap-2">
          <input id={`tb-${studentId}`} className={fieldClass} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && add(typed)) setTyped(''); }} placeholder="ACC-00071 ACC-00072" />
          <ScanButton label="Scan" title={`Scan books for ${name}`} prompt="the barcode inside the book" continuous onScan={add} />
        </div>
      </Field>
      {typed.trim() && <button type="button" className="min-h-[44px] self-start text-sm font-semibold text-primary" onClick={() => { add(typed); setTyped(''); }}>Add to the list</button>}
      {codes.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {codes.map((c) => <li key={c}><button type="button" className="min-h-[36px] rounded-full bg-tint px-3 text-xs font-semibold text-ink" onClick={() => setCodes(codes.filter((x) => x !== c))}>{c} ×</button></li>)}
        </ul>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setCodes([]); }}>Cancel</Button>
        <Button size="sm" loading={busy} disabled={codes.length === 0} onClick={() => void submit()}>Issue {codes.length || ''} book{codes.length === 1 ? '' : 's'}</Button>
      </div>
    </div>
  );
}

/** Scan books back in, one after another. */
export function CollectBooks() {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [last, setLast] = useState<string | null>(null);

  async function collect(code: string): Promise<boolean> {
    const r = await api('/api/facilities/textbooks/return', 'POST', { barcode: code });
    if (!r.ok) { toast.error(problem(r)); return false; }
    const d = r.body.data as { student: string; title: string };
    setLast(`${d.title} back from ${d.student}`);
    router.refresh();
    return true;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input aria-label="Book to collect" className={fieldClass} placeholder="Scan or type the book's number" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={async (e) => { if (e.key === 'Enter' && typed.trim() && (await collect(typed.trim()))) setTyped(''); }} />
        <ScanButton label="Scan" title="Collect textbooks" prompt="the barcode inside the book" continuous onScan={collect} />
      </div>
      {last && <p role="status" className="text-sm font-semibold text-primary">{last}</p>}
    </div>
  );
}

export function MarkMissing({ studentId, name, count }: { studentId: string; name: string; count: number }) {
  return (
    <RowAction label={`Mark ${count} missing`} variant="danger" url="/api/facilities/textbooks/missing" body={{ studentId }}
      confirm={`${name} has not brought back ${count} textbook${count === 1 ? '' : 's'}. They are marked missing and the replacement cost is charged to the learner.`} done="Marked missing and charged" />
  );
}
