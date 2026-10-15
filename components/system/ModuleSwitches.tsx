'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { ALWAYS_ON_MODULES, MODULES } from '@/lib/access-core';

export function ModuleSwitches({ initial, canManage }: { initial: Record<string, boolean>; canManage: boolean }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const changes = MODULES.filter((m) => state[m.key] !== saved[m.key]);
  const turningOff = changes.filter((m) => !state[m.key]);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch('/api/system/subscription/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules: Object.fromEntries(changes.map((m) => [m.key, state[m.key]])) }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.errors ? Object.values(body.errors as Record<string, string[]>).flat()[0] : body.message ?? 'Could not save');
        return;
      }
      setSaved(body.data.modules);
      setState(body.data.modules);
      setConfirming(false);
      toast.success('Modules updated');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-line">
        {MODULES.map((m) => {
          const locked = ALWAYS_ON_MODULES.includes(m.key) || !canManage;
          return (
            <li key={m.key} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-ink">
                {m.label}
                {ALWAYS_ON_MODULES.includes(m.key) && <span className="ml-2 text-xs text-muted">always on</span>}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={state[m.key]}
                aria-label={`${m.label} module`}
                disabled={locked}
                onClick={() => setState((s) => ({ ...s, [m.key]: !s[m.key] }))}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center disabled:opacity-50"
              >
                <span className={`relative inline-block h-6 w-11 rounded-full transition-colors ${state[m.key] ? 'bg-primary' : 'bg-line'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${state[m.key] ? 'left-[22px]' : 'left-0.5'}`} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {canManage && changes.length > 0 && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setState(saved)} disabled={busy}>Undo</Button>
          <Button onClick={() => (turningOff.length ? setConfirming(true) : save())} loading={busy && !confirming}>Save changes</Button>
        </div>
      )}
      <ConfirmDialog open={confirming} title="Switch modules off?" confirmLabel="Switch off" destructive loading={busy} onCancel={() => setConfirming(false)} onConfirm={save}>
        {turningOff.map((m) => m.label).join(', ')} will disappear from the menu for everyone in your school, and its pages will refuse access. No data is deleted; switch it back on any time.
      </ConfirmDialog>
    </div>
  );
}
