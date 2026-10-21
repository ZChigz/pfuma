'use client';

// Type a name or admission number, pick a learner. Used inside forms that need a student (a sponsor award, a credit transfer, a payment plan ...).
import { useEffect, useState } from 'react';
import { api, fieldClass } from '@/components/finance/shared';

interface Found { studentId: string; name: string; admissionNumber: string; className: string | null }

export function StudentSearch({ id, value, onChange }: { id: string; value: string; onChange: (studentId: string, label: string) => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (value || q.trim().length < 2) { setFound([]); return; }
    const h = setTimeout(async () => {
      const r = await api(`/api/finance/accounts?q=${encodeURIComponent(q.trim())}&pageSize=8`, 'GET');
      if (r.ok) setFound((r.body.data as { rows: Found[] }).rows);
    }, 250);
    return () => clearTimeout(h);
  }, [q, value]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
        <span className="font-semibold text-ink">{label}</span>
        <button type="button" className="text-primary underline" onClick={() => { onChange('', ''); setLabel(''); setQ(''); }}>Change</button>
      </div>
    );
  }
  return (
    <div>
      <input id={id} className={fieldClass} placeholder="Name or admission number" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      {found.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-auto rounded-xl border border-line bg-white">
          {found.map((s) => (
            <li key={s.studentId}>
              <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-tint" onClick={() => { const l = `${s.name} · ${s.admissionNumber}${s.className ? ` · ${s.className}` : ''}`; setLabel(l); onChange(s.studentId, l); }}>
                {s.name} <span className="text-muted">· {s.admissionNumber}{s.className ? ` · ${s.className}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
