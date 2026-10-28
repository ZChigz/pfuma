'use client';

// A room inspection on the phone: score each item 0 to 5, add notes and photos, and note damage that may be charged to a learner.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FileUpload } from '@/components/ui/FileUpload';
import { toast } from '@/components/ui/Toast';
import { Field, Section, api, fieldClass, problem } from '@/components/finance/shared';
import { LearnerPicker, type Learner } from '@/components/facilities/LearnerPicker';

const DEFAULT_ITEMS = ['CLEANLINESS', 'BEDS_MADE', 'LOCKERS', 'DAMAGE'];
const NICE: Record<string, string> = { CLEANLINESS: 'Cleanliness', BEDS_MADE: 'Beds made', LOCKERS: 'Lockers', DAMAGE: 'Damage' };

export function InspectionForm({ hostels }: { hostels: { id: string; name: string; rooms: { id: string; name: string }[] }[] }) {
  const router = useRouter();
  const [hostelId, setHostelId] = useState(hostels[0]?.id ?? '');
  const [roomId, setRoomId] = useState('');
  const [scores, setScores] = useState<Record<string, number>>(Object.fromEntries(DEFAULT_ITEMS.map((i) => [i, 4])));
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [damage, setDamage] = useState<{ learner: Learner | null; amount: string; currency: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const rooms = hostels.find((h) => h.id === hostelId)?.rooms ?? [];

  async function submit() {
    setBusy(true);
    const items = DEFAULT_ITEMS.map((item) => ({
      item, score: scores[item]!,
      ...(item === 'DAMAGE' && damage?.learner && Number(damage.amount) > 0 ? { note: damage.note.trim() || undefined, damage: { studentId: damage.learner.id, amountCents: Math.round(Number(damage.amount) * 100), currency: damage.currency } } : {}),
    }));
    const r = await api('/api/facilities/hostel/inspections', 'POST', { hostelId, roomId, items, notes: notes.trim() || undefined, photoKeys: photos });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(`Saved: ${(r.body.data as { score: number }).score} out of 100`);
    setScores(Object.fromEntries(DEFAULT_ITEMS.map((i) => [i, 4]))); setNotes(''); setPhotos([]); setDamage(null); setRoomId('');
    router.refresh();
  }

  return (
    <Section title="Inspect a room">
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="in-h" label="Hostel"><select id="in-h" className={fieldClass} value={hostelId} onChange={(e) => { setHostelId(e.target.value); setRoomId(''); }}>{hostels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
          <Field id="in-r" label="Room"><select id="in-r" className={fieldClass} value={roomId} onChange={(e) => setRoomId(e.target.value)}><option value="">Choose…</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        </div>
        {DEFAULT_ITEMS.map((item) => (
          <div key={item} className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">{NICE[item]}: {scores[item]} out of 5</span>
            <div className="grid grid-cols-6 gap-1" role="group" aria-label={NICE[item]}>
              {[0, 1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-pressed={scores[item] === n} onClick={() => setScores({ ...scores, [item]: n })} className={`min-h-[48px] rounded-xl text-base font-semibold ${scores[item] === n ? 'bg-primary text-white' : 'bg-canvas ring-1 ring-line'}`}>{n}</button>)}
            </div>
          </div>
        ))}
        {!damage ? <button type="button" className="min-h-[44px] self-start text-sm font-semibold text-primary" onClick={() => setDamage({ learner: null, amount: '', currency: 'USD', note: '' })}>+ Damage to charge to a learner</button> : (
          <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
            <Field id="in-dl" label="Learner responsible"><LearnerPicker id="in-dl" value={damage.learner} onChange={(l) => setDamage({ ...damage, learner: l })} boardersOnly /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field id="in-da" label="Cost of the damage"><input id="in-da" className={fieldClass} inputMode="decimal" value={damage.amount} onChange={(e) => setDamage({ ...damage, amount: e.target.value })} /></Field>
              <Field id="in-dc" label="Currency"><select id="in-dc" className={fieldClass} value={damage.currency} onChange={(e) => setDamage({ ...damage, currency: e.target.value })}><option value="USD">US dollars</option><option value="ZIG">ZiG</option></select></Field>
            </div>
            <Field id="in-dn" label="What was damaged"><input id="in-dn" className={fieldClass} value={damage.note} onChange={(e) => setDamage({ ...damage, note: e.target.value })} /></Field>
            <p className="text-xs text-muted">The boarding master approves before anything is charged.</p>
            <button type="button" className="min-h-[44px] self-start text-sm text-danger underline" onClick={() => setDamage(null)}>Remove the damage</button>
          </div>
        )}
        <Field id="in-n" label="Notes"><textarea id="in-n" className="min-h-[72px] w-full rounded-xl border border-line bg-white p-3 text-sm" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></Field>
        {photos.length < 6 && <FileUpload endpoint="proofOfPayment" label={`Photo (${photos.length} added)`} onUpload={(k) => setPhotos([...photos, k])} />}
        <Button className="min-h-[52px]" loading={busy} disabled={!hostelId || !roomId} onClick={() => void submit()}>Save the inspection</Button>
      </div>
    </Section>
  );
}
