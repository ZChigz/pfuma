'use client';

// Cover (relief) lessons: pick the day and the absent teacher, see their lessons, and give each to a free teacher. The free teachers
// are ranked by fewest covers this term, so the load is shared.
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { api, linkButton, Notice, problem, Section } from '@/components/academics/shared';

interface Lesson {
  slotId: string; periodNo: number; start: string; end: string; subject: string; target: string; room: string | null;
  covered: { id: string; teacherId: string; teacher: string } | null; free: { id: string; name: string; covers: number }[];
}

export function CoverClient({ teachers, today }: { teachers: { id: string; fullName: string }[]; today: string }) {
  const [date, setDate] = useState(today);
  const [teacherId, setTeacherId] = useState('');
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function find() {
    setBusy(true); setError(null);
    const r = await api(`/api/academics/timetable/cover?date=${date}&teacherId=${teacherId}`);
    setBusy(false);
    if (!r.ok) { setLessons(null); return setError(problem(r)); }
    setLessons(r.body.data.lessons as Lesson[]);
    setPick({});
  }
  async function assign(l: Lesson) {
    const coverTeacherId = pick[l.slotId] ?? l.free[0]?.id;
    if (!coverTeacherId) return;
    const r = await api('/api/academics/timetable/cover', 'POST', { date, slotId: l.slotId, coverTeacherId });
    if (!r.ok) return toast.error(problem(r));
    toast.success('Cover arranged. The teacher has been told.');
    await find();
  }
  async function remove(l: Lesson) {
    if (!l.covered) return;
    const r = await api(`/api/academics/timetable/cover/${l.covered.id}`, 'DELETE');
    if (!r.ok) return toast.error(problem(r));
    await find();
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="Who is absent?" action={<Link href={`/print/academics/cover?date=${date}`} target="_blank" className={linkButton}>Print the cover list</Link>}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44"><Input id="cv-date" type="date" label="Day" min={today} value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="min-w-[240px] flex-1"><Select id="cv-teacher" label="Absent teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} placeholder="Choose a teacher" options={teachers.map((t) => ({ value: t.id, label: t.fullName }))} /></div>
          <Button onClick={find} loading={busy} disabled={!teacherId || !date}>Show their lessons</Button>
        </div>
      </Section>

      {error && <Notice tone="warn">{error}</Notice>}
      {lessons && lessons.length === 0 && <Notice tone="info">This teacher has no lessons on that day.</Notice>}
      {lessons && lessons.length > 0 && (
        <Section title={`${lessons.length} lesson${lessons.length === 1 ? '' : 's'} to cover`} hint="Free teachers are listed with the fewest covers this term first.">
          <ul className="divide-y divide-line">
            {lessons.map((l) => (
              <li key={l.slotId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-ink">Period {l.periodNo} <span className="font-normal text-muted">{l.start}–{l.end}</span> · {l.subject} · {l.target}</p>
                  {l.room && <p className="text-sm text-muted">{l.room}</p>}
                </div>
                {l.covered ? (
                  <div className="flex items-center gap-3"><Badge variant="success" label={`Covered by ${l.covered.teacher}`} /><button type="button" onClick={() => remove(l)} className="text-sm font-semibold text-danger hover:underline">Cancel</button></div>
                ) : l.free.length === 0 ? (
                  <Badge variant="danger" label="Nobody is free" />
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select id={`cv-${l.slotId}`} aria-label="Cover teacher" value={pick[l.slotId] ?? l.free[0]!.id} onChange={(e) => setPick({ ...pick, [l.slotId]: e.target.value })} options={l.free.map((f) => ({ value: f.id, label: `${f.name} (${f.covers} cover${f.covers === 1 ? '' : 's'})` }))} />
                    <Button onClick={() => assign(l)}>Assign</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
