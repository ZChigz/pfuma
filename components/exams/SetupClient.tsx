'use client';

// Assessment setup, in tabs: the term weighting plan (per level, optionally per subject), the school's assessment types, the papers
// set once for every class (end-of-term exam, mocks), the dates for entering and verifying marks, the examinations and report card
// settings, the alternate verifier of each department, and the comment bank.
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { Notice, Section, Tabs, api, fieldClass, labelClass, problem } from '@/components/exams/shared';
import { validatePlan } from '@/lib/results/term-mark';

type Rule = 'AVERAGE' | 'BEST_N' | 'BY_MAX';
interface Line { label: string; weight: string; rule: Rule; bestN: string; typeIds: string[] }
interface TypeRow { id: string; name: string; isProject: boolean; commonExam: boolean; active: boolean; assessments: number; inPlans: number }
interface PlanRow { id: string; levelId: string; subjectId: string | null; name: string; lines: { label: string; weight: number; rule: Rule; bestN: number | null; typeIds: string[] }[] }
interface Settings { englishSubjectId: string; mathsSubjectId: string; passesRequired: number; outlierSd: number; subjectCommentsEnabled: boolean; showSubjectPositions: boolean; showClassPosition: boolean; showFormPosition: boolean; showTypeScores: boolean; showAttendance: boolean; showConduct: boolean; showPreviousAverage: boolean; passGrade: string }
type Tab = 'plan' | 'types' | 'common' | 'dates' | 'settings' | 'verifiers' | 'bank';

const RULE_TEXT: Record<Rule, string> = { AVERAGE: 'Average of all', BEST_N: 'Best N', BY_MAX: 'Weighted by maximum mark' };
const toLines = (p?: PlanRow): Line[] => (p ? p.lines.map((l) => ({ label: l.label, weight: String(l.weight), rule: l.rule, bestN: l.bestN ? String(l.bestN) : '', typeIds: l.typeIds })) : []);

export function SetupClient(props: {
  termId: string; terms: { id: string; name: string; status: string }[]; levels: { id: string; name: string }[]; subjects: { id: string; name: string }[];
  types: TypeRow[]; plans: PlanRow[]; deadlines: { entryDue: string | null; submitDue: string | null; verifyDue: string | null };
  settings: Settings; verifiers: { departmentId: string; name: string; hod: string | null; verifierId: string | null }[]; bank: { id: string; category: string; text: string }[];
  eligible: { id: string; fullName: string }[]; flags: { setup: boolean; reportCards: boolean };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(props.flags.setup ? 'plan' : 'settings');
  const tabs = [
    ...(props.flags.setup ? [{ id: 'plan' as const, label: 'Weighting plan' }, { id: 'types' as const, label: 'Assessment types' }, { id: 'common' as const, label: 'Exams for every class' }, { id: 'dates' as const, label: 'Dates' }] : []),
    { id: 'settings' as const, label: 'Settings & report card' },
    ...(props.flags.setup ? [{ id: 'verifiers' as const, label: 'Verifiers' }, { id: 'bank' as const, label: 'Comment bank' }] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Setup sections" />
      {tab === 'plan' && <PlanTab {...props} refresh={() => router.refresh()} />}
      {tab === 'types' && <TypesTab types={props.types} refresh={() => router.refresh()} />}
      {tab === 'common' && <CommonTab termId={props.termId} terms={props.terms} levels={props.levels} subjects={props.subjects} types={props.types} />}
      {tab === 'dates' && <DatesTab termId={props.termId} deadlines={props.deadlines} />}
      {tab === 'settings' && <SettingsTab settings={props.settings} subjects={props.subjects} canReportCards={props.flags.reportCards} canSetup={props.flags.setup} />}
      {tab === 'verifiers' && <VerifiersTab rows={props.verifiers} eligible={props.eligible} />}
      {tab === 'bank' && <BankTab bank={props.bank} refresh={() => router.refresh()} />}
    </div>
  );
}

// ─── Weighting plan ──────────────────────────────────────────────────────────

function PlanTab({ termId, terms, levels, subjects, types, plans: initialPlans, refresh }: { termId: string; terms: { id: string; name: string; status: string }[]; levels: { id: string; name: string }[]; subjects: { id: string; name: string }[]; types: TypeRow[]; plans: PlanRow[]; refresh: () => void }) {
  const [term, setTerm] = useState(termId);
  const [plans, setPlans] = useState(initialPlans);
  const [levelId, setLevelId] = useState(levels[0]?.id ?? '');
  const [subjectId, setSubjectId] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [copyTo, setCopyTo] = useState('');
  const usable = types.filter((t) => t.active);

  useEffect(() => {
    let live = true;
    if (term === termId) { setPlans(initialPlans); return; }
    void api(`/api/exams/plans?termId=${term}`).then((r) => { if (live && r.ok) setPlans(r.body.data as PlanRow[]); });
    return () => { live = false; };
  }, [term, termId, initialPlans]);

  const current = useMemo(() => plans.find((p) => p.levelId === levelId && (p.subjectId ?? '') === subjectId), [plans, levelId, subjectId]);
  const inherited = !current && subjectId ? plans.find((p) => p.levelId === levelId && !p.subjectId) : undefined;
  useEffect(() => { setLines(toLines(current ?? inherited)); }, [current, inherited, levelId, subjectId, term]);

  const total = Math.round(lines.reduce((a, l) => a + (Number(l.weight) || 0), 0) * 100) / 100;
  const problemText = lines.length ? validatePlan(lines.map((l) => ({ label: l.label, weight: Number(l.weight) || 0, rule: l.rule, bestN: l.bestN ? Number(l.bestN) : null, typeIds: l.typeIds }))) : null;
  const used = new Set(lines.flatMap((l) => l.typeIds));
  const edit = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save() {
    setBusy(true);
    const r = await api('/api/exams/plans', 'PUT', {
      termId: term, levelId, subjectId: subjectId || null,
      lines: lines.map((l) => ({ label: l.label, weight: Number(l.weight), rule: l.rule, bestN: l.rule === 'BEST_N' ? Number(l.bestN) : null, typeIds: l.typeIds })),
    });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Plan saved');
    refresh();
    const again = await api(`/api/exams/plans?termId=${term}`);
    if (again.ok) setPlans(again.body.data as PlanRow[]);
  }

  async function removeOverride() {
    if (!current?.subjectId) return;
    const r = await api(`/api/exams/plans/${current.id}`, 'DELETE');
    if (!r.ok) return toast.error(problem(r));
    toast.success('The level plan applies to this subject again');
    refresh();
    setPlans((ps) => ps.filter((p) => p.id !== current.id));
  }

  async function mockOnly() {
    const r = await api('/api/exams/plans/mock-only');
    if (!r.ok) return toast.error(problem(r));
    const l = (r.body.data as { lines: { label: string; weight: number; rule: Rule; typeIds: string[] }[] }).lines;
    setLines(l.map((x) => ({ label: x.label, weight: String(x.weight), rule: x.rule, bestN: '', typeIds: x.typeIds })));
    toast.info('"Mock exam only" is filled in. Save it to use it.');
  }

  async function copyAll() {
    if (!copyTo) return;
    const r = await api('/api/exams/plans/copy', 'POST', { fromTermId: term, toTermId: copyTo });
    if (!r.ok) return toast.error(problem(r));
    const d = r.body.data as { copied: number; skipped: number };
    toast.success(`${d.copied} plan${d.copied === 1 ? '' : 's'} copied${d.skipped ? `, ${d.skipped} already there` : ''}`);
  }

  return (
    <Section title="Term weighting plan" hint="What counts towards a subject's term mark, and how much. The weights must add up to 100%. A subject can have its own plan (for example, a practical subject giving 30% to practicals).">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5"><label htmlFor="pl-term" className={labelClass}>Term</label>
          <select id="pl-term" className={fieldClass} value={term} onChange={(e) => setTerm(e.target.value)}>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.status === 'CLOSED' ? ' (closed)' : ''}</option>)}</select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="pl-level" className={labelClass}>Level</label>
          <select id="pl-level" className={fieldClass} value={levelId} onChange={(e) => setLevelId(e.target.value)}>{levels.map((l) => <option key={l.id} value={l.id}>{l.name}{plans.some((p) => p.levelId === l.id && !p.subjectId) ? '' : ' (no plan)'}</option>)}</select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="pl-subject" className={labelClass}>Applies to</label>
          <select id="pl-subject" className={fieldClass} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Every subject at this level</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name} only{plans.some((p) => p.levelId === levelId && p.subjectId === s.id) ? ' (own plan)' : ''}</option>)}</select></div>
      </div>

      {inherited && <div className="mt-3"><Notice tone="info">This subject uses the level plan. Change it below and save to give the subject its own plan.</Notice></div>}
      {!current && !inherited && <div className="mt-3"><Notice tone="warn">No plan yet for this selection. Add the lines below.</Notice></div>}

      <div className="mt-4 flex flex-col gap-3">
        {lines.map((l, i) => (
          <div key={i} className="rounded-xl border border-line p-3">
            <div className="grid gap-3 sm:grid-cols-12">
              <div className="flex flex-col gap-1.5 sm:col-span-4"><label htmlFor={`l-label-${i}`} className={labelClass}>Name on the report</label><input id={`l-label-${i}`} className={fieldClass} value={l.label} maxLength={80} onChange={(e) => edit(i, { label: e.target.value })} /></div>
              <div className="flex flex-col gap-1.5 sm:col-span-2"><label htmlFor={`l-w-${i}`} className={labelClass}>Weight %</label><input id={`l-w-${i}`} className={fieldClass} inputMode="decimal" value={l.weight} onChange={(e) => edit(i, { weight: e.target.value })} /></div>
              <div className="flex flex-col gap-1.5 sm:col-span-4"><label htmlFor={`l-rule-${i}`} className={labelClass}>Several assessments are combined by</label>
                <select id={`l-rule-${i}`} className={fieldClass} value={l.rule} onChange={(e) => edit(i, { rule: e.target.value as Rule })}>{(Object.keys(RULE_TEXT) as Rule[]).map((r) => <option key={r} value={r}>{RULE_TEXT[r]}</option>)}</select></div>
              {l.rule === 'BEST_N' && <div className="flex flex-col gap-1.5 sm:col-span-2"><label htmlFor={`l-n-${i}`} className={labelClass}>Best how many</label><input id={`l-n-${i}`} className={fieldClass} inputMode="numeric" value={l.bestN} onChange={(e) => edit(i, { bestN: e.target.value })} /></div>}
            </div>
            <fieldset className="mt-3"><legend className="text-sm font-medium text-ink">Assessment types on this line</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {usable.map((t) => {
                  const on = l.typeIds.includes(t.id);
                  const elsewhere = !on && used.has(t.id);
                  return (
                    <label key={t.id} className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-3 text-sm ${on ? 'border-primary bg-tint text-ink' : 'border-line text-muted'} ${elsewhere ? 'opacity-40' : ''}`}>
                      <input type="checkbox" className="h-4 w-4" checked={on} disabled={elsewhere} onChange={(e) => edit(i, { typeIds: e.target.checked ? [...l.typeIds, t.id] : l.typeIds.filter((x) => x !== t.id) })} />{t.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="mt-2 text-right"><Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Remove this line</Button></div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setLines((ls) => [...ls, { label: '', weight: '', rule: 'AVERAGE', bestN: '', typeIds: [] }])} disabled={lines.length >= 8}>Add a line</Button>
        <Button variant="ghost" onClick={mockOnly}>Mock exam only</Button>
        <span className={`text-sm font-semibold ${total === 100 ? 'text-success' : 'text-danger'}`} role="status">Total {total}%</span>
      </div>
      {lines.length > 0 && problemText && <p className="mt-2 text-sm text-danger" role="alert">{problemText}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={save} loading={busy} disabled={lines.length === 0 || !!problemText}>Save plan</Button>
        {current?.subjectId && <Button variant="ghost" onClick={removeOverride}>Remove this subject&apos;s own plan</Button>}
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <div className="flex min-w-[220px] flex-col gap-1.5"><label htmlFor="pl-copy" className={labelClass}>Copy every plan of this term to</label>
          <select id="pl-copy" className={fieldClass} value={copyTo} onChange={(e) => setCopyTo(e.target.value)}><option value="">Choose a term</option>{terms.filter((t) => t.id !== term && t.status !== 'CLOSED').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <Button variant="secondary" onClick={copyAll} disabled={!copyTo}>Copy plans</Button>
      </div>
    </Section>
  );
}

// ─── Assessment types ────────────────────────────────────────────────────────

function TypesTab({ types, refresh }: { types: TypeRow[]; refresh: () => void }) {
  const [name, setName] = useState('');
  const [isProject, setIsProject] = useState(false);
  const [commonExam, setCommonExam] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const r = await api('/api/exams/types', 'POST', { name, isProject, commonExam });
    if (!r.ok) return toast.error(problem(r));
    setName(''); setIsProject(false); setCommonExam(false);
    toast.success('Type added');
    refresh();
  }
  async function patch(id: string, body: object) {
    const r = await api(`/api/exams/types/${id}`, 'PATCH', body);
    if (!r.ok) return toast.error(problem(r));
    refresh();
  }

  return (
    <Section title="Assessment types" hint="The school's own list. Add, rename or switch off types; a type used in a plan or by assessments cannot be removed, only switched off.">
      <ul className="flex flex-col gap-2">
        {types.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <input aria-label={`Name of ${t.name}`} defaultValue={t.name} className="h-10 w-56 rounded-lg border border-line px-2 text-sm" maxLength={60} onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== t.name) void patch(t.id, { name: e.target.value.trim() }); }} />
              {t.isProject && <Badge variant="gold" label="Project" />}
              {t.commonExam && <Badge variant="info" label="Set for every class" />}
              {!t.active && <Badge variant="neutral" label="Switched off" />}
              <span className="text-xs text-muted">{t.assessments} assessment{t.assessments === 1 ? '' : 's'} · in {t.inPlans} plan line{t.inPlans === 1 ? '' : 's'}</span>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => patch(t.id, { commonExam: !t.commonExam })}>{t.commonExam ? 'Teachers may create' : 'Exams Officer only'}</Button>
              <Button size="sm" variant="ghost" onClick={() => patch(t.id, { active: !t.active })}>{t.active ? 'Switch off' : 'Switch on'}</Button>
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <div className="flex min-w-[220px] flex-col gap-1.5"><label htmlFor="ty-name" className={labelClass}>New type</label><input id="ty-name" className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required /></div>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-4 w-4" checked={isProject} onChange={(e) => setIsProject(e.target.checked)} /> A school-based project</label>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-4 w-4" checked={commonExam} onChange={(e) => setCommonExam(e.target.checked)} /> Set once for every class</label>
        <Button type="submit">Add</Button>
      </form>
    </Section>
  );
}

// ─── Papers set for every class ──────────────────────────────────────────────

function CommonTab({ termId, terms, levels, subjects, types }: { termId: string; terms: { id: string; name: string; status: string }[]; levels: { id: string; name: string }[]; subjects: { id: string; name: string }[]; types: TypeRow[] }) {
  const exam = types.filter((t) => t.active && !t.isProject);
  const [f, setF] = useState({ termId, levelId: levels[0]?.id ?? '', typeId: exam.find((t) => t.commonExam)?.id ?? exam[0]?.id ?? '', title: '', date: '', max: '100', all: true, subjectIds: [] as string[], counts: true });
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api('/api/exams/assessments/common', 'POST', { termId: f.termId, levelId: f.levelId, typeId: f.typeId, title: f.title, date: f.date || null, maxMark: Number(f.max), countsToTerm: f.counts, ...(f.all ? {} : { subjectIds: f.subjectIds }) });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    const d = r.body.data as { created: number; skipped: number };
    toast.success(`${d.created} paper${d.created === 1 ? '' : 's'} set${d.skipped ? `, ${d.skipped} already existed` : ''}`);
    setF({ ...f, title: '' });
  }

  return (
    <Section title="End-of-term exams and mocks" hint="Set once for every subject and class at a level, so all classes write the same paper with the same maximum mark. Teachers enter the marks for their own classes.">
      <form onSubmit={create} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-1.5"><label htmlFor="cm-term" className={labelClass}>Term</label><select id="cm-term" className={fieldClass} value={f.termId} onChange={(e) => setF({ ...f, termId: e.target.value })}>{terms.filter((t) => t.status !== 'CLOSED').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="cm-level" className={labelClass}>Level</label><select id="cm-level" className={fieldClass} value={f.levelId} onChange={(e) => setF({ ...f, levelId: e.target.value })}>{levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="cm-type" className={labelClass}>Type</label><select id="cm-type" className={fieldClass} value={f.typeId} onChange={(e) => setF({ ...f, typeId: e.target.value })}>{exam.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="cm-title" className={labelClass}>Title</label><input id="cm-title" className={fieldClass} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Term 3 exam 2026" required maxLength={120} /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="cm-date" className={labelClass}>Date (optional)</label><input id="cm-date" type="date" className={fieldClass} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="cm-max" className={labelClass}>Maximum mark</label><input id="cm-max" className={fieldClass} inputMode="decimal" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} required /></div>
        <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2"><input type="checkbox" className="h-4 w-4" checked={f.all} onChange={(e) => setF({ ...f, all: e.target.checked })} /> Every subject offered at this level</label>
        {!f.all && (
          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3"><label htmlFor="cm-subjects" className={labelClass}>Subjects</label>
            <select id="cm-subjects" multiple className={`${fieldClass} h-36 py-2`} value={f.subjectIds} onChange={(e) => setF({ ...f, subjectIds: Array.from(e.target.selectedOptions, (o) => o.value) })}>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        )}
        <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2"><input type="checkbox" className="h-4 w-4" checked={f.counts} onChange={(e) => setF({ ...f, counts: e.target.checked })} /> Counts towards the term mark</label>
        <div className="sm:col-span-2 lg:col-span-3"><Button type="submit" loading={busy}>Set the paper</Button></div>
      </form>
    </Section>
  );
}

// ─── Dates ───────────────────────────────────────────────────────────────────

function DatesTab({ termId, deadlines }: { termId: string; deadlines: { entryDue: string | null; submitDue: string | null; verifyDue: string | null } }) {
  const router = useRouter();
  const [d, setD] = useState({ entryDue: deadlines.entryDue ?? '', submitDue: deadlines.submitDue ?? '', verifyDue: deadlines.verifyDue ?? '' });
  async function save() {
    const r = await api('/api/exams/deadlines', 'PUT', { termId, entryDue: d.entryDue || null, submitDue: d.submitDue || null, verifyDue: d.verifyDue || null });
    if (!r.ok) return toast.error(problem(r));
    toast.success('Dates saved');
    router.refresh();
  }
  return (
    <Section title="Dates for this term" hint="The Head's progress page shows overdue mark sheets against these dates.">
      <div className="grid gap-3 sm:grid-cols-3">
        {([['entryDue', 'Marks entered by'], ['submitDue', 'Mark sheets submitted by'], ['verifyDue', 'Mark sheets verified by']] as const).map(([k, label]) => (
          <div key={k} className="flex flex-col gap-1.5"><label htmlFor={`dt-${k}`} className={labelClass}>{label}</label><input id={`dt-${k}`} type="date" className={fieldClass} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} /></div>
        ))}
      </div>
      <div className="mt-4"><Button onClick={save}>Save dates</Button></div>
    </Section>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────

function SettingsTab({ settings, subjects, canReportCards, canSetup }: { settings: Settings; subjects: { id: string; name: string }[]; canReportCards: boolean; canSetup: boolean }) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [busy, setBusy] = useState(false);
  const toggles: [keyof Settings, string][] = [
    ['subjectCommentsEnabled', 'Subject teachers write a comment per student on their mark sheet'],
    ['showSubjectPositions', 'Show the position in each subject'],
    ['showClassPosition', 'Show the class position'],
    ['showFormPosition', 'Show the form position'],
    ['showTypeScores', 'Show the score of each part of the term mark'],
    ['showAttendance', 'Show attendance (days present, times late)'],
    ['showConduct', 'Show the number of discipline incidents'],
    ['showPreviousAverage', 'Show last term\'s average for comparison'],
  ];
  async function save() {
    setBusy(true);
    const r = await api('/api/exams/settings', 'PUT', {
      englishSubjectId: s.englishSubjectId || null, mathsSubjectId: s.mathsSubjectId || null, passesRequired: Number(s.passesRequired), outlierSd: Number(s.outlierSd),
      subjectCommentsEnabled: s.subjectCommentsEnabled, showSubjectPositions: s.showSubjectPositions, showClassPosition: s.showClassPosition, showFormPosition: s.showFormPosition,
      showTypeScores: s.showTypeScores, showAttendance: s.showAttendance, showConduct: s.showConduct, showPreviousAverage: s.showPreviousAverage,
    });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Settings saved');
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-4">
      {canSetup && (
        <Section title="O Level summary" hint={`A pass is the pass grade (${settings.passGrade}) or better; change the pass grade in School Settings, Grading.`}>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5"><label htmlFor="st-en" className={labelClass}>English Language is</label><select id="st-en" className={fieldClass} value={s.englishSubjectId} onChange={(e) => setS({ ...s, englishSubjectId: e.target.value })}><option value="">Not chosen</option>{subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="st-ma" className={labelClass}>Mathematics is</label><select id="st-ma" className={fieldClass} value={s.mathsSubjectId} onChange={(e) => setS({ ...s, mathsSubjectId: e.target.value })}><option value="">Not chosen</option>{subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="st-pass" className={labelClass}>Passes needed</label><input id="st-pass" className={fieldClass} inputMode="numeric" value={s.passesRequired} onChange={(e) => setS({ ...s, passesRequired: Number(e.target.value) })} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="st-sd" className={labelClass}>Warn beyond (std deviations)</label><input id="st-sd" className={fieldClass} inputMode="decimal" value={s.outlierSd} onChange={(e) => setS({ ...s, outlierSd: Number(e.target.value) })} /></div>
          </div>
        </Section>
      )}
      {canReportCards && (
        <Section title="Report card" hint="Choose which parts appear on the card and in the mark sheet.">
          <ul className="grid gap-2 sm:grid-cols-2">
            {toggles.map(([k, label]) => (
              <li key={k}><label className="flex min-h-[44px] items-center gap-3 rounded-xl border border-line px-3 text-sm text-ink"><input type="checkbox" className="h-4 w-4" checked={s[k] as boolean} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />{label}</label></li>
            ))}
          </ul>
        </Section>
      )}
      <div><Button onClick={save} loading={busy}>Save settings</Button></div>
    </div>
  );
}

// ─── Alternate verifiers ─────────────────────────────────────────────────────

function VerifiersTab({ rows, eligible }: { rows: { departmentId: string; name: string; hod: string | null; verifierId: string | null }[]; eligible: { id: string; fullName: string }[] }) {
  const router = useRouter();
  async function set(departmentId: string, userId: string) {
    const r = await api('/api/exams/verifiers', 'PUT', { departmentId, userId: userId || null });
    if (!r.ok) return toast.error(problem(r));
    toast.success('Saved');
    router.refresh();
  }
  return (
    <Section title="Alternate verifiers" hint="A Head of Department never verifies their own marks. When they teach a class, the sheet goes to the alternate verifier set here (another HOD or the Deputy).">
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.departmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
            <div><div className="font-medium text-ink">{r.name}</div><div className="text-xs text-muted">Head of Department: {r.hod ?? 'not set'}</div></div>
            <select aria-label={`Alternate verifier for ${r.name}`} className="h-10 rounded-lg border border-line bg-white px-2 text-sm" value={r.verifierId ?? ''} onChange={(e) => void set(r.departmentId, e.target.value)}>
              <option value="">None</option>{eligible.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ─── Comment bank ────────────────────────────────────────────────────────────

function BankTab({ bank, refresh }: { bank: { id: string; category: string; text: string }[]; refresh: () => void }) {
  const [category, setCategory] = useState<'SUBJECT' | 'CLASS_TEACHER' | 'HEAD'>('CLASS_TEACHER');
  const [text, setText] = useState('');
  const label = { SUBJECT: 'Subject teacher', CLASS_TEACHER: 'Class teacher', HEAD: 'Head' };
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const r = await api('/api/exams/comment-bank', 'POST', { category, text });
    if (!r.ok) return toast.error(problem(r));
    setText('');
    refresh();
  }
  async function remove(id: string) {
    const r = await api(`/api/exams/comment-bank/${id}`, 'DELETE');
    if (!r.ok) return toast.error(problem(r));
    refresh();
  }
  return (
    <Section title="Comment bank" hint="Common phrases teachers and the Head can pick and edit. Comments are limited to 300 characters to fit the card.">
      <form onSubmit={add} className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5"><label htmlFor="cb-cat" className={labelClass}>For</label><select id="cb-cat" className={fieldClass} value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>{(Object.keys(label) as (keyof typeof label)[]).map((k) => <option key={k} value={k}>{label[k]}</option>)}</select></div>
        <div className="flex min-w-[260px] flex-1 flex-col gap-1.5"><label htmlFor="cb-text" className={labelClass}>Phrase</label><input id="cb-text" className={fieldClass} value={text} onChange={(e) => setText(e.target.value)} maxLength={300} required /></div>
        <Button type="submit">Add</Button>
      </form>
      {(['SUBJECT', 'CLASS_TEACHER', 'HEAD'] as const).map((c) => {
        const items = bank.filter((b) => b.category === c);
        return (
          <div key={c} className="mb-3">
            <h3 className="text-sm font-semibold text-ink">{label[c]} ({items.length})</h3>
            {items.length === 0 ? <p className="text-sm text-muted">None yet.</p> : <ul className="mt-1 flex flex-col gap-1">{items.map((b) => <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5 text-sm"><span>{b.text}</span><Button size="sm" variant="ghost" onClick={() => remove(b.id)}>Remove</Button></li>)}</ul>}
          </div>
        );
      })}
    </Section>
  );
}
