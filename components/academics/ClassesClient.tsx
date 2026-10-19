'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { api, ClosedNotice, Notice, problem, Td, Th } from '@/components/academics/shared';

export interface ClassRowData {
  id: string; name: string; classTeacherId: string | null; classTeacher: string | null; students: number; boys: number; girls: number; capacity: number;
  subjects: number; timetable: 'PUBLISHED' | 'DRAFT' | 'NONE'; today: 'MARKED' | 'NOT_MARKED' | 'NO_SCHOOL';
}

const TIMETABLE: Record<ClassRowData['timetable'], { label: string; variant: 'success' | 'warning' | 'neutral' }> = {
  PUBLISHED: { label: 'Published', variant: 'success' }, DRAFT: { label: 'Draft', variant: 'warning' }, NONE: { label: 'Not started', variant: 'neutral' },
};
const TODAY: Record<ClassRowData['today'], { label: string; variant: 'success' | 'danger' | 'neutral' }> = {
  MARKED: { label: 'Marked', variant: 'success' }, NOT_MARKED: { label: 'Not marked', variant: 'danger' }, NO_SCHOOL: { label: 'No school', variant: 'neutral' },
};

export function ClassesClient({ term, classes, staff, canManage }: {
  term: { id: string; name: string; status: string };
  classes: ClassRowData[];
  staff: { id: string; fullName: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const closed = term.status === 'CLOSED';
  const [assign, setAssign] = useState<ClassRowData | null>(null);
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [copy, setCopy] = useState(false);
  const [copyWhat, setCopyWhat] = useState({ classTeachers: true, assignments: true, studentSubjects: true });
  const [copyResult, setCopyResult] = useState<{ text: string; skipped: string[] } | null>(null);

  async function saveTeacher() {
    if (!assign) return;
    setBusy(true);
    const r = await api(`/api/academics/classes/${assign.id}/class-teacher`, 'PUT', { termId: term.id, userId: userId || null });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    const w = (r.body.data?.warnings ?? []) as string[];
    if (w.length) { setWarning(w[0]!); toast.info('Saved. Please read the note.'); } else { toast.success('Class teacher saved'); setAssign(null); }
    router.refresh();
  }

  async function runCopy() {
    setBusy(true);
    const r = await api('/api/academics/classes/copy', 'POST', { termId: term.id, ...copyWhat });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    const d = r.body.data;
    setCopyResult({ text: `Copied from ${d.from}: ${d.classTeachers} class teachers, ${d.assignments} teacher assignments, ${d.groups} teaching groups, ${d.studentSubjects} subject choices.`, skipped: d.skipped ?? [] });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {closed && <ClosedNotice termName={term.name} />}
      {canManage && !closed && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => { setCopy(true); setCopyResult(null); }}>Copy from last term</Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl bg-white">
        <table className="min-w-full divide-y divide-line">
          <caption className="sr-only">Classes of {term.name}</caption>
          <thead>
            <tr>
              <Th>Class</Th><Th>Class teacher</Th><Th className="text-right">Students (B / G)</Th><Th className="text-right">Capacity</Th>
              <Th className="text-right">Subjects</Th><Th>Timetable</Th><Th>Today</Th>{canManage && <Th><span className="sr-only">Actions</span></Th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {classes.length === 0 && <tr><Td className="py-8 text-center text-muted" >No classes yet. Create forms, streams and classes in School Settings.</Td></tr>}
            {classes.map((c) => (
              <tr key={c.id} className="hover:bg-rowhover">
                <Td><Link href={`/academics/classes/${c.id}`} className="font-semibold text-primary hover:underline">{c.name}</Link></Td>
                <Td>{c.classTeacher ?? <span className="text-muted">None yet</span>}</Td>
                <Td className="text-right tabular-nums">
                  <span className={c.students > c.capacity ? 'font-semibold text-danger' : ''}>{c.students}</span>
                  <span className="text-muted"> ({c.boys} / {c.girls})</span>
                </Td>
                <Td className="text-right tabular-nums">{c.capacity}</Td>
                <Td className="text-right tabular-nums">{c.subjects}</Td>
                <Td><Badge variant={TIMETABLE[c.timetable].variant} label={TIMETABLE[c.timetable].label} /></Td>
                <Td><Badge variant={TODAY[c.today].variant} label={TODAY[c.today].label} /></Td>
                {canManage && (
                  <Td className="text-right">
                    {!closed && <button type="button" onClick={() => { setAssign(c); setUserId(c.classTeacherId ?? ''); setWarning(null); }} className="text-sm font-semibold text-primary hover:underline">Class teacher</button>}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!assign}
        onClose={() => setAssign(null)}
        title={assign ? `Class teacher of ${assign.name}` : ''}
        footer={<><Button variant="secondary" onClick={() => setAssign(null)}>Close</Button><Button onClick={saveTeacher} loading={busy}>Save</Button></>}
      >
        <div className="flex flex-col gap-3">
          <Select
            id="class-teacher" label="Staff member" value={userId} onChange={(e) => setUserId(e.target.value)}
            placeholder="No class teacher" options={staff.map((s) => ({ value: s.id, label: s.fullName }))}
            hint="They get the Class Teacher role for this class only, and mark its daily register."
          />
          {warning && <Notice tone="warn">{warning}</Notice>}
        </div>
      </Modal>

      <Modal
        open={copy}
        onClose={() => setCopy(false)}
        title={`Copy into ${term.name}`}
        footer={<><Button variant="secondary" onClick={() => setCopy(false)}>Close</Button>{!copyResult && <Button onClick={runCopy} loading={busy}>Copy</Button>}</>}
      >
        {copyResult ? (
          <div className="flex flex-col gap-3">
            <Notice tone="success">{copyResult.text}</Notice>
            {copyResult.skipped.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-semibold text-ink">Left out ({copyResult.skipped.length})</p>
                <ul className="max-h-48 list-disc overflow-auto pl-5 text-sm text-muted">{copyResult.skipped.map((s) => <li key={s}>{s}</li>)}</ul>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm text-ink">
            <p className="text-muted">Copies from the term before this one. You can edit everything afterwards. Anything already set in this term stays as it is.</p>
            {([['classTeachers', 'Class teachers'], ['assignments', 'Teacher assignments (with teaching groups)'], ['studentSubjects', "Students' chosen subjects"]] as const).map(([k, label]) => (
              <label key={k} className="flex min-h-[44px] items-center gap-3">
                <input type="checkbox" className="h-5 w-5" checked={copyWhat[k]} onChange={(e) => setCopyWhat({ ...copyWhat, [k]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
