'use client';

// One interview panel member's scores: 1 to 5 for each criterion, and a recommendation.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { api, problem } from '@/components/finance/shared';
import { fieldClass } from '@/components/finance/format';

const CRITERIA = ['Subject knowledge', 'Communication', 'Teaching or job skills', 'Professionalism'];

export function ScoreForm({ applicantId, name }: { applicantId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scores, setScores] = useState<Record<string, number>>(Object.fromEntries(CRITERIA.map((c) => [c, 3])));
  const [rec, setRec] = useState('CONSIDER');

  async function save() {
    setBusy(true);
    const r = await api(`/api/hr/applicants/${applicantId}/score`, 'POST', { scores: CRITERIA.map((c) => ({ criterion: c, score: scores[c] })), recommendation: rec });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Scores saved');
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Score</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Score ${name}`} size="md" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Save scores</Button></>}>
        <div className="flex flex-col gap-3">
          {CRITERIA.map((c) => (
            <label key={c} className="flex items-center justify-between gap-3 text-sm text-ink">{c}
              <select className={`${fieldClass} w-24`} value={scores[c]} onChange={(e) => setScores({ ...scores, [c]: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </label>
          ))}
          <label className="flex items-center justify-between gap-3 text-sm text-ink">Recommendation
            <select className={`${fieldClass} w-40`} value={rec} onChange={(e) => setRec(e.target.value)}><option value="HIRE">Hire</option><option value="CONSIDER">Consider</option><option value="DO_NOT_HIRE">Do not hire</option></select>
          </label>
        </div>
      </Modal>
    </>
  );
}
