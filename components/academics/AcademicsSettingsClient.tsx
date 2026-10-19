'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { api, problem, Section } from '@/components/academics/shared';

interface S {
  afternoonRegister: boolean; perLessonAttendance: boolean; lessonPlans: boolean; minSubjectsOLevel: number; maxSubjectsOLevel: number; minSubjectsALevel: number; maxSubjectsALevel: number;
  maxPeriodsPerWeek: number; absentSmsAlert: boolean; chronicAbsenceAlert: boolean; consecutiveAbsentDays: number; attendanceThresholdPct: number;
}

export function AcademicsSettingsClient({ settings, canEdit }: { settings: S; canEdit: boolean }) {
  const router = useRouter();
  const [s, setS] = useState<S>(settings);
  const [busy, setBusy] = useState(false);
  const num = (k: keyof S, label: string, hint?: string, min = 0, max = 100) => (
    <Input id={k} type="number" min={min} max={max} label={label} hint={hint} disabled={!canEdit} value={s[k] as number} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} />
  );
  const flag = (k: keyof S, label: string, hint?: string) => (
    <label className="flex min-h-[44px] items-start gap-3 text-sm text-ink"><input type="checkbox" className="mt-0.5 h-5 w-5" disabled={!canEdit} checked={s[k] as boolean} onChange={(e) => setS({ ...s, [k]: e.target.checked })} /><span>{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span></label>
  );

  async function save() {
    setBusy(true);
    const r = await api('/api/academics/settings', 'PUT', s);
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Settings saved');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="Attendance">
        <div className="flex flex-col gap-2">
          {flag('afternoonRegister', 'Also take an afternoon register')}
          {flag('perLessonAttendance', 'Take a register in each lesson', 'Each lesson opens a register for the students who take the subject. A student present in the morning but absent from a lesson is flagged as a possible truant.')}
          {flag('absentSmsAlert', 'Send an SMS to the guardian when a student is absent without a reason', 'Needs the Communication module.')}
          {flag('chronicAbsenceAlert', 'Tell the class teacher and Deputy about chronic absence')}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {num('consecutiveAbsentDays', 'Days absent in a row before an alert', undefined, 1, 30)}
          {num('attendanceThresholdPct', 'Attendance % below which an alert is sent', 'For the term so far.', 1, 100)}
        </div>
      </Section>
      <Section title="Subjects per student" hint="Students are warned about, not stopped from, taking fewer or more.">
        <div className="grid gap-3 sm:grid-cols-4">
          {num('minSubjectsOLevel', 'O Level least', undefined, 0, 30)}{num('maxSubjectsOLevel', 'O Level most', undefined, 1, 30)}
          {num('minSubjectsALevel', 'A Level least', undefined, 0, 15)}{num('maxSubjectsALevel', 'A Level most', undefined, 1, 15)}
        </div>
      </Section>
      <Section title="Teaching and planning">
        <div className="flex flex-col gap-3">
          <div className="max-w-xs">{num('maxPeriodsPerWeek', 'Most periods a teacher should teach in a week', undefined, 1, 80)}</div>
          {flag('lessonPlans', 'Teachers write a lesson plan for each lesson', 'A simple form linked to the timetable lesson and the scheme week.')}
        </div>
      </Section>
      {canEdit && <div><Button onClick={save} loading={busy}>Save settings</Button></div>}
    </div>
  );
}
