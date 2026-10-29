'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { DEFAULT_A_LEVEL_STREAMS, DEFAULT_STREAMS, classDisplayName } from '@/lib/academic/rules';

type Category = 'O_LEVEL' | 'A_LEVEL';
type Level = { id: string; name: string; order: number; category: Category; active: boolean };

export interface StructureData {
  defaultCapacity: number;
  levels: Level[];
  streams: { id: string; name: string; category: Category }[];
  classes: { id: string; name: string; levelId: string; stream: string; capacity: number; active: boolean; teacher: string | null; studentsEver: number; studentsNow: number }[];
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ok: res.ok, json: await res.json().catch(() => ({})) };
}
const firstError = (json: { errors?: Record<string, string[]>; message?: string }, fallback: string) =>
  json.errors ? Object.values(json.errors).flat()[0] : json.message ?? fallback;

type Cell = { exists: boolean; capacity: string };
const keyOf = (levelId: string, stream: string) => `${levelId}|${stream.toLowerCase()}`;

export function StructureTab({ data, canUpdate }: { data: StructureData; canUpdate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // ── forms
  const [formsOn, setFormsOn] = useState<Record<string, boolean>>(() => Object.fromEntries(data.levels.map((l) => [l.id, l.active])));
  // After a save the page reloads its data; start the editors from it again.
  useEffect(() => setFormsOn(Object.fromEntries(data.levels.map((l) => [l.id, l.active]))), [data.levels]);
  const formsChanged = data.levels.some((l) => formsOn[l.id] !== l.active);
  const [confirmForms, setConfirmForms] = useState(false);
  const switchingOff = data.levels.filter((l) => l.active && !formsOn[l.id]);

  async function saveForms() {
    setBusy(true);
    try {
      const { ok, json } = await send('/api/system/structure/forms', 'PATCH', { forms: data.levels.map((l) => ({ id: l.id, active: formsOn[l.id] })) });
      setConfirmForms(false);
      if (!ok) { toast.error(firstError(json, 'Could not save the forms')); return; }
      toast.success('Forms saved');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // ── streams
  const [newStream, setNewStream] = useState<Record<Category, string>>({ O_LEVEL: '', A_LEVEL: '' });
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  async function streamCall(url: string, method: string, body: unknown, done: string) {
    setBusy(true);
    try {
      const { ok, json } = await send(url, method, body);
      if (!ok) { toast.error(firstError(json, 'That did not work')); return false; }
      toast.success(done);
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }
  async function addStream(name: string, category: Category) {
    if (await streamCall('/api/system/structure/streams', 'POST', { name, category }, `${name} added`)) setNewStream((n) => ({ ...n, [category]: '' }));
  }

  // ── classes grid
  const initialCells = useMemo(() => {
    const m: Record<string, Cell> = {};
    for (const c of data.classes) m[keyOf(c.levelId, c.stream)] = { exists: c.active, capacity: String(c.capacity) };
    return m;
  }, [data.classes]);
  const [cells, setCells] = useState<Record<string, Cell>>(initialCells);
  useEffect(() => setCells(initialCells), [initialCells]);
  // Each form offers the streams of its own level: North, South, East for Form 1 to 4, and
  // Sciences, Commercials, Arts for Form 5 and 6.
  const columnsFor = (l: Level) => {
    const names = data.streams.filter((s) => s.category === l.category).map((s) => s.name);
    // A class already made with another stream keeps showing, so nothing goes missing.
    for (const c of data.classes) {
      if (c.levelId === l.id && c.stream !== '' && !names.some((n) => n.toLowerCase() === c.stream.toLowerCase())) names.push(c.stream);
    }
    // A form with a single class and no stream gets a column of its own.
    const noStream = names.length === 0 || data.classes.some((c) => c.levelId === l.id && c.stream === '');
    return noStream ? ['', ...names] : names;
  };
  const classAt = (levelId: string, stream: string) => data.classes.find((c) => c.levelId === levelId && c.stream.toLowerCase() === stream.toLowerCase());
  const cellOf = (levelId: string, stream: string): Cell => cells[keyOf(levelId, stream)] ?? { exists: false, capacity: String(data.defaultCapacity) };
  const setCell = (levelId: string, stream: string, change: Partial<Cell>) => setCells((all) => ({ ...all, [keyOf(levelId, stream)]: { ...cellOf(levelId, stream), ...change } }));

  const activeLevels = data.levels.filter((l) => l.active);
  const gridChanged = activeLevels.some((l) => columnsFor(l).some((s) => {
    const was = initialCells[keyOf(l.id, s)];
    const now = cellOf(l.id, s);
    return (was?.exists ?? false) !== now.exists || (now.exists && was?.capacity !== now.capacity);
  }));
  const [confirmGrid, setConfirmGrid] = useState(false);
  const removed = activeLevels.flatMap((l) => columnsFor(l).filter((s) => classAt(l.id, s)?.active && !cellOf(l.id, s).exists).map((s) => classAt(l.id, s)!));

  async function saveGrid() {
    setBusy(true);
    try {
      const body = {
        cells: activeLevels.flatMap((l) => columnsFor(l).map((s) => ({ levelId: l.id, stream: s, exists: cellOf(l.id, s).exists, capacity: Number(cellOf(l.id, s).capacity) || 0 }))),
      };
      const { ok, json } = await send('/api/system/structure/classes', 'PUT', body);
      setConfirmGrid(false);
      if (!ok) { toast.error(firstError(json, 'Could not save the classes')); return; }
      const r = json.data;
      const parts = [r.created && `${r.created} added`, r.restored && `${r.restored} restored`, r.updated && `${r.updated} changed`, r.archived && `${r.archived} archived`, r.deleted && `${r.deleted} deleted`].filter(Boolean);
      toast.success(parts.length ? `Classes saved: ${parts.join(', ')}` : 'Nothing to change');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // ── default capacity
  const [capacity, setCapacity] = useState(String(data.defaultCapacity));
  useEffect(() => setCapacity(String(data.defaultCapacity)), [data.defaultCapacity]);
  async function saveCapacity() {
    setBusy(true);
    try {
      const { ok, json } = await send('/api/system/settings/defaults', 'PATCH', { maxClassSize: Number(capacity) });
      if (!ok) { toast.error(firstError(json, 'Could not save')); return; }
      toast.success('Default capacity saved');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const lock = !canUpdate;

  return (
    <div className="flex flex-col gap-4">
      <Card title="Forms" subtitle="Switch off the forms your school does not have, for example no A Level">
        <ul className="divide-y divide-line">
          {data.levels.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-sm text-ink">{l.name} <span className="text-xs text-muted">{l.category === 'A_LEVEL' ? 'A Level' : 'O Level'}</span></span>
              <button
                type="button" role="switch" aria-checked={formsOn[l.id]} aria-label={`${l.name} is ${formsOn[l.id] ? 'on' : 'off'}`}
                disabled={lock} onClick={() => setFormsOn((f) => ({ ...f, [l.id]: !f[l.id] }))}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center disabled:opacity-50"
              >
                <span className={`relative inline-block h-6 w-11 rounded-full transition-colors ${formsOn[l.id] ? 'bg-primary' : 'bg-line'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${formsOn[l.id] ? 'left-[22px]' : 'left-0.5'}`} />
                </span>
              </button>
            </li>
          ))}
        </ul>
        {canUpdate && formsChanged && (
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setFormsOn(Object.fromEntries(data.levels.map((l) => [l.id, l.active])))} disabled={busy}>Undo</Button>
            <Button onClick={() => (switchingOff.length ? setConfirmForms(true) : saveForms())} loading={busy && !confirmForms}>Save forms</Button>
          </div>
        )}
      </Card>

      <Card title="Streams" subtitle="The names your classes use. Form 1 to 4 usually use North, South and East; Form 5 and 6 are named for what they study.">
        <div className="flex flex-col gap-5">
          {([
            { category: 'O_LEVEL', title: 'O Level (Form 1 to 4)', defaults: DEFAULT_STREAMS },
            { category: 'A_LEVEL', title: 'A Level (Form 5 and 6)', defaults: DEFAULT_A_LEVEL_STREAMS },
          ] as const).map(({ category, title, defaults }) => {
            const list = data.streams.filter((s) => s.category === category);
            return (
              <section key={category}>
                <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
                {list.length === 0 ? (
                  <p className="text-sm text-muted">No streams yet.{canUpdate && ` Add your own below, or start with ${defaults.join(', ')}.`}</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {list.map((s) => (
                      <li key={s.id} className="flex items-center gap-1 rounded-full bg-tint pl-4 text-sm text-ink">
                        {s.name}
                        {canUpdate && (
                          <>
                            <button type="button" onClick={() => setRenaming({ id: s.id, name: s.name })} className="min-h-[44px] px-2 text-xs font-semibold text-primary hover:underline">Rename</button>
                            <button type="button" onClick={() => setRemoving(s)} aria-label={`Remove ${s.name}`} className="min-h-[44px] min-w-[44px] pr-2 text-danger hover:underline">×</button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canUpdate && (
                  <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (newStream[category].trim()) void addStream(newStream[category], category); }}>
                    <div className="min-w-[10rem] flex-1 sm:max-w-xs">
                      <Input id={`stream-new-${category}`} label={`New ${category === 'A_LEVEL' ? 'A Level' : 'O Level'} stream`} value={newStream[category]} maxLength={30} onChange={(e) => setNewStream((n) => ({ ...n, [category]: e.target.value }))} />
                    </div>
                    <Button type="submit" disabled={!newStream[category].trim()} loading={busy}>Add stream</Button>
                    {list.length === 0 && (
                      <Button type="button" variant="secondary" disabled={busy} onClick={async () => { for (const n of defaults) await addStream(n, category); }}>
                        Use {defaults.join(', ')}
                      </Button>
                    )}
                  </form>
                )}
              </section>
            );
          })}
        </div>
      </Card>

      <Card title="Classes" subtitle="Tick the classes your school has and set how many students each can hold. The class name is made for you.">
        {activeLevels.length === 0 ? (
          <p className="text-sm text-muted">Switch on at least one form.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {activeLevels.map((l) => (
              <fieldset key={l.id} className="rounded-xl border border-line p-3">
                <legend className="px-1 text-sm font-semibold text-ink">{l.name}</legend>
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {columnsFor(l).map((s) => {
                    const cell = cellOf(l.id, s);
                    const existing = classAt(l.id, s);
                    const label = classDisplayName(l.name, s);
                    return (
                      <li key={s || 'none'} className="flex items-center gap-3 rounded-lg bg-canvas px-3 py-1.5">
                        <label className="flex min-h-[44px] flex-1 items-center gap-3 text-sm text-ink">
                          <input type="checkbox" disabled={lock} checked={cell.exists} onChange={(e) => setCell(l.id, s, { exists: e.target.checked })} className="h-5 w-5 accent-primary" />
                          <span className="min-w-0">
                            <span className="block truncate">{label}</span>
                            {existing && !existing.active && <Badge variant="neutral" label="Archived" />}
                            {existing && existing.active && existing.studentsNow > 0 && <span className="block text-[11px] text-muted">{existing.studentsNow} students</span>}
                            {existing?.teacher && <span className="block text-[11px] text-muted">{existing.teacher}</span>}
                          </span>
                        </label>
                        {cell.exists && (
                          <label className="flex items-center gap-1 text-xs text-muted">
                            <span className="sr-only">Capacity of {label}</span>
                            <input
                              type="number" inputMode="numeric" min={1} max={200} disabled={lock} value={cell.capacity}
                              onChange={(e) => setCell(l.id, s, { capacity: e.target.value })}
                              className="min-h-[44px] w-16 rounded-lg border border-line bg-white px-2 text-center text-sm text-ink"
                            />
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ))}
            <p className="text-xs text-muted">A class that has had students is archived, not deleted, so its history is kept. A class teacher is chosen later.</p>
            {canUpdate && gridChanged && (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setCells(initialCells)} disabled={busy}>Undo</Button>
                <Button onClick={() => (removed.length ? setConfirmGrid(true) : saveGrid())} loading={busy && !confirmGrid}>Save classes</Button>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="Default class capacity" subtitle="New classes start with this many places">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void saveCapacity(); }}>
          <div className="w-32"><Input id="cap" label="Students" type="number" inputMode="numeric" min={1} max={200} disabled={lock} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
          {canUpdate && <Button type="submit" disabled={Number(capacity) === data.defaultCapacity} loading={busy}>Save</Button>}
        </form>
      </Card>

      <ConfirmDialog open={confirmForms} title="Switch off these forms?" confirmLabel="Switch off" destructive loading={busy} onCancel={() => setConfirmForms(false)} onConfirm={saveForms}>
        {switchingOff.map((l) => l.name).join(', ')}: its classes are archived and it disappears from the choices for new students. Nothing is deleted. You can switch it on again.
      </ConfirmDialog>

      <ConfirmDialog open={confirmGrid} title="Remove these classes?" confirmLabel="Save classes" destructive loading={busy} onCancel={() => setConfirmGrid(false)} onConfirm={saveGrid}>
        <p>{removed.map((c) => c.name).join(', ')}.</p>
        <p className="mt-2">A class that has never had students is deleted. One with a history is archived and kept.</p>
      </ConfirmDialog>

      <ConfirmDialog open={removing !== null} title={`Remove ${removing?.name ?? ''}?`} confirmLabel="Remove" destructive loading={busy} onCancel={() => setRemoving(null)}
        onConfirm={async () => { if (removing && (await streamCall(`/api/system/structure/streams/${removing.id}`, 'DELETE', undefined, `${removing.name} removed`))) setRemoving(null); else setRemoving(null); }}>
        A stream that classes use cannot be removed.
      </ConfirmDialog>

      <ConfirmDialog open={renaming !== null} title="Rename stream" confirmLabel="Rename" loading={busy} onCancel={() => setRenaming(null)}
        onConfirm={async () => { if (renaming && (await streamCall(`/api/system/structure/streams/${renaming.id}`, 'PATCH', { name: renaming.name }, 'Stream renamed'))) setRenaming(null); }}>
        {renaming && (
          <>
            <p className="mb-2">Its classes are renamed to match, for example Form 2 East becomes Form 2 {renaming.name || '…'}.</p>
            <Input id="stream-rename" label="New name" value={renaming.name} maxLength={30} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
