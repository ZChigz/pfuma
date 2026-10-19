'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { useUploadThing } from '@/lib/uploadthing';
import type { ChecklistItem, DocumentRow } from '@/lib/students/documents';
import { api, fieldMessages, formatDay, FormGrid, problem, Section, TextArea, useBusy } from '@/components/students/shared';

const UPLOAD_TYPES: [string, string][] = [
  ['BIRTH_CERTIFICATE', 'Birth certificate'], ['GUARDIAN_ID', 'Guardian ID'], ['GRADE7_RESULTS_SLIP', 'Grade 7 results slip'], ['OLEVEL_RESULTS_SLIP', 'O Level results slip'],
  ['PREVIOUS_SCHOOL_REPORT', 'Previous school report'], ['TRANSFER_LETTER_RECEIVED', 'Transfer letter (from previous school)'], ['MEDICAL_REPORT', 'Medical report'],
  ['PHOTO_CONSENT', 'Photo consent'], ['OTHER', 'Other'],
];
const LETTERS: [string, string][] = [
  ['LETTER_ADMISSION', 'Admission letter'], ['LETTER_PROOF_OF_ENROLMENT', 'Proof of enrolment'], ['LETTER_TRANSFER', 'Transfer letter'],
  ['LETTER_TESTIMONIAL', 'Testimonial'], ['LETTER_LEAVING_CERTIFICATE', 'School leaving certificate'],
];

export function DocumentsTab({ studentId, documents, checklist, canUpload, canGenerate }: { studentId: string; documents: DocumentRow[]; checklist: ChecklistItem[]; canUpload: boolean; canGenerate: boolean }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [making, setMaking] = useState(false);
  const missing = checklist.filter((c) => !c.present);

  async function open(d: DocumentRow) {
    if (d.generated) { window.open(`/api/students/documents/${d.id}/pdf`, '_blank', 'noopener'); return; }
    const r = await api(`/api/students/documents/${d.id}/link`);
    if (!r.ok) { toast.error(problem(r)); return; }
    window.open(r.body.data.url, '_blank', 'noopener');
    toast.info('The link works for 10 minutes.');
  }

  return (
    <div className="flex flex-col gap-4">
      {checklist.length > 0 && (
        <Section title="Required documents">
          <ul className="flex flex-col gap-1.5">
            {checklist.map((c) => (
              <li key={c.type} className="flex items-center justify-between gap-2 text-sm">
                <span>{c.label}</span>
                {c.present ? <Badge variant="success" label="On file" /> : c.expired ? <Badge variant="warning" label="Expired" /> : <Badge variant="danger" label="Missing" />}
              </li>
            ))}
          </ul>
          {missing.length > 0 && <p className="mt-2 text-xs text-muted">{missing.length} required document{missing.length === 1 ? ' is' : 's are'} missing or out of date.</p>}
        </Section>
      )}
      <Section title={`Documents and letters (${documents.length})`} action={<div className="flex gap-2">{canGenerate && <Button size="sm" variant="secondary" onClick={() => setMaking(true)}>Make a letter</Button>}{canUpload && <Button size="sm" onClick={() => setUploading(true)}>Upload a document</Button>}</div>}>
        {documents.length === 0 ? <p className="text-sm text-muted">No documents yet.</p> : (
          <ul className="flex flex-col divide-y divide-line">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="break-words font-medium text-ink">{d.title}</p>
                  <p className="text-xs text-muted">{d.typeLabel}{d.referenceNo ? ` · ${d.referenceNo}` : ''}{d.date ? ` · ${formatDay(d.date)}` : ''} · {d.uploadedBy}{d.notes ? ` · ${d.notes}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  {d.expiryDate && <Badge variant={d.expired ? 'danger' : 'neutral'} label={d.expired ? `Expired ${formatDay(d.expiryDate)}` : `Expires ${formatDay(d.expiryDate)}`} />}
                  {d.generated && <Badge variant="info" label="Generated" />}
                  {d.canOpen ? <Button size="sm" variant="secondary" onClick={() => open(d)}>{d.generated ? 'Print' : 'Open'}</Button> : <span className="text-xs text-muted">Restricted</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {uploading && <UploadModal studentId={studentId} onClose={() => setUploading(false)} onDone={() => { setUploading(false); router.refresh(); }} />}
      {making && <LetterModal studentId={studentId} onClose={() => setMaking(false)} onDone={() => { setMaking(false); router.refresh(); }} />}
    </div>
  );
}

function UploadModal({ studentId, onClose, onDone }: { studentId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ type: '', title: '', date: '', expiryDate: '', notes: '' });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();
  const { startUpload } = useUploadThing('studentDocument');
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit() {
    if (!file) { setErrors({ form: 'Choose a file (PDF, JPG or PNG, up to 5 MB).' }); return; }
    if (file.size > 5 * 1024 * 1024) { setErrors({ form: 'The file must be 5 MB or smaller.' }); return; }
    await run(async () => {
      let res;
      try { res = await startUpload([file]); } catch (e) { setErrors({ form: e instanceof Error ? e.message : 'The upload failed. Try again.' }); return; }
      const key = (res?.[0]?.serverData as { key?: string } | undefined)?.key;
      if (!key) { setErrors({ form: 'The upload did not finish. Try again.' }); return; }
      const r = await api(`/api/students/${studentId}/documents`, 'POST', { type: f.type, title: f.title, date: f.date || undefined, expiryDate: f.expiryDate || undefined, notes: f.notes || undefined, fileKey: key, mimeType: file.type, sizeBytes: file.size });
      if (!r.ok) { setErrors({ ...fieldMessages(r), form: problem(r) }); return; }
      toast.success('Document saved');
      onDone();
    });
  }
  return (
    <Modal open onClose={onClose} title="Upload a document" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!f.type || !f.title || !file}>Upload</Button></>}>
      <div className="flex flex-col gap-3">
        <Select id="d-type" label="Type" required placeholder="Choose a type" value={f.type} onChange={(e) => set('type', e.target.value)} options={UPLOAD_TYPES.map(([value, label]) => ({ value, label }))} error={errors.type} />
        <Input id="d-title" label="Title" required value={f.title} onChange={(e) => set('title', e.target.value)} error={errors.title} />
        <FormGrid>
          <Input id="d-date" type="date" label="Date of the document" value={f.date} onChange={(e) => set('date', e.target.value)} />
          <Input id="d-exp" type="date" label="Expires (optional)" value={f.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} error={errors.expiryDate} />
        </FormGrid>
        <TextArea id="d-notes" label="Notes" rows={2} value={f.notes} onChange={(v) => set('notes', v)} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="d-file" className="text-sm font-medium text-ink">File <span className="text-danger" aria-hidden="true">*</span></label>
          <input id="d-file" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="min-h-[44px] text-sm" />
          <p className="text-xs text-muted">PDF, JPG or PNG, up to 5 MB. Files are stored privately and opened through links that stop working after 10 minutes.</p>
        </div>
        {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      </div>
    </Modal>
  );
}

function LetterModal({ studentId, onClose, onDone }: { studentId: string; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState('');
  const [f, setF] = useState({ reportingDate: '', purpose: '', conduct: '', activities: '', positions: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function submit() {
    const body: Record<string, unknown> = { type };
    if (type === 'LETTER_ADMISSION') body.reportingDate = f.reportingDate;
    if (type === 'LETTER_PROOF_OF_ENROLMENT') body.purpose = f.purpose || undefined;
    if (type === 'LETTER_TRANSFER' || type === 'LETTER_TESTIMONIAL') body.conduct = f.conduct;
    if (type === 'LETTER_TESTIMONIAL') { body.activities = f.activities || undefined; body.positions = f.positions || undefined; }
    const r = await run(() => api(`/api/students/${studentId}/letters`, 'POST', body));
    if (!r) return;
    if (!r.ok) { setErrors({ ...fieldMessages(r), form: problem(r) }); return; }
    toast.success(`Saved as ${r.body.data.referenceNo}`);
    window.open(`/api/students/documents/${r.body.data.id}/pdf`, '_blank', 'noopener');
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Make a letter" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!type}>Make letter</Button></>}>
      <div className="flex flex-col gap-3">
        <Select id="l-type" label="Letter" required placeholder="Choose a letter" value={type} onChange={(e) => { setType(e.target.value); setErrors({}); }} options={LETTERS.map(([value, label]) => ({ value, label }))} />
        {type === 'LETTER_ADMISSION' && <Input id="l-rep" type="date" label="Reporting date" required value={f.reportingDate} onChange={(e) => set('reportingDate', e.target.value)} error={errors.reportingDate} />}
        {type === 'LETTER_PROOF_OF_ENROLMENT' && <Input id="l-purpose" label="What it is for (optional)" placeholder="e.g. visa application" value={f.purpose} onChange={(e) => set('purpose', e.target.value)} />}
        {(type === 'LETTER_TRANSFER' || type === 'LETTER_TESTIMONIAL') && <TextArea id="l-conduct" label="Conduct" required rows={2} value={f.conduct} onChange={(v) => set('conduct', v)} error={errors.conduct} />}
        {type === 'LETTER_TESTIMONIAL' && <><TextArea id="l-act" label="Activities" rows={2} value={f.activities} onChange={(v) => set('activities', v)} /><TextArea id="l-pos" label="Positions held" rows={2} value={f.positions} onChange={(v) => set('positions', v)} /></>}
        {type === 'LETTER_TRANSFER' && <p className="text-xs text-muted">A transfer letter needs the leaving process to be started with the reason “Transfer to another school”.</p>}
        {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
        <p className="text-xs text-muted">The letter is printed on the school letterhead with the Head&apos;s name and signature, saved here with a reference number, and can be printed again later.</p>
      </div>
    </Modal>
  );
}
