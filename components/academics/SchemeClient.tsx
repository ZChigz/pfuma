'use client';

// A scheme of work: one card per teaching week of the term (topics from the syllabus, objectives, activities, resources,
// assessment), and for each week that has started the record of work: which planned topics were covered, anything extra, and
// problems. The HOD approves or returns it with a comment.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { api, ClosedNotice, linkButton, Notice, problem, Section } from '@/components/academics/shared';

interface TopicNode { id: string; title: string; objectives: string | null; children: TopicNode[] }
interface Week {
  id: string; weekNo: number; startDate: string; endDate: string; topicIds: string[]; topics: { id: string; title: string; parent: string | null }[];
  objectives: string | null; activities: string | null; resources: string | null; assessment: string | null;
  record: { coveredTopicIds: string[]; extraNotes: string | null; problems: string | null; recordedAt: string } | null; due: boolean; current: boolean;
}
interface Data {
  assignment: { id: string; subject: string; target: string; teacher: string; termName: string };
  term: { id: string; name: string; status: string };
  scheme: { id: string; status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED'; returnComment: string | null } | null;
  weeks: Week[]; topics: TopicNode[]; dueDate: string | null; late: boolean; coverage: { due: number; covered: number; pct: number | null };
  canEdit: boolean; canRecord: boolean; canDecide: boolean;
}

const STATUS = { NONE: ['neutral', 'Not started'], DRAFT: ['warning', 'Draft'], SUBMITTED: ['info', 'Waiting for the HOD'], APPROVED: ['success', 'Approved'], RETURNED: ['danger', 'Returned'] } as const;

type Edit = { topicIds: string[]; objectives: string; activities: string; resources: string; assessment: string };
type Rec = { covered: string[]; extra: string; problems: string };

function flatten(nodes: TopicNode[], depth = 0): { node: TopicNode; depth: number }[] {
  return nodes.flatMap((n) => [{ node: n, depth }, ...flatten(n.children, depth + 1)]);
}

export function SchemeClient({ data }: { data: Data }) {
  const router = useRouter();
  const { scheme } = data;
  const status = scheme?.status ?? 'NONE';
  const [edits, setEdits] = useState<Record<string, Edit>>(() => Object.fromEntries(data.weeks.map((w) => [w.id, { topicIds: w.topicIds, objectives: w.objectives ?? '', activities: w.activities ?? '', resources: w.resources ?? '', assessment: w.assessment ?? '' }])));
  const [recs, setRecs] = useState<Record<string, Rec>>(() => Object.fromEntries(data.weeks.map((w) => [w.id, { covered: w.record?.coveredTopicIds ?? [], extra: w.record?.extraNotes ?? '', problems: w.record?.problems ?? '' }])));
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const flat = useMemo(() => flatten(data.topics), [data.topics]);
  const title = new Map(flat.map((f) => [f.node.id, f.node.title]));
  const url = `/api/academics/schemes/${data.assignment.id}`;
  const fresh = () => router.refresh();

  async function run(fn: () => ReturnType<typeof api>, ok: string) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { toast.error(problem(r)); return null; }
    toast.success(ok);
    fresh();
    return r;
  }

  const start = () => run(() => api(url, 'POST'), 'Scheme started');
  const save = () => run(() => api(url, 'PUT', { weeks: data.weeks.map((w) => ({ weekNo: w.weekNo, ...edits[w.id]! })) }), 'Scheme saved');
  const submit = async () => { if (await save()) await run(() => api(`${url}/submit`, 'POST'), 'Sent to the head of department'); };
  const decide = (decision: 'APPROVE' | 'RETURN') => run(() => api(`${url}/decide`, 'POST', { decision, comment: comment || undefined }), decision === 'APPROVE' ? 'Scheme approved' : 'Scheme returned');
  async function copyLast() {
    if (!confirm('Copy last year\'s scheme for this subject and form into this one? Anything written here will be replaced.')) return;
    await run(() => api(`${url}/copy`, 'POST', { overwrite: true }), 'Copied from last year');
  }
  async function saveRecord(w: Week) {
    const r = recs[w.id]!;
    await run(() => api(`/api/academics/schemes/records/${w.id}`, 'PUT', { coveredTopicIds: r.covered, extraNotes: r.extra, problems: r.problems }), 'Recorded');
  }

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const cell = (w: Week, key: keyof Edit, label: string) => (
    <label className="flex flex-col gap-1 text-sm font-medium text-ink">{label}
      <textarea rows={2} disabled={!data.canEdit} value={edits[w.id]![key] as string} onChange={(e) => setEdits({ ...edits, [w.id]: { ...edits[w.id]!, [key]: e.target.value } })} className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-normal disabled:bg-canvas" />
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      {data.term.status === 'CLOSED' && <ClosedNotice termName={data.term.name} />}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS[status][0]} label={STATUS[status][1]} />
          {data.dueDate && <span className="text-sm text-muted">Due {data.dueDate}{data.late ? ' — late' : ''}</span>}
          {data.coverage.pct !== null && <span className="text-sm text-ink">Coverage so far: <b>{data.coverage.pct}%</b> ({data.coverage.covered} of {data.coverage.due} planned topics)</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {scheme && <Link href={`/print/academics/scheme?assignmentId=${data.assignment.id}`} target="_blank" className={linkButton}>Print (A4)</Link>}
          {!scheme && data.canEdit && <Button onClick={start} loading={busy}>Start the scheme</Button>}
          {scheme && data.canEdit && <Button variant="secondary" onClick={copyLast} disabled={busy}>Copy from last year</Button>}
          {scheme && data.canEdit && <Button variant="secondary" onClick={save} loading={busy}>Save</Button>}
          {scheme && data.canEdit && <Button onClick={submit} loading={busy}>Submit</Button>}
        </div>
      </div>

      {data.coverage.pct !== null && (
        <div role="progressbar" aria-label="Syllabus coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.coverage.pct} className="h-3 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-primary" style={{ width: `${data.coverage.pct}%` }} /></div>
      )}
      {scheme?.status === 'RETURNED' && scheme.returnComment && <Notice tone="warn"><b>Returned:</b> {scheme.returnComment}</Notice>}
      {!scheme && !data.canEdit && <Notice tone="info">No scheme of work has been started for this assignment.</Notice>}
      {flat.length === 0 && scheme && data.canEdit && <Notice tone="info">There is no syllabus for this subject and form yet, so you can write objectives but not pick topics. The head of department can add or import the syllabus under Syllabus.</Notice>}

      {data.canDecide && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4">
          <p className="w-full text-sm font-semibold text-ink">This scheme is waiting for approval.</p>
          <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-sm font-medium text-ink">Comment (needed to return)
            <input value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-[44px] rounded-xl border border-line px-3 text-sm" />
          </label>
          <Button onClick={() => decide('APPROVE')} loading={busy}>Approve</Button>
          <Button variant="secondary" onClick={() => decide('RETURN')} loading={busy}>Return</Button>
        </div>
      )}

      {scheme && data.weeks.map((w) => (
        <Section
          key={w.id}
          title={`Week ${w.weekNo}`}
          hint={`${w.startDate} to ${w.endDate}${w.current ? ' · this week' : ''}`}
          action={w.record ? <Badge variant="success" label="Recorded" /> : w.due && data.canRecord ? <Badge variant="warning" label="To record" /> : undefined}
        >
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1 text-sm font-medium text-ink">Topics</p>
              <div className="flex flex-wrap items-center gap-2">
                {edits[w.id]!.topicIds.length === 0 && <span className="text-sm text-muted">None chosen</span>}
                {edits[w.id]!.topicIds.map((id) => <span key={id} className="rounded-full bg-tint px-3 py-1 text-sm font-semibold text-primary">{title.get(id) ?? '(removed topic)'}</span>)}
                {data.canEdit && flat.length > 0 && <button type="button" onClick={() => setPickFor(w.id)} className="min-h-[44px] rounded-full border border-primary px-4 text-sm font-semibold text-primary hover:bg-tint">Choose topics</button>}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">{cell(w, 'objectives', 'Objectives')}{cell(w, 'activities', 'Teaching and learning activities')}{cell(w, 'resources', 'Resources and references')}{cell(w, 'assessment', 'Assessment planned')}</div>

            {w.due && (data.canRecord || w.record) && (
              <div className="rounded-xl bg-canvas p-3">
                <p className="mb-2 text-sm font-semibold text-ink">Record of work</p>
                {w.topicIds.length === 0 && <p className="text-sm text-muted">No topics were planned for this week. Use the notes below.</p>}
                <div className="flex flex-col">
                  {w.topicIds.map((id) => (
                    <label key={id} className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" disabled={!data.canRecord} checked={recs[w.id]!.covered.includes(id)} onChange={() => setRecs({ ...recs, [w.id]: { ...recs[w.id]!, covered: toggle(recs[w.id]!.covered, id) } })} />{title.get(id) ?? '(removed topic)'}</label>
                  ))}
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm font-medium text-ink">Anything extra covered<textarea rows={2} disabled={!data.canRecord} value={recs[w.id]!.extra} onChange={(e) => setRecs({ ...recs, [w.id]: { ...recs[w.id]!, extra: e.target.value } })} className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-normal" /></label>
                  <label className="flex flex-col gap-1 text-sm font-medium text-ink">Problems (for example lost 2 lessons to sports day)<textarea rows={2} disabled={!data.canRecord} value={recs[w.id]!.problems} onChange={(e) => setRecs({ ...recs, [w.id]: { ...recs[w.id]!, problems: e.target.value } })} className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-normal" /></label>
                </div>
                {data.canRecord && <Button className="mt-3" variant="secondary" onClick={() => saveRecord(w)} loading={busy}>Save record</Button>}
              </div>
            )}
          </div>
        </Section>
      ))}

      <Modal open={!!pickFor} onClose={() => setPickFor(null)} size="lg" title="Choose the topics for this week" footer={<Button onClick={() => setPickFor(null)}>Done</Button>}>
        <div className="max-h-[60vh] overflow-auto">
          {pickFor && flat.map(({ node, depth }) => (
            <label key={node.id} style={{ paddingLeft: depth * 20 }} className="flex min-h-[44px] items-center gap-3 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={edits[pickFor]!.topicIds.includes(node.id)} onChange={() => setEdits({ ...edits, [pickFor]: { ...edits[pickFor]!, topicIds: toggle(edits[pickFor]!.topicIds, node.id) } })} />
              <span className={depth === 0 ? 'font-semibold' : ''}>{node.title}</span>
            </label>
          ))}
        </div>
      </Modal>
    </div>
  );
}
