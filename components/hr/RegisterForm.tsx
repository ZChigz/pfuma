'use client';

// The staff register: everyone starts Present, the person taps the exceptions, then saves. Arrival time is asked for when someone is late.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { api, problem } from '@/components/finance/shared';
import { fieldClass } from '@/components/finance/format';

export interface RegRow { employeeId: string; name: string; jobTitle: string; department: string | null; status: string; arrivalTime: string | null; saved: boolean; fromLeave: boolean }

const STATUSES = [['PRESENT', 'Present'], ['LATE', 'Late'], ['ABSENT', 'Absent'], ['ON_LEAVE', 'On leave'], ['OFFICIAL_DUTY', 'Official duty'], ['HALF_DAY', 'Half day']] as const;
const TH = 'px-3 py-2 text-left text-xs font-semibold uppercase text-muted';

export function RegisterForm({ date, rows, past }: { date: string; rows: RegRow[]; past: boolean }) {
  const router = useRouter();
  const [state, setState] = useState(() => Object.fromEntries(rows.map((r) => [r.employeeId, { status: r.status, arrival: r.arrivalTime ?? '' }])));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const changed = rows.filter((r) => state[r.employeeId]!.status !== r.status || state[r.employeeId]!.arrival !== (r.arrivalTime ?? ''));

  async function save() {
    setBusy(true);
    const entries = rows
      .filter((r) => !r.saved || changed.includes(r))
      .filter((r) => !(r.fromLeave && state[r.employeeId]!.status === r.status))
      .map((r) => ({ employeeId: r.employeeId, status: state[r.employeeId]!.status, ...(state[r.employeeId]!.arrival ? { arrivalTime: state[r.employeeId]!.arrival } : {}) }));
    const res = await api('/api/hr/attendance', 'POST', { date, entries, markRest: true, ...(reason.trim() ? { reason: reason.trim() } : {}) });
    setBusy(false);
    if (!res.ok) return toast.error(problem(res));
    toast.success('Register saved');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem]">
          <thead><tr><th className={TH}>Name</th><th className={TH}>Status</th><th className={TH}>Arrived</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId} className="border-t border-line">
                <td className="px-3 py-2 text-sm text-ink">{r.name}<div className="text-xs text-muted">{r.jobTitle}{r.department ? ` · ${r.department}` : ''}{r.fromLeave ? ' · from approved leave' : ''}</div></td>
                <td className="px-3 py-2"><select aria-label={`Status of ${r.name}`} className={fieldClass} value={state[r.employeeId]!.status} onChange={(e) => setState({ ...state, [r.employeeId]: { ...state[r.employeeId]!, status: e.target.value } })}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                <td className="px-3 py-2"><input aria-label={`Arrival of ${r.name}`} type="time" className={fieldClass} value={state[r.employeeId]!.arrival} onChange={(e) => setState({ ...state, [r.employeeId]: { ...state[r.employeeId]!, arrival: e.target.value } })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {past && <input aria-label="Reason for the change" className={fieldClass} placeholder="Why is this day being changed? (needed for a day that has passed)" value={reason} onChange={(e) => setReason(e.target.value)} />}
      <div className="flex items-center gap-3"><Button loading={busy} onClick={() => void save()}>Save register</Button><span className="text-sm text-muted">{changed.length} changed</span></div>
    </div>
  );
}

export function SignInButton({ label = 'Sign in', url = '/api/hr/attendance/sign-in' }: { label?: string; url?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const r = await api(url, 'POST', {});
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(label === 'Sign in' ? 'You are signed in' : 'Signed out');
    router.refresh();
  }
  return <Button loading={busy} onClick={() => void go()}>{label}</Button>;
}
