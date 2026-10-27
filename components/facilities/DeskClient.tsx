'use client';

// The library desk on a phone or laptop: scan the member's ID card, then scan the book. Lending shows the due date; taking a book back
// shows the days late and the fine. Renewing, reserving and recording a loss are one tap away.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { Notice, RowAction, Section, Td, Th, api, fieldClass, problem } from '@/components/finance/shared';
import { ScanButton } from '@/components/facilities/Scanner';

interface Loan { id: string; accessionNo: string; title: string; dueAt: string; overdueDays: number; renewedCount: number; reserved: boolean }
interface Member { id: string; type: 'LEARNER' | 'STAFF'; name: string; number: string; className: string | null; suspended: boolean; suspendedReason: string | null; maxLoans: number; loanDays: number; open: Loan[]; overdue: number }
interface Returned { title: string; member: string; daysLate: number; fineCents: number; currency: string | null; charged: string | null; reservedFor: string | null }

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const money = (c: number, cur: string | null) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;

export function DeskClient({ canDesk, canWaive }: { canDesk: boolean; canWaive: boolean }) {
  const router = useRouter();
  const [member, setMember] = useState<Member | null>(null);
  const [code, setCode] = useState('');
  const [book, setBook] = useState('');
  const [back, setBack] = useState('');
  const [last, setLast] = useState<Returned | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load(c: string): Promise<boolean> {
    const r = await api(`/api/facilities/library/members?code=${encodeURIComponent(c)}`, 'GET');
    if (!r.ok) { toast.error(problem(r)); return false; }
    setMember(r.body.data as Member);
    setCode('');
    return true;
  }
  async function refresh() { if (member) { const r = await api(`/api/facilities/library/members?code=${encodeURIComponent(member.number)}`, 'GET'); if (r.ok) setMember(r.body.data as Member); } router.refresh(); }

  async function lend(barcode: string): Promise<boolean> {
    if (!member) return false;
    setBusy('lend');
    const r = await api('/api/facilities/library/checkout', 'POST', { memberId: member.id, barcode });
    setBusy(null);
    if (!r.ok) { toast.error(problem(r)); return false; }
    const d = r.body.data as { title: string; dueDate: string };
    toast.success(`${d.title}: due back ${day(d.dueDate)}`);
    setBook('');
    await refresh();
    return true;
  }

  async function giveBack(barcode: string): Promise<boolean> {
    setBusy('return');
    const r = await api('/api/facilities/library/return', 'POST', { barcode });
    setBusy(null);
    if (!r.ok) { toast.error(problem(r)); return false; }
    setLast(r.body.data as Returned);
    setBack('');
    await refresh();
    return true;
  }

  async function renew(id: string) {
    const r = await api(`/api/facilities/library/loans/${id}/renew`, 'POST', {});
    if (!r.ok) return toast.error(problem(r));
    toast.success(`Renewed until ${day((r.body.data as { dueDate: string }).dueDate)}`);
    await refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {canDesk && (
        <Section title="Take a book back" hint="Scan the book. It does not matter who had it.">
          <div className="flex gap-2">
            <input aria-label="Book barcode" className={fieldClass} placeholder="Book barcode or accession number" value={back} onChange={(e) => setBack(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && back.trim()) void giveBack(back.trim()); }} />
            <ScanButton label="Scan" title="Scan the book" prompt="the barcode inside the book" onScan={giveBack} />
          </div>
          {last && (
            <div className={`mt-3 rounded-xl border p-3 text-sm ${last.daysLate > 0 ? 'border-danger bg-white' : 'border-primary bg-white'}`} role="status">
              <p className="font-semibold text-ink">{last.title} · {last.member}</p>
              {last.daysLate > 0 ? (
                <p className="text-danger">{last.daysLate} day{last.daysLate === 1 ? '' : 's'} late. Fine {money(last.fineCents, last.currency)}{last.charged === 'FINANCE' ? ' charged to the learner\'s account.' : last.charged === 'LEDGER' ? ' kept on the library ledger.' : last.charged === 'LEGACY' ? ' charged on the older accounting screens.' : ' recorded for the staff member.'}</p>
              ) : <p className="text-primary">Returned on time.</p>}
              {last.reservedFor && <p className="mt-1 font-semibold text-ink">Keep it for {last.reservedFor}: they reserved it.</p>}
            </div>
          )}
        </Section>
      )}

      <Section title="Lend a book" hint="Scan the member's ID card, then the book.">
        {!member ? (
          <div className="flex gap-2">
            <input aria-label="Admission or staff number" className={fieldClass} placeholder="Admission or staff number" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) void load(code.trim()); }} />
            <ScanButton label="Scan card" title="Scan the ID card" prompt="the member's ID card" onScan={load} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2 rounded-xl border border-line bg-white p-3">
              <div>
                <p className="text-base font-semibold text-ink">{member.name}</p>
                <p className="text-sm text-muted">{member.number}{member.className ? ` · ${member.className}` : ''} · {member.type === 'LEARNER' ? 'Learner' : 'Staff'} · {member.open.length} of {member.maxLoans} books out · {member.loanDays} days</p>
              </div>
              <button type="button" className="min-h-[44px] px-2 text-primary underline" onClick={() => { setMember(null); setLast(null); }}>Next person</button>
            </div>
            {member.suspended && <Notice tone="danger">Cannot borrow: {member.suspendedReason}</Notice>}
            {member.overdue > 0 && <Notice tone="warn">{member.overdue} book{member.overdue === 1 ? ' is' : 's are'} overdue.</Notice>}
            {canDesk && !member.suspended && (
              <div className="flex gap-2">
                <input aria-label="Book to lend" className={fieldClass} placeholder="Book barcode or accession number" value={book} onChange={(e) => setBook(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && book.trim()) void lend(book.trim()); }} />
                <ScanButton label="Scan book" title="Scan the book" prompt="the barcode inside the book" onScan={lend} />
                <Button className="min-h-[48px]" loading={busy === 'lend'} disabled={!book.trim()} onClick={() => void lend(book.trim())}>Lend</Button>
              </div>
            )}
            {member.open.length > 0 && (
              <div className="overflow-x-auto"><table className="w-full min-w-[30rem]"><thead><tr><Th>Book</Th><Th>Copy</Th><Th>Due</Th><Th /></tr></thead><tbody>
                {member.open.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <Td>{l.title}</Td><Td>{l.accessionNo}</Td>
                    <Td className={l.overdueDays > 0 ? 'font-semibold text-danger' : ''}>{day(l.dueAt)}{l.overdueDays > 0 ? ` · ${l.overdueDays} late` : ''}</Td>
                    <Td>{canDesk && (
                      <div className="flex flex-wrap gap-2">
                        {l.renewedCount < 1 && l.overdueDays === 0 && !l.reserved && <Button size="sm" variant="secondary" onClick={() => void renew(l.id)}>Renew</Button>}
                        <RowAction label="Lost" variant="danger" url="/api/facilities/library/lost" body={{ loanId: l.id, kind: 'LOST' }} reason={{ label: 'What happened to it?', min: 3 }} confirm="The learner is charged the replacement cost of this copy." done="Recorded as lost" onDone={() => void refresh()} />
                      </div>
                    )}</Td>
                  </tr>
                ))}
              </tbody></table></div>
            )}
          </div>
        )}
      </Section>
      {canWaive && <p className="text-xs text-muted">Fines are waived from the Reports page, with a reason.</p>}
    </div>
  );
}
