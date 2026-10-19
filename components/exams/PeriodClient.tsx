'use client';

// One exam period: its papers (date, session, start time, rooms), the clash check, invigilation duties, seating and attendance, incident
// reports, and the road to approval (Exams Officer sends it, the Deputy approves or sends it back).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Notice, Section, Tabs, Td, Th, api, fieldClass, labelClass, problem } from '@/components/exams/shared';
import type { listIncidents, dutyRoster } from '@/lib/exams/invigilation';
import type { PeriodDetail, PaperView } from '@/lib/exams/timetable';

type Tab = 'papers' | 'clashes' | 'duties' | 'incidents';
const STATUS: Record<string, [BadgeVariant, string]> = { DRAFT: ['neutral', 'Being written'], PENDING: ['warning', 'Waiting for the Deputy'], APPROVED: ['success', 'Approved'] };
const emptyPaper = (periodId: string, startDate: string, levelId: string, subjectId: string) => ({ id: null as string | null, periodId, subjectId, levelId, paperNumber: 1, name: '', durationMinutes: 120, date: startDate, session: 'MORNING' as 'MORNING' | 'AFTERNOON', startTime: '08:30', maxMark: 100 });

export function PeriodClient({ detail, subjects, rooms, roster, incidents, currentUserId, flags }: {
  detail: PeriodDetail; subjects: { id: string; name: string }[]; rooms: { id: string; name: string; capacity: number }[]; roster: Awaited<ReturnType<typeof dutyRoster>> | null;
  incidents: Awaited<ReturnType<typeof listIncidents>>; currentUserId: string; flags: { manage: boolean; approve: boolean; invigilation: boolean };
}) {
  const router = useRouter();
  const { period, papers, clashes } = detail;
  const [tab, setTab] = useState<Tab>('papers');
  const [busy, setBusy] = useState(false);
  const [paper, setPaper] = useState<ReturnType<typeof emptyPaper> | null>(null);
  const [roomsFor, setRoomsFor] = useState<PaperView | null>(null);
  const [picked, setPicked] = useState<Record<string, { on: boolean; cap: string }>>({});
  const [returning, setReturning] = useState(false);
  const [comment, setComment] = useState('');
  const [incidentFor, setIncidentFor] = useState<PaperView | null>(null);
  const [incident, setIncident] = useState({ type: 'DISRUPTION', description: '' });
  const [duty, setDuty] = useState({ paperId: '', roomId: '', userId: '' });
  const editable = period.status === 'DRAFT' && flags.manage;
  const blocked = clashes.filter((c) => c.severity === 'block');
  const [variant, label] = STATUS[period.status] ?? ['neutral', period.status];

  async function call(url: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, ok?: string) {
    setBusy(true);
    const r = await api(url, method, body);
    setBusy(false);
    if (!r.ok) { toast.error(problem(r)); return null; }
    if (ok) toast.success(ok);
    router.refresh();
    return r;
  }

  async function savePaper() {
    if (!paper) return;
    const { id, ...body } = paper;
    const r = await call(id ? `/api/exams/timetable/papers/${id}` : '/api/exams/timetable/papers', id ? 'PATCH' : 'POST', { ...body, maxMark: Number(body.maxMark), durationMinutes: Number(body.durationMinutes), paperNumber: Number(body.paperNumber) }, 'Paper saved');
    if (r) {
      const warnings = (r.body.data as { warnings?: string[] }).warnings ?? [];
      warnings.forEach((w) => toast.info(w));
      setPaper(null);
    }
  }

  function openRooms(p: PaperView) {
    setRoomsFor(p);
    setPicked(Object.fromEntries(rooms.map((r) => { const x = p.rooms.find((y) => y.roomId === r.id); return [r.id, { on: !!x, cap: String(x?.examCapacity ?? Math.max(1, Math.ceil(r.capacity / 2))) }]; })));
  }
  async function saveRooms() {
    if (!roomsFor) return;
    const chosen = rooms.filter((r) => picked[r.id]?.on).map((r) => ({ roomId: r.id, examCapacity: Number(picked[r.id]!.cap) }));
    if (await call(`/api/exams/timetable/papers/${roomsFor.id}/rooms`, 'PUT', { rooms: chosen }, 'Rooms saved')) setRoomsFor(null);
  }

  async function addDuty() {
    if (!duty.paperId || !duty.roomId || !duty.userId) return;
    const r = await call('/api/exams/timetable/invigilation', 'POST', duty);
    if (r) { const w = (r.body.data as { warning?: string | null }).warning; if (w) toast.info(w); setDuty({ paperId: '', roomId: '', userId: '' }); }
  }

  const dutyPaper = papers.find((p) => p.id === duty.paperId);
  const days = Array.from(new Set(papers.map((p) => p.date)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4">
        <div className="flex flex-wrap items-center gap-2"><Badge variant={variant} label={label} /><span className="text-sm text-muted">{papers.length} paper{papers.length === 1 ? '' : 's'} over {days.length} day{days.length === 1 ? '' : 's'}</span></div>
        <div className="flex flex-wrap gap-2">
          {flags.manage && period.status === 'DRAFT' && <Button onClick={() => call(`/api/exams/timetable/periods/${period.id}/submit`, 'POST', undefined, 'Sent to the Deputy for approval')} loading={busy} disabled={!detail.canSubmit}>Send for approval</Button>}
          {flags.approve && period.status === 'PENDING' && <Button onClick={() => call(`/api/exams/timetable/periods/${period.id}/approve`, 'POST', undefined, 'Approved. It is on the Calendar.')} loading={busy}>Approve</Button>}
          {flags.approve && period.status !== 'DRAFT' && <Button variant="secondary" onClick={() => setReturning(true)}>{period.status === 'APPROVED' ? 'Reopen' : 'Send back'}</Button>}
          {period.status === 'APPROVED' && <a className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-4 text-sm font-semibold text-primary hover:bg-tint" href={`/print/exams/timetable?periodId=${period.id}`} target="_blank" rel="noreferrer">Print timetable</a>}
          {flags.invigilation && <a className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-4 text-sm font-semibold text-primary hover:bg-tint" href={`/print/exams/duty-roster?periodId=${period.id}`} target="_blank" rel="noreferrer">Print duty roster</a>}
        </div>
      </div>
      {blocked.length > 0 && <Notice tone="danger"><strong>{blocked.length} problem{blocked.length === 1 ? '' : 's'} to fix before this can be sent:</strong> {blocked[0]!.message}{blocked.length > 1 ? ` and ${blocked.length - 1} more (see Clashes)` : ''}</Notice>}
      {!editable && period.status !== 'APPROVED' && <Notice tone="info">{period.status === 'PENDING' ? 'This timetable is waiting for the Deputy, so it cannot be changed.' : 'You can look at this timetable.'}</Notice>}
      {period.status === 'APPROVED' && <Notice tone="success">Approved and on the Calendar. Normal lessons are suspended for {period.levels.map((l) => l.name).join(', ')} on exam days.</Notice>}

      <Tabs value={tab} onChange={setTab} label="Exam period sections" tabs={[
        { id: 'papers', label: 'Papers', badge: papers.length }, { id: 'clashes', label: 'Clashes', badge: clashes.length },
        ...(roster ? [{ id: 'duties' as const, label: 'Invigilation', badge: roster.missing.length || undefined }, { id: 'incidents' as const, label: 'Incidents', badge: incidents.length }] : []),
      ]} />

      {tab === 'papers' && (
        <Section title="Papers" action={editable ? <Button size="sm" onClick={() => setPaper(emptyPaper(period.id, period.startDate, period.levels[0]?.id ?? '', subjects[0]?.id ?? ''))}>Add a paper</Button> : undefined}>
          {papers.length === 0 ? <p className="text-sm text-muted">No papers yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead><tr><Th>Date</Th><Th>Session</Th><Th>Paper</Th><Th>Form</Th><Th className="text-right">Candidates</Th><Th>Rooms</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                <tbody className="divide-y divide-line">
                  {papers.map((p) => (
                    <tr key={p.id}>
                      <Td className="whitespace-nowrap">{p.date}</Td>
                      <Td className="whitespace-nowrap">{p.session === 'MORNING' ? 'Morning' : 'Afternoon'} {p.startTime}-{p.endTime}</Td>
                      <Td><span className="font-medium">{p.name}</span><span className="block text-xs text-muted">{p.durationMinutes} min · out of {p.maxMark}{p.hasMarks ? ' · marks entered' : ''}</span></Td>
                      <Td>{p.level}</Td>
                      <Td className="text-right tabular-nums">{p.candidates}</Td>
                      <Td>{p.rooms.length ? p.rooms.map((r) => `${r.room} (${r.examCapacity})`).join(', ') : <span className="text-danger">None</span>}</Td>
                      <Td className="whitespace-nowrap text-right">
                        {editable && <><Button size="sm" variant="ghost" onClick={() => openRooms(p)}>Rooms</Button><Button size="sm" variant="ghost" onClick={() => setPaper({ ...emptyPaper(period.id, p.date, p.levelId, p.subjectId), id: p.id, paperNumber: p.paperNumber, name: p.name, durationMinutes: p.durationMinutes, session: p.session, startTime: p.startTime, maxMark: p.maxMark })}>Change</Button></>}
                        {editable && !p.hasMarks && <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Remove ${p.name}?`)) void call(`/api/exams/timetable/papers/${p.id}`, 'DELETE', undefined, 'Removed'); }}>Remove</Button>}
                        {period.status === 'APPROVED' && <a className="text-sm font-semibold text-primary hover:underline" href={`/print/exams/seating?paperId=${p.id}`} target="_blank" rel="noreferrer">Seating</a>}
                        {roster && period.status === 'APPROVED' && <Button size="sm" variant="ghost" onClick={() => { setIncidentFor(p); setIncident({ type: 'DISRUPTION', description: '' }); }}>Report</Button>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {tab === 'clashes' && (
        <Section title="Clash check" hint="Blocked clashes must be fixed before the timetable is sent. Warnings are for your judgement.">
          {clashes.length === 0 ? <p className="text-sm text-success">No clashes: no student sits two papers at once, and every paper has enough seats.</p> : (
            <ul className="flex flex-col gap-2 text-sm">{clashes.map((c, i) => <li key={i} className={`rounded-xl border px-3 py-2 ${c.severity === 'block' ? 'border-danger-line bg-danger-bg text-danger' : 'border-warn-line bg-warn-bg text-warn'}`}><strong>{c.severity === 'block' ? 'Blocked: ' : 'Warning: '}</strong>{c.message}</li>)}</ul>
          )}
        </Section>
      )}

      {tab === 'duties' && roster && (
        <div className="flex flex-col gap-4">
          <Section title="Invigilation duties" hint="One or more teachers per room. Auto-assign spreads duties evenly and avoids each subject's own teachers where possible."
            action={flags.invigilation ? <Button size="sm" onClick={() => call('/api/exams/timetable/invigilation/auto', 'POST', { periodId: period.id }, 'Duties assigned')} loading={busy}>Auto-assign</Button> : undefined}>
            {roster.missing.length > 0 && <div className="mb-3"><Notice tone="warn">{roster.missing.length} room{roster.missing.length === 1 ? ' has' : 's have'} no invigilator: {roster.missing.slice(0, 3).map((m) => `${m.paper} (${m.room})`).join(', ')}{roster.missing.length > 3 ? ' ...' : ''}</Notice></div>}
            {roster.duties.length === 0 ? <p className="text-sm text-muted">No duties yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left">
                  <thead><tr><Th>Date</Th><Th>Paper</Th><Th>Room</Th><Th>Invigilator</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {roster.duties.map((d) => (
                      <tr key={d.id}>
                        <Td className="whitespace-nowrap">{d.date} {d.session === 'MORNING' ? 'am' : 'pm'}</Td><Td>{d.paper}</Td><Td>{d.room} ({d.candidates})</Td><Td>{d.teacher}</Td>
                        <Td className="text-right">
                          <Link className="mr-2 text-sm font-semibold text-primary hover:underline" href={`/exams/timetable/${period.id}/attendance/${d.paperId}/${d.roomId}`}>Attendance</Link>
                          {flags.invigilation && <Button size="sm" variant="ghost" onClick={() => void call(`/api/exams/timetable/invigilation/${d.id}`, 'DELETE', undefined, 'Removed')}>Remove</Button>}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          {flags.invigilation && (
            <Section title="Add an invigilator by hand">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="flex flex-col gap-1.5"><label htmlFor="dt-paper" className={labelClass}>Paper</label><select id="dt-paper" className={fieldClass} value={duty.paperId} onChange={(e) => setDuty({ paperId: e.target.value, roomId: '', userId: duty.userId })}><option value="">Choose</option>{papers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                <div className="flex flex-col gap-1.5"><label htmlFor="dt-room" className={labelClass}>Room</label><select id="dt-room" className={fieldClass} value={duty.roomId} onChange={(e) => setDuty({ ...duty, roomId: e.target.value })}><option value="">Choose</option>{dutyPaper?.rooms.map((r) => <option key={r.roomId} value={r.roomId}>{r.room}</option>)}</select></div>
                <div className="flex flex-col gap-1.5"><label htmlFor="dt-user" className={labelClass}>Teacher</label><select id="dt-user" className={fieldClass} value={duty.userId} onChange={(e) => setDuty({ ...duty, userId: e.target.value })}><option value="">Choose</option>{roster.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === currentUserId ? ' (you)' : ''}</option>)}</select></div>
                <div className="flex items-end"><Button onClick={addDuty} loading={busy} disabled={!duty.paperId || !duty.roomId || !duty.userId}>Add</Button></div>
              </div>
            </Section>
          )}
        </div>
      )}

      {tab === 'incidents' && (
        <Section title="Incident reports" hint="Suspected malpractice is also recorded in Discipline as exam dishonesty.">
          {incidents.length === 0 ? <p className="text-sm text-muted">No incidents reported.</p> : (
            <ul className="flex flex-col gap-2 text-sm">{incidents.map((i) => <li key={i.id} className="rounded-xl border border-line px-3 py-2"><div className="flex flex-wrap items-center gap-2"><Badge variant={i.type === 'MALPRACTICE' ? 'danger' : 'neutral'} label={i.type.toLowerCase()} /><strong>{i.paper}</strong>{i.student && <span>{i.student}</span>}<span className="text-muted">{i.at.slice(0, 16).replace('T', ' ')}</span>{i.inDiscipline && <Badge variant="warning" label="In Discipline" />}</div><p className="mt-1 text-ink">{i.description}</p></li>)}</ul>
          )}
        </Section>
      )}

      <Modal open={!!paper} onClose={() => setPaper(null)} size="lg" title={paper?.id ? 'Change paper' : 'Add a paper'} footer={<><Button variant="ghost" onClick={() => setPaper(null)}>Cancel</Button><Button onClick={savePaper} loading={busy}>Save</Button></>}>
        {paper && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5"><label htmlFor="pp-subject" className={labelClass}>Subject</label><select id="pp-subject" className={fieldClass} value={paper.subjectId} onChange={(e) => setPaper({ ...paper, subjectId: e.target.value })}>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="pp-level" className={labelClass}>Form</label><select id="pp-level" className={fieldClass} value={paper.levelId} onChange={(e) => setPaper({ ...paper, levelId: e.target.value })}>{period.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="pp-no" className={labelClass}>Paper number</label><input id="pp-no" className={fieldClass} inputMode="numeric" value={paper.paperNumber} onChange={(e) => setPaper({ ...paper, paperNumber: Number(e.target.value) })} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="pp-name" className={labelClass}>Name</label><input id="pp-name" className={fieldClass} value={paper.name} onChange={(e) => setPaper({ ...paper, name: e.target.value })} placeholder="Mathematics Paper 1" /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="pp-date" className={labelClass}>Date</label><input id="pp-date" type="date" className={fieldClass} min={period.startDate} max={period.endDate} value={paper.date} onChange={(e) => setPaper({ ...paper, date: e.target.value })} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="pp-session" className={labelClass}>Session</label><select id="pp-session" className={fieldClass} value={paper.session} onChange={(e) => setPaper({ ...paper, session: e.target.value as 'MORNING' | 'AFTERNOON' })}><option value="MORNING">Morning</option><option value="AFTERNOON">Afternoon</option></select></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="pp-start" className={labelClass}>Start time</label><input id="pp-start" type="time" className={fieldClass} value={paper.startTime} onChange={(e) => setPaper({ ...paper, startTime: e.target.value })} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="pp-dur" className={labelClass}>Duration (minutes)</label><input id="pp-dur" className={fieldClass} inputMode="numeric" value={paper.durationMinutes} onChange={(e) => setPaper({ ...paper, durationMinutes: Number(e.target.value) })} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="pp-max" className={labelClass}>Maximum mark</label><input id="pp-max" className={fieldClass} inputMode="decimal" value={paper.maxMark} onChange={(e) => setPaper({ ...paper, maxMark: Number(e.target.value) })} /></div>
          </div>
        )}
      </Modal>

      <Modal open={!!roomsFor} onClose={() => setRoomsFor(null)} title={`Rooms: ${roomsFor?.name ?? ''}`} footer={<><Button variant="ghost" onClick={() => setRoomsFor(null)}>Cancel</Button><Button onClick={saveRooms} loading={busy}>Save</Button></>}>
        <p className="mb-3 text-sm text-muted">{roomsFor?.candidates} candidates. They fill the rooms in this order. Exam seats are fewer than lesson seats, to keep desks apart.</p>
        <ul className="flex flex-col gap-2">
          {rooms.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
              <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-4 w-4" checked={picked[r.id]?.on ?? false} onChange={(e) => setPicked({ ...picked, [r.id]: { ...(picked[r.id] ?? { cap: '1' }), on: e.target.checked } })} />{r.name} <span className="text-muted">(lessons: {r.capacity})</span></label>
              <input aria-label={`Exam seats in ${r.name}`} className="h-9 w-20 rounded-lg border border-line px-2 text-sm" inputMode="numeric" disabled={!picked[r.id]?.on} value={picked[r.id]?.cap ?? ''} onChange={(e) => setPicked({ ...picked, [r.id]: { ...(picked[r.id] ?? { on: true }), cap: e.target.value } })} />
            </li>
          ))}
        </ul>
      </Modal>

      <Modal open={returning} onClose={() => setReturning(false)} title={period.status === 'APPROVED' ? 'Reopen the timetable' : 'Send back to the Exams Officer'}
        footer={<><Button variant="ghost" onClick={() => setReturning(false)}>Cancel</Button><Button onClick={async () => { if (await call(`/api/exams/timetable/periods/${period.id}/return`, 'POST', { comment })) { setReturning(false); setComment(''); } }} loading={busy} disabled={comment.trim().length < 3}>Send back</Button></>}>
        <div className="flex flex-col gap-1.5"><label htmlFor="ret-c" className={labelClass}>What needs to change? (required)</label><textarea id="ret-c" className={`${fieldClass} h-24 py-2`} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} /></div>
        {period.status === 'APPROVED' && <p className="mt-2 text-xs text-muted">Reopening takes the exam period off the Calendar until it is approved again.</p>}
      </Modal>

      <Modal open={!!incidentFor} onClose={() => setIncidentFor(null)} title={`Report an incident: ${incidentFor?.name ?? ''}`}
        footer={<><Button variant="ghost" onClick={() => setIncidentFor(null)}>Cancel</Button><Button onClick={async () => { if (incidentFor && await call('/api/exams/timetable/incidents', 'POST', { paperId: incidentFor.id, type: incident.type, description: incident.description }, 'Reported')) setIncidentFor(null); }} loading={busy} disabled={incident.description.trim().length < 5}>Report</Button></>}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5"><label htmlFor="in-type" className={labelClass}>What happened</label><select id="in-type" className={fieldClass} value={incident.type} onChange={(e) => setIncident({ ...incident, type: e.target.value })}><option value="DISRUPTION">Disruption</option><option value="ILLNESS">Illness</option><option value="OTHER">Other</option></select></div>
          <div className="flex flex-col gap-1.5"><label htmlFor="in-d" className={labelClass}>Details</label><textarea id="in-d" className={`${fieldClass} h-24 py-2`} value={incident.description} onChange={(e) => setIncident({ ...incident, description: e.target.value })} maxLength={2000} /></div>
          <p className="text-xs text-muted">To report suspected malpractice by a student, open the attendance sheet of the room and use &quot;Report malpractice&quot; beside their name.</p>
        </div>
      </Modal>
    </div>
  );
}
