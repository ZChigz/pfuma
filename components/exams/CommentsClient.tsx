'use client';

// The class comments page. Each row: the student's results, then the class teacher's comment box and the Head's remark box (each only
// for the person allowed to write it). A comment bank offers common phrases to pick and edit. The Head can also write one remark for
// a whole band of averages (for example 75% and above) and then edit it per student.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { Notice, Section, api, fieldClass, labelClass, problem } from '@/components/exams/shared';
import type { ClassComments } from '@/lib/exams/publish';

const MAX = 300;

export function CommentsClient({ data }: { data: ClassComments }) {
  const router = useRouter();
  const [ct, setCt] = useState<Record<string, string>>(Object.fromEntries(data.rows.map((r) => [r.studentId, r.classTeacherComment])));
  const [head, setHead] = useState<Record<string, string>>(Object.fromEntries(data.rows.map((r) => [r.studentId, r.headRemark])));
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [band, setBand] = useState({ min: '75', max: '100', text: '', overwrite: false });
  const [busy, setBusy] = useState(false);
  const locked = data.rows.some((r) => r.published);

  async function save(kind: 'CLASS_TEACHER' | 'HEAD', studentId: string, text: string) {
    const before = kind === 'HEAD' ? data.rows.find((r) => r.studentId === studentId)!.headRemark : data.rows.find((r) => r.studentId === studentId)!.classTeacherComment;
    if (text.trim() === before.trim() && saved[`${kind}${studentId}`] !== false) return;
    const r = await api('/api/exams/class-comments', 'PUT', { classId: data.classId, termId: data.termId, kind, comments: [{ studentId, text: text.trim() || null }] });
    if (!r.ok) return toast.error(problem(r));
    setSaved((s) => ({ ...s, [`${kind}${studentId}`]: true }));
  }

  async function applyBand() {
    setBusy(true);
    const r = await api('/api/exams/class-comments/band', 'POST', { classId: data.classId, termId: data.termId, minAverage: Number(band.min), maxAverage: Number(band.max), text: band.text.trim(), overwrite: band.overwrite });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    const d = r.body.data as { saved: number; skipped: number };
    toast.success(`${d.saved} remark${d.saved === 1 ? '' : 's'} written${d.skipped ? `, ${d.skipped} already had one` : ''}`);
    router.refresh();
  }

  const pick = (kind: 'CLASS_TEACHER' | 'HEAD', studentId: string, phrase: string) => {
    if (!phrase) return;
    (kind === 'HEAD' ? setHead : setCt)((s) => ({ ...s, [studentId]: phrase }));
    void save(kind, studentId, phrase);
  };

  return (
    <div className="flex flex-col gap-4">
      {locked && <Notice tone="info">These results are published, so comments cannot change. Unpublish the class first.</Notice>}
      {!data.canWriteClass && !data.canWriteHead && <Notice tone="info">You can read the comments but not write them.</Notice>}

      {data.canWriteHead && !locked && (
        <Section title="One remark for a band of the class" hint="Fills the Head's remark for everyone whose average is in the band. You can then edit it for any student.">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5"><label htmlFor="b-min" className={labelClass}>Average from %</label><input id="b-min" className={fieldClass} inputMode="decimal" value={band.min} onChange={(e) => setBand({ ...band, min: e.target.value })} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="b-max" className={labelClass}>to %</label><input id="b-max" className={fieldClass} inputMode="decimal" value={band.max} onChange={(e) => setBand({ ...band, max: e.target.value })} /></div>
            <div className="flex flex-col gap-1.5 sm:col-span-2"><label htmlFor="b-text" className={labelClass}>Remark</label>
              <input id="b-text" list="bank-head" className={fieldClass} maxLength={MAX} value={band.text} onChange={(e) => setBand({ ...band, text: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm text-ink sm:col-span-3"><input type="checkbox" className="h-4 w-4" checked={band.overwrite} onChange={(e) => setBand({ ...band, overwrite: e.target.checked })} /> Replace remarks already written</label>
            <div><Button onClick={applyBand} loading={busy} disabled={!band.text.trim()}>Apply to the band</Button></div>
          </div>
        </Section>
      )}

      <datalist id="bank-ct">{data.bank.CLASS_TEACHER.map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="bank-head">{data.bank.HEAD.map((t) => <option key={t} value={t} />)}</datalist>

      <ul className="flex flex-col gap-3">
        {data.rows.map((r) => (
          <li key={r.studentId} className="rounded-2xl bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h2 className="text-base font-semibold text-ink">{r.name}</h2><p className="text-xs text-muted">{r.admissionNumber}</p></div>
              <div className="text-right text-sm">
                {r.average !== null ? <><span className="text-lg font-bold tabular-nums text-ink">{r.average.toFixed(1)}%</span>{r.classPosition ? <span className="ml-2 text-muted">position {r.classPosition} of {r.classSize}</span> : null}</> : <Badge variant="neutral" label="No results yet" />}
              </div>
            </div>
            {r.subjects.length > 0 && <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">{r.subjects.map((s) => <span key={s.subject}>{s.subject} <strong>{s.mark}</strong>{s.grade ? ` (${s.grade})` : ''}</span>)}</p>}
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`ct-${r.studentId}`} className={labelClass}>Class teacher&apos;s comment</label>
                <textarea id={`ct-${r.studentId}`} className={`${fieldClass} h-20 py-2`} maxLength={MAX} readOnly={!data.canWriteClass || locked} value={ct[r.studentId] ?? ''}
                  onChange={(e) => { setCt((s) => ({ ...s, [r.studentId]: e.target.value })); setSaved((s) => ({ ...s, [`CLASS_TEACHER${r.studentId}`]: false })); }} onBlur={(e) => void save('CLASS_TEACHER', r.studentId, e.target.value)} />
                <div className="flex items-center justify-between gap-2 text-xs text-muted">
                  {data.canWriteClass && !locked && data.bank.CLASS_TEACHER.length > 0 ? (
                    <select aria-label="Pick a common phrase" className="h-9 max-w-[60%] rounded-lg border border-line bg-white px-2 text-xs" value="" onChange={(e) => pick('CLASS_TEACHER', r.studentId, e.target.value)}>
                      <option value="">Pick a phrase...</option>{data.bank.CLASS_TEACHER.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  ) : <span />}
                  <span>{(ct[r.studentId] ?? '').length}/{MAX}{saved[`CLASS_TEACHER${r.studentId}`] ? ' · saved' : ''}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`hd-${r.studentId}`} className={labelClass}>Head&apos;s remark</label>
                <textarea id={`hd-${r.studentId}`} className={`${fieldClass} h-20 py-2`} maxLength={MAX} readOnly={!data.canWriteHead || locked} value={head[r.studentId] ?? ''}
                  onChange={(e) => { setHead((s) => ({ ...s, [r.studentId]: e.target.value })); setSaved((s) => ({ ...s, [`HEAD${r.studentId}`]: false })); }} onBlur={(e) => void save('HEAD', r.studentId, e.target.value)} />
                <div className="flex items-center justify-between gap-2 text-xs text-muted">
                  {data.canWriteHead && !locked && data.bank.HEAD.length > 0 ? (
                    <select aria-label="Pick a common phrase" className="h-9 max-w-[60%] rounded-lg border border-line bg-white px-2 text-xs" value="" onChange={(e) => pick('HEAD', r.studentId, e.target.value)}>
                      <option value="">Pick a phrase...</option>{data.bank.HEAD.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  ) : <span />}
                  <span>{(head[r.studentId] ?? '').length}/{MAX}{saved[`HEAD${r.studentId}`] ? ' · saved' : ''}</span>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
