'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { api, ClosedNotice, Dot, Notice, problem } from '@/components/academics/shared';

interface Subject { id: string; name: string; shortName: string; colour: string; type: 'CORE' | 'ELECTIVE' }
interface Row { id: string; fullName: string; surname: string; admissionNumber: string; gender: string | null; subjects: Record<string, string>; count: number; warnings: { code: string; message: string }[] }
interface Grid {
  term: { id: string; name: string; status: string }; class: { id: string; name: string }; limits: { min: number; max: number };
  subjects: Subject[]; students: Row[]; combinations: { id: string; name: string; subjectIds: string[] }[];
}

export function StudentSubjectsClient({ classes, classId, grid, canManage }: { classes: { id: string; name: string }[]; classId: string | null; grid: Grid | null; canManage: boolean }) {
  const router = useRouter();
  const electives = useMemo(() => grid?.subjects.filter((s) => s.type === 'ELECTIVE') ?? [], [grid]);
  const core = useMemo(() => grid?.subjects.filter((s) => s.type === 'CORE') ?? [], [grid]);
  const original = useMemo(() => Object.fromEntries((grid?.students ?? []).map((s) => [s.id, electives.filter((e) => e.id in s.subjects).map((e) => e.id)])), [grid, electives]);
  const [chosen, setChosen] = useState<Record<string, string[]>>(original);
  const [picked, setPicked] = useState<string[]>([]);
  const [combo, setCombo] = useState('');
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<{ studentName: string; message: string }[]>([]);
  const closed = grid?.term.status === 'CLOSED';
  const editable = canManage && !closed;

  const dirty = (grid?.students ?? []).filter((s) => [...(chosen[s.id] ?? [])].sort().join() !== [...(original[s.id] ?? [])].sort().join());

  function toggle(studentId: string, subjectId: string) {
    const cur = chosen[studentId] ?? [];
    setChosen({ ...chosen, [studentId]: cur.includes(subjectId) ? cur.filter((x) => x !== subjectId) : [...cur, subjectId] });
  }

  async function save() {
    if (!grid) return;
    setBusy(true);
    const r = await api('/api/academics/student-subjects', 'PUT', { termId: grid.term.id, classId: grid.class.id, changes: dirty.map((s) => ({ studentId: s.id, subjectIds: chosen[s.id] ?? [] })) });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    setWarnings((r.body.data.warnings ?? []) as { studentName: string; message: string }[]);
    toast.success(`Saved for ${r.body.data.changedStudents} student${r.body.data.changedStudents === 1 ? '' : 's'}`);
    router.refresh();
  }

  async function apply() {
    if (!grid || !combo || picked.length === 0) return;
    setBusy(true);
    const r = await api('/api/academics/student-subjects/apply-combination', 'POST', { termId: grid.term.id, classId: grid.class.id, combinationId: combo, studentIds: picked });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    setWarnings((r.body.data.warnings ?? []) as { studentName: string; message: string }[]);
    toast.success(`Combination applied to ${r.body.data.applied} student${r.body.data.applied === 1 ? '' : 's'}`);
    setPicked([]);
    router.refresh();
  }

  async function syncCore() {
    if (!grid) return;
    const r = await api('/api/academics/student-subjects/sync-core', 'POST', { termId: grid.term.id, classId: grid.class.id });
    if (!r.ok) return toast.error(problem(r));
    toast.success(r.body.data.added ? `Core subjects added (${r.body.data.added})` : 'Core subjects are already up to date');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <Select id="ss-class" label="Class" value={classId ?? ''} placeholder="Choose a class" options={classes.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => router.push(e.target.value ? `?classId=${e.target.value}` : '?')} />
        </div>
        {grid && <p className="pb-2 text-sm text-muted">{grid.term.name} · each student takes {grid.limits.min} to {grid.limits.max} subjects</p>}
      </div>

      {!grid && <p className="rounded-2xl bg-white p-8 text-center text-sm text-muted">Choose a class to see and set its students&apos; subjects.</p>}
      {grid && closed && <ClosedNotice termName={grid.term.name} />}

      {grid && (
        <>
          {grid.students.length === 0 && <p className="rounded-2xl bg-white p-8 text-center text-sm text-muted">No students are enrolled in this class this term.</p>}

          {editable && grid.students.length > 0 && (
            <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4">
              <div className="min-w-[220px]">
                <Select id="ss-combo" label="Apply a combination to the ticked students" value={combo} onChange={(e) => setCombo(e.target.value)} placeholder="Choose a combination" options={grid.combinations.map((c) => ({ value: c.id, label: c.name }))} />
              </div>
              <Button variant="secondary" onClick={apply} disabled={!combo || picked.length === 0} loading={busy}>Apply to {picked.length} student{picked.length === 1 ? '' : 's'}</Button>
              <Button variant="ghost" onClick={syncCore}>Add core subjects</Button>
            </div>
          )}

          {warnings.length > 0 && (
            <Notice tone="warn">
              <p className="mb-1 font-semibold">Saved, with notes:</p>
              <ul className="list-disc pl-5">{warnings.slice(0, 10).map((w, i) => <li key={i}>{w.studentName}: {w.message}</li>)}</ul>
            </Notice>
          )}

          {grid.students.length > 0 && (
            <div className="overflow-x-auto rounded-2xl bg-white">
              <table className="min-w-full divide-y divide-line">
                <caption className="sr-only">Subjects each student takes</caption>
                <thead>
                  <tr>
                    {editable && <th scope="col" className="px-3 py-2"><span className="sr-only">Select</span></th>}
                    <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Student</th>
                    {core.length > 0 && <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Core</th>}
                    {electives.map((e) => <th key={e.id} scope="col" className="px-2 py-2 text-center text-xs font-semibold text-muted"><span className="flex flex-col items-center gap-1"><Dot colour={e.colour} />{e.shortName}</span></th>)}
                    <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted">Subjects</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {grid.students.map((s) => {
                    const count = core.length + (chosen[s.id] ?? []).length;
                    const wrong = count < grid.limits.min || count > grid.limits.max;
                    return (
                      <tr key={s.id} className={dirty.some((d) => d.id === s.id) ? 'bg-tint/60' : 'hover:bg-rowhover'}>
                        {editable && <td className="px-3 py-2"><input type="checkbox" className="h-5 w-5" aria-label={`Select ${s.fullName}`} checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} /></td>}
                        <td className="whitespace-nowrap px-3 py-2 text-sm"><b className="uppercase">{s.surname}</b>, {s.fullName.replace(s.surname, '').trim()}</td>
                        {core.length > 0 && <td className="px-3 py-2 text-xs text-muted">{core.length} core</td>}
                        {electives.map((e) => (
                          <td key={e.id} className="px-2 py-2 text-center">
                            <input type="checkbox" className="h-5 w-5" aria-label={`${s.fullName}: ${e.name}`} disabled={!editable} checked={(chosen[s.id] ?? []).includes(e.id)} onChange={() => toggle(s.id, e.id)} />
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-3 py-2 text-right text-sm">
                          <span className={wrong ? 'font-semibold text-warn' : ''}>{count}</span>
                          {s.warnings.filter((w) => w.code === 'CLASH').map((w) => <Badge key={w.message} variant="warning" label="Clash" className="ml-1" />)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {grid.students.some((s) => s.warnings.some((w) => w.code === 'CLASH')) && (
            <Notice tone="warn">
              <p className="mb-1 font-semibold">Timetable clashes</p>
              <ul className="list-disc pl-5">{grid.students.flatMap((s) => s.warnings.filter((w) => w.code === 'CLASH').map((w) => <li key={s.id + w.message}>{s.fullName}: {w.message}</li>))}</ul>
            </Notice>
          )}

          {editable && grid.students.length > 0 && (
            <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-2xl bg-white p-3 shadow-[0_-8px_24px_-12px_rgba(20,48,31,0.25)]">
              <p className="text-sm text-muted">{dirty.length === 0 ? 'No changes yet.' : `${dirty.length} student${dirty.length === 1 ? '' : 's'} changed.`}</p>
              <Button onClick={save} loading={busy} disabled={dirty.length === 0}>Save changes</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
