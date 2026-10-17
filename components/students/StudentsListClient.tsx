'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';
import type { StudentCounts, StudentRow } from '@/lib/students/list';
import { AssignHouseModal, IncidentModal, LeavingModal, MoveClassModal, PrintClassListModal, type ClassOption, type HouseOption } from '@/components/students/actions';
import { Avatar, BoardingBadge, formatDay, StatusBadge } from '@/components/students/shared';
import { downloadStudentExport } from '@/components/students/ExportButton';

export interface ListFlags {
  create: boolean; import: boolean; export: boolean; edit: boolean; moveClass: boolean; recordIncident: boolean; startLeaving: boolean; guardians: boolean; print: boolean;
}

interface Props {
  rows: StudentRow[];
  counts: StudentCounts;
  total: number;
  page: number;
  pageSize: number;
  termName: string | null;
  searchTooShort: boolean;
  classes: (ClassOption & { stream: string })[];
  forms: { order: number; name: string }[];
  streams: string[];
  houses: HouseOption[];
  admissionYears: number[];
  flags: ListFlags;
}

type OptionalColumn = 'house' | 'dateOfBirth' | 'admissionDate' | 'previousSchool';
const OPTIONAL: { key: OptionalColumn; label: string }[] = [
  { key: 'house', label: 'House' }, { key: 'dateOfBirth', label: 'Date of birth' }, { key: 'admissionDate', label: 'Admission date' }, { key: 'previousSchool', label: 'Previous school' },
];

const COUNT_TILES: { key: keyof StudentCounts; filter: string; label: string }[] = [
  { key: 'active', filter: 'active', label: 'Active' }, { key: 'boarders', filter: 'boarders', label: 'Boarders' }, { key: 'day', filter: 'day', label: 'Day scholars' },
  { key: 'new', filter: 'new', label: 'New this term' }, { key: 'suspended', filter: 'suspended', label: 'Suspended' },
];

const selectCls = 'min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

export function StudentsListClient(props: Props) {
  const { rows, counts, total, page, pageSize, flags } = props;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [columns, setColumns] = useState<OptionalColumn[]>([]);
  const [modal, setModal] = useState<null | { kind: 'move' | 'house' | 'incident' | 'leave' | 'print'; ids: string[] }>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [exporting, setExporting] = useState(false);

  // Optional columns are remembered on this device only.
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem('pfuma.students.columns') ?? '[]'); if (Array.isArray(v)) setColumns(v.filter((c): c is OptionalColumn => OPTIONAL.some((o) => o.key === c))); } catch { /* ignore */ }
  }, []);
  const toggleColumn = (c: OptionalColumn) => setColumns((cur) => {
    const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
    try { localStorage.setItem('pfuma.students.columns', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  function go(changes: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) { if (v === null || v === '') next.delete(k); else next.set(k, v); }
    if (resetPage) next.delete('page');
    setSelected(new Set());
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  useEffect(() => () => clearTimeout(timer.current), []);
  function onSearch(v: string) {
    setSearch(v);
    clearTimeout(timer.current);
    // Results start after 2 characters; a pause in typing keeps slow connections from being flooded.
    timer.current = setTimeout(() => { if (v.trim().length === 0 || v.trim().length >= 2) go({ q: v.trim() || null }); }, 400);
  }

  const filterKeys = ['form', 'classId', 'stream', 'gender', 'status', 'boarding', 'houseId', 'beam', 'sponsored', 'specialNeeds', 'admissionYear', 'count'];
  const anyFilter = !!params.get('q') || filterKeys.some((k) => params.get(k));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const picked = rows.filter((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const classesOfPicked = useMemo(() => Array.from(new Set(picked.flatMap((r) => (r.classId ? [r.classId] : [])))), [picked]);
  const bulk = flags.moveClass || flags.edit || flags.export || flags.print;

  async function exportRows(ids?: string[]) {
    setExporting(true);
    await downloadStudentExport(new URLSearchParams(params.toString()), ids);
    setExporting(false);
  }

  const refresh = () => { setSelected(new Set()); router.refresh(); };
  const modalStudents = modal ? props.rows.filter((r) => modal.ids.includes(r.id)).map((r) => ({ id: r.id, fullName: r.fullName, className: r.className, admissionNumber: r.admissionNumber })) : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Counts for the selected term: each is a filter */}
      <section aria-label={`Counts for ${props.termName ?? 'the current term'}`} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {COUNT_TILES.map((t) => {
          const on = params.get('count') === t.filter;
          return (
            <button key={t.key} type="button" onClick={() => go({ count: on ? null : t.filter })} aria-pressed={on}
              className={cn('flex min-h-[64px] flex-col items-start justify-center rounded-2xl px-4 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                on ? 'bg-primary text-white' : 'bg-white text-ink hover:bg-tint')}>
              <span className={cn('text-xs font-medium', on ? 'text-white/80' : 'text-muted')}>{t.label}</span>
              <span className="text-2xl font-bold leading-tight">{counts[t.key]}</span>
            </button>
          );
        })}
      </section>
      {props.termName && <p className="-mt-2 text-xs text-muted">Counts are for {props.termName}.</p>}

      {/* Search and filters */}
      <section aria-label="Find students" className="flex flex-col gap-2">
        <label className="block">
          <span className="sr-only">Search by name, admission number, birth certificate number or guardian phone</span>
          <input type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search by name, admission number, birth certificate number or guardian phone" className={selectCls} />
        </label>
        {props.searchTooShort && <p className="text-xs text-muted">Type at least 2 characters to search.</p>}
        <details className="group rounded-xl" open={anyFilter && filterKeys.some((k) => params.get(k) && k !== 'count')}>
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-sm font-semibold text-primary">
            <span>Filters</span><span aria-hidden="true" className="text-xs group-open:rotate-180">▼</span>
            {anyFilter && <button type="button" onClick={(e) => { e.preventDefault(); setSearch(''); router.push(pathname); setSelected(new Set()); }} className="ml-auto text-xs font-medium text-muted underline">Clear all</button>}
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <FilterSelect label="Form" k="form" value={params.get('form')} onChange={go} options={props.forms.map((f) => [String(f.order), f.name])} />
            <FilterSelect label="Class" k="classId" value={params.get('classId')} onChange={go} options={props.classes.map((c) => [c.id, c.name])} />
            <FilterSelect label="Stream" k="stream" value={params.get('stream')} onChange={go} options={props.streams.map((s) => [s, s])} />
            <FilterSelect label="Gender" k="gender" value={params.get('gender')} onChange={go} options={[['M', 'Male'], ['F', 'Female']]} />
            <FilterSelect label="Status" k="status" value={params.get('status')} onChange={go} options={[['ACTIVE', 'Active'], ['SUSPENDED', 'Suspended'], ['TRANSFERRED', 'Transferred'], ['GRADUATED', 'Graduated'], ['WITHDRAWN', 'Withdrawn'], ['EXPELLED', 'Expelled'], ['DECEASED', 'Deceased']]} />
            <FilterSelect label="Boarding" k="boarding" value={params.get('boarding')} onChange={go} options={[['DAY', 'Day scholar'], ['BOARDER', 'Boarder']]} />
            <FilterSelect label="House" k="houseId" value={params.get('houseId')} onChange={go} options={props.houses.map((h) => [h.id, h.name])} />
            <FilterSelect label="Admission year" k="admissionYear" value={params.get('admissionYear')} onChange={go} options={props.admissionYears.map((y) => [String(y), String(y)])} />
            <FilterSelect label="BEAM or sponsored" k="beam" value={params.get('beam') ? 'beam' : params.get('sponsored') ? 'sponsored' : null} options={[['beam', 'BEAM beneficiary'], ['sponsored', 'Sponsored']]}
              onChange={(c) => { const v = c.beam ?? null; go({ beam: v === 'beam' ? '1' : null, sponsored: v === 'sponsored' ? '1' : null }); }} />
            <FilterSelect label="Special needs" k="specialNeeds" value={params.get('specialNeeds') ? '1' : null} onChange={go} options={[['1', 'Has special needs']]} />
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-2">
          <details className="relative">
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center rounded-full border border-line bg-white px-4 text-sm font-medium text-ink">Columns</summary>
            <div className="absolute left-0 z-20 mt-1 w-52 rounded-xl border border-line bg-white p-2 shadow-lg">
              {OPTIONAL.map((o) => (
                <label key={o.key} className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={columns.includes(o.key)} onChange={() => toggleColumn(o.key)} className="h-4 w-4" />{o.label}</label>
              ))}
            </div>
          </details>
          <p className="text-sm text-muted" aria-live="polite">{total} student{total === 1 ? '' : 's'}{pending ? ' …' : ''}</p>
        </div>
      </section>

      {/* Results */}
      <div className={cn('transition-opacity', pending && 'opacity-60')} aria-busy={pending}>
        {rows.length === 0 ? (
          <EmptyState
            title={anyFilter ? 'No students match' : 'No students yet'}
            description={anyFilter ? 'Try a different search or clear the filters.' : 'Add the first student, or import a class list.'}
            action={!anyFilter && flags.create ? <Link href="/students/new" className="inline-flex min-h-[44px] items-center rounded-full bg-primary px-5 text-sm font-semibold text-white">Add student</Link> : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded-2xl bg-white md:block">
              <table className="w-full min-w-[720px] text-left text-sm">
                <caption className="sr-only">Students</caption>
                <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <tr>
                    {bulk && <th scope="col" className="w-10 px-3 py-3"><input type="checkbox" aria-label="Select all on this page" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} className="h-5 w-5" /></th>}
                    <Th k="name" label="Student" params={params} go={go} />
                    <Th k="admissionNumber" label="Admission no." params={params} go={go} />
                    <Th k="class" label="Class" params={params} go={go} />
                    <th scope="col" className="px-3 py-3">Gender</th>
                    <th scope="col" className="px-3 py-3">Age</th>
                    <th scope="col" className="px-3 py-3">Boarding</th>
                    {flags.guardians && <th scope="col" className="px-3 py-3">Primary guardian</th>}
                    <th scope="col" className="px-3 py-3">Status</th>
                    {columns.includes('house') && <th scope="col" className="px-3 py-3">House</th>}
                    {columns.includes('dateOfBirth') && <th scope="col" className="px-3 py-3">Date of birth</th>}
                    {columns.includes('admissionDate') && <Th k="admissionDate" label="Admitted" params={params} go={go} />}
                    {columns.includes('previousSchool') && <th scope="col" className="px-3 py-3">Previous school</th>}
                    <th scope="col" className="w-12 px-3 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={cn('border-b border-line/60 last:border-0', selected.has(r.id) && 'bg-tint/60')}>
                      {bulk && <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${r.fullName}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="h-5 w-5" /></td>}
                      <td className="px-3 py-2">
                        <Link href={`/students/${r.id}`} className="flex items-center gap-3 font-medium text-ink hover:text-primary">
                          <Avatar name={r.fullName} src={r.photoUrl} size={36} />
                          <span>{r.surname.toUpperCase()}, {r.firstName}{r.specialNeeds && <span className="ml-1.5 text-xs font-normal text-muted">· special needs</span>}</span>
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted">{r.admissionNumber}</td>
                      <td className="whitespace-nowrap px-3 py-2">{r.className ?? '—'}</td>
                      <td className="px-3 py-2">{r.gender === 'M' ? 'M' : r.gender === 'F' ? 'F' : '—'}</td>
                      <td className="px-3 py-2">{r.age ?? '—'}</td>
                      <td className="px-3 py-2"><BoardingBadge boarding={r.boarding} /></td>
                      {flags.guardians && <td className="px-3 py-2"><div className="leading-tight">{r.guardianName ?? '—'}<div className="font-mono text-xs text-muted">{r.guardianPhone ?? ''}</div></div></td>}
                      <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                      {columns.includes('house') && <td className="px-3 py-2">{r.houseName ?? '—'}</td>}
                      {columns.includes('dateOfBirth') && <td className="whitespace-nowrap px-3 py-2">{formatDay(r.dateOfBirth)}</td>}
                      {columns.includes('admissionDate') && <td className="whitespace-nowrap px-3 py-2">{formatDay(r.admissionDate)}</td>}
                      {columns.includes('previousSchool') && <td className="px-3 py-2">{r.previousSchool ?? '—'}</td>}
                      <td className="px-3 py-2"><RowMenu row={r} flags={flags} open={(kind) => setModal({ kind, ids: [r.id] })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* On a phone each row is a card: photo, name, class and status */}
            <ul className="flex flex-col gap-2 md:hidden">
              {rows.map((r) => (
                <li key={r.id} className={cn('flex items-center gap-3 rounded-2xl bg-white p-3', selected.has(r.id) && 'ring-2 ring-primary/40')}>
                  {bulk && <input type="checkbox" aria-label={`Select ${r.fullName}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="h-6 w-6 flex-shrink-0" />}
                  <Link href={`/students/${r.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={r.fullName} src={r.photoUrl} size={44} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">{r.surname.toUpperCase()}, {r.firstName}</span>
                      <span className="block text-xs text-muted">{r.className ?? 'No class'} · {r.admissionNumber}</span>
                      <span className="mt-1 flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.boarding === 'BOARDER' && <BoardingBadge boarding="BOARDER" />}</span>
                    </span>
                  </Link>
                  <RowMenu row={r} flags={flags} open={(kind) => setModal({ kind, ids: [r.id] })} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => go({ page: String(page - 1) }, false)}>Previous</Button>
          <span className="text-sm text-muted">Page {page} of {pages}</span>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => go({ page: String(page + 1) }, false)}>Next</Button>
        </nav>
      )}

      {/* Bulk actions on the ticked rows */}
      {selected.size > 0 && bulk && (
        <div role="region" aria-label="Actions for the selected students" className="sticky bottom-3 z-30 flex flex-wrap items-center gap-2 rounded-2xl bg-ink p-3 text-white shadow-xl">
          <span className="mr-auto text-sm font-semibold">{selected.size} selected</span>
          {flags.moveClass && <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'move', ids: picked.map((p) => p.id) })}>Move to class</Button>}
          {flags.edit && <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'house', ids: picked.map((p) => p.id) })}>Assign house</Button>}
          {flags.export && <Button size="sm" variant="secondary" loading={exporting} onClick={() => exportRows(picked.map((p) => p.id))}>Export</Button>}
          {flags.print && <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'print', ids: classesOfPicked })}>Print class list</Button>}
          <button type="button" onClick={() => setSelected(new Set())} className="min-h-[44px] px-3 text-sm underline">Clear</button>
        </div>
      )}

      <MoveClassModal open={modal?.kind === 'move'} students={modalStudents} classes={props.classes} onClose={() => setModal(null)} onDone={refresh} />
      <AssignHouseModal open={modal?.kind === 'house'} students={modalStudents} houses={props.houses} onClose={() => setModal(null)} onDone={refresh} />
      <PrintClassListModal open={modal?.kind === 'print'} classes={props.classes} preselected={modal?.kind === 'print' ? modal.ids : []} onClose={() => setModal(null)} />
      {modal?.kind === 'incident' && <IncidentModal open initial={modalStudents} onClose={() => setModal(null)} onDone={refresh} />}
      {modal?.kind === 'leave' && modalStudents[0] && <LeavingModal open student={modalStudents[0]} onClose={() => setModal(null)} onDone={refresh} />}
    </div>
  );
}

function FilterSelect({ label, k, value, options, onChange }: { label: string; k: string; value: string | null; options: string[][]; onChange: (c: Record<string, string | null>) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange({ [k]: e.target.value || null })} className={selectCls}>
        <option value="">All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function Th({ k, label, params, go }: { k: string; label: string; params: URLSearchParams; go: (c: Record<string, string | null>, reset?: boolean) => void }) {
  const on = (params.get('sort') ?? 'name') === k;
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc';
  return (
    <th scope="col" aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="px-3 py-3">
      <button type="button" onClick={() => go({ sort: k, dir: on && dir === 'asc' ? 'desc' : 'asc' }, false)} className="inline-flex min-h-[32px] items-center gap-1 font-semibold uppercase tracking-wide hover:text-ink">
        {label}{on && <span aria-hidden="true">{dir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}

function RowMenu({ row, flags, open }: { row: StudentRow; flags: ListFlags; open: (kind: 'move' | 'incident' | 'leave') => void }) {
  const atSchool = row.status === 'ACTIVE' || row.status === 'SUSPENDED';
  const item = 'flex min-h-[44px] w-full items-center px-3 text-left text-sm text-ink hover:bg-tint';
  return (
    <details className="relative">
      <summary aria-label={`Actions for ${row.fullName}`} className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full text-lg text-muted hover:bg-tint">⋯</summary>
      <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lg">
        <Link href={`/students/${row.id}`} className={item}>View profile</Link>
        {flags.edit && <Link href={`/students/${row.id}/edit`} className={item}>Edit</Link>}
        {flags.moveClass && atSchool && <button type="button" onClick={() => open('move')} className={item}>Move class</button>}
        {flags.print && <a href={`/api/students/${row.id}/print`} target="_blank" rel="noreferrer" className={item}>Print profile</a>}
        {flags.recordIncident && atSchool && <button type="button" onClick={() => open('incident')} className={item}>Record incident</button>}
        {flags.startLeaving && atSchool && <button type="button" onClick={() => open('leave')} className={cn(item, 'text-danger')}>Start leaving process</button>}
      </div>
    </details>
  );
}

