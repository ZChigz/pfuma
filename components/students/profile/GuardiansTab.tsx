'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import type { ProfileGuardian } from '@/lib/students/profile';
import { api, Checkbox, fieldMessages, FormGrid, problem, Section, useBusy } from '@/components/students/shared';

export const RELATIONSHIP_OPTIONS = [
  ['FATHER', 'Father'], ['MOTHER', 'Mother'], ['UNCLE', 'Uncle'], ['AUNT', 'Aunt'], ['GRANDPARENT', 'Grandparent'], ['SIBLING', 'Sibling'], ['GUARDIAN', 'Guardian'], ['OTHER', 'Other'],
].map(([value, label]) => ({ value: value!, label: label! }));

interface Found { guardianId: string; fullName: string; phone: string; children: { id: string; fullName: string; className: string | null }[] }

export function GuardiansTab({ studentId, guardians, canEdit, canSeeIds }: { studentId: string; guardians: ProfileGuardian[]; canEdit: boolean; canSeeIds: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProfileGuardian | null>(null);
  const [removing, setRemoving] = useState<ProfileGuardian | null>(null);
  const { busy, run } = useBusy();

  async function patch(g: ProfileGuardian, link: Record<string, unknown>) {
    const r = await run(() => api(`/api/students/${studentId}/guardians/${g.guardianId}`, 'PATCH', { link }));
    if (r && !r.ok) toast.error(problem(r)); else router.refresh();
  }
  async function unlink() {
    if (!removing) return;
    const r = await run(() => api(`/api/students/${studentId}/guardians/${removing.guardianId}`, 'DELETE'));
    if (r && !r.ok) toast.error(problem(r)); else { toast.success('Guardian unlinked'); setRemoving(null); router.refresh(); }
  }

  return (
    <Section title={`Guardians (${guardians.length})`} action={canEdit && <Button size="sm" onClick={() => setAdding(true)}>Add or link a guardian</Button>}>
      <ul className="flex flex-col gap-3">
        {guardians.map((g) => (
          <li key={g.guardianId} className="rounded-xl border border-line p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{g.fullName} <span className="font-normal text-muted">· {g.relationship.toLowerCase()}{g.relationshipNote ? ` (${g.relationshipNote})` : ''}</span></p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted">
                  <a href={`tel:${g.phone}`} className="font-mono text-primary">{g.phone}</a>{g.altPhone && <a href={`tel:${g.altPhone}`} className="font-mono text-primary">{g.altPhone}</a>}{g.email && <span className="break-all">{g.email}</span>}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.isPrimary && <Badge variant="success" label="Primary contact" />}{g.isFeePayer && <Badge variant="info" label="Fee payer" />}
                {g.canCollect && <Badge variant="neutral" label="May collect" />}{!g.receivesSms && <Badge variant="warning" label="No SMS" />}
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {g.occupation && <div><dt className="inline text-muted">Occupation: </dt><dd className="inline">{g.occupation}</dd></div>}
              {g.address && <div><dt className="inline text-muted">Address: </dt><dd className="inline">{g.address}</dd></div>}
              <div><dt className="inline text-muted">National ID: </dt><dd className="inline">{canSeeIds ? g.nationalId ?? 'not recorded' : g.hasNationalId ? 'On file (you may not see the number)' : 'not recorded'}</dd></div>
              {g.custodyNote && <div className="font-medium text-warn"><dt className="inline">Custody note: </dt><dd className="inline">{g.custodyNote}</dd></div>}
            </dl>
            {g.otherChildren.length > 0 && (
              <p className="mt-2 text-sm text-muted">Also the guardian of: {g.otherChildren.map((c, i) => (
                <span key={c.id}>{i > 0 && ', '}<Link href={`/students/${c.id}`} className="text-primary hover:underline">{c.fullName}</Link>{c.className ? ` (${c.className})` : ''}</span>
              ))}</p>
            )}
            {canEdit && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-2">
                {!g.isPrimary && <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch(g, { makePrimary: true })}>Make primary</Button>}
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch(g, { isFeePayer: !g.isFeePayer })}>{g.isFeePayer ? 'Not fee payer' : 'Fee payer'}</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch(g, { receivesSms: !g.receivesSms })}>{g.receivesSms ? 'Stop SMS' : 'Send SMS'}</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch(g, { canCollect: !g.canCollect })}>{g.canCollect ? 'May not collect' : 'May collect'}</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(g)}>Edit details and custody note</Button>
                {!g.isPrimary && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoving(g)}>Unlink</Button>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {adding && <AddGuardianModal studentId={studentId} onClose={() => setAdding(false)} onDone={() => { setAdding(false); router.refresh(); }} />}
      {editing && <EditGuardianModal studentId={studentId} g={editing} canSeeIds={canSeeIds} onClose={() => setEditing(null)} onDone={() => { setEditing(null); router.refresh(); }} />}
      <ConfirmDialog open={!!removing} title="Unlink this guardian?" confirmLabel="Unlink" destructive onConfirm={unlink} onCancel={() => setRemoving(null)} loading={busy}>{removing?.fullName ?? ''} will no longer be a guardian of this student. Their record stays for any other children.</ConfirmDialog>
    </Section>
  );
}

export function AddGuardianModal({ studentId, onClose, onDone }: { studentId: string; onClose: () => void; onDone: () => void }) {
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [searched, setSearched] = useState(false);
  const [f, setF] = useState({ fullName: '', phone2: '', email: '', nationalId: '', occupation: '', address: '', relationship: 'GUARDIAN', relationshipNote: '', isPrimary: false, isFeePayer: false, receivesSms: true, canCollect: true, custodyNote: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const { busy, run } = useBusy();
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  // Search by phone first, so siblings share one guardian record.
  useEffect(() => {
    clearTimeout(timer.current);
    setFound(null); setSearched(false);
    if (phone.replace(/\D/g, '').length < 9) return;
    timer.current = setTimeout(async () => {
      const r = await api(`/api/students/guardians/lookup?phone=${encodeURIComponent(phone)}`);
      if (r.ok) { setFound(r.body.data.guardian); setSearched(true); }
    }, 400);
    return () => clearTimeout(timer.current);
  }, [phone]);

  async function submit() {
    const body = found ? { guardianId: found.guardianId } : { fullName: f.fullName, phone, phone2: f.phone2 || undefined, email: f.email || undefined, nationalId: f.nationalId || undefined, occupation: f.occupation || undefined, address: f.address || undefined };
    const r = await run(() => api(`/api/students/${studentId}/guardians`, 'POST', { ...body, relationship: f.relationship, relationshipNote: f.relationshipNote || undefined, isPrimary: f.isPrimary, isFeePayer: f.isFeePayer, receivesSms: f.receivesSms, canCollect: f.canCollect, custodyNote: f.custodyNote || undefined }));
    if (!r) return;
    if (!r.ok) { setErrors({ ...fieldMessages(r), form: problem(r) }); return; }
    toast.success('Guardian added');
    onDone();
  }

  return (
    <Modal open onClose={onClose} title="Add or link a guardian" size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!(found || (searched && f.fullName))}>{found ? 'Link guardian' : 'Add guardian'}</Button></>}>
      <div className="flex flex-col gap-3">
        <Input id="g-phone" type="tel" label="Phone (+263) — search first" required placeholder="0771234567" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} hint="If this person is already a guardian of another student, they are found here." />
        {found && (
          <div role="status" className="rounded-xl bg-tint p-3 text-sm text-ink">
            <p><strong>{found.fullName}</strong> is already in the school{found.children.length ? ` and has ${found.children.length} ${found.children.length === 1 ? 'child' : 'children'} here: ${found.children.map((c) => `${c.fullName}${c.className ? ` (${c.className})` : ''}`).join(', ')}` : ''}.</p>
            <p className="mt-1 text-muted">Link this guardian to the student?</p>
          </div>
        )}
        {searched && !found && (
          <>
            <FormGrid>
              <Input id="g-name" label="Full name" required value={f.fullName} onChange={(e) => set('fullName', e.target.value)} error={errors.fullName} />
              <Input id="g-phone2" type="tel" label="Second phone" value={f.phone2} onChange={(e) => set('phone2', e.target.value)} error={errors.phone2} />
              <Input id="g-email" type="email" label="Email" value={f.email} onChange={(e) => set('email', e.target.value)} error={errors.email} />
              <Input id="g-id" label="National ID" value={f.nationalId} onChange={(e) => set('nationalId', e.target.value)} error={errors.nationalId} />
              <Input id="g-occ" label="Occupation" value={f.occupation} onChange={(e) => set('occupation', e.target.value)} />
              <Input id="g-addr" label="Address" value={f.address} onChange={(e) => set('address', e.target.value)} />
            </FormGrid>
          </>
        )}
        {(found || searched) && (
          <>
            <FormGrid>
              <Select id="g-rel" label="Relationship" required value={f.relationship} onChange={(e) => set('relationship', e.target.value)} options={RELATIONSHIP_OPTIONS} error={errors.relationship} />
              {f.relationship === 'OTHER' && <Input id="g-relnote" label="Say how they are related" value={f.relationshipNote} onChange={(e) => set('relationshipNote', e.target.value)} error={errors.relationshipNote} />}
            </FormGrid>
            <div className="grid grid-cols-1 sm:grid-cols-2">
              <Checkbox label="Primary contact" checked={f.isPrimary} onChange={(v) => set('isPrimary', v)} hint="Replaces the current primary contact." />
              <Checkbox label="Fee payer" checked={f.isFeePayer} onChange={(v) => set('isFeePayer', v)} />
              <Checkbox label="Receives SMS" checked={f.receivesSms} onChange={(v) => set('receivesSms', v)} />
              <Checkbox label="Can collect the student" checked={f.canCollect} onChange={(v) => set('canCollect', v)} />
            </div>
            <Input id="g-custody" label="Custody note" placeholder="e.g. Only collect with mother" value={f.custodyNote} onChange={(e) => set('custodyNote', e.target.value)} />
          </>
        )}
        {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      </div>
    </Modal>
  );
}

function EditGuardianModal({ studentId, g, canSeeIds, onClose, onDone }: { studentId: string; g: ProfileGuardian; canSeeIds: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ fullName: g.fullName, phone: g.phone, altPhone: g.altPhone ?? '', email: g.email ?? '', nationalId: g.nationalId ?? '', occupation: g.occupation ?? '', address: g.address ?? '', custodyNote: g.custodyNote ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function submit() {
    const guardian: Record<string, string | null> = { fullName: f.fullName, phone: f.phone, altPhone: f.altPhone || null, email: f.email || null, occupation: f.occupation || null, address: f.address || null };
    if (canSeeIds) guardian.nationalId = f.nationalId || null;
    const r = await run(() => api(`/api/students/${studentId}/guardians/${g.guardianId}`, 'PATCH', { guardian, link: { custodyNote: f.custodyNote || null } }));
    if (!r) return;
    if (!r.ok) { setErrors({ ...fieldMessages(r), form: problem(r) }); return; }
    toast.success('Saved');
    onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Edit ${g.fullName}`} size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Save</Button></>}>
      <p className="mb-3 text-xs text-muted">Name, phone and email belong to the guardian and change for every child they have here. The custody note is only for this student.</p>
      <FormGrid>
        <Input id="e-name" label="Full name" value={f.fullName} onChange={(e) => set('fullName', e.target.value)} error={errors['guardian.fullName']} />
        <Input id="e-phone" type="tel" label="Phone" value={f.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
        <Input id="e-alt" type="tel" label="Second phone" value={f.altPhone} onChange={(e) => set('altPhone', e.target.value)} />
        <Input id="e-email" type="email" label="Email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        {canSeeIds && <Input id="e-id" label="National ID" value={f.nationalId} onChange={(e) => set('nationalId', e.target.value)} />}
        <Input id="e-occ" label="Occupation" value={f.occupation} onChange={(e) => set('occupation', e.target.value)} />
        <Input id="e-addr" label="Address" value={f.address} onChange={(e) => set('address', e.target.value)} />
        <Input id="e-cust" label="Custody note (this student)" value={f.custodyNote} onChange={(e) => set('custodyNote', e.target.value)} />
      </FormGrid>
      {errors.form && <p role="alert" className="mt-2 text-sm text-danger">{errors.form}</p>}
    </Modal>
  );
}
