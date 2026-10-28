'use client';

// Allocate a whole intake: filter by form or class, keep forms together or not, look at the plan, then make it.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { Field, Notice, Td, Th, api, fieldClass, problem } from '@/components/finance/shared';

interface Plan { candidates: number; freeBeds: number; placements: { studentId: string; student: string; room: string; bed: string }[]; unplaced: { studentId: string; student: string }[]; applied: boolean }

export function AutoAllocate({ hostelId, levels, classes }: { hostelId: string; levels: { id: string; name: string }[]; classes: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [levelId, setLevelId] = useState('');
  const [classId, setClassId] = useState('');
  const [together, setTogether] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);

  const body = (apply: boolean) => ({ hostelId, keepFormsTogether: together, apply, ...(levelId ? { levelId } : {}), ...(classId ? { classId } : {}) });

  async function show() {
    setBusy(true);
    const r = await api('/api/facilities/hostel/auto-allocate', 'POST', body(false));
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    setPlan(r.body.data as Plan);
  }
  async function make() {
    setBusy(true);
    const r = await api('/api/facilities/hostel/auto-allocate', 'POST', body(true));
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(`${(r.body.data as Plan).placements.length} boarders given beds`);
    setOpen(false); setPlan(null);
    router.refresh();
  }

  return (
    <>
      <Button className="min-h-[44px]" variant="secondary" onClick={() => setOpen(true)}>Allocate an intake</Button>
      <Modal open={open} onClose={() => { setOpen(false); setPlan(null); }} title="Allocate boarders without a bed" size="lg"
        footer={<><Button variant="ghost" onClick={() => { setOpen(false); setPlan(null); }}>Close</Button><Button variant="secondary" loading={busy} onClick={() => void show()}>Show the plan</Button>{plan && plan.placements.length > 0 && <Button loading={busy} onClick={() => void make()}>Give these {plan.placements.length} beds</Button>}</>}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">Boarders of this hostel&apos;s gender who have no bed are put in the free beds, room by room.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="aa-l" label="Form"><select id="aa-l" className={fieldClass} value={levelId} onChange={(e) => { setLevelId(e.target.value); setPlan(null); }}><option value="">All forms</option>{levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
            <Field id="aa-c" label="Class"><select id="aa-c" className={fieldClass} value={classId} onChange={(e) => { setClassId(e.target.value); setPlan(null); }}><option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          </div>
          <label className="flex min-h-[48px] items-center gap-3 text-sm text-ink"><input type="checkbox" className="h-6 w-6 accent-primary" checked={together} onChange={(e) => { setTogether(e.target.checked); setPlan(null); }} />Keep forms together in the same rooms</label>
          {plan && (
            <>
              <Notice tone={plan.unplaced.length ? 'warn' : 'info'}>{plan.candidates} boarders without a bed, {plan.freeBeds} free beds. {plan.placements.length} would be placed{plan.unplaced.length ? `; ${plan.unplaced.length} would have no bed` : ''}.</Notice>
              <div className="max-h-72 overflow-auto"><table className="w-full"><thead><tr><Th>Learner</Th><Th>Room</Th><Th>Bed</Th></tr></thead><tbody>
                {plan.placements.map((p) => <tr key={p.studentId} className="border-t border-line"><Td>{p.student}</Td><Td>{p.room}</Td><Td>{p.bed}</Td></tr>)}
                {plan.unplaced.map((p) => <tr key={p.studentId} className="border-t border-line text-danger"><Td>{p.student}</Td><Td>No bed</Td><Td /></tr>)}
              </tbody></table></div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
