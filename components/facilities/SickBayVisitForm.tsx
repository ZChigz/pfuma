'use client';

// A sick bay visit on a phone. Choosing the learner shows their medical alerts first (allergies in red); medicine that matches an allergy
// is refused unless a reason is written.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { api, problem, Notice, fieldClass } from '@/components/finance/shared';
import { LearnerPicker, type Learner } from '@/components/facilities/LearnerPicker';
import type { Alerts } from '@/lib/facilities/sickbay';

const COMPLAINTS = [['HEADACHE', 'Headache'], ['FEVER', 'Fever'], ['STOMACH_PAIN', 'Stomach pain'], ['INJURY', 'Injury'], ['MENSTRUAL', 'Menstrual'], ['ASTHMA', 'Asthma'], ['OTHER', 'Other']] as const;
const OUTCOMES = [['BACK_TO_CLASS', 'Back to class'], ['REST_IN_SICK_BAY', 'Rest in the sick bay'], ['SENT_TO_CLINIC', 'Sent to a clinic'], ['SENT_HOME', 'Sent home']] as const;
export interface MedicineOption { itemId: string; name: string; unit: string; qty: number }
interface Given { name: string; dose: string; stockItemId: string; qty: string }

export function SickBayVisitForm({ medicine }: { medicine: MedicineOption[] }) {
  const router = useRouter();
  const [s, setS] = useState<Learner | null>(null);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [f, setF] = useState({ complaint: 'HEADACHE', complaintNote: '', temperatureC: '', observations: '', treatment: '', outcome: 'BACK_TO_CLASS', facility: '', transport: '', accompaniedBy: '', guardianTold: '', allergyOverrideReason: '' });
  const [meds, setMeds] = useState<Given[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAlerts(null);
    if (!s) return;
    void api(`/api/facilities/sickbay/alerts?studentId=${s.id}`, 'GET').then((r) => { if (r.ok) setAlerts(r.body.data as Alerts); else setError(problem(r)); });
  }, [s]);

  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const setMed = (i: number, p: Partial<Given>) => setMeds((m) => m.map((x, j) => (j === i ? { ...x, ...p } : x)));

  async function save() {
    if (!s) { setError('Choose the learner'); return; }
    setBusy(true); setError(null);
    const body = {
      studentId: s.id, complaint: f.complaint, complaintNote: f.complaintNote || undefined, temperatureC: f.temperatureC ? Number(f.temperatureC) : undefined, observations: f.observations || undefined, treatment: f.treatment || undefined,
      medication: meds.filter((m) => m.name.trim()).map((m) => ({ name: m.name, dose: m.dose || undefined, ...(m.stockItemId ? { stockItemId: m.stockItemId, qty: Number(m.qty) || 1 } : {}) })),
      outcome: f.outcome, allergyOverrideReason: f.allergyOverrideReason || undefined, guardianTold: f.guardianTold || undefined,
      referral: f.outcome === 'SENT_TO_CLINIC' ? { facility: f.facility, transport: f.transport, accompaniedBy: f.accompaniedBy } : undefined,
    };
    const r = await api('/api/facilities/sickbay', 'POST', body);
    setBusy(false);
    if (!r.ok) { setError(problem(r)); return; }
    toast.success(r.body.data?.smsQueued ? 'Visit recorded. The guardian was sent an SMS.' : 'Visit recorded');
    setS(null); setMeds([]); setF((x) => ({ ...x, complaintNote: '', temperatureC: '', observations: '', treatment: '', allergyOverrideReason: '', guardianTold: '' }));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-3">
      <LearnerPicker id="sb-learner" value={s} onChange={setS} />
      {alerts && (
        <div className="flex flex-col gap-1 rounded-xl border border-line p-3 text-sm">
          {alerts.allergies.length > 0 && (
            <p role="alert" className={`rounded-lg p-2 font-bold ${alerts.severe ? 'bg-danger-bg text-danger' : 'bg-warn-bg text-warn'}`}>
              Allergies: {alerts.allergies.map((a) => `${a.name}${a.severity === 'SEVERE' ? ' (severe)' : ''}`).join(', ')}
            </p>
          )}
          {alerts.conditions.length > 0 && <p><b>Conditions:</b> {alerts.conditions.map((c) => c.name + (c.note ? ` (${c.note})` : '')).join(', ')}</p>}
          {alerts.medications.length > 0 && <p><b>Takes:</b> {alerts.medications.map((m) => `${m.name}${m.dose ? ` ${m.dose}` : ''}`).join(', ')}</p>}
          {alerts.allergies.length === 0 && alerts.conditions.length === 0 && <p className="text-muted">No allergies or conditions on record.</p>}
          <p className="text-xs text-muted">Emergency: {alerts.emergency.name ?? 'no one on record'} {alerts.emergency.phone ?? ''}{alerts.consentEmergencyTreatment === false ? ' · NO consent for emergency treatment' : ''}</p>
          {alerts.inSickBay && <Notice tone="warn">This learner is already in the sick bay.</Notice>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <select aria-label="Complaint" className={fieldClass} value={f.complaint} onChange={(e) => set({ complaint: e.target.value })}>{COMPLAINTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input aria-label="Temperature" className={fieldClass} inputMode="decimal" placeholder="Temp °C" value={f.temperatureC} onChange={(e) => set({ temperatureC: e.target.value })} />
      </div>
      {f.complaint === 'OTHER' && <input aria-label="What is the complaint" className={fieldClass} placeholder="What is the complaint?" value={f.complaintNote} onChange={(e) => set({ complaintNote: e.target.value })} />}
      <input aria-label="Observations" className={fieldClass} placeholder="Observations" value={f.observations} onChange={(e) => set({ observations: e.target.value })} />
      <input aria-label="Treatment" className={fieldClass} placeholder="Treatment" value={f.treatment} onChange={(e) => set({ treatment: e.target.value })} />
      <div className="flex flex-col gap-2">
        {meds.map((m, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl bg-canvas p-2">
            <select aria-label="Medicine from the sick bay store" className={fieldClass} value={m.stockItemId} onChange={(e) => { const o = medicine.find((x) => x.itemId === e.target.value); setMed(i, { stockItemId: e.target.value, name: o?.name ?? m.name }); }}>
              <option value="">Other medicine (not from stock)</option>
              {medicine.map((o) => <option key={o.itemId} value={o.itemId}>{o.name} · {o.qty} {o.unit.toLowerCase()} left</option>)}
            </select>
            <button type="button" className="min-h-[44px] px-2 text-sm text-danger" onClick={() => setMeds((x) => x.filter((_, j) => j !== i))}>Remove</button>
            {!m.stockItemId && <input aria-label="Medicine name" className={fieldClass} placeholder="Medicine name" value={m.name} onChange={(e) => setMed(i, { name: e.target.value })} />}
            <div className="col-span-2 grid grid-cols-2 gap-2">
              <input aria-label="Dose" className={fieldClass} placeholder="Dose" value={m.dose} onChange={(e) => setMed(i, { dose: e.target.value })} />
              {m.stockItemId && <input aria-label="Quantity from stock" className={fieldClass} inputMode="decimal" placeholder="Quantity used" value={m.qty} onChange={(e) => setMed(i, { qty: e.target.value })} />}
            </div>
          </div>
        ))}
        <Button variant="secondary" className="min-h-[48px]" onClick={() => setMeds((m) => [...m, { name: '', dose: '', stockItemId: '', qty: '1' }])}>Add medicine given</Button>
      </div>
      {alerts?.allergies.length ? <input aria-label="Reason to give a medicine the learner is allergic to" className={fieldClass} placeholder="Only if a medicine matches an allergy: who decided and why" value={f.allergyOverrideReason} onChange={(e) => set({ allergyOverrideReason: e.target.value })} /> : null}
      <select aria-label="Outcome" className={fieldClass} value={f.outcome} onChange={(e) => set({ outcome: e.target.value })}>{OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {f.outcome === 'SENT_TO_CLINIC' && (
        <div className="grid gap-2">
          <input aria-label="Clinic or hospital" className={fieldClass} placeholder="Clinic or hospital" value={f.facility} onChange={(e) => set({ facility: e.target.value })} />
          <input aria-label="Transport" className={fieldClass} placeholder="Transport (school car, ambulance ...)" value={f.transport} onChange={(e) => set({ transport: e.target.value })} />
          <input aria-label="Accompanied by" className={fieldClass} placeholder="Who goes with the learner" value={f.accompaniedBy} onChange={(e) => set({ accompaniedBy: e.target.value })} />
        </div>
      )}
      {f.outcome === 'SENT_HOME' && <input aria-label="How the guardian was told" className={fieldClass} placeholder="How the guardian was told (only if no SMS can be sent)" value={f.guardianTold} onChange={(e) => set({ guardianTold: e.target.value })} />}
      {error && <Notice tone="danger">{error}</Notice>}
      <Button className="min-h-[56px] text-base" loading={busy} onClick={() => void save()}>Record visit</Button>
    </div>
  );
}
