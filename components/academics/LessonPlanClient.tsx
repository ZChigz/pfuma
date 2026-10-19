'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { api, problem, Section } from '@/components/academics/shared';

const FIELDS = [['objectives', 'Objectives'], ['introduction', 'Introduction'], ['development', 'Development'], ['conclusion', 'Conclusion'], ['evaluation', 'Evaluation']] as const;

export function LessonPlanClient({ slotId, date, plan, canEdit }: { slotId: string; date: string; plan: Record<string, string | null> | null; canEdit: boolean }) {
  const [c, setC] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map(([k]) => [k, plan?.[k] ?? ''])));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await api('/api/academics/lesson-plans', 'PUT', { slotId, date, content: c });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Lesson plan saved');
  }
  return (
    <Section title={`Lesson on ${date}`}>
      <div className="flex flex-col gap-3">
        {FIELDS.map(([k, label]) => (
          <label key={k} className="flex flex-col gap-1 text-sm font-medium text-ink">{label}
            <textarea rows={k === 'development' ? 5 : 3} disabled={!canEdit} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-normal disabled:bg-canvas" />
          </label>
        ))}
        {canEdit && <div><Button onClick={save} loading={busy}>Save lesson plan</Button></div>}
      </div>
    </Section>
  );
}
