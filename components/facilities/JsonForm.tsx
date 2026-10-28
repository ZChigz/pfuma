'use client';

// A small form driven by a list of fields, for the many short forms of Transport (add a vehicle, a stop, fuel ...). Fields are 16px+ and
// touch sized. Amounts typed in dollars go to the server as cents. Nothing here decides a rule: the server does.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { api, problem, Notice, fieldClass } from '@/components/finance/shared';

export type JsonField =
  | { name: string; label: string; type: 'text' | 'time' | 'date' | 'datetime'; required?: boolean; placeholder?: string; initial?: string }
  | { name: string; label: string; type: 'number' | 'cents'; required?: boolean; placeholder?: string; initial?: string }
  | { name: string; label: string; type: 'select'; options: { value: string; label: string }[]; required?: boolean; initial?: string; blank?: string };

export function JsonForm({ fields, url, method = 'POST', submit, done, fixed = {}, nullEmpty = false }: {
  fields: JsonField[]; url: string; method?: 'POST' | 'PUT' | 'DELETE'; submit: string; done: string; fixed?: Record<string, unknown>; nullEmpty?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ''])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true); setError(null);
    const body: Record<string, unknown> = { ...fixed };
    for (const f of fields) {
      const raw = (v[f.name] ?? '').trim();
      if (!raw) { if (nullEmpty && f.type === 'select') body[f.name] = null; continue; }
      if (f.type === 'number') body[f.name] = Number(raw);
      else if (f.type === 'cents') body[f.name] = Math.round(Number(raw.replace(',', '.')) * 100);
      else if (f.type === 'datetime') body[f.name] = new Date(raw).toISOString();
      else body[f.name] = raw;
    }
    const r = await api(url, method, body);
    setBusy(false);
    if (!r.ok) { setError(problem(r)); return; }
    toast.success(done);
    setV(Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ''])));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3">
      {fields.map((f) => (
        <label key={f.name} className="flex flex-col gap-1 text-xs text-muted">
          {f.label}{f.required ? ' *' : ''}
          {f.type === 'select' ? (
            <select className={fieldClass} value={v[f.name]} onChange={(e) => setV({ ...v, [f.name]: e.target.value })}>
              <option value="">{f.blank ?? 'Choose'}</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input className={fieldClass} type={f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : f.type === 'datetime' ? 'datetime-local' : 'text'}
              inputMode={f.type === 'number' || f.type === 'cents' ? 'decimal' : undefined} placeholder={f.placeholder} value={v[f.name]} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
          )}
        </label>
      ))}
      {error && <Notice tone="danger">{error}</Notice>}
      <Button className="min-h-[52px]" loading={busy} onClick={() => void go()}>{submit}</Button>
    </div>
  );
}
