// Examination analytics. Published results turn into the questions heads, HODs and teachers ask after every term: which subjects and
// classes are slipping, who needs help, and are we improving.
//
//  Panel                 Who sees it
//  overview              Owner/Administrator, Head, Deputy, Exams Officer
//  subjects, teachers    Owner/Administrator, Head, Deputy; HOD for the own department
//  grades, top           the people above (including the Exams Officer)
//  trend                 the people above; a teacher or class teacher for their own classes
//  atRisk                Owner/Administrator, Head, Deputy; the class teacher for their own class
//  valueAdded            Owner/Administrator, Head, Deputy
//  board (ZIMSEC)        Owner/Administrator, Head, Deputy, Exams Officer
//
// Only published results are used. The Head (and Owner/Administrator) can switch to verified marks before publishing; the panel is
// then labelled "Not yet published". Filters: term, exam (term marks or a single assessment), form, class, subject, gender.
// Every panel is a table (columns and rows) so it exports to Excel as it is shown.
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { classStats, gradeOf, round2 } from '@/lib/results';
import { ownScope } from '@/lib/academics/common';
import { holds, idSchema, isFull, num, resolveTerm, previousTerm, type Actor } from '@/lib/exams/common';
import { scaleFor, type LevelScale } from '@/lib/exams/scales';

export const PANELS = ['overview', 'subjects', 'teachers', 'grades', 'trend', 'top', 'atRisk', 'valueAdded', 'board'] as const;
export type PanelKey = (typeof PANELS)[number];

export const PANEL_TITLE: Record<PanelKey, string> = {
  overview: 'School overview', subjects: 'Subject performance', teachers: 'Teacher comparison', grades: 'Grade distribution', trend: 'Trend',
  top: 'Top students', atRisk: 'At-risk students', valueAdded: 'Value added', board: 'ZIMSEC results',
};

const has = (u: Actor, ...keys: string[]) => (u.roles ?? []).some((r) => keys.includes(r));

/** Which panels a person sees. Everything also needs exams.analytics.view. */
export function panelsFor(u: Actor): PanelKey[] {
  if (!holds(u, 'exams.analytics.view')) return [];
  if (isFull(u) || has(u, 'OWNER', 'ADMINISTRATOR', 'HEAD', 'DEPUTY_HEAD')) return [...PANELS];
  const out = new Set<PanelKey>();
  if (has(u, 'EXAMS_OFFICER')) ['overview', 'grades', 'top', 'trend', 'board', 'subjects'].forEach((p) => out.add(p as PanelKey));
  if (has(u, 'HOD')) ['subjects', 'teachers', 'grades', 'trend', 'top'].forEach((p) => out.add(p as PanelKey));
  if (has(u, 'CLASS_TEACHER')) ['trend', 'atRisk'].forEach((p) => out.add(p as PanelKey));
  if (has(u, 'TEACHER')) out.add('trend');
  return PANELS.filter((p) => out.has(p));
}

export const FiltersSchema = z.object({
  termId: idSchema.optional(),
  levelId: idSchema.optional(),
  classId: idSchema.optional(),
  subjectId: idSchema.optional(),
  gender: z.enum(['M', 'F']).optional(),
  /** A single assessment instead of the term marks. */
  assessmentId: idSchema.optional(),
  /** Before publishing: verified marks, labelled "Not yet published" (Head, Owner and Administrator only). */
  source: z.enum(['published', 'verified']).default('published'),
  studentId: idSchema.optional(),
  sessionId: idSchema.optional(),
});
export type Filters = z.input<typeof FiltersSchema>;

type Cell = string | number | null;
export interface PanelResult {
  panel: PanelKey;
  title: string;
  term: string;
  label: string;
  notYetPublished: boolean;
  columns: string[];
  rows: Cell[][];
  notes: string[];
  /** For the trend panel: points to draw. */
  series?: { name: string; points: { term: string; value: number | null }[] }[];
}

interface Row {
  studentId: string; student: string; gender: string | null; classId: string; className: string; levelId: string; levelName: string; subjectId: string; subject: string;
  departmentId: string | null; assignmentId: string | null; teacherId: string | null; value: number; rounded: number; grade: string | null; published: boolean;
}

interface Ctx {
  tx: Db; user: Actor; schoolId: string; termId: string; termName: string; filters: z.infer<typeof FiltersSchema>;
  scope: { all: boolean; departmentIds: string[]; assignmentIds: string[]; classIds: string[] };
  scales: Map<string, LevelScale>;
  teachers: Map<string, string>;
}

async function scaleOf(c: Ctx, levelId: string, termId = c.termId): Promise<LevelScale> {
  const k = `${levelId}|${termId}`;
  if (!c.scales.has(k)) c.scales.set(k, await scaleFor(c.tx, c.schoolId, levelId, termId));
  return c.scales.get(k)!;
}

/** The subject results of a term as plain rows, filtered, and narrowed to what this person may see. */
async function termRows(c: Ctx, termId: string, opts: { narrow: 'subject' | 'class' | 'assignment' | 'none' }): Promise<Row[]> {
  const f = c.filters;
  const verified = f.source === 'verified';
  const rows = await c.tx.subjectResult.findMany({
    where: {
      schoolId: c.schoolId, termId, ...(verified ? {} : { published: true }),
      ...(f.levelId ? { levelId: f.levelId } : {}), ...(f.classId ? { classId: f.classId } : {}), ...(f.subjectId ? { subjectId: f.subjectId } : {}),
      ...(f.gender ? { student: { gender: f.gender } } : {}),
    },
    include: { student: { select: { fullName: true, gender: true } }, subject: { select: { name: true, departmentId: true } }, class: { select: { name: true, level: { select: { id: true, name: true } } } } },
  });
  const assignmentIds = Array.from(new Set(rows.map((r) => r.assignmentId).filter((x): x is string => !!x)));
  const tas = assignmentIds.length ? await c.tx.teacherAssignment.findMany({ where: { id: { in: assignmentIds } }, select: { id: true, teacherId: true } }) : [];
  const teacherOf = new Map(tas.map((t) => [t.id, t.teacherId]));
  let out = rows.map<Row>((r) => ({
    studentId: r.studentId, student: r.student.fullName, gender: r.student.gender, classId: r.classId, className: r.class.name, levelId: r.levelId, levelName: r.class.level.name, subjectId: r.subjectId,
    subject: r.subject.name, departmentId: r.subject.departmentId, assignmentId: r.assignmentId, teacherId: r.assignmentId ? teacherOf.get(r.assignmentId) ?? null : null,
    value: num(r.termMark)!, rounded: r.roundedMark, grade: r.grade, published: r.published,
  }));
  if (!c.scope.all) {
    if (opts.narrow === 'subject') out = out.filter((r) => r.departmentId && c.scope.departmentIds.includes(r.departmentId));
    else if (opts.narrow === 'class') out = out.filter((r) => c.scope.classIds.includes(r.classId));
    else if (opts.narrow === 'assignment') out = out.filter((r) => (r.assignmentId && c.scope.assignmentIds.includes(r.assignmentId)) || c.scope.classIds.includes(r.classId));
  }
  return out;
}

/** A single assessment's marks as rows: the percentage, graded with the level's scale (AB and NS count as 0, EX is left out). */
async function assessmentRows(c: Ctx): Promise<Row[]> {
  const f = c.filters;
  const a = await c.tx.assessment.findFirst({ where: { id: f.assessmentId!, schoolId: c.schoolId }, select: { id: true, maxMark: true, subjectId: true, levelId: true, termId: true, subject: { select: { name: true, departmentId: true } }, level: { select: { name: true } } } });
  if (!a) throw new ServiceError('Assessment not found', 404);
  const marks = await c.tx.assessmentMark.findMany({
    where: { schoolId: c.schoolId, assessmentId: a.id, assignment: { markSheets: { some: { termId: a.termId, status: f.source === 'verified' ? { in: ['VERIFIED', 'PUBLISHED'] } : 'PUBLISHED' } } }, ...(f.gender ? { student: { gender: f.gender } } : {}) },
    include: { student: { select: { fullName: true, gender: true } }, assignment: { select: { id: true, teacherId: true, classId: true, class: { select: { name: true } }, group: { select: { name: true } } } } },
  });
  const scale = await scaleOf(c, a.levelId, a.termId);
  const max = num(a.maxMark)!;
  const out: Row[] = [];
  for (const m of marks) {
    if (m.code === 'EX' || m.code === 'AB_EXCUSED' || (m.value === null && m.code === null)) continue;
    const value = m.value !== null ? round2((num(m.value)! / max) * 100) : 0;
    const rounded = Math.floor(value + 0.5);
    out.push({
      studentId: m.studentId, student: m.student.fullName, gender: m.student.gender, classId: m.assignment.classId ?? m.assignment.id, className: m.assignment.class?.name ?? m.assignment.group?.name ?? '', levelId: a.levelId, levelName: a.level.name,
      subjectId: a.subjectId, subject: a.subject.name, departmentId: a.subject.departmentId, assignmentId: m.assignmentId, teacherId: m.assignment.teacherId, value, rounded, grade: gradeOf(rounded, scale.scale).grade, published: f.source !== 'verified',
    });
  }
  let rows = out;
  if (f.classId) rows = rows.filter((r) => r.classId === f.classId);
  if (f.subjectId) rows = rows.filter((r) => r.subjectId === f.subjectId);
  if (!c.scope.all) rows = rows.filter((r) => (r.departmentId && c.scope.departmentIds.includes(r.departmentId)) || (r.assignmentId && c.scope.assignmentIds.includes(r.assignmentId)));
  return rows;
}

const mean = (xs: number[]) => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

async function summarise(c: Ctx, rows: Row[], termId?: string) {
  const levels = Array.from(new Set(rows.map((r) => r.levelId)));
  const pass = new Map<string, number>();
  for (const l of levels) pass.set(l, (await scaleOf(c, l, termId)).passMark);
  const values = rows.map((r) => r.value);
  const passed = rows.filter((r) => r.rounded >= (pass.get(r.levelId) ?? 50)).length;
  const st = classStats(values, 0);
  return { n: rows.length, mean: st.mean, highest: st.highest, lowest: st.lowest, passRate: rows.length ? round2((passed / rows.length) * 100) : null };
}

// ─── Panels ──────────────────────────────────────────────────────────────────

async function overview(c: Ctx): Promise<Pick<PanelResult, 'columns' | 'rows' | 'notes'>> {
  const prev = await previousTerm(c.tx, c.schoolId, await c.tx.academicTerm.findFirstOrThrow({ where: { id: c.termId }, select: { id: true, startDate: true } }));
  const now = await termRows(c, c.termId, { narrow: 'none' });
  const before = prev ? await termRows(c, prev.id, { narrow: 'none' }) : [];
  const levels = Array.from(new Map(now.concat(before).map((r) => [r.levelId, r.levelName])).entries());
  const rows: Cell[][] = [];
  for (const [id, name] of levels) {
    const a = await summarise(c, now.filter((r) => r.levelId === id));
    const b = prev ? await summarise(c, before.filter((r) => r.levelId === id), prev.id) : null;
    rows.push([name, a.n ? a.mean : null, a.passRate, b?.mean ?? null, b?.passRate ?? null, a.mean !== null && b?.mean != null ? round2(a.mean - b.mean) : null, a.n]);
  }
  rows.sort((x, y) => String(x[0]).localeCompare(String(y[0]), 'en', { numeric: true }));
  return { columns: ['Form', 'Average % (this term)', 'Pass rate % (this term)', `Average % (${prev?.name ?? 'last term'})`, `Pass rate % (${prev?.name ?? 'last term'})`, 'Change in average', 'Results counted'], rows, notes: prev ? [] : ['There is no earlier term to compare with.'] };
}

async function subjects(c: Ctx): Promise<Pick<PanelResult, 'columns' | 'rows' | 'notes'>> {
  const rows = c.filters.assessmentId ? await assessmentRows(c) : await termRows(c, c.termId, { narrow: 'subject' });
  const grades = Array.from(new Set(rows.map((r) => r.grade).filter((g): g is string => !!g))).sort();
  const out: Cell[][] = [];
  const keys = Array.from(new Map(rows.map((r) => [`${r.subjectId}|${r.levelId}`, r])).values()).sort((a, b) => a.subject.localeCompare(b.subject) || a.levelName.localeCompare(b.levelName, 'en', { numeric: true }));
  for (const k of keys) {
    const mine = rows.filter((r) => r.subjectId === k.subjectId && r.levelId === k.levelId);
    const s = await summarise(c, mine);
    out.push([k.subject, k.levelName, 'All classes', s.n, s.mean, s.passRate, s.highest, s.lowest, ...grades.map((g) => mine.filter((r) => r.grade === g).length)]);
    const classes = Array.from(new Map(mine.map((r) => [r.classId, r.className])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
    if (classes.length > 1) for (const [cid, cname] of classes) {
      const cs = mine.filter((r) => r.classId === cid);
      const t = await summarise(c, cs);
      out.push([k.subject, k.levelName, cname, t.n, t.mean, t.passRate, t.highest, t.lowest, ...grades.map((g) => cs.filter((r) => r.grade === g).length)]);
    }
  }
  return { columns: ['Subject', 'Form', 'Class', 'Students', 'Mean %', 'Pass rate %', 'Highest', 'Lowest', ...grades.map((g) => `Grade ${g}`)], rows: out, notes: [] };
}

async function teachers(c: Ctx): Promise<Pick<PanelResult, 'columns' | 'rows' | 'notes'>> {
  const rows = c.filters.assessmentId ? await assessmentRows(c) : await termRows(c, c.termId, { narrow: 'subject' });
  const out: Cell[][] = [];
  const keys = Array.from(new Map(rows.map((r) => [`${r.subjectId}|${r.levelId}`, r])).values()).sort((a, b) => a.subject.localeCompare(b.subject) || a.levelName.localeCompare(b.levelName, 'en', { numeric: true }));
  for (const k of keys) {
    const mine = rows.filter((r) => r.subjectId === k.subjectId && r.levelId === k.levelId);
    const form = await summarise(c, mine);
    const by = Array.from(new Map(mine.map((r) => [`${r.assignmentId}|${r.classId}`, r])).values());
    for (const a of by) {
      const cs = mine.filter((r) => r.assignmentId === a.assignmentId && r.classId === a.classId);
      const s = await summarise(c, cs);
      out.push([k.subject, k.levelName, a.className, a.teacherId ? c.teachers.get(a.teacherId) ?? '' : '', s.n, s.mean, s.passRate, s.mean !== null && form.mean !== null ? round2(s.mean - form.mean) : null, form.mean]);
    }
  }
  return { columns: ['Subject', 'Form', 'Class', 'Teacher', 'Students', 'Mean %', 'Pass rate %', 'Difference from the form mean', 'Form mean %'], rows: out, notes: ['Every class of a subject is compared with the mean of all classes of that subject in the form.'] };
}

async function gradeDistribution(c: Ctx): Promise<Pick<PanelResult, 'columns' | 'rows' | 'notes'>> {
  const rows = c.filters.assessmentId ? await assessmentRows(c) : await termRows(c, c.termId, { narrow: c.scope.all ? 'none' : 'subject' });
  const grades = Array.from(new Set(rows.map((r) => r.grade).filter((g): g is string => !!g))).sort();
  const out: Cell[][] = [];
  const keys = Array.from(new Map(rows.map((r) => [`${r.subjectId}|${r.levelId}`, r])).values()).sort((a, b) => a.levelName.localeCompare(b.levelName, 'en', { numeric: true }) || a.subject.localeCompare(b.subject));
  for (const k of keys) {
    const mine = rows.filter((r) => r.subjectId === k.subjectId && r.levelId === k.levelId);
    out.push([k.levelName, k.subject, mine.length, ...grades.map((g) => mine.filter((r) => r.grade === g).length)]);
  }
  return { columns: ['Form', 'Subject', 'Students', ...grades.map((g) => `Grade ${g}`)], rows: out, notes: [] };
}

async function top(c: Ctx): Promise<Pick<PanelResult, 'columns' | 'rows' | 'notes'>> {
  const f = c.filters;
  const out: Cell[][] = [];
  // By form: the best overall averages.
  const tr = await c.tx.termResult.findMany({
    where: { schoolId: c.schoolId, termId: c.termId, classId: { not: null }, ...(f.source === 'verified' ? {} : { published: true }), ...(f.levelId ? { class: { levelId: f.levelId } } : {}), ...(f.classId ? { classId: f.classId } : {}), ...(f.gender ? { student: { gender: f.gender } } : {}) },
    include: { student: { select: { fullName: true } }, class: { select: { name: true, level: { select: { id: true, name: true } } } } },
  });
  const byLevel = new Map<string, typeof tr>();
  for (const r of tr) (byLevel.get(r.class!.level.name) ?? byLevel.set(r.class!.level.name, []).get(r.class!.level.name)!).push(r);
  for (const [level, list] of Array.from(byLevel).sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))) {
    const sorted = [...list].sort((a, b) => (num(b.averagePercentage) ?? 0) - (num(a.averagePercentage) ?? 0));
    let place = 0;
    let last = Infinity;
    sorted.forEach((r, i) => { const v = num(r.averagePercentage)!; if (v !== last) { place = i + 1; last = v; } if (place <= 10) out.push([`${level}: overall`, place, r.student.fullName, r.class!.name, v]); });
  }
  // By subject.
  const rows = await termRows(c, c.termId, { narrow: c.scope.all ? 'none' : 'subject' });
  const keys = Array.from(new Map(rows.map((r) => [`${r.subjectId}|${r.levelId}`, r])).values()).sort((a, b) => a.levelName.localeCompare(b.levelName, 'en', { numeric: true }) || a.subject.localeCompare(b.subject));
  for (const k of keys) {
    const sorted = rows.filter((r) => r.subjectId === k.subjectId && r.levelId === k.levelId).sort((a, b) => b.value - a.value);
    let place = 0;
    let last = Infinity;
    sorted.forEach((r, i) => { if (r.value !== last) { place = i + 1; last = r.value; } if (place <= 10) out.push([`${k.levelName}: ${k.subject}`, place, r.student, r.className, r.value]); });
  }
  return { columns: ['List', 'Position', 'Student', 'Class', 'Mark %'], rows: out, notes: ['The top 10 positions of each list; students on equal marks share a position.'] };
}

async function trend(c: Ctx): Promise<{ columns: string[]; rows: Cell[][]; notes: string[]; series: NonNullable<PanelResult['series']> }> {
  const f = c.filters;
  const terms = await c.tx.academicTerm.findMany({ where: { schoolId: c.schoolId }, orderBy: { startDate: 'asc' }, select: { id: true, name: true } });
  const series: NonNullable<PanelResult['series']> = [];
  if (f.studentId) {
    // A student's term marks across terms and years, one line per subject.
    const rows = await c.tx.subjectResult.findMany({ where: { schoolId: c.schoolId, studentId: f.studentId, ...(f.source === 'verified' ? {} : { published: true }) }, include: { subject: { select: { name: true } } } });
    if (!c.scope.all && !rows.every((r) => c.scope.classIds.includes(r.classId) || (r.assignmentId && c.scope.assignmentIds.includes(r.assignmentId)))) throw new ServiceError('Student not found', 404);
    const names = Array.from(new Set(rows.map((r) => r.subject.name))).sort();
    for (const n of names) series.push({ name: n, points: terms.map((t) => ({ term: t.name, value: rows.find((r) => r.termId === t.id && r.subject.name === n) ? num(rows.find((r) => r.termId === t.id && r.subject.name === n)!.termMark) : null })) });
    const avg = await c.tx.termResult.findMany({ where: { schoolId: c.schoolId, studentId: f.studentId, ...(f.source === 'verified' ? {} : { published: true }) } });
    series.unshift({ name: 'Overall average', points: terms.map((t) => ({ term: t.name, value: num(avg.find((a) => a.termId === t.id)?.averagePercentage ?? null) })) });
  } else {
    // A subject's mean across terms and years (or the whole school's when no subject is chosen).
    const where = { schoolId: c.schoolId, ...(f.source === 'verified' ? {} : { published: true }), ...(f.levelId ? { levelId: f.levelId } : {}), ...(f.classId ? { classId: f.classId } : {}), ...(f.subjectId ? { subjectId: f.subjectId } : {}), ...(f.gender ? { student: { gender: f.gender } } : {}) };
    const rows = await c.tx.subjectResult.findMany({ where, select: { termId: true, termMark: true, subjectId: true, classId: true, assignmentId: true, subject: { select: { name: true, departmentId: true } } } });
    const visible = c.scope.all ? rows : rows.filter((r) => (r.assignmentId && c.scope.assignmentIds.includes(r.assignmentId)) || c.scope.classIds.includes(r.classId) || (r.subject.departmentId && c.scope.departmentIds.includes(r.subject.departmentId)));
    const bySubject = new Map<string, typeof visible>();
    for (const r of visible) (bySubject.get(r.subject.name) ?? bySubject.set(r.subject.name, []).get(r.subject.name)!).push(r);
    if (f.subjectId || bySubject.size === 1) {
      for (const [name, list] of Array.from(bySubject)) series.push({ name, points: terms.map((t) => ({ term: t.name, value: mean(list.filter((r) => r.termId === t.id).map((r) => num(r.termMark)!)) })) });
    } else {
      series.push({ name: 'All subjects', points: terms.map((t) => ({ term: t.name, value: mean(visible.filter((r) => r.termId === t.id).map((r) => num(r.termMark)!)) })) });
      for (const [name, list] of Array.from(bySubject).sort((a, b) => a[0].localeCompare(b[0])).slice(0, 12)) series.push({ name, points: terms.map((t) => ({ term: t.name, value: mean(list.filter((r) => r.termId === t.id).map((r) => num(r.termMark)!)) })) });
    }
  }
  return { columns: ['Term', ...series.map((s) => s.name)], rows: terms.map((t, i) => [t.name, ...series.map((s) => s.points[i]?.value ?? null)]).filter((r) => r.slice(1).some((v) => v !== null)), notes: ['The mean term mark across the terms and years the school has results for.'], series };
}

async function atRisk(c: Ctx): Promise<Pick<PanelResult, 'columns' | 'rows' | 'notes'>> {
  const f = c.filters;
  const settings = await c.tx.examSettings.findUnique({ where: { schoolId: c.schoolId } });
  const required = settings?.passesRequired ?? 5;
  const prev = await previousTerm(c.tx, c.schoolId, await c.tx.academicTerm.findFirstOrThrow({ where: { id: c.termId }, select: { id: true, startDate: true } }));
  const trs = await c.tx.termResult.findMany({
    where: { schoolId: c.schoolId, termId: c.termId, classId: { not: null }, ...(f.source === 'verified' ? {} : { published: true }), ...(f.levelId ? { class: { levelId: f.levelId } } : {}), ...(f.classId ? { classId: f.classId } : {}), ...(f.gender ? { student: { gender: f.gender } } : {}), ...(c.scope.all ? {} : { classId: { in: c.scope.classIds } }) },
    include: { student: { select: { fullName: true } }, class: { select: { name: true, level: { select: { id: true, name: true, category: true } } } } },
  });
  const ids = trs.map((t) => t.studentId);
  const subj = ids.length ? await c.tx.subjectResult.findMany({ where: { schoolId: c.schoolId, termId: c.termId, studentId: { in: ids } }, select: { studentId: true, roundedMark: true, levelId: true } }) : [];
  const prevAvg = prev && ids.length ? new Map((await c.tx.termResult.findMany({ where: { schoolId: c.schoolId, termId: prev.id, studentId: { in: ids }, published: true }, select: { studentId: true, averagePercentage: true } })).map((p) => [p.studentId, num(p.averagePercentage)])) : new Map<string, number | null>();
  // Attendance next to it: days present of the days the class register was taken this term.
  const regs = ids.length ? await c.tx.attendanceRegister.findMany({ where: { schoolId: c.schoolId, termId: c.termId, session: 'AM', slotId: null, classId: { in: Array.from(new Set(trs.map((t) => t.classId!))) } }, select: { id: true, classId: true } }) : [];
  const entries = regs.length ? await c.tx.attendanceEntry.findMany({ where: { schoolId: c.schoolId, registerId: { in: regs.map((r) => r.id) }, studentId: { in: ids } }, select: { studentId: true, status: true, register: { select: { classId: true } } } }) : [];
  const out: Cell[][] = [];
  for (const t of trs) {
    const scale = await scaleOf(c, t.class!.level.id);
    const marks = subj.filter((s) => s.studentId === t.studentId);
    const failed = marks.filter((m) => m.roundedMark < scale.passMark).length;
    const avg = num(t.averagePercentage);
    const before = prevAvg.get(t.studentId) ?? num(t.previousAverage);
    const drop = avg !== null && before != null ? round2(before - avg) : null;
    const reasons: string[] = [];
    if (drop !== null && drop >= 10) reasons.push(`Dropped ${drop} points since last term`);
    if (failed >= 3) reasons.push(`Failed ${failed} subjects`);
    if (t.class!.level.category === 'O_LEVEL' && t.fivePassesEngMaths === false) reasons.push(`Below the ${required}-passes line (${t.subjectsPassed ?? 0} passes)`);
    if (!reasons.length) continue;
    const mine = entries.filter((e) => e.studentId === t.studentId);
    const total = regs.filter((r) => r.classId === t.classId).length;
    const present = mine.filter((e) => e.status === 'PRESENT' || e.status === 'LATE').length;
    out.push([t.student.fullName, t.class!.name, avg, before ?? null, drop, failed, t.subjectsPassed ?? null, total ? round2((present / total) * 100) : null, reasons.join('; ')]);
  }
  out.sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'en', { numeric: true }) || String(a[0]).localeCompare(String(b[0])));
  return { columns: ['Student', 'Class', 'Average %', 'Last term %', 'Drop', 'Subjects failed', 'Passes', 'Attendance %', 'Why'], rows: out, notes: ['Dropped 10 points or more since last term, failed 3 or more subjects, or below the O Level passes line (including English and Mathematics). Attendance is from the class register.'] };
}

async function valueAdded(c: Ctx): Promise<Pick<PanelResult, 'columns' | 'rows' | 'notes'>> {
  const f = c.filters;
  const trs = await c.tx.termResult.findMany({
    where: { schoolId: c.schoolId, termId: c.termId, classId: { not: null }, ...(f.source === 'verified' ? {} : { published: true }), ...(f.levelId ? { class: { levelId: f.levelId } } : {}) },
    include: { student: { select: { entryType: true, entryResults: true } }, class: { select: { name: true, level: { select: { id: true, name: true } } } } },
  });
  // Entry measure: Grade 7 units for Form 1 (fewer is better, so negated); O Level points for Lower 6.
  const rows = trs.flatMap((t) => {
    const e = (t.student.entryResults ?? {}) as { grade7Units?: number; oLevelPoints?: number };
    const x = e.grade7Units !== undefined ? -e.grade7Units : e.oLevelPoints !== undefined ? e.oLevelPoints : null;
    const y = num(t.averagePercentage);
    return x !== null && y !== null ? [{ level: t.class!.level.name, classId: t.classId!, className: t.class!.name, x, y, kind: e.grade7Units !== undefined ? 'Grade 7 units' : 'O Level points' }] : [];
  });
  const out: Cell[][] = [];
  const notes = ['Entry results (Grade 7 units for Form 1, O Level points for Lower 6) against current results. The expected result comes from the line that best fits the whole form; a class above the line adds value.'];
  for (const level of Array.from(new Set(rows.map((r) => r.level))).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    const pts = rows.filter((r) => r.level === level);
    if (pts.length < 5) { notes.push(`${level}: too few students with entry results to fit a line.`); continue; }
    const mx = mean(pts.map((p) => p.x))!;
    const my = mean(pts.map((p) => p.y))!;
    const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
    const slope = sxx === 0 ? 0 : pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx;
    const intercept = my - slope * mx;
    for (const cid of Array.from(new Set(pts.map((p) => p.classId)))) {
      const cs = pts.filter((p) => p.classId === cid);
      const expected = mean(cs.map((p) => intercept + slope * p.x))!;
      const actual = mean(cs.map((p) => p.y))!;
      out.push([level, cs[0]!.className, cs.length, cs[0]!.kind, mean(cs.map((p) => (cs[0]!.kind === 'Grade 7 units' ? -p.x : p.x))), expected, actual, round2(actual - expected)]);
    }
  }
  return { columns: ['Form', 'Class', 'Students', 'Entry measure', 'Mean at entry', 'Expected average %', 'Actual average %', 'Value added'], rows: out, notes };
}

async function board(c: Ctx): Promise<Pick<PanelResult, 'columns' | 'rows' | 'notes'>> {
  const f = c.filters;
  const sessions = await c.tx.boardSession.findMany({ where: { schoolId: c.schoolId, ...(f.sessionId ? { id: f.sessionId } : {}) }, orderBy: { createdAt: 'desc' }, take: f.sessionId ? 1 : 4 });
  const settings = await c.tx.examSettings.findUnique({ where: { schoolId: c.schoolId } });
  const out: Cell[][] = [];
  const notes: string[] = [];
  for (const s of sessions) {
    const results = await c.tx.boardResult.findMany({ where: { sessionId: s.id, schoolId: c.schoolId, ...(f.gender ? { student: { gender: f.gender } } : {}) }, include: { code: { select: { code: true, name: true, subjectId: true } } } });
    if (results.length === 0) { notes.push(`${s.board} ${s.session}: no results loaded yet.`); continue; }
    const pass = new Set(s.passGrades.map((g) => g.toUpperCase()));
    const label = `${s.board} ${s.session}`;
    const bySubject = new Map<string, typeof results>();
    for (const r of results) (bySubject.get(r.code.code) ?? bySubject.set(r.code.code, []).get(r.code.code)!).push(r);
    // The school's own mock results for the same subject, for comparison.
    const mocks = await c.tx.assessmentMark.findMany({ where: { schoolId: c.schoolId, assessment: { type: { name: 'Mock exam' } }, value: { not: null }, studentId: { in: results.map((r) => r.studentId).filter((x): x is string => !!x) } }, select: { value: true, assessment: { select: { subjectId: true, maxMark: true } } } });
    for (const [code, list] of Array.from(bySubject).sort((a, b) => a[0].localeCompare(b[0]))) {
      const passed = list.filter((r) => pass.has(r.grade)).length;
      const subjectId = list[0]!.code.subjectId;
      const mine = subjectId ? mocks.filter((m) => m.assessment.subjectId === subjectId).map((m) => (num(m.value)! / num(m.assessment.maxMark)!) * 100) : [];
      out.push([label, code, list[0]!.code.name, list.length, round2((passed / list.length) * 100), mean(mine), ...['A', 'B', 'C', 'D', 'E', 'U'].map((g) => list.filter((r) => r.grade === g).length)]);
    }
    // Whole-candidate figures.
    const byCand = new Map<string, typeof results>();
    for (const r of results) (byCand.get(r.candidateNumber) ?? byCand.set(r.candidateNumber, []).get(r.candidateNumber)!).push(r);
    const english = settings?.englishSubjectId; const maths = settings?.mathsSubjectId;
    if (s.category === 'O_LEVEL') {
      const need = settings?.passesRequired ?? 5;
      const ok = Array.from(byCand.values()).filter((rs) => rs.filter((r) => pass.has(r.grade)).length >= need && (!english || rs.some((r) => r.code.subjectId === english && pass.has(r.grade))) && (!maths || rs.some((r) => r.code.subjectId === maths && pass.has(r.grade)))).length;
      out.push([label, `${need}+ passes incl. English & Maths`, '', byCand.size, byCand.size ? round2((ok / byCand.size) * 100) : null, null, null, null, null, null, null, null]);
    } else {
      const pts = (s.gradePoints ?? { A: 5, B: 4, C: 3, D: 2, E: 1 }) as Record<string, number>;
      const totals = Array.from(byCand.values()).map((rs) => rs.map((r) => pts[r.grade] ?? 0).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0));
      out.push([label, 'A Level points (best 3)', '', byCand.size, null, mean(totals), null, null, null, null, null, null]);
    }
  }
  return { columns: ['Session', 'Subject code', 'Subject', 'Candidates', 'Pass rate %', 'Own mock mean % / points', 'A', 'B', 'C', 'D', 'E', 'U'], rows: out, notes: [...notes, 'Compared with the school\'s own mock exam results for the same subject, and with the earlier sessions listed.'] };
}

// ─── The one entry point ─────────────────────────────────────────────────────

export async function analyticsPanel(user: Actor, panel: PanelKey, rawFilters: Filters = {}): Promise<PanelResult> {
  const filters = FiltersSchema.parse(rawFilters);
  if (!panelsFor(user).includes(panel)) throw new ServiceError('Forbidden', 403);
  const mayVerified = isFull(user) || has(user, 'HEAD') || holds(user, 'exams.results.publish');
  if (filters.source === 'verified' && !mayVerified) throw new ServiceError('Only the Head can look at results that are not yet published', 403);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const term = await resolveTerm(tx, sid, filters.termId);
    const own = await ownScope(tx, user, term.id);
    const people = await tx.user.findMany({ where: { schoolId: sid, teachingAssignments: { some: { termId: term.id } } }, select: { id: true, fullName: true } });
    const c: Ctx = {
      tx, user, schoolId: sid, termId: term.id, termName: term.name, filters,
      scope: { all: isFull(user) || has(user, 'HEAD', 'DEPUTY_HEAD', 'EXAMS_OFFICER', 'OWNER', 'ADMINISTRATOR'), departmentIds: own.departmentIds, assignmentIds: own.assignmentIds, classIds: Array.from(new Set([...own.classTeacherOf, ...(panel === 'trend' ? own.taughtClasses : [])])) },
      scales: new Map(), teachers: new Map(people.map((p) => [p.id, p.fullName])),
    };
    // A class teacher's own class reaches the at-risk panel; a HOD is narrowed to the department by the panel itself.
    if (!c.scope.all && panel === 'atRisk' && !has(user, 'CLASS_TEACHER')) throw new ServiceError('Forbidden', 403);
    const body = panel === 'overview' ? await overview(c) : panel === 'subjects' ? await subjects(c) : panel === 'teachers' ? await teachers(c) : panel === 'grades' ? await gradeDistribution(c)
      : panel === 'top' ? await top(c) : panel === 'trend' ? await trend(c) : panel === 'atRisk' ? await atRisk(c) : panel === 'valueAdded' ? await valueAdded(c) : await board(c);
    const notYet = filters.source === 'verified';
    return {
      panel, title: PANEL_TITLE[panel], term: term.name, notYetPublished: notYet, ...body,
      label: filters.assessmentId ? 'A single assessment' : panel === 'board' ? 'Board results' : notYet ? 'Not yet published: verified marks' : 'Published results',
      notes: [...body.notes, ...(notYet ? ['These are verified marks that have not been published. Do not share them.'] : [])],
    };
  });
}

/** The panels as an Excel workbook, as shown. */
export async function panelXlsx(user: Actor, panel: PanelKey, filters: Filters = {}): Promise<{ fileName: string; buffer: Buffer }> {
  const p = await analyticsPanel(user, panel, filters);
  await getScopedDb(user.schoolId, user.id).$tx((tx) => logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'EXPORT_ACADEMICS', entityType: 'ExamAnalytics', entityId: panel, detail: `Exported ${p.title}, ${p.term}${p.notYetPublished ? ' (not yet published)' : ''}` }, tx));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(p.title.slice(0, 30));
  ws.addRow([`${p.title}: ${p.term}`]);
  ws.getRow(1).font = { bold: true, size: 13 };
  ws.addRow([p.notYetPublished ? 'NOT YET PUBLISHED' : p.label]);
  ws.addRow([]);
  const head = ws.addRow(p.columns);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14613F' } };
  for (const r of p.rows) ws.addRow(r);
  ws.columns.forEach((col, i) => { col.width = i === 0 ? 26 : 16; });
  return { fileName: `${p.title} ${p.term}.xlsx`.replace(/[^A-Za-z0-9._ -]/g, '-'), buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
}

/** The one-page results summary for staff and board meetings: the overview, the subjects that need attention and the top of each form. */
export async function resultsSummary(user: Actor, filters: Filters = {}): Promise<{ term: string; school: string; panels: PanelResult[]; label: string }> {
  const allowed = panelsFor(user);
  const picks = (['overview', 'subjects', 'top'] as const).filter((p) => allowed.includes(p));
  if (picks.length === 0) throw new ServiceError('Forbidden', 403);
  const panels: PanelResult[] = [];
  for (const p of picks) panels.push(await analyticsPanel(user, p, filters));
  const school = await getScopedDb(user.schoolId, user.id).school.findUnique({ where: { id: user.schoolId }, select: { name: true } });
  return { term: panels[0]!.term, school: school?.name ?? '', panels, label: panels[0]!.notYetPublished ? 'Not yet published' : 'Published results' };
}

