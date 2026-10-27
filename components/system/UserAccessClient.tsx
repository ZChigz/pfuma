'use client';
// One person's access: the roles they hold (each for the whole school or one place), exceptions, what they can do, refused attempts.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { send } from '@/components/access/send';
import { Can } from '@/components/access/AccessProvider';
import type { AccessView } from '@/lib/system/access-admin';

export interface RoleChoice { key: string; name: string; /** The places the role can be pinned to: DEPARTMENT, CLASS, HOSTEL, STORE. */ pins: string[] }
export interface PlaceChoice { id: string; name: string }
interface Props {
  view: AccessView;
  roleChoices: RoleChoice[];
  places: Record<'DEPARTMENT' | 'CLASS' | 'HOSTEL' | 'STORE', PlaceChoice[]>;
  permissionChoices: { value: string; label: string }[];
  isSelf: boolean;
}

const PIN_LABEL: Record<string, string> = { DEPARTMENT: 'department', CLASS: 'class', HOSTEL: 'hostel', STORE: 'store' };
const SCOPE_TEXT: Record<string, string> = { SCHOOL: 'Whole school', DEPARTMENT: 'Their department', CLASS: 'Their class', ASSIGNED: 'Assigned to them', HOSTEL: 'Their hostel', STORE: 'Their store', RECORDED_BY_ME: 'Recorded by them', SELF: 'Only their own' };
const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const STATE = { ACTIVE: 'In force', EXPIRED: 'Ended', REVOKED: 'Taken back' } as const;

export function UserAccessClient({ view, roleChoices, places, permissionChoices, isSelf }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<AccessView['roles'][number] | null>(null);
  const [roleKey, setRoleKey] = useState('');
  const [pin, setPin] = useState('SCHOOL');
  const [placeId, setPlaceId] = useState('');
  const [exc, setExc] = useState({ permissionKey: '', effect: 'GRANT', reason: '', days: '14' });
  const [showAll, setShowAll] = useState(false);

  const chosen = roleChoices.find((r) => r.key === roleKey);
  const base = `/api/system/users/${view.user.id}`;

  async function run(p: Promise<{ ok: boolean; message: string }>, done: string, after?: () => void) {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok) { toast.error(r.message); return; }
    toast.success(done);
    after?.();
    router.refresh();
  }

  const addRole = () => run(send(`${base}/roles`, 'POST', { roleKey, scopeType: pin, scopeId: pin === 'SCHOOL' ? '' : placeId }), 'Role given', () => { setRoleKey(''); setPin('SCHOOL'); setPlaceId(''); });
  const removeRole = async () => { if (removing) await run(send(`${base}/roles/${removing.id}`, 'DELETE'), 'Role taken away', () => setRemoving(null)); };
  const addException = () => run(send(`${base}/overrides`, 'POST', { permissionKey: exc.permissionKey, effect: exc.effect, reason: exc.reason, days: Number(exc.days) }), 'Exception saved', () => setExc({ permissionKey: '', effect: 'GRANT', reason: '', days: '14' }));
  const endException = (id: string) => run(send(`/api/system/overrides/${id}`, 'DELETE'), 'Exception ended');

  return (
    <div className="flex flex-col gap-4">
      {isSelf && <p className="rounded-2xl bg-tint px-4 py-3 text-sm text-ink">This is your own account. Nobody changes their own roles or exceptions, so ask the Owner or an Administrator.</p>}

      <section className="rounded-2xl bg-white p-4" aria-labelledby="roles-h">
        <h2 id="roles-h" className="text-sm font-semibold text-ink">Roles</h2>
        {view.roles.length === 0 ? <p className="mt-2 text-sm text-muted">No roles yet.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {view.roles.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="font-medium text-ink">{r.name}</span>{' '}
                  <span className="text-muted">{r.place ? `for ${r.place}` : 'for the whole school'}</span>{' '}
                  {!r.isSystem && <Badge variant="gold" label="Custom" />}
                </span>
                {!isSelf && <Can permission="system.users.edit"><Button size="sm" variant="secondary" onClick={() => setRemoving(r)}>Take away</Button></Can>}
              </li>
            ))}
          </ul>
        )}
        {!isSelf && (
          <Can permission="system.users.edit">
            <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
              <Select label="Give a role" placeholder="Choose a role" value={roleKey} options={roleChoices.map((r) => ({ value: r.key, label: r.name }))} onChange={(e) => { setRoleKey(e.target.value); setPin('SCHOOL'); setPlaceId(''); }} />
              {chosen && chosen.pins.length > 0 && (
                <Select label="Where" value={pin} options={[{ value: 'SCHOOL', label: 'The whole school' }, ...chosen.pins.map((p) => ({ value: p, label: `One ${PIN_LABEL[p]}` }))]} onChange={(e) => { setPin(e.target.value); setPlaceId(''); }} />
              )}
              {pin !== 'SCHOOL' && (
                <Select label={`Which ${PIN_LABEL[pin]}`} placeholder="Choose" value={placeId} options={places[pin as keyof typeof places].map((p) => ({ value: p.id, label: p.name }))} onChange={(e) => setPlaceId(e.target.value)} />
              )}
              <div className="flex items-end"><Button onClick={addRole} loading={busy} disabled={!roleKey || (pin !== 'SCHOOL' && !placeId)}>Give role</Button></div>
            </div>
          </Can>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4" aria-labelledby="exc-h">
        <h2 id="exc-h" className="text-sm font-semibold text-ink">Exceptions</h2>
        <p className="mt-1 text-xs text-muted">One permission, given or refused for a limited time (at most 90 days), with a reason. A refusal always wins over a grant.</p>
        {view.overrides.length === 0 ? <p className="mt-2 text-sm text-muted">No exceptions.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {view.overrides.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <Badge variant={o.effect === 'GRANT' ? 'info' : 'danger'} label={o.effect === 'GRANT' ? 'Allowed' : 'Refused'} /> <span className="font-medium text-ink">{o.label}</span>
                  <span className="block text-xs text-muted">{o.reason} · until {when(o.expiresAt)} · {STATE[o.state]} · given by {o.createdBy}</span>
                </span>
                {o.state === 'ACTIVE' && !isSelf && <Can permission="system.users.edit"><Button size="sm" variant="secondary" onClick={() => endException(o.id)} disabled={busy}>End now</Button></Can>}
              </li>
            ))}
          </ul>
        )}
        {!isSelf && (
          <Can permission="system.users.edit">
            <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
              <Select label="Permission" placeholder="Choose" value={exc.permissionKey} options={permissionChoices} onChange={(e) => setExc({ ...exc, permissionKey: e.target.value })} />
              <Select label="Allow or refuse" value={exc.effect} options={[{ value: 'GRANT', label: 'Allow it' }, { value: 'DENY', label: 'Refuse it' }]} onChange={(e) => setExc({ ...exc, effect: e.target.value })} />
              <Input label="Reason" value={exc.reason} onChange={(e) => setExc({ ...exc, reason: e.target.value })} maxLength={300} />
              <Input label="For how many days (1 to 90)" type="number" min={1} max={90} value={exc.days} onChange={(e) => setExc({ ...exc, days: e.target.value })} />
              <div><Button onClick={addException} loading={busy} disabled={!exc.permissionKey || !exc.reason.trim()}>Save exception</Button></div>
            </div>
          </Can>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4" aria-labelledby="can-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="can-h" className="text-sm font-semibold text-ink">What can {view.user.fullName} do?</h2>
          <Button size="sm" variant="ghost" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Hide the list' : 'Show the list'}</Button>
        </div>
        {view.everything && <p className="mt-2 text-sm text-ink">Full access to everything in the school.</p>}
        {showAll && !view.everything && (
          <div className="mt-3 flex flex-col gap-4">
            {view.effective.length === 0 && <p className="text-sm text-muted">Nothing yet.</p>}
            {view.effective.map((m) => (
              <div key={m.module}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle">{m.module}</h3>
                <ul className="mt-1 divide-y divide-line">
                  {m.keys.map((k) => (
                    <li key={k.key} className="flex flex-wrap justify-between gap-x-3 py-1.5 text-sm">
                      <span className="text-ink">{k.label}</span>
                      <span className="text-xs text-muted">{k.scopes.map((s) => SCOPE_TEXT[s] ?? s).join(', ')} · from {k.via.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4" aria-labelledby="den-h">
        <h2 id="den-h" className="text-sm font-semibold text-ink">Recent refused attempts</h2>
        {view.denied.length === 0 ? <p className="mt-2 text-sm text-muted">None recently.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {view.denied.map((d) => (
              <li key={d.id} className="flex flex-wrap justify-between gap-x-3 py-1.5 text-sm">
                <span className="text-ink">{d.detail ?? d.key}</span>
                <span className="text-xs text-muted">{new Date(d.at).toLocaleString('en-GB')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog open={!!removing} title="Take this role away?" confirmLabel="Take away" destructive loading={busy} onConfirm={removeRole} onCancel={() => setRemoving(null)}>
        {view.user.fullName} will lose {removing?.name}{removing?.place ? ` for ${removing.place}` : ''} straight away.
      </ConfirmDialog>
    </div>
  );
}
