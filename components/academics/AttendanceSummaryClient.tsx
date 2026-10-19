'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { api, Notice, problem, Section, Td, Th } from '@/components/academics/shared';

interface Summary {
  date: string; schoolDay: boolean; reason: string | null; marked: number; total: number;
  classes: { id: string; name: string; form: string; teacher: string | null; marked: boolean; markedBy: string | null; markedAt: string | null; size: number; present: number; absent: number; rate: number | null }[];
  forms: { formId: string; form: string; present: number; absent: number; rate: number | null }[];
  absentees: { studentId: string; student: string; className: string; status: string; reason: string | null; guardianPhone: string | null }[];
}

const REASON: Record<string, string> = { SICK: 'Sick', FAMILY: 'Family', SCHOOL_ACTIVITY: 'School activity', OTHER: 'Other' };

export function AttendanceSummaryClient({ summary, truancy, canRemind, today }: { summary: Summary; truancy: { studentId: string; student: string; className: string; lesson: string }[]; canRemind: boolean; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const missing = summary.classes.filter((c) => !c.marked);

  async function remind(ids: string[]) {
    setBusy(true);
    const r = await api('/api/academics/attendance/remind', 'POST', { classIds: ids });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(r.body.data.reminded ? `Reminded ${r.body.data.reminded} class teacher${r.body.data.reminded === 1 ? '' : 's'}` : 'They were already reminded a short while ago');
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">Day
          <input type="date" value={summary.date} max={today} onChange={(e) => e.target.value && router.push(`?tab=summary&date=${e.target.value}`)} className="min-h-[44px] rounded-xl border border-line bg-white px-3" />
        </label>
        <p className="text-sm text-muted">{summary.schoolDay ? `${summary.marked} of ${summary.total} registers marked` : ''}</p>
      </div>

      {!summary.schoolDay && <Notice tone="info">{summary.reason}</Notice>}

      {summary.schoolDay && (
        <>
          <Section
            title="Registers: marked and not marked"
            action={canRemind && summary.date === today && missing.length > 0 && <Button variant="secondary" loading={busy} onClick={() => remind(missing.map((c) => c.id))}>Remind all {missing.length}</Button>}
          >
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-line">
                <caption className="sr-only">Morning registers by class</caption>
                <thead><tr><Th>Class</Th><Th>Class teacher</Th><Th>Register</Th><Th className="text-right">Present</Th><Th className="text-right">Absent</Th><Th className="text-right">Present %</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                <tbody className="divide-y divide-line">
                  {summary.classes.map((c) => (
                    <tr key={c.id} className="hover:bg-rowhover">
                      <Td><Link href={`/academics/attendance?classId=${c.id}&date=${summary.date}`} className="font-semibold text-primary hover:underline">{c.name}</Link></Td>
                      <Td>{c.teacher ?? <span className="text-muted">No class teacher</span>}</Td>
                      <Td>{c.marked ? <Badge variant="success" label={`Marked${c.markedBy ? ` by ${c.markedBy}` : ''}`} /> : <Badge variant="danger" label="Not marked" />}</Td>
                      <Td className="text-right tabular-nums">{c.marked ? c.present : '—'}</Td>
                      <Td className="text-right tabular-nums">{c.marked ? c.absent : '—'}</Td>
                      <Td className="text-right tabular-nums">{c.rate === null ? '—' : `${c.rate}%`}</Td>
                      <Td className="text-right">{canRemind && !c.marked && summary.date === today && c.teacher && <button type="button" onClick={() => remind([c.id])} className="text-sm font-semibold text-primary hover:underline">Remind</button>}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Present % by form">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {summary.forms.length === 0 && <p className="col-span-full text-sm text-muted">No register has been marked yet.</p>}
              {summary.forms.map((f) => (
                <div key={f.formId} className="rounded-xl bg-canvas p-3 text-center"><p className="text-2xl font-bold tabular-nums text-ink">{f.rate === null ? '—' : `${f.rate}%`}</p><p className="text-xs text-muted">{f.form}</p></div>
              ))}
            </div>
          </Section>

          <Section title={`Absentees (${summary.absentees.length})`}>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-line">
                <caption className="sr-only">Students absent</caption>
                <thead><tr><Th>Student</Th><Th>Class</Th><Th>Status</Th><Th>Guardian phone</Th></tr></thead>
                <tbody className="divide-y divide-line">
                  {summary.absentees.length === 0 && <tr><Td className="text-muted">Nobody is absent.</Td></tr>}
                  {summary.absentees.map((a) => (
                    <tr key={a.studentId}>
                      <Td className="font-semibold">{a.student}</Td><Td>{a.className}</Td>
                      <Td>{a.status === 'EXCUSED' ? <Badge variant="info" label={`Excused: ${REASON[a.reason ?? ''] ?? ''}`} /> : <Badge variant="danger" label={a.reason ? `Absent: ${REASON[a.reason]}` : 'Absent'} />}</Td>
                      <Td>{a.guardianPhone ? <a href={`tel:${a.guardianPhone}`} className="text-primary hover:underline">{a.guardianPhone}</a> : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {truancy.length > 0 && (
            <Section title="Possible truancy" hint="Present in the morning register but absent from a lesson.">
              <ul className="divide-y divide-line text-sm">{truancy.map((t) => <li key={t.studentId + t.lesson} className="py-2"><b>{t.student}</b> ({t.className}) missed {t.lesson}</li>)}</ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
