'use client';

// Find the learner standing at the desk: type a name or admission number, or scan the number on the ID card. Used by every facilities
// screen that needs a learner (tuck shop, sick bay, gate, library desk ...). It asks /api/facilities/learners, which any facilities
// permission may call.
import { useEffect, useState } from 'react';
import { api, fieldClass } from '@/components/finance/shared';
import { ScanButton } from '@/components/facilities/Scanner';

export interface Learner { id: string; name: string; admissionNumber: string; className: string | null; boarding: 'DAY' | 'BOARDER'; gender: string | null; photoUrl: string | null }

export function LearnerPicker({ id, value, onChange, boardersOnly }: { id: string; value: Learner | null; onChange: (learner: Learner | null) => void; boardersOnly?: boolean }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Learner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const boarders = boardersOnly ? '&boarders=1' : '';

  useEffect(() => {
    if (value || q.trim().length < 2) { setFound([]); return; }
    const h = setTimeout(async () => {
      const r = await api(`/api/facilities/learners?q=${encodeURIComponent(q.trim())}${boarders}`, 'GET');
      if (r.ok) setFound(r.body.data as Learner[]);
    }, 250);
    return () => clearTimeout(h);
  }, [q, value, boarders]);

  async function scanned(code: string): Promise<boolean> {
    const r = await api(`/api/facilities/learners?code=${encodeURIComponent(code)}${boarders}`, 'GET');
    const list = r.ok ? (r.body.data as Learner[]) : [];
    if (!list[0]) { setError('No learner has that number'); return false; }
    setError(null);
    onChange(list[0]);
    return true;
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
        <span><span className="font-semibold text-ink">{value.name}</span> <span className="text-muted">· {value.admissionNumber}{value.className ? ` · ${value.className}` : ''}{value.boarding === 'BOARDER' ? ' · Boarder' : ''}</span></span>
        <button type="button" className="min-h-[44px] px-2 text-primary underline" onClick={() => { onChange(null); setQ(''); }}>Change</button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input id={id} className={fieldClass} placeholder="Name or admission number" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        <ScanButton label="Scan" title="Scan the learner card" prompt="the learner's ID card" onScan={scanned} />
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {found.length > 0 && (
        <ul className="max-h-56 overflow-auto rounded-xl border border-line bg-white">
          {found.map((s) => (
            <li key={s.id}>
              <button type="button" className="block min-h-[48px] w-full px-3 py-2 text-left text-sm hover:bg-tint" onClick={() => onChange(s)}>
                {s.name} <span className="text-muted">· {s.admissionNumber}{s.className ? ` · ${s.className}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
