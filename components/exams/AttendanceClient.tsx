'use client';

// The exam attendance sheet of one paper and room: present, absent, late (with the time). Everyone starts as not yet marked; "All present"
// fills the sheet and the invigilator taps the exceptions. Suspected malpractice is reported beside the student's name.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Notice, api, fieldClass, labelClass, problem } from '@/components/exams/shared';
import type { AttendanceSheet } from '@/lib/exams/invigilation';

type Status = 'PRESENT' | 'ABSENT' | 'LATE';
const nowHm = () => new Date().toTimeString().slice(0, 5);

export function AttendanceClient({ sheet }: { sheet: AttendanceSheet }) {
  const router = useRouter();
  const [rows, setRows] = useState(sheet.rows.map((r) => ({ ...r, status: r.status as Status | null, arrivalTime: r.arrivalTime })));
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ studentId: string; name: string } | null>(null);
  const [text, setText] = useState('');
  const dirty = rows.some((r, i) => r.status !== sheet.rows[i]!.status || r.arrivalTime !== sheet.rows[i]!.arrivalTime);
  const counts = { PRESENT: rows.filter((r) => r.status === 'PRESENT').length, ABSENT: rows.filter((r) => r.status === 'ABSENT').length, LATE: rows.filter((r) => r.status === 'LATE').length };
  const set = (i: number, status: Status) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, status, arrivalTime: status === 'LATE' ? r.arrivalTime ?? nowHm() : null } : r)));

  async function save() {
    setBusy(true);
    const entries = rows.filter((r) => r.status).map((r) => ({ studentId: r.studentId, status: r.status!, arrivalTime: r.status === 'LATE' ? r.arrivalTime : null }));
    const r = await api('/api/exams/timetable/attendance', 'PUT', { paperId: sheet.paperId, roomId: sheet.roomId, entries });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    const d = r.body.data as { markedAB: number; notApplied: string[] };
    toast.success(d.markedAB ? `Saved. ${d.markedAB} absent student${d.markedAB === 1 ? '' : 's'} got AB on the paper.` : 'Saved');
    d.notApplied.forEach((n) => toast.info(n));
    router.refresh();
  }

  async function reportMalpractice() {
    if (!report) return;
    setBusy(true);
    const r = await api('/api/exams/timetable/incidents', 'POST', { paperId: sheet.paperId, roomId: sheet.roomId, studentId: report.studentId, type: 'MALPRACTICE', description: text });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Reported. It is also recorded in Discipline.');
    setReport(null); setText('');
  }

  return (
    <div className="flex flex-col gap-3">
      {!sheet.canMark && <Notice tone="info">You can look at this sheet. It is marked by the people on duty in this room.</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-4">
        <p className="text-sm text-ink">{rows.length} candidates · <strong>{counts.PRESENT}</strong> present · <strong>{counts.LATE}</strong> late · <strong>{counts.ABSENT}</strong> absent</p>
        {sheet.canMark && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setRows((rs) => rs.map((r) => (r.status ? r : { ...r, status: 'PRESENT' })))}>All present</Button>
            <Button onClick={save} loading={busy} disabled={!dirty}>Save</Button>
          </div>
        )}
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-white">
        {rows.map((r, i) => (
          <li key={r.studentId} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="w-8 text-center text-sm font-semibold tabular-nums text-muted">{r.desk}</span>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-ink">{r.name}</div><div className="text-xs text-muted">{r.candidateNumber ?? r.admissionNumber}</div></div>
            <div className="flex gap-1" role="group" aria-label={`Attendance of ${r.name}`}>
              {(['PRESENT', 'LATE', 'ABSENT'] as const).map((s) => (
                <button key={s} type="button" disabled={!sheet.canMark} onClick={() => set(i, s)} aria-pressed={r.status === s}
                  className={cn('h-11 min-w-[72px] rounded-xl border px-2 text-xs font-bold', r.status === s ? (s === 'ABSENT' ? 'border-danger bg-danger text-white' : s === 'LATE' ? 'border-warn bg-warn text-white' : 'border-success bg-success text-white') : 'border-line bg-white text-muted')}>
                  {s === 'PRESENT' ? 'Present' : s === 'LATE' ? 'Late' : 'Absent'}
                </button>
              ))}
            </div>
            {r.status === 'LATE' && <input type="time" aria-label={`Arrival time of ${r.name}`} value={r.arrivalTime ?? ''} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, arrivalTime: e.target.value } : x)))} className="h-11 rounded-xl border border-line px-2 text-sm" />}
            {sheet.canMark && <Button size="sm" variant="ghost" onClick={() => { setReport({ studentId: r.studentId, name: r.name }); setText(''); }}>Report malpractice</Button>}
          </li>
        ))}
      </ul>
      <Modal open={!!report} onClose={() => setReport(null)} title={`Suspected malpractice: ${report?.name ?? ''}`}
        footer={<><Button variant="ghost" onClick={() => setReport(null)}>Cancel</Button><Button variant="danger" onClick={reportMalpractice} loading={busy} disabled={text.trim().length < 5}>Report</Button></>}>
        <div className="flex flex-col gap-1.5"><label htmlFor="mp-text" className={labelClass}>What did you see?</label><textarea id="mp-text" className={`${fieldClass} h-28 py-2`} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} /></div>
        <p className="mt-2 text-xs text-muted">The report goes to the Exams Officer and the Deputy, and is recorded in Discipline as exam dishonesty.</p>
      </Modal>
    </div>
  );
}
