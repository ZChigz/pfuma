'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { api, Checkbox, problem, Section, useBusy } from '@/components/students/shared';

const DOCS: [string, string][] = [
  ['BIRTH_CERTIFICATE', 'Birth certificate'], ['GUARDIAN_ID', 'Guardian ID'], ['GRADE7_RESULTS_SLIP', 'Grade 7 results slip'], ['OLEVEL_RESULTS_SLIP', 'O Level results slip'],
  ['PREVIOUS_SCHOOL_REPORT', 'Previous school report'], ['TRANSFER_LETTER_RECEIVED', 'Transfer letter (from previous school)'], ['MEDICAL_REPORT', 'Medical report'], ['PHOTO_CONSENT', 'Photo consent'],
];

interface House { id: string; name: string; colour: string; students: number }

// Houses (sports or boarding) and the documents every student file must hold.
export function StudentsTab({ houses, required, canUpdate }: { houses: House[]; required: string[]; canUpdate: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [colour, setColour] = useState('#1F7A4D');
  const [edit, setEdit] = useState<{ id: string; name: string; colour: string } | null>(null);
  const [types, setTypes] = useState<string[]>(required);
  const { busy, run } = useBusy();

  async function saveHouse(id: string | null, h: { name: string; colour: string }) {
    const r = await run(() => api(id ? `/api/system/houses/${id}` : '/api/system/houses', id ? 'PATCH' : 'POST', h));
    if (r && !r.ok) { toast.error(problem(r)); return; }
    toast.success(id ? 'House saved' : 'House added');
    setName(''); setEdit(null); router.refresh();
  }
  async function saveDocs() {
    const r = await run(() => api('/api/system/settings/documents', 'PUT', { types }));
    if (r && !r.ok) toast.error(problem(r)); else toast.success('Saved');
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="Houses">
        <p className="mb-3 text-sm text-muted">Sports or boarding houses. Students are put in a house from the Students list or their profile.</p>
        <ul className="flex flex-col divide-y divide-line">
          {houses.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="h-5 w-5 flex-shrink-0 rounded-full border border-line" style={{ background: h.colour }} aria-hidden="true" />
              {edit?.id === h.id ? (
                <>
                  <Input id={`hn-${h.id}`} aria-label="House name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                  <input type="color" aria-label="Colour" value={edit.colour} onChange={(e) => setEdit({ ...edit, colour: e.target.value })} className="h-11 w-14" />
                  <Button size="sm" loading={busy} onClick={() => saveHouse(h.id, edit)}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
                </>
              ) : (
                <>
                  <span className="flex-1 font-medium text-ink">{h.name}</span><span className="text-sm text-muted">{h.students} student{h.students === 1 ? '' : 's'}</span>
                  {canUpdate && <Button size="sm" variant="ghost" onClick={() => setEdit({ id: h.id, name: h.name, colour: h.colour })}>Edit</Button>}
                </>
              )}
            </li>
          ))}
          {houses.length === 0 && <li className="py-2 text-sm text-muted">No houses yet.</li>}
        </ul>
        {canUpdate && (
          <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void saveHouse(null, { name, colour }); }}>
            <Input id="new-house" label="New house" value={name} onChange={(e) => setName(e.target.value)} />
            <input type="color" aria-label="Colour" value={colour} onChange={(e) => setColour(e.target.value)} className="h-11 w-14" />
            <Button type="submit" loading={busy} disabled={name.trim().length < 2}>Add house</Button>
          </form>
        )}
      </Section>
      <Section title="Required student documents">
        <p className="mb-2 text-sm text-muted">The Documents tab of every student shows which of these are missing.</p>
        {DOCS.map(([value, label]) => <Checkbox key={value} label={label} checked={types.includes(value)} disabled={!canUpdate} onChange={(v) => setTypes((t) => (v ? [...t, value] : t.filter((x) => x !== value)))} />)}
        {canUpdate && <div className="mt-3"><Button loading={busy} onClick={saveDocs}>Save</Button></div>}
      </Section>
    </div>
  );
}
