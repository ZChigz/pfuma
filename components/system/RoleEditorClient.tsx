'use client';
// A role's grid: every page and what can be done on it, with the scope each grant has. System roles are read-only;
// a custom role can have permissions taken out or narrowed (and, for the Owner, added).
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { send } from '@/components/access/send';
import { SCOPES, SCOPE_WIDTH, narrowsOrEquals, type Scope } from '@/lib/access/types';
import type { CatalogueModule } from '@/lib/access/catalogue';

const SCOPE_LABEL: Record<string, string> = {
  SCHOOL: 'Whole school', DEPARTMENT: 'Their department', CLASS: 'Their class', ASSIGNED: 'Assigned to them', HOSTEL: 'Their hostel',
  STORE: 'Their store', RECORDED_BY_ME: 'Recorded by them', SELF: 'Only their own', CHILDREN: 'Their children',
};
const CHOOSABLE = SCOPES.filter((s) => s !== 'CHILDREN');

interface Props {
  roleKey: string;
  name: string;
  description: string;
  isSystem: boolean;
  /** Key → scope the role grants. */
  grants: Record<string, string>;
  catalogue: CatalogueModule[];
  /** Whether the person may change a custom role at all, and whether they may also add permissions (the Owner). */
  canEdit: boolean;
  canAdd: boolean;
  holders: number;
}

export function RoleEditorClient({ roleKey, name, description, isSystem, grants, catalogue, canEdit, canAdd, holders }: Props) {
  const router = useRouter();
  const editable = canEdit && !isSystem;
  const original = useMemo(() => grants, [grants]);
  const [draft, setDraft] = useState<Record<string, string>>(grants);
  const [title, setTitle] = useState(name);
  const [about, setAbout] = useState(description);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = title !== name || about !== description || JSON.stringify(Object.entries(draft).sort()) !== JSON.stringify(Object.entries(original).sort());

  const toggle = (key: string) =>
    setDraft((d) => {
      const next = { ...d };
      if (key in next) delete next[key];
      else next[key] = 'SCHOOL';
      return next;
    });

  async function save() {
    setBusy(true);
    const r = await send(`/api/system/roles/${roleKey}`, 'PATCH', { name: title, description: about, grants: Object.entries(draft).map(([key, scope]) => ({ key, scope })) });
    setBusy(false);
    if (!r.ok) { toast.error(r.message); return; }
    toast.success('Role saved');
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    const r = await send(`/api/system/roles/${roleKey}`, 'DELETE');
    setBusy(false);
    setConfirmDelete(false);
    if (!r.ok) { toast.error(r.message); return; }
    toast.success('Role deleted');
    router.push('/system/roles');
    router.refresh();
  }

  /** Scopes a cell may take: any for the Owner, otherwise the one saved or narrower. */
  const optionsFor = (key: string) => {
    const saved = original[key] as Scope | undefined;
    return saved && !canAdd ? CHOOSABLE.filter((s) => narrowsOrEquals(saved, s)) : [...CHOOSABLE].sort((a, b) => SCOPE_WIDTH[a] - SCOPE_WIDTH[b]);
  };

  return (
    <div className="flex flex-col gap-4">
      {editable && (
        <div className="grid gap-3 rounded-2xl bg-white p-4 sm:grid-cols-2">
          <Input label="Role name" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
          <Input label="What it is for" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={200} />
        </div>
      )}
      <p className="rounded-2xl bg-tint px-4 py-3 text-sm text-ink">
        {isSystem
          ? 'This is a system role. It cannot be changed, but you can copy it into a custom role of your own.'
          : editable
            ? canAdd
              ? 'Tick what this role may do and choose how far it reaches. The Owner can add permissions as well as take them away.'
              : 'You can take permissions out of this role or narrow how far they reach. Only the Owner can add permissions.'
            : 'This custom role can only be changed by someone who manages users.'}
      </p>

      {catalogue.map((m) => (
        <section key={m.module} className="overflow-x-auto rounded-2xl bg-white" aria-label={m.title}>
          <h2 className="px-4 pt-4 text-sm font-semibold text-ink">{m.title}</h2>
          <table className="mt-2 w-full min-w-[560px] text-left text-sm text-ink">
            <tbody className="divide-y divide-line">
              {m.pages.map((p) => {
                const cells = p.actions.filter((a) => {
                  const on = a.key in draft;
                  return on || (editable && canAdd);
                });
                if (!cells.length) return null;
                return (
                  <tr key={p.page}>
                    <th scope="row" className="w-40 px-4 py-2.5 align-top text-left font-medium">{p.title}</th>
                    <td className="px-3 py-2">
                      <ul className="flex flex-wrap gap-2">
                        {cells.map((a) => {
                          const scope = draft[a.key];
                          const on = scope !== undefined;
                          return (
                            <li key={a.key} className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 ${on ? 'border-success/40 bg-success-bg' : 'border-line'}`}>
                              {editable ? (
                                <label className="flex min-h-[32px] items-center gap-1.5">
                                  <input type="checkbox" checked={on} onChange={() => toggle(a.key)} aria-label={a.label} />
                                  <span>{a.label}</span>
                                </label>
                              ) : (
                                <span><span className="font-semibold text-success" aria-hidden="true">✓ </span>{a.label}</span>
                              )}
                              {on && editable && (
                                <select aria-label={`How far: ${a.label}`} className="rounded-lg border border-line bg-white px-1.5 py-1 text-xs" value={scope} onChange={(e) => setDraft((d) => ({ ...d, [a.key]: e.target.value }))}>
                                  {optionsFor(a.key).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                                </select>
                              )}
                              {on && !editable && scope !== 'SCHOOL' && <span className="text-xs text-muted">{SCOPE_LABEL[scope!]}</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} loading={busy} disabled={!dirty}>Save role</Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy}>Delete role</Button>
        </div>
      )}
      <ConfirmDialog open={confirmDelete} title="Delete this role?" confirmLabel="Delete role" destructive loading={busy} onConfirm={remove} onCancel={() => setConfirmDelete(false)}>
        {holders > 0 ? `${holders} ${holders === 1 ? 'person holds' : 'people hold'} this role. Give them another role first.` : `${name} will be removed. This cannot be undone.`}
      </ConfirmDialog>
    </div>
  );
}
