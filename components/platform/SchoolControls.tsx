'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { PRESETS } from '@/lib/platform/presets';

interface Props {
  schoolId: string;
  status: string;
  planId: string;
  plans: { id: string; name: string }[];
  studentLimit: number | null;
  renewalDate: string;
  modules: { key: string; label: string; on: boolean }[];
}

const firstError = (b: { errors?: Record<string, string[]>; message?: string }, fallback: string) => (b.errors ? Object.values(b.errors).flat()[0] : b.message ?? fallback);

export function SchoolControls(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [billing, setBilling] = useState({ planId: p.planId, studentLimit: p.studentLimit === null ? '' : String(p.studentLimit), renewalDate: p.renewalDate, status: p.status === 'SUSPENDED' ? 'ACTIVE' : p.status });
  const [modules, setModules] = useState(Object.fromEntries(p.modules.map((m) => [m.key, m.on])));
  const [preset, setPreset] = useState('');
  const [suspending, setSuspending] = useState(false);
  const [reason, setReason] = useState('');
  const [reactivating, setReactivating] = useState(false);
  const suspended = p.status === 'SUSPENDED';

  async function call(key: string, url: string, method: string, body: unknown, ok: string) {
    setBusy(key);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { toast.error(firstError(data, 'That did not work')); return null; }
      toast.success(ok);
      router.refresh();
      return data;
    } finally {
      setBusy(null);
    }
  }

  async function saveBilling(e: React.FormEvent) {
    e.preventDefault();
    await call('billing', `/api/platform/schools/${p.schoolId}`, 'PATCH', {
      planId: billing.planId, studentLimit: billing.studentLimit === '' ? null : Number(billing.studentLimit), renewalDate: billing.renewalDate,
      ...(suspended ? {} : { status: billing.status }),
    }, 'Saved');
  }

  async function saveModules() {
    const data = await call('modules', `/api/platform/schools/${p.schoolId}/modules`, 'PATCH', preset ? { preset, modules } : { modules }, 'Modules saved');
    if (data) setPreset('');
  }

  function applyPreset(key: string) {
    setPreset(key);
    if (!key) return;
    const off = new Set<string>(PRESETS[key as keyof typeof PRESETS].modulesOff);
    setModules(Object.fromEntries(p.modules.map((m) => [m.key, !off.has(m.key)])));
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Plan and billing" subtitle="What the school sees on its Subscription page">
          <form onSubmit={saveBilling} className="flex flex-col gap-4" noValidate aria-label="Plan and billing">
            <Select id="b-plan" label="Plan" placeholder="No plan" options={p.plans.map((x) => ({ value: x.id, label: x.name }))} value={billing.planId} onChange={(e) => setBilling({ ...billing, planId: e.target.value })} />
            <Input id="b-limit" label="Student limit" type="number" min={1} inputMode="numeric" hint="Leave empty for no limit" value={billing.studentLimit} onChange={(e) => setBilling({ ...billing, studentLimit: e.target.value })} />
            <Input id="b-renew" label="Renewal date" type="date" value={billing.renewalDate} onChange={(e) => setBilling({ ...billing, renewalDate: e.target.value })} />
            {!suspended && (
              <Select id="b-status" label="Status" options={[{ value: 'TRIAL', label: 'Trial' }, { value: 'ACTIVE', label: 'Active' }, { value: 'OVERDUE', label: 'Overdue' }]} value={billing.status} onChange={(e) => setBilling({ ...billing, status: e.target.value })} />
            )}
            <div><Button type="submit" loading={busy === 'billing'}>Save</Button></div>
          </form>
        </Card>

        <Card title="Suspension" subtitle="A suspended school can sign in and look, but cannot add or change anything">
          {suspended ? (
            <Button onClick={() => setReactivating(true)}>Reactivate school</Button>
          ) : (
            <Button variant="danger" onClick={() => { setReason(''); setSuspending(true); }}>Suspend school</Button>
          )}
        </Card>
      </div>

      <Card title="Modules" subtitle="Switch on only what the school pays for. Dashboard & System is always on.">
        <div className="flex flex-col gap-4">
          <Select id="m-preset" label="Start from a preset" placeholder="Keep the current switches" options={Object.entries(PRESETS).map(([k, v]) => ({ value: k, label: v.label }))} value={preset} onChange={(e) => applyPreset(e.target.value)} />
          <ul className="grid gap-x-4 sm:grid-cols-2">
            {p.modules.map((m) => (
              <li key={m.key}>
                <label className="flex min-h-[44px] items-center gap-3 text-sm text-ink">
                  <input type="checkbox" className="h-5 w-5 accent-primary" checked={modules[m.key]} disabled={m.key === 'system'} onChange={(e) => setModules({ ...modules, [m.key]: e.target.checked })} />
                  {m.label}
                </label>
              </li>
            ))}
          </ul>
          <div><Button onClick={saveModules} loading={busy === 'modules'}>Save modules</Button></div>
        </div>
      </Card>

      <ConfirmDialog
        open={suspending}
        title="Suspend this school?"
        confirmLabel="Suspend"
        destructive
        loading={busy === 'suspend'}
        onCancel={() => setSuspending(false)}
        onConfirm={async () => { const d = await call('suspend', `/api/platform/schools/${p.schoolId}/suspend`, 'POST', { reason }, 'School suspended'); if (d) setSuspending(false); }}
      >
        <div className="flex flex-col gap-3">
          <p>Everyone at the school keeps their sign-in but can only look. Say why, so the next person knows.</p>
          <Input id="suspend-reason" label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={reactivating}
        title="Reactivate this school?"
        confirmLabel="Reactivate"
        loading={busy === 'reactivate'}
        onCancel={() => setReactivating(false)}
        onConfirm={async () => { const d = await call('reactivate', `/api/platform/schools/${p.schoolId}/reactivate`, 'POST', undefined, 'School reactivated'); if (d) setReactivating(false); }}
      >
        People at the school can add and change records again.
      </ConfirmDialog>
    </>
  );
}
