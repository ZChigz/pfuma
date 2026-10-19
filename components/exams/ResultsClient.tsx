'use client';

// Publishing. Each class shows whether it is ready, and what is missing if it is not (unverified sheets, comments, remarks). The
// Head publishes one class or a whole form; publishing recalculates the class, locks the results and gives each card a code.
// Unpublishing needs a reason. Downloads: one card, the whole class in one PDF, the class results sheet in Excel.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Notice, api, fieldClass, labelClass, problem } from '@/components/exams/shared';
import type { ResultsClass } from '@/lib/exams/publish';

export function ResultsClient({ data, flags }: { data: { termId: string; termName: string; classes: ResultsClass[] }; flags: { publish: boolean; unpublish: boolean; comments: boolean } }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [unpub, setUnpub] = useState<ResultsClass[] | null>(null);
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const levels = Array.from(new Map(data.classes.map((c) => [c.levelId, c.levelName])).entries());

  async function publish(classes: ResultsClass[]) {
    setBusy(classes.map((c) => c.classId).join(','));
    const r = await api('/api/exams/publish', 'POST', { termId: data.termId, classIds: classes.map((c) => c.classId) });
    setBusy(null);
    if (!r.ok) return toast.error(problem(r));
    const d = r.body.data as { classes: number; students: number };
    toast.success(`Published ${d.classes} class${d.classes === 1 ? '' : 'es'}: ${d.students} report cards are ready`);
    router.refresh();
  }

  async function unpublish() {
    if (!unpub) return;
    setBusy('unpublish');
    const r = await api('/api/exams/unpublish', 'POST', { termId: data.termId, classIds: unpub.map((c) => c.classId), reason: reason.trim() });
    setBusy(null);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Unpublished. The results are off report cards and the portal until they are published again.');
    setUnpub(null); setReason('');
    router.refresh();
  }

  if (data.classes.length === 0) return <Notice tone="info">No class has students enrolled in {data.termName}.</Notice>;

  return (
    <div className="flex flex-col gap-4">
      {flags.publish && levels.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-4">
          <span className="text-sm font-semibold text-ink">Publish a whole form:</span>
          {levels.map(([id, name]) => {
            const cs = data.classes.filter((c) => c.levelId === id);
            const ready = cs.every((c) => c.ready || c.published) && cs.some((c) => !c.published);
            return <Button key={id} size="sm" variant="secondary" disabled={!ready} loading={busy === cs.map((c) => c.classId).join(',')} onClick={() => publish(cs.filter((c) => !c.published))}>{name}</Button>;
          })}
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {data.classes.map((c) => (
          <li key={c.classId} className="rounded-2xl bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-ink">{c.className}</h2>
                <p className="text-sm text-muted">{c.students} students{c.publishedAt ? ` · published ${c.publishedAt.slice(0, 10)}` : ''}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {c.published ? <Badge variant="success" label="Published" /> : c.ready ? <Badge variant="info" label="Ready to publish" /> : <Badge variant="warning" label={`${c.blockers.length} thing${c.blockers.length === 1 ? '' : 's'} missing`} />}
              </div>
            </div>
            {!c.published && c.blockers.length > 0 && (
              <div className="mt-3">
                <button type="button" onClick={() => setOpen(open === c.classId ? null : c.classId)} aria-expanded={open === c.classId} className="text-sm font-semibold text-primary hover:underline">{open === c.classId ? 'Hide what is missing' : 'What is missing?'}</button>
                {open === c.classId && <ClassCheck classId={c.classId} termId={data.termId} />}
              </div>
            )}
            {c.warnings.map((w) => <p key={w} className="mt-2 text-xs text-warn">{w}</p>)}
            <div className="mt-4 flex flex-wrap gap-2">
              {flags.comments && <Link href={`/exams/comments/${c.classId}`} className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-4 text-sm font-semibold text-primary hover:bg-tint">Comments</Link>}
              {flags.publish && !c.published && <Button size="sm" onClick={() => publish([c])} disabled={!c.ready} loading={busy === c.classId}>Publish</Button>}
              {flags.publish && !c.published && <a className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-4 text-sm font-semibold text-primary hover:bg-tint" href={`/api/exams/report-cards/class/${c.classId}?termId=${data.termId}&draft=1`}>Preview cards (draft)</a>}
              {c.published && <a className="inline-flex min-h-[44px] items-center rounded-full bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover" href={`/api/exams/report-cards/class/${c.classId}?termId=${data.termId}`}>Report cards PDF</a>}
              <a className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-4 text-sm font-semibold text-primary hover:bg-tint" href={`/api/exams/broadsheet?classId=${c.classId}&termId=${data.termId}`}>Results sheet (Excel)</a>
              {flags.unpublish && c.published && <Button size="sm" variant="danger" onClick={() => setUnpub([c])}>Unpublish</Button>}
            </div>
          </li>
        ))}
      </ul>
      <Modal open={!!unpub} onClose={() => setUnpub(null)} title="Unpublish results"
        footer={<><Button variant="ghost" onClick={() => setUnpub(null)}>Cancel</Button><Button variant="danger" onClick={unpublish} loading={busy === 'unpublish'} disabled={reason.trim().length < 5}>Unpublish</Button></>}>
        <p className="mb-3 text-sm text-ink">The results of {unpub?.map((c) => c.className).join(', ')} disappear from report cards and the parent portal, and their verification codes stop working. Then unlock the mark sheet that needs correcting. Publishing again recalculates the whole class.</p>
        <div className="flex flex-col gap-1.5"><label htmlFor="up-reason" className={labelClass}>Reason (required)</label>
          <textarea id="up-reason" className={`${fieldClass} h-24 py-2`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></div>
      </Modal>
    </div>
  );
}

function ClassCheck({ classId, termId }: { classId: string; termId: string }) {
  const [items, setItems] = useState<{ message: string; items?: string[]; severity: string }[] | null>(null);
  useEffect(() => {
    let live = true;
    void api(`/api/exams/publish/check?classId=${classId}&termId=${termId}`).then((r) => { if (live) setItems(r.ok ? (r.body.data as { problems: { message: string; items?: string[]; severity: string }[] }).problems : []); });
    return () => { live = false; };
  }, [classId, termId]);
  if (!items) return <p className="mt-2 text-sm text-muted">Checking...</p>;
  return (
    <ul className="mt-2 flex flex-col gap-2 text-sm">
      {items.filter((p) => p.severity === 'block').map((p) => (
        <li key={p.message} className="rounded-xl border border-warn-line bg-warn-bg px-3 py-2 text-ink">
          <strong>{p.message}</strong>
          {p.items && <ul className="mt-1 list-disc pl-5 text-xs">{p.items.slice(0, 8).map((i) => <li key={i}>{i}</li>)}{p.items.length > 8 && <li>and {p.items.length - 8} more</li>}</ul>}
        </li>
      ))}
    </ul>
  );
}
