'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import type { ApplicantRow, IntakeReport } from '@/lib/students/admissions';
import { api, Checkbox, fieldMessages, FormGrid, problem, Section, TextArea, useBusy, WarningList } from '@/components/students/shared';
import { RELATIONSHIP_OPTIONS } from '@/components/students/profile/GuardiansTab';

const STAGES = ['APPLIED', 'SHORTLISTED', 'TESTED', 'OFFERED', 'ACCEPTED', 'ENROLLED', 'WAITLISTED', 'REJECTED', 'DECLINED'] as const;
const LABEL: Record<string, string> = { APPLIED: 'Applied', SHORTLISTED: 'Shortlisted', TESTED: 'Tested / interviewed', OFFERED: 'Offered', ACCEPTED: 'Accepted', ENROLLED: 'Enrolled', WAITLISTED: 'Waitlisted', REJECTED: 'Rejected', DECLINED: 'Declined' };
const VARIANT: Record<string, BadgeVariant> = { APPLIED: 'neutral', SHORTLISTED: 'info', TESTED: 'info', OFFERED: 'warning', ACCEPTED: 'success', ENROLLED: 'success', WAITLISTED: 'warning', REJECTED: 'danger', DECLINED: 'danger' };
const FINAL = ['ENROLLED', 'REJECTED', 'DECLINED'];

type View = 'board' | 'table' | 'ranking' | 'report';
interface Ranked extends ApplicantRow { rank: number; withinPlaces: boolean }

interface Props {
  intake: { id: string; name: string; places: number; level: string; reportingDate: string | null };
  applicants: ApplicantRow[];
  ranking: Ranked[];
  rankedBy: 'units' | 'score' | 'points';
  report: IntakeReport;
  classes: { id: string; name: string }[];
  canManage: boolean;
  canApprove: boolean;
  financeOn: boolean;
}

export function IntakeClient(p: Props) {
  const router = useRouter();
  const [view, setView] = useState<View>('board');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState<ApplicantRow | null>(null);
  const { busy, run } = useBusy();
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const refresh = () => { setSelected(new Set()); router.refresh(); };

  async function move(ids: string[], to: string) {
    const r = await run(() => api('/api/students/admissions/applications/move', 'POST', { applicationIds: ids, to }));
    if (!r) return;
    if (!r.ok) { toast.error(problem(r)); return; }
    toast.success(`${r.body.data.moved} moved to ${LABEL[to]}`);
    refresh();
  }

  const tabs: [View, string][] = [['board', 'Board'], ['table', 'Table'], ['ranking', 'Ranking'], ['report', 'Report']];
  const picked = Array.from(selected);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="View" className="flex gap-1 rounded-full bg-white p-1">
          {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={cn('min-h-[40px] rounded-full px-4 text-sm font-semibold', view === k ? 'bg-primary text-white' : 'text-muted hover:text-ink')}>{l}</button>)}
        </div>
        <p className="text-sm text-muted">{p.applicants.length} applicants · {p.intake.places} places · {p.intake.level}</p>
        {p.canManage && <Button className="ml-auto" size="sm" onClick={() => setAdding(true)}>New application</Button>}
      </div>

      {selected.size > 0 && p.canManage && (
        <div role="region" aria-label="Actions for the selected applicants" className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-2xl bg-ink p-3 text-white shadow-lg">
          <span className="mr-auto text-sm font-semibold">{selected.size} selected</span>
          <Button size="sm" variant="secondary" loading={busy} onClick={() => move(picked, 'SHORTLISTED')}>Shortlist</Button>
          <Button size="sm" variant="secondary" loading={busy} onClick={() => move(picked, 'REJECTED')}>Reject</Button>
          {p.canApprove ? <Button size="sm" variant="secondary" loading={busy} onClick={() => move(picked, 'OFFERED')}>Offer</Button> : <span className="text-xs">Offers need the Head</span>}
          <span className="text-xs text-white/70" title="SMS to guardians needs the Communication module">SMS: Communication module</span>
          <button type="button" onClick={() => setSelected(new Set())} className="min-h-[44px] px-3 text-sm underline">Clear</button>
        </div>
      )}

      {view === 'board' && (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          {STAGES.map((st) => {
            const list = p.applicants.filter((a) => a.stage === st);
            return (
              <section key={st} aria-label={LABEL[st]} className="w-64 flex-shrink-0 rounded-2xl bg-canvas p-2">
                <h3 className="flex items-center justify-between px-2 py-1.5 text-sm font-semibold text-ink">{LABEL[st]}<span className="rounded-full bg-white px-2 text-xs text-muted">{list.length}</span></h3>
                <ul className="flex flex-col gap-2">
                  {list.map((a) => (
                    <li key={a.id} className="rounded-xl bg-white p-2.5 text-sm shadow-sm">
                      <div className="flex items-start gap-2">
                        {p.canManage && !FINAL.includes(a.stage) && <input type="checkbox" aria-label={`Select ${a.fullName}`} checked={selected.has(a.id)} onChange={() => toggle(a.id)} className="mt-0.5 h-5 w-5 flex-shrink-0" />}
                        <button type="button" onClick={() => setDetail(a)} className="min-w-0 flex-1 text-left"><span className="block truncate font-semibold text-ink">{a.fullName}</span><span className="block text-xs text-muted">{a.gender === 'M' ? 'M' : 'F'}, {a.age} · {metric(a)}</span></button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {view === 'table' && (
        <div className="overflow-x-auto rounded-2xl bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">Applicants</caption>
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted"><tr><th className="w-10 px-3 py-3" /><th className="px-3 py-3">Applicant</th><th className="px-3 py-3">Stage</th><th className="px-3 py-3">Results</th><th className="px-3 py-3">Guardian</th><th className="px-3 py-3" /></tr></thead>
            <tbody>
              {p.applicants.map((a) => (
                <tr key={a.id} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2">{p.canManage && !FINAL.includes(a.stage) && <input type="checkbox" aria-label={`Select ${a.fullName}`} checked={selected.has(a.id)} onChange={() => toggle(a.id)} className="h-5 w-5" />}</td>
                  <td className="px-3 py-2 font-medium">{a.fullName}<span className="ml-1 text-xs font-normal text-muted">{a.gender}, {a.age}</span></td>
                  <td className="px-3 py-2"><Badge variant={VARIANT[a.stage]} label={LABEL[a.stage]!} /></td>
                  <td className="px-3 py-2 text-muted">{metric(a)}</td>
                  <td className="px-3 py-2">{a.guardianName}<div className="font-mono text-xs text-muted">{a.guardianPhone}</div></td>
                  <td className="px-3 py-2"><Button size="sm" variant="ghost" onClick={() => setDetail(a)}>Open</Button></td>
                </tr>
              ))}
              {p.applicants.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted">No applicants yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === 'ranking' && (
        <Section title="Ranking" action={
          <div className="flex gap-1" role="group" aria-label="Rank by">
            {([['units', 'Grade 7 units (lower is better)'], ['score', 'Test score (higher)'], ['points', 'O Level points (higher)']] as const).map(([k, l]) => (
              <Link key={k} href={`?by=${k}`} scroll={false} aria-current={p.rankedBy === k ? 'true' : undefined} className={cn('inline-flex min-h-[40px] items-center rounded-full px-3 text-xs font-semibold', p.rankedBy === k ? 'bg-primary text-white' : 'bg-canvas text-muted')}>{l}</Link>
            ))}
          </div>}>
          <p className="mb-2 text-sm text-muted">Rejected and declined applicants are left out. The line shows where the {p.intake.places} places end.</p>
          <ol className="flex flex-col">
            {p.ranking.map((r, i) => (
              <li key={r.id}>
                {i === p.intake.places && <div role="separator" className="my-1 flex items-center gap-2 text-xs font-semibold text-danger"><span className="h-px flex-1 bg-danger/50" />Cut-off: {p.intake.places} places<span className="h-px flex-1 bg-danger/50" /></div>}
                <div className={cn('flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm', r.withinPlaces ? 'bg-white' : 'bg-canvas text-muted')}>
                  <span className="w-7 text-right font-bold">{r.rank}</span>
                  <button type="button" onClick={() => setDetail(r)} className="min-w-0 flex-1 truncate text-left font-medium text-ink">{r.fullName}</button>
                  <span className="text-xs">{metric(r)}</span><Badge variant={VARIANT[r.stage]} label={LABEL[r.stage]!} />
                </div>
              </li>
            ))}
          </ol>
          {p.ranking.length === 0 && <p className="text-sm text-muted">Nobody to rank yet.</p>}
        </Section>
      )}

      {view === 'report' && (
        <Section title={`Intake report: ${p.report.intake}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-muted"><tr><th className="py-2 pr-3">Stage</th><th className="px-3 py-2">Total</th><th className="px-3 py-2">Boys</th><th className="px-3 py-2">Girls</th><th className="px-3 py-2">Conversion</th></tr></thead>
              <tbody>{p.report.stages.map((s) => <tr key={s.key} className="border-b border-line/60 last:border-0"><th scope="row" className="py-2.5 pr-3 font-medium">{s.label}</th><td className="px-3 py-2.5 font-bold">{s.total}</td><td className="px-3 py-2.5">{s.male}</td><td className="px-3 py-2.5">{s.female}</td><td className="px-3 py-2.5 text-muted">{s.conversion === null ? '—' : `${s.conversion}% of ${s.key === 'offers' ? 'applications' : s.key === 'acceptances' ? 'offers' : 'acceptances'}`}</td></tr>)}</tbody>
            </table>
          </div>
        </Section>
      )}

      {adding && <ApplicationModal intakeId={p.intake.id} onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />}
      {detail && <ApplicantModal a={detail} {...p} onClose={() => setDetail(null)} onDone={() => { setDetail(null); refresh(); }} />}
    </div>
  );
}

function metric(a: ApplicantRow) {
  const parts = [a.grade7Units !== null && `${a.grade7Units} units`, a.oLevelPasses !== null && `${a.oLevelPasses} passes`, a.oLevelPoints !== null && `${a.oLevelPoints} points`, a.testScore !== null && `test ${a.testScore}`].filter(Boolean);
  return parts.length ? parts.join(', ') : 'no results yet';
}

function ApplicationModal({ intakeId, onClose, onDone }: { intakeId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ firstName: '', surname: '', gender: '', dateOfBirth: '', birthCertificateNumber: '', previousSchool: '', boarding: 'DAY', guardianName: '', guardianRelationship: 'MOTHER', guardianPhone: '', guardianPhone2: '', guardianEmail: '', address: '', grade7Units: '', oLevelPasses: '', oLevelPoints: '', testScore: '', interviewNotes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function submit() {
    const entryResults = { ...(f.grade7Units ? { grade7Units: Number(f.grade7Units) } : {}), ...(f.oLevelPasses ? { oLevelPasses: Number(f.oLevelPasses) } : {}), ...(f.oLevelPoints ? { oLevelPoints: Number(f.oLevelPoints) } : {}) };
    const r = await run(() => api('/api/students/admissions/applications', 'POST', { intakeId, ...f, grade7Units: undefined, oLevelPasses: undefined, oLevelPoints: undefined, entryResults: Object.keys(entryResults).length ? entryResults : undefined, testScore: f.testScore ? Number(f.testScore) : undefined, interviewNotes: f.interviewNotes || undefined }));
    if (!r) return;
    if (!r.ok) { setErrors({ ...fieldMessages(r), form: problem(r) }); return; }
    toast.success('Application saved');
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="New application" size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!f.firstName || !f.surname || !f.gender || !f.dateOfBirth || !f.guardianName || !f.guardianPhone}>Save</Button></>}>
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
        <FormGrid>
          <Input id="ap-fn" label="First name(s)" required value={f.firstName} onChange={(e) => set('firstName', e.target.value)} error={errors.firstName} />
          <Input id="ap-sn" label="Surname" required value={f.surname} onChange={(e) => set('surname', e.target.value)} error={errors.surname} />
          <Select id="ap-g" label="Gender" required placeholder="Choose" value={f.gender} onChange={(e) => set('gender', e.target.value)} options={[{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }]} error={errors.gender} />
          <Input id="ap-dob" type="date" label="Date of birth" required value={f.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} error={errors.dateOfBirth} />
          <Input id="ap-bc" label="Birth certificate number" value={f.birthCertificateNumber} onChange={(e) => set('birthCertificateNumber', e.target.value)} error={errors.birthCertificateNumber} />
          <Input id="ap-ps" label="Previous school" value={f.previousSchool} onChange={(e) => set('previousSchool', e.target.value)} />
          <Input id="ap-g7" type="number" label="Grade 7 units" value={f.grade7Units} onChange={(e) => set('grade7Units', e.target.value)} error={errors['entryResults.grade7Units']} />
          <Input id="ap-ts" type="number" label="Entrance test score (0 to 100)" value={f.testScore} onChange={(e) => set('testScore', e.target.value)} error={errors.testScore} />
          <Input id="ap-olp" type="number" label="O Level passes (Lower 6)" value={f.oLevelPasses} onChange={(e) => set('oLevelPasses', e.target.value)} />
          <Input id="ap-olpt" type="number" label="O Level points (Lower 6)" value={f.oLevelPoints} onChange={(e) => set('oLevelPoints', e.target.value)} />
        </FormGrid>
        <fieldset className="rounded-xl border border-line p-3"><legend className="px-1 text-sm font-medium">Guardian</legend>
          <FormGrid>
            <Input id="ap-gn" label="Full name" required value={f.guardianName} onChange={(e) => set('guardianName', e.target.value)} error={errors.guardianName} />
            <Select id="ap-gr" label="Relationship" value={f.guardianRelationship} onChange={(e) => set('guardianRelationship', e.target.value)} options={RELATIONSHIP_OPTIONS} />
            <Input id="ap-gp" type="tel" label="Phone" required value={f.guardianPhone} onChange={(e) => set('guardianPhone', e.target.value)} error={errors.guardianPhone} />
            <Input id="ap-gp2" type="tel" label="Second phone" value={f.guardianPhone2} onChange={(e) => set('guardianPhone2', e.target.value)} />
            <Input id="ap-ge" type="email" label="Email" value={f.guardianEmail} onChange={(e) => set('guardianEmail', e.target.value)} />
            <Input id="ap-ad" label="Address" value={f.address} onChange={(e) => set('address', e.target.value)} />
          </FormGrid>
        </fieldset>
        <TextArea id="ap-notes" label="Interview notes" rows={2} value={f.interviewNotes} onChange={(v) => set('interviewNotes', v)} />
        {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      </div>
    </Modal>
  );
}

function ApplicantModal({ a, intake, canManage, canApprove, classes, financeOn, onClose, onDone }: Props & { a: ApplicantRow; onClose: () => void; onDone: () => void }) {
  const [score, setScore] = useState(a.testScore === null ? '' : String(a.testScore));
  const [classId, setClassId] = useState('');
  const [warnings, setWarnings] = useState<{ code: string; message: string }[]>([]);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [deposit, setDeposit] = useState(false);
  const [error, setError] = useState('');
  const { busy, run } = useBusy();

  async function call(path: string, body: unknown, done: string, method: 'POST' | 'PATCH' = 'POST') {
    const r = await run(() => api(`/api/students/admissions/applications/${a.id}${path}`, method, body));
    if (!r) return null;
    if (!r.ok) { setError(problem(r)); return null; }
    toast.success(done);
    return r;
  }
  async function enrolCheck() {
    const r = await call('/enrol', { classId, dryRun: true }, 'Checked');
    if (r) { setWarnings(r.body.data.check.warnings); setAccepted([]); if (!r.body.data.check.warnings.length) await enrol([]); }
  }
  async function enrol(ack: string[]) {
    const r = await call('/enrol', { classId, acknowledgedWarnings: ack }, 'Enrolled as a student');
    if (r) onDone();
  }

  return (
    <Modal open onClose={onClose} title={a.fullName} size="md" footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-2 text-sm"><Badge variant={VARIANT[a.stage]} label={LABEL[a.stage]!} /> {a.gender === 'M' ? 'Male' : 'Female'}, {a.age} years · {a.previousSchool ?? 'previous school not given'}</p>
        <p className="text-sm">{metric(a)}</p>
        <p className="text-sm text-muted">Guardian: {a.guardianName}, {a.guardianPhone}</p>
        {a.offerReference && <a href={`/api/students/admissions/applications/${a.id}/offer-letter`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary underline">Offer letter {a.offerReference} (PDF)</a>}
        {a.studentId && <Link href={`/students/${a.studentId}`} className="text-sm font-semibold text-primary underline">Open the student&apos;s profile</Link>}
        {canManage && !FINAL.includes(a.stage) && (
          <div className="flex items-end gap-2">
            <Input id="ts" type="number" label="Entrance test score" value={score} onChange={(e) => setScore(e.target.value)} />
            <Button variant="secondary" loading={busy} onClick={async () => { if (await call('', { testScore: score === '' ? null : Number(score) }, 'Score saved', 'PATCH')) onDone(); }}>Save</Button>
          </div>
        )}
        {canManage && !FINAL.includes(a.stage) && (
          <div className="flex flex-wrap gap-2">
            {a.stage === 'APPLIED' && <MoveButton to="SHORTLISTED" a={a} onDone={onDone} />}
            {(a.stage === 'APPLIED' || a.stage === 'SHORTLISTED') && <MoveButton to="TESTED" a={a} onDone={onDone} />}
            {canApprove && ['APPLIED', 'SHORTLISTED', 'TESTED', 'WAITLISTED'].includes(a.stage) && <MoveButton to="OFFERED" a={a} onDone={onDone} primary />}
            {a.stage !== 'WAITLISTED' && a.stage !== 'ACCEPTED' && <MoveButton to="WAITLISTED" a={a} onDone={onDone} />}
            {a.stage === 'OFFERED' && <MoveButton to="DECLINED" a={a} onDone={onDone} label="Offer declined" />}
            <MoveButton to="REJECTED" a={a} onDone={onDone} danger />
          </div>
        )}
        {canManage && a.stage === 'OFFERED' && (
          <div className="rounded-xl bg-canvas p-3">
            {financeOn && <Checkbox label="Acceptance deposit paid" checked={deposit} onChange={setDeposit} />}
            <Button loading={busy} onClick={async () => { if (await call('/accept', financeOn ? { depositPaid: deposit } : {}, 'Acceptance recorded')) onDone(); }}>Record acceptance</Button>
          </div>
        )}
        {canManage && a.stage === 'ACCEPTED' && (
          <div className="flex flex-col gap-2 rounded-xl bg-canvas p-3">
            <p className="text-sm font-semibold">Enrol as a student</p>
            <Select id="en-class" label={`Class (${intake.level})`} placeholder="Choose a class" value={classId} onChange={(e) => { setClassId(e.target.value); setWarnings([]); }} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
            <WarningList warnings={warnings} accepted={accepted} onToggle={(c) => setAccepted((l) => (l.includes(c) ? l.filter((x) => x !== c) : [...l, c]))} />
            {warnings.length > 0 ? <Button loading={busy} disabled={warnings.some((w) => !accepted.includes(w.code))} onClick={() => enrol(accepted)}>Enrol anyway</Button> : <Button loading={busy} disabled={!classId} onClick={enrolCheck}>Enrol</Button>}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function MoveButton({ to, a, onDone, label, primary, danger }: { to: string; a: ApplicantRow; onDone: () => void; label?: string; primary?: boolean; danger?: boolean }) {
  const { busy, run } = useBusy();
  return (
    <Button size="sm" variant={danger ? 'danger' : primary ? 'primary' : 'secondary'} loading={busy} onClick={async () => {
      const r = await run(() => api('/api/students/admissions/applications/move', 'POST', { applicationIds: [a.id], to }));
      if (r && !r.ok) toast.error(problem(r)); else if (r) { toast.success(`Moved to ${LABEL[to]}`); onDone(); }
    }}>{label ?? LABEL[to]}</Button>
  );
}
