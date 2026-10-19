'use client';

// The board sessions of the school and a form to add a new one. Fees, dates, subject codes and the export layout are typed in by the
// Exams Officer each session because the board changes them.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { Notice, Section, api, fieldClass, labelClass, problem } from '@/components/exams/shared';
import type { SessionRow } from '@/lib/exams/board';

export function SessionsClient({ sessions, centre, canManage }: { sessions: SessionRow[]; centre: string; canManage: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ board: 'ZIMSEC', category: 'O_LEVEL', session: '', centreNumber: centre, registrationOpens: '', registrationCloses: '', feePerSubject: '', fixedFee: '0', currency: 'USD', photoRequired: true, passGrades: 'A,B,C' });
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api('/api/exams/board/sessions', 'POST', {
      board: f.board, category: f.category, session: f.session, centreNumber: f.centreNumber, registrationOpens: f.registrationOpens || null, registrationCloses: f.registrationCloses || null,
      feePerSubject: Number(f.feePerSubject), fixedFee: Number(f.fixedFee || 0), currency: f.currency, photoRequired: f.photoRequired, passGrades: f.passGrades.split(',').map((g) => g.trim()).filter(Boolean),
    });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Session added. Enter its subject codes next.');
    router.push(`/exams/board/${(r.body.data as { id: string }).id}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="Sessions">
        {sessions.length === 0 ? <p className="text-sm text-muted">No session yet.</p> : (
          <ul className="flex flex-col gap-3">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/exams/board/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-4 py-3 hover:ring-2 hover:ring-primary/30">
                  <div><div className="font-semibold text-ink">{s.board} {s.session} · {s.category === 'O_LEVEL' ? 'O Level' : 'A Level'}</div><div className="text-sm text-muted">Centre {s.centreNumber} · {s.currency} {s.feePerSubject} per subject · {s.candidates} candidate{s.candidates === 1 ? '' : 's'}{s.registrationCloses ? ` · closes ${s.registrationCloses}` : ''}</div></div>
                  <Badge variant={s.status === 'APPROVED' ? 'success' : 'info'} label={s.status === 'APPROVED' ? 'Entry list approved' : 'Open'} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {canManage ? (
        <Section title="New session" hint="Enter what the board has published for this sitting. Nothing here is built in.">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5"><label htmlFor="bs-board" className={labelClass}>Board</label><select id="bs-board" className={fieldClass} value={f.board} onChange={(e) => setF({ ...f, board: e.target.value })}><option value="ZIMSEC">ZIMSEC</option><option value="CAMBRIDGE">Cambridge</option></select></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="bs-level" className={labelClass}>Level</label><select id="bs-level" className={fieldClass} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, passGrades: e.target.value === 'A_LEVEL' ? 'A,B,C,D,E' : 'A,B,C' })}><option value="O_LEVEL">O Level</option><option value="A_LEVEL">A Level</option></select></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="bs-session" className={labelClass}>Session</label><input id="bs-session" className={fieldClass} value={f.session} onChange={(e) => setF({ ...f, session: e.target.value })} placeholder="November 2027" required /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="bs-centre" className={labelClass}>Centre number</label><input id="bs-centre" className={fieldClass} value={f.centreNumber} onChange={(e) => setF({ ...f, centreNumber: e.target.value })} required /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="bs-open" className={labelClass}>Registration opens</label><input id="bs-open" type="date" className={fieldClass} value={f.registrationOpens} onChange={(e) => setF({ ...f, registrationOpens: e.target.value })} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="bs-close" className={labelClass}>Registration closes</label><input id="bs-close" type="date" className={fieldClass} value={f.registrationCloses} onChange={(e) => setF({ ...f, registrationCloses: e.target.value })} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="bs-fee" className={labelClass}>Fee per subject</label><input id="bs-fee" className={fieldClass} inputMode="decimal" value={f.feePerSubject} onChange={(e) => setF({ ...f, feePerSubject: e.target.value })} required /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="bs-fixed" className={labelClass}>Fixed fee (optional)</label><input id="bs-fixed" className={fieldClass} inputMode="decimal" value={f.fixedFee} onChange={(e) => setF({ ...f, fixedFee: e.target.value })} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="bs-cur" className={labelClass}>Currency</label><select id="bs-cur" className={fieldClass} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option value="USD">USD</option><option value="ZIG">ZiG</option></select></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="bs-pass" className={labelClass}>Grades that count as a pass</label><input id="bs-pass" className={fieldClass} value={f.passGrades} onChange={(e) => setF({ ...f, passGrades: e.target.value })} /></div>
            <label className="flex items-end gap-2 pb-3 text-sm text-ink"><input type="checkbox" className="h-4 w-4" checked={f.photoRequired} onChange={(e) => setF({ ...f, photoRequired: e.target.checked })} /> A photo is required</label>
            <div className="sm:col-span-2 lg:col-span-4"><Button type="submit" loading={busy}>Add session</Button></div>
          </form>
        </Section>
      ) : <Notice tone="info">The Exams Officer sets up the sessions.</Notice>}
    </div>
  );
}
