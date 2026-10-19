'use client';

// One board session: the entry list with the checks per candidate, the subject codes, fees, candidate numbers, approval and export, and the
// released results. Unpaid candidates are flagged, not removed, so the Head decides. After approval every change is logged as an amendment.
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Notice, Section, Tabs, Td, Th, api, fieldClass, labelClass, problem } from '@/components/exams/shared';
import { parseCsv } from '@/lib/students/csv';
import type { CandidateRow, EntryList } from '@/lib/exams/board';

type Tab = 'entries' | 'codes' | 'numbers' | 'results' | 'summary';

export function BoardClient({ list, levels, flags }: { list: EntryList; levels: { id: string; name: string }[]; flags: { manage: boolean; approve: boolean; results: boolean } }) {
  const router = useRouter();
  const s = list.session;
  const [tab, setTab] = useState<Tab>('entries');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ c: CandidateRow; codeIds: string[]; certificateName: string } | null>(null);
  const [priv, setPriv] = useState<{ fullName: string; gender: string; dateOfBirth: string; idNumber: string; phone: string; codeIds: string[] } | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [codesText, setCodesText] = useState(list.codes.map((c) => `${c.code}\t${c.name}`).join('\n'));
  const [numbers, setNumbers] = useState<{ review: { line: number; identifier: string; candidateNumber: string; candidate: string | null; status: string; message: string | null }[] } | null>(null);
  const [results, setResults] = useState<{ review: { line: number; candidateNumber: string; subjectCode: string; grade: string; candidate: string | null; status: string; message: string | null }[] } | null>(null);
  const numRows = useRef<{ identifier: string; candidateNumber: string }[]>([]);
  const resRows = useRef<{ candidateNumber: string; subjectCode: string; grade: string }[]>([]);
  const approved = s.status === 'APPROVED';

  async function call(url: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, ok?: string) {
    setBusy(true);
    const r = await api(url, method, body);
    setBusy(false);
    if (!r.ok) { toast.error(problem(r)); return null; }
    if (ok) toast.success(ok);
    router.refresh();
    return r;
  }

  const tick = (c: CandidateRow, body: object) => call(`/api/exams/board/candidates/${c.id}`, 'PATCH', body);

  async function saveCodes() {
    const codes = codesText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [code, ...name] = l.split(/\t|,(.+)/).filter(Boolean); return { code: (code ?? '').trim(), name: name.join(' ').trim() || (code ?? '').trim() }; });
    await call(`/api/exams/board/sessions/${s.id}/codes`, 'PUT', { codes }, 'Subject codes saved');
  }

  async function readFile(file: File, kind: 'numbers' | 'results') {
    const table = parseCsv(await file.text());
    if (table.length < 2) return toast.error('The file has no rows');
    const head = table[0]!.map((h) => h.trim().toLowerCase());
    const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
    if (kind === 'numbers') {
      const id = col('admission', 'id', 'identifier'); const num = col('candidate');
      if (id < 0 || num < 0) return toast.error('The first row needs "Admission number" (or ID number) and "Candidate number".');
      numRows.current = table.slice(1).map((r) => ({ identifier: (r[id] ?? '').trim(), candidateNumber: (r[num] ?? '').trim() })).filter((r) => r.identifier || r.candidateNumber);
      const r = await api(`/api/exams/board/sessions/${s.id}/numbers`, 'POST', { rows: numRows.current });
      if (!r.ok) return toast.error(problem(r));
      setNumbers(r.body.data);
    } else {
      const cn = col('candidate'); const sc = col('subject', 'code'); const gr = col('grade', 'result');
      if (cn < 0 || sc < 0 || gr < 0) return toast.error('The first row needs "Candidate number", "Subject code" and "Grade".');
      resRows.current = table.slice(1).map((r) => ({ candidateNumber: (r[cn] ?? '').trim(), subjectCode: (r[sc] ?? '').trim(), grade: (r[gr] ?? '').trim() })).filter((r) => r.candidateNumber);
      const r = await api(`/api/exams/board/sessions/${s.id}/results`, 'POST', { rows: resRows.current });
      if (!r.ok) return toast.error(problem(r));
      setResults(r.body.data);
    }
  }

  const bad = (rows: { status: string }[] | undefined) => (rows ?? []).filter((r) => r.status === 'ERROR').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4">
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink">
          <Badge variant={approved ? 'success' : 'info'} label={approved ? 'Entry list approved' : 'Open'} />
          <span><strong>{list.totals.candidates}</strong> candidates · <strong>{list.totals.ready}</strong> complete · <strong className={list.totals.unpaid ? 'text-warn' : ''}>{list.totals.unpaid}</strong> unpaid</span>
          <span className="text-muted">Fees {s.currency} {list.totals.feeCollected.toFixed(2)} of {list.totals.feeTotal.toFixed(2)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {flags.approve && !approved && <Button onClick={() => { if (window.confirm(`Approve the entry list? ${list.totals.unpaid} candidate${list.totals.unpaid === 1 ? ' is' : 's are'} unpaid and stay on it. After approval, changes are logged as amendments.`)) void call(`/api/exams/board/sessions/${s.id}/approve`, 'POST', undefined, 'Entry list approved'); }} loading={busy}>Approve the entry list</Button>}
          {approved && (flags.manage || flags.approve) && <>
            <a className="inline-flex min-h-[44px] items-center rounded-full bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover" href={`/api/exams/board/sessions/${s.id}/export?format=xlsx`}>Export to Excel</a>
            <a className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-4 text-sm font-semibold text-primary hover:bg-tint" href={`/api/exams/board/sessions/${s.id}/export?format=csv`}>Export to CSV</a>
          </>}
          <a className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-4 text-sm font-semibold text-primary hover:bg-tint" href={`/print/exams/board-summary?sessionId=${s.id}`} target="_blank" rel="noreferrer">Print summary</a>
        </div>
      </div>
      {!approved && flags.manage && <Notice tone="info">The entry list can be exported once the Head has approved it.</Notice>}

      <Tabs value={tab} onChange={setTab} label="Session sections" tabs={[
        { id: 'entries', label: 'Entry list', badge: list.candidates.length }, { id: 'codes', label: 'Subject codes', badge: list.codes.length },
        ...(flags.manage ? [{ id: 'numbers' as const, label: 'Candidate numbers' }] : []), ...(flags.results ? [{ id: 'results' as const, label: 'Results' }] : []), { id: 'summary', label: 'By subject' },
      ]} />

      {tab === 'entries' && (
        <Section title="Entry list" hint="Each row shows what is still outstanding. Tick the name check after looking at the birth certificate."
          action={flags.manage ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => call(`/api/exams/board/sessions/${s.id}/pull`, 'POST', { extraLevelIds: extra }, undefined).then((r) => { if (r) { const d = r.body.data as { added: number; unmappedSubjects: string[] }; toast.success(`${d.added} candidate${d.added === 1 ? '' : 's'} added${d.unmappedSubjects.length ? `. No code yet for: ${d.unmappedSubjects.join(', ')}` : ''}`); } })} loading={busy}>Bring in {s.category === 'O_LEVEL' ? 'Form 4' : 'Upper 6'}</Button>
              <Button size="sm" variant="secondary" onClick={() => setPriv({ fullName: '', gender: '', dateOfBirth: '', idNumber: '', phone: '', codeIds: [] })}>Add a private candidate</Button>
              <Button size="sm" variant="secondary" onClick={() => call(`/api/exams/board/sessions/${s.id}/fees`, 'POST').then((r) => { if (r) { const d = r.body.data as { created: number; privateCandidates: number }; toast.success(`${d.created} fee charge${d.created === 1 ? '' : 's'} added${d.privateCandidates ? `. ${d.privateCandidates} private candidate(s) pay at the office.` : ''}`); } })}>Create exam fee charges</Button>
            </div>
          ) : undefined}>
          {flags.manage && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span>Also bring in:</span>
              {levels.map((l) => <label key={l.id} className="inline-flex items-center gap-1"><input type="checkbox" className="h-4 w-4" checked={extra.includes(l.id)} onChange={(e) => setExtra(e.target.checked ? [...extra, l.id] : extra.filter((x) => x !== l.id))} />{l.name}</label>)}
            </div>
          )}
          {list.candidates.length === 0 ? <p className="text-sm text-muted">No candidates yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left">
                <thead><tr><Th>Candidate</Th><Th>Subjects</Th><Th className="text-right">Fee</Th><Th>Checks</Th><Th>Number</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                <tbody className="divide-y divide-line">
                  {list.candidates.map((c) => (
                    <tr key={c.id} className={c.ready ? undefined : 'bg-warn-bg/30'}>
                      <Td><span className="font-medium">{c.surname.toUpperCase()}, {c.firstNames}</span><span className="block text-xs text-muted">{c.kind === 'PRIVATE' ? 'Private candidate' : `${c.admissionNumber}${c.className ? ` · ${c.className}` : ''}`}</span></Td>
                      <Td className="max-w-[200px]">{c.subjects.map((x) => x.code).join(', ') || <span className="text-danger">None</span>}</Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">{c.feeTotal.toFixed(2)}<span className={`block text-xs ${c.feePaid ? 'text-success' : 'text-warn'}`}>{c.feePaid ? (c.feeSource === 'finance' ? 'Paid' : 'Paid (ticked)') : 'Unpaid'}</span></Td>
                      <Td>
                        <ul className="flex flex-wrap gap-1">{c.checks.map((k) => <li key={k.key} title={`${k.label}: ${k.detail}`}><Badge variant={k.ok ? 'success' : 'warning'} label={k.key === 'name' ? 'Name' : k.key === 'dob' ? 'DoB' : k.key === 'id' ? 'ID' : k.key === 'photo' ? 'Photo' : k.key === 'codes' ? 'Codes' : 'Fee'} /></li>)}</ul>
                      </Td>
                      <Td>{c.candidateNumber ?? '-'}</Td>
                      <Td className="whitespace-nowrap text-right">
                        {flags.manage && <>
                          <Button size="sm" variant="ghost" onClick={() => void tick(c, { nameChecked: !c.nameChecked })}>{c.nameChecked ? 'Untick name' : 'Name matches'}</Button>
                          <Button size="sm" variant="ghost" onClick={() => void tick(c, { feePaid: !c.feePaid })} disabled={c.feeSource === 'finance'}>{c.feePaid ? 'Mark unpaid' : 'Mark paid'}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEdit({ c, codeIds: c.codeIds, certificateName: c.certificateName ?? '' })}>Edit</Button>
                        </>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {tab === 'codes' && (
        <Section title="Subject codes" hint="One per line: the code, then the subject name. Codes are matched to the school's subjects by the ZIMSEC or Cambridge code in Academics, so students' subjects map across.">
          <textarea aria-label="Subject codes" className={`${fieldClass} h-56 py-2 font-mono`} value={codesText} onChange={(e) => setCodesText(e.target.value)} readOnly={!flags.manage} placeholder={'4004\tMathematics\n1122\tEnglish Language'} />
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">{list.codes.map((c) => <li key={c.id} className="rounded-full bg-tint px-3 py-1">{c.code} {c.name}{c.subject ? ` → ${c.subject}` : ' (no school subject)'} · {c.entries}</li>)}</ul>
          {flags.manage && <div className="mt-3"><Button onClick={saveCodes} loading={busy}>Save codes</Button></div>}
        </Section>
      )}

      {tab === 'numbers' && (
        <Section title="Candidate numbers" hint="Once the board issues them, load a file with an admission number (or ID number) and the candidate number. They then show on seating lists and the student's profile.">
          <input type="file" accept=".csv,.txt" aria-label="File of candidate numbers" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f, 'numbers'); e.target.value = ''; }} className="block w-full text-sm file:mr-3 file:min-h-[44px] file:rounded-full file:border-0 file:bg-primary file:px-5 file:text-sm file:font-semibold file:text-white" />
          {numbers && (
            <div className="mt-3">
              <p className="mb-2 text-sm"><Badge variant="success" label={`${numbers.review.length - bad(numbers.review)} ready`} /> {bad(numbers.review) > 0 && <Badge variant="danger" label={`${bad(numbers.review)} with errors`} />}</p>
              <div className="max-h-72 overflow-auto rounded-xl border border-line"><table className="w-full text-left"><thead><tr><Th>Line</Th><Th>Identifier</Th><Th>Number</Th><Th>Candidate</Th><Th>Result</Th></tr></thead><tbody className="divide-y divide-line">{numbers.review.map((r) => <tr key={r.line} className={r.status === 'ERROR' ? 'bg-danger-bg' : undefined}><Td>{r.line}</Td><Td>{r.identifier}</Td><Td>{r.candidateNumber}</Td><Td>{r.candidate ?? ''}</Td><Td className={r.status === 'ERROR' ? 'text-danger' : 'text-success'}>{r.message ?? 'OK'}</Td></tr>)}</tbody></table></div>
              <div className="mt-3"><Button disabled={bad(numbers.review) > 0} loading={busy} onClick={() => call(`/api/exams/board/sessions/${s.id}/numbers`, 'POST', { rows: numRows.current, apply: true }, 'Candidate numbers saved').then((r) => { if (r) setNumbers(null); })}>Save {numbers.review.length} numbers</Button></div>
            </div>
          )}
        </Section>
      )}

      {tab === 'results' && (
        <Section title="Released results" hint="Load a file with the candidate number, subject code and grade.">
          <input type="file" accept=".csv,.txt" aria-label="File of results" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f, 'results'); e.target.value = ''; }} className="block w-full text-sm file:mr-3 file:min-h-[44px] file:rounded-full file:border-0 file:bg-primary file:px-5 file:text-sm file:font-semibold file:text-white" />
          {results && (
            <div className="mt-3">
              <p className="mb-2 text-sm"><Badge variant="success" label={`${results.review.length - bad(results.review)} ready`} /> {bad(results.review) > 0 && <Badge variant="danger" label={`${bad(results.review)} with errors`} />}</p>
              <div className="max-h-72 overflow-auto rounded-xl border border-line"><table className="w-full text-left"><thead><tr><Th>Line</Th><Th>Candidate no.</Th><Th>Subject</Th><Th>Grade</Th><Th>Candidate</Th><Th>Result</Th></tr></thead><tbody className="divide-y divide-line">{results.review.slice(0, 500).map((r) => <tr key={r.line} className={r.status === 'ERROR' ? 'bg-danger-bg' : undefined}><Td>{r.line}</Td><Td>{r.candidateNumber}</Td><Td>{r.subjectCode}</Td><Td className="font-semibold">{r.grade}</Td><Td>{r.candidate ?? ''}</Td><Td className={r.status === 'ERROR' ? 'text-danger' : 'text-success'}>{r.message ?? 'OK'}</Td></tr>)}</tbody></table></div>
              <div className="mt-3"><Button disabled={bad(results.review) > 0} loading={busy} onClick={() => call(`/api/exams/board/sessions/${s.id}/results`, 'POST', { rows: resRows.current, apply: true }, 'Results loaded').then((r) => { if (r) setResults(null); })}>Load {results.review.length} results</Button></div>
            </div>
          )}
          <p className="mt-3 text-sm text-muted">Results attach to each student&apos;s record and the alumni record, and feed the analytics: pass rate per subject, grade distribution, 5+ passes including English and Maths, A Level points, and comparison with the school&apos;s own mocks.</p>
        </Section>
      )}

      {tab === 'summary' && (
        <Section title="Entries by subject" hint="The number of candidates per subject code, for the centre's records.">
          <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-left"><thead><tr><Th>Code</Th><Th>Subject</Th><Th className="text-right">Candidates</Th></tr></thead><tbody className="divide-y divide-line">{list.summary.map((r) => <tr key={r.code}><Td className="font-semibold">{r.code}</Td><Td>{r.subject}</Td><Td className="text-right tabular-nums">{r.candidates}</Td></tr>)}</tbody></table></div>
        </Section>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Edit: ${edit?.c.name ?? ''}`} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={async () => { if (edit && await tick(edit.c, { codeIds: edit.codeIds, certificateName: edit.certificateName || null })) setEdit(null); }}>Save</Button></>}>
        {edit && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5"><label htmlFor="ce-name" className={labelClass}>Name exactly as on the birth certificate (if different)</label><input id="ce-name" className={fieldClass} value={edit.certificateName} onChange={(e) => setEdit({ ...edit, certificateName: e.target.value })} placeholder="SURNAME, First names" /></div>
            <fieldset><legend className={labelClass}>Subjects</legend>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">{list.codes.map((c) => <label key={c.id} className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-4 w-4" checked={edit.codeIds.includes(c.id)} onChange={(e) => setEdit({ ...edit, codeIds: e.target.checked ? [...edit.codeIds, c.id] : edit.codeIds.filter((x) => x !== c.id) })} />{c.code} {c.name}</label>)}</div></fieldset>
            {approved && <Notice tone="warn">The list is approved, so this change is logged as an amendment.</Notice>}
            <div className="flex justify-between"><span className="text-xs text-muted">{edit.c.checks.filter((k) => !k.ok).map((k) => k.detail).join(' · ')}</span>{<Button size="sm" variant="danger" onClick={() => { if (window.confirm(`Remove ${edit.c.name} from the entry list?`)) void call(`/api/exams/board/candidates/${edit.c.id}`, 'DELETE', undefined, 'Removed').then(() => setEdit(null)); }}>Remove from the list</Button>}</div>
          </div>
        )}
      </Modal>

      <Modal open={!!priv} onClose={() => setPriv(null)} size="lg" title="Add a private candidate" footer={<><Button variant="ghost" onClick={() => setPriv(null)}>Cancel</Button><Button loading={busy} onClick={async () => { if (priv && await call(`/api/exams/board/sessions/${s.id}/private`, 'POST', { fullName: priv.fullName, gender: priv.gender || null, dateOfBirth: priv.dateOfBirth, idNumber: priv.idNumber, phone: priv.phone || null, codeIds: priv.codeIds }, 'Candidate added')) setPriv(null); }}>Add</Button></>}>
        {priv && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2"><label htmlFor="pc-name" className={labelClass}>Full name as on the birth certificate</label><input id="pc-name" className={fieldClass} value={priv.fullName} onChange={(e) => setPriv({ ...priv, fullName: e.target.value })} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="pc-dob" className={labelClass}>Date of birth</label><input id="pc-dob" type="date" className={fieldClass} value={priv.dateOfBirth} onChange={(e) => setPriv({ ...priv, dateOfBirth: e.target.value })} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="pc-g" className={labelClass}>Gender</label><select id="pc-g" className={fieldClass} value={priv.gender} onChange={(e) => setPriv({ ...priv, gender: e.target.value })}><option value="">Not stated</option><option value="M">Male</option><option value="F">Female</option></select></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="pc-id" className={labelClass}>ID or birth certificate number</label><input id="pc-id" className={fieldClass} value={priv.idNumber} onChange={(e) => setPriv({ ...priv, idNumber: e.target.value })} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="pc-ph" className={labelClass}>Phone</label><input id="pc-ph" className={fieldClass} value={priv.phone} onChange={(e) => setPriv({ ...priv, phone: e.target.value })} /></div>
            <fieldset className="sm:col-span-2"><legend className={labelClass}>Subjects</legend><div className="mt-1 grid gap-1 sm:grid-cols-2">{list.codes.map((c) => <label key={c.id} className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-4 w-4" checked={priv.codeIds.includes(c.id)} onChange={(e) => setPriv({ ...priv, codeIds: e.target.checked ? [...priv.codeIds, c.id] : priv.codeIds.filter((x) => x !== c.id) })} />{c.code} {c.name}</label>)}</div></fieldset>
          </div>
        )}
      </Modal>
    </div>
  );
}
