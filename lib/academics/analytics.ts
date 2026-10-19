// Academic analytics: one page answers the Head's weekly questions — are students attending, are teachers covering the
// syllabus, is the teaching load fair. Filters: term, form, class, department. Every panel exports to CSV. A head of
// department sees the department-level panels (coverage, schemes, load, gaps) for their own department only.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { toCsv, type CsvCell } from '@/lib/csv';
import { getScopedDb } from '@/lib/scoped-db';
import { idSchema, isoOf, resolveTerm, todayInHarare, weekdayOf, DAY_NAMES, addDays, type Actor } from '@/lib/academics/common';
import { attendanceRate } from '@/lib/academics/attendance';
import { findGaps } from '@/lib/academics/coverage';
import { departmentScope, coveragePercent } from '@/lib/academics/curriculum';
import { schoolDaysOf } from '@/lib/academics/school-days';
import { teacherWorkload } from '@/lib/academics/assignments';
import { loadPlan } from '@/lib/academics/timetable';
import { placedReport } from '@/lib/academics/timetable-rules';

export const FilterSchema = z.object({
  termId: idSchema.optional(),
  formId: idSchema.optional(),
  classId: idSchema.optional(),
  departmentId: idSchema.optional(),
});
export type AnalyticsFilter = z.input<typeof FilterSchema>;

export const PANELS = ['attendance', 'chronic', 'compliance', 'groups', 'coverage', 'schemes', 'load', 'gaps'] as const;
export type Panel = (typeof PANELS)[number];

type Counts = { present: number; late: number; absent: number; excused: number };
const zero = (): Counts => ({ present: 0, late: 0, absent: 0, excused: 0 });
const add = (c: Counts, status: string, n: number) => {
  if (status === 'PRESENT') c.present += n; else if (status === 'LATE') c.late += n; else if (status === 'ABSENT') c.absent += n; else if (status === 'EXCUSED') c.excused += n;
};
const rate = (c: Counts) => attendanceRate(c);
const weekMonday = (iso: string) => addDays(iso, -(weekdayOf(iso) - 1));

export async function analytics(user: Actor, rawFilter: AnalyticsFilter = {}) {
  const f = FilterSchema.parse(rawFilter);
  const db = getScopedDb(user.schoolId, user.id);
  const termRow = await db.academicTerm.findFirst({ where: f.termId ? { id: f.termId } : { status: 'OPEN' } });
  if (!termRow) throw new ServiceError(f.termId ? 'Term not found' : 'No term is open', f.termId ? 404 : 409);
  const today = todayInHarare();
  const days = await schoolDaysOf(db, user, termRow, { to: today });
  // The load is read school-wide here; the panel below keeps only the teachers the person's department scope covers.
  const loadAll = await teacherWorkload({ ...user, grants: ['*'] }, termRow.id);

  return db.$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termRow.id);
    const scope = await departmentScope(tx, user);
    const wide = scope === 'ALL';
    const departmentId = wide ? f.departmentId : (f.departmentId && scope.includes(f.departmentId) ? f.departmentId : scope[0]);
    const deptFilter = wide ? (f.departmentId ? [f.departmentId] : null) : (f.departmentId && scope.includes(f.departmentId) ? [f.departmentId] : scope);
    const settings = await tx.academicsSettings.findUnique({ where: { schoolId: user.schoolId } });
    const threshold = settings?.attendanceThresholdPct ?? 90;
    const streakDays = settings?.consecutiveAbsentDays ?? 3;

    const [forms, classesAll, departments] = await Promise.all([
      tx.level.findMany({ where: { active: true }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
      tx.schoolClass.findMany({ where: { active: true, level: { active: true } }, orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }], select: { id: true, name: true, levelId: true } }),
      tx.department.findMany({ where: wide ? {} : { id: { in: scope } }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ]);
    const classIds = classesAll.filter((c) => (!f.formId || c.levelId === f.formId) && (!f.classId || c.id === f.classId)).map((c) => c.id);
    const className = new Map(classesAll.map((c) => [c.id, c.name]));
    const classLevel = new Map(classesAll.map((c) => [c.id, c.levelId]));
    const formName = new Map(forms.map((x) => [x.id, x.name]));

    // ── Attendance panels (school-wide people only) ─────────────────────────
    let attendance = null, chronic = null, compliance = null, groups = null;
    if (wide) {
      const regs = await tx.attendanceRegister.findMany({ where: { termId: term.id, classId: { in: classIds }, session: 'AM', slotId: null }, select: { id: true, classId: true, date: true, markedAt: true, markedById: true } });
      const regById = new Map(regs.map((r) => [r.id, r]));
      const entries = await tx.attendanceEntry.findMany({
        where: { registerId: { in: regs.map((r) => r.id) }, status: { in: ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] } },
        select: { registerId: true, studentId: true, status: true, student: { select: { fullName: true, gender: true, boarding: true } } },
      });

      const byClass = new Map<string, Counts>(), byForm = new Map<string, Counts>(), byWeek = new Map<string, Counts>();
      const byStudent = new Map<string, { name: string; classId: string; counts: Counts; marks: { date: string; status: string }[] }>();
      const bySex = new Map<string, Counts>(), byBoarding = new Map<string, Counts>(), byDay = new Map<string, Counts>();
      for (const e of entries) {
        const r = regById.get(e.registerId)!;
        const date = isoOf(r.date), cid = r.classId!;
        add(byClass.get(cid) ?? byClass.set(cid, zero()).get(cid)!, e.status, 1);
        const fid = classLevel.get(cid)!;
        add(byForm.get(fid) ?? byForm.set(fid, zero()).get(fid)!, e.status, 1);
        const wk = weekMonday(date);
        add(byWeek.get(wk) ?? byWeek.set(wk, zero()).get(wk)!, e.status, 1);
        const st = byStudent.get(e.studentId) ?? byStudent.set(e.studentId, { name: e.student.fullName, classId: cid, counts: zero(), marks: [] }).get(e.studentId)!;
        add(st.counts, e.status, 1);
        st.marks.push({ date, status: e.status });
        add(bySex.get(e.student.gender ?? '?') ?? bySex.set(e.student.gender ?? '?', zero()).get(e.student.gender ?? '?')!, e.status, 1);
        add(byBoarding.get(e.student.boarding) ?? byBoarding.set(e.student.boarding, zero()).get(e.student.boarding)!, e.status, 1);
        const dn = DAY_NAMES[weekdayOf(date)]!;
        add(byDay.get(dn) ?? byDay.set(dn, zero()).get(dn)!, e.status, 1);
      }
      const all = zero();
      byClass.forEach((c) => { all.present += c.present; all.late += c.late; all.absent += c.absent; all.excused += c.excused; });
      attendance = {
        overall: rate(all),
        byForm: forms.filter((x) => byForm.has(x.id)).map((x) => ({ id: x.id, form: x.name, rate: rate(byForm.get(x.id)!), ...byForm.get(x.id)! })),
        byClass: classIds.filter((id) => byClass.has(id)).map((id) => ({ id, class: className.get(id)!, form: formName.get(classLevel.get(id)!)!, rate: rate(byClass.get(id)!), ...byClass.get(id)! })),
        trend: Array.from(byWeek).sort(([a], [b]) => a.localeCompare(b)).map(([week, c], i) => ({ week: i + 1, weekStart: week, rate: rate(c) })),
        threshold,
      };

      // Chronic absence: below the threshold, or absent several days in a row right now.
      const phones = await tx.studentGuardian.findMany({ where: { isPrimary: true, studentId: { in: Array.from(byStudent.keys()) } }, select: { studentId: true, guardian: { select: { fullName: true, phone: true } } } });
      const guardian = new Map(phones.map((p) => [p.studentId, p.guardian]));
      chronic = Array.from(byStudent).flatMap(([studentId, s]) => {
        const marks = [...s.marks].sort((a, b) => b.date.localeCompare(a.date));
        let streak = 0;
        for (const m of marks) { if (m.status === 'ABSENT' || m.status === 'EXCUSED') streak++; else break; }
        const r = rate(s.counts);
        const days = s.counts.present + s.counts.late + s.counts.absent + s.counts.excused;
        const low = days >= 5 && r !== null && r < threshold;
        if (!low && streak < streakDays) return [];
        return [{ studentId, student: s.name, class: className.get(s.classId) ?? '', rate: r, daysAbsent: s.counts.absent + s.counts.excused, streak, reason: low && streak >= streakDays ? 'Below threshold and absent in a row' : low ? `Below ${threshold}%` : `Absent ${streak} days in a row`, guardian: guardian.get(studentId)?.fullName ?? null, guardianPhone: guardian.get(studentId)?.phone ?? null }];
      }).sort((a, b) => (a.rate ?? 100) - (b.rate ?? 100));

      // Register compliance: registers marked on the day, by class teacher.
      const teachers = await tx.classTeacher.findMany({ where: { termId: term.id, classId: { in: classIds } }, select: { classId: true, user: { select: { id: true, fullName: true } } } });
      const harare = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      compliance = classIds.map((cid) => {
        const mine = regs.filter((r) => r.classId === cid);
        const marked = new Set(mine.map((r) => isoOf(r.date)));
        const onTime = mine.filter((r) => harare(r.markedAt) === isoOf(r.date)).length;
        const missed = days.filter((d) => !marked.has(d));
        const t = teachers.find((x) => x.classId === cid);
        return { classId: cid, class: className.get(cid)!, classTeacher: t?.user.fullName ?? null, schoolDays: days.length, marked: marked.size, onTime, missed: missed.length, missedDays: missed.slice(-10), onTimePct: days.length ? Math.round((onTime / days.length) * 100) : null };
      });

      groups = {
        gender: Array.from(bySex).map(([k, c]) => ({ group: k === 'M' ? 'Boys' : k === 'F' ? 'Girls' : 'Not stated', rate: rate(c) })),
        boarding: Array.from(byBoarding).map(([k, c]) => ({ group: k === 'BOARDER' ? 'Boarders' : 'Day scholars', rate: rate(c) })),
        dayOfWeek: [1, 2, 3, 4, 5, 6].map((d) => DAY_NAMES[d]!).filter((d) => byDay.has(d)).map((d) => ({ day: d, rate: rate(byDay.get(d)!) })),
      };
    }

    // ── Curriculum panels ───────────────────────────────────────────────────
    const assignWhere = {
      termId: term.id, status: 'ACTIVE' as const,
      ...(deptFilter ? { subject: { departmentId: { in: deptFilter } } } : {}),
      ...(f.classId ? { classId: f.classId } : f.formId ? { OR: [{ class: { levelId: f.formId } }, { group: { levelId: f.formId } }] } : {}),
    };
    const assignments = await tx.teacherAssignment.findMany({
      where: assignWhere,
      include: { subject: { select: { id: true, name: true, shortName: true, department: { select: { id: true, name: true } } } }, class: { select: { name: true } }, group: { select: { name: true } }, teacher: { select: { id: true, fullName: true } },
        schemes: { include: { weeks: { include: { record: { select: { coveredTopicIds: true } } } } } } },
    });
    const dueDate = term.schemeDueDate ? isoOf(term.schemeDueDate) : null;

    const perScheme = assignments.map((a) => {
      const s = a.schemes[0];
      const weeks = (s?.weeks ?? []).map((w) => ({ topicIds: w.topicIds, startDate: isoOf(w.startDate), record: w.record ? { coveredTopicIds: w.record.coveredTopicIds } : null }));
      const cov = coveragePercent(weeks, today);
      const total = new Set(weeks.flatMap((w) => w.topicIds)).size;
      return { a, s, cov, total };
    });
    const sumBy = (key: (x: (typeof perScheme)[number]) => string, label: (x: (typeof perScheme)[number]) => string) => {
      const m = new Map<string, { label: string; due: number; covered: number; planned: number; total: number }>();
      for (const x of perScheme) {
        const k = key(x);
        const e = m.get(k) ?? { label: label(x), due: 0, covered: 0, planned: 0, total: 0 };
        e.due += x.cov.due; e.covered += x.cov.covered; e.total += x.total;
        m.set(k, e);
      }
      return Array.from(m.values()).map((e) => ({ name: e.label, covered: e.covered, due: e.due, coverage: e.due ? Math.round((e.covered / e.due) * 100) : null, plannedByNow: e.total ? Math.round((e.due / e.total) * 100) : null })).sort((a, b) => a.name.localeCompare(b.name));
    };
    const coverage = {
      byDepartment: sumBy((x) => x.a.subject.department?.id ?? 'none', (x) => x.a.subject.department?.name ?? 'No department'),
      bySubject: sumBy((x) => x.a.subject.id, (x) => x.a.subject.name),
      schemes: perScheme.map((x) => ({ assignmentId: x.a.id, subject: x.a.subject.shortName ?? x.a.subject.name, target: x.a.class?.name ?? x.a.group?.name ?? '', teacher: x.a.teacher.fullName, coverage: x.cov.pct, covered: x.cov.covered, due: x.cov.due, plannedByNow: x.total ? Math.round((x.cov.due / x.total) * 100) : null })).sort((a, b) => (a.coverage ?? 101) - (b.coverage ?? 101)),
    };
    const schemes = {
      dueDate,
      counts: {
        total: perScheme.length,
        none: perScheme.filter((x) => !x.s).length, draft: perScheme.filter((x) => x.s?.status === 'DRAFT').length, submitted: perScheme.filter((x) => x.s?.status === 'SUBMITTED').length,
        approved: perScheme.filter((x) => x.s?.status === 'APPROVED').length, returned: perScheme.filter((x) => x.s?.status === 'RETURNED').length,
        late: perScheme.filter((x) => dueDate && dueDate < today && (!x.s || x.s.status === 'DRAFT' || x.s.status === 'RETURNED')).length,
      },
      rows: perScheme.map((x) => ({
        assignmentId: x.a.id, teacher: x.a.teacher.fullName, teacherId: x.a.teacher.id, subject: x.a.subject.shortName ?? x.a.subject.name, target: x.a.class?.name ?? x.a.group?.name ?? '',
        status: x.s?.status ?? 'NONE', late: !!dueDate && dueDate < today && (!x.s || x.s.status === 'DRAFT' || x.s.status === 'RETURNED'),
      })).sort((a, b) => Number(b.late) - Number(a.late) || a.teacher.localeCompare(b.teacher)),
    };

    // ── Teaching load and gaps ──────────────────────────────────────────────
    const load = {
      maxPeriods: loadAll.maxPeriods,
      teachers: loadAll.teachers.filter((t) => !deptFilter || assignments.some((a) => a.teacher.id === t.id)).map((t) => ({ id: t.id, name: t.name, periods: t.periods, pct: t.pct, status: t.status, covers: t.covers })),
    };
    const gapRows = (await findGaps(tx, term.id, classIds));
    const subjectDept = new Map((await tx.subject.findMany({ select: { id: true, departmentId: true } })).map((s) => [s.id, s.departmentId]));
    const plan = await loadPlan(tx, term.id, (await tx.timetable.findFirst({ where: { termId: term.id, status: { in: ['DRAFT', 'PENDING'] } }, select: { id: true } }))?.id ?? (await tx.timetable.findFirst({ where: { termId: term.id, status: 'PUBLISHED' }, select: { id: true } }))?.id ?? null);
    const unplacedAll = placedReport(plan).filter((r) => r.placed < r.needed);
    const wanted = new Set(assignments.map((a) => a.id));
    const gaps = {
      subjects: gapRows.filter((g) => !deptFilter || (subjectDept.get(g.subjectId) && deptFilter.includes(subjectDept.get(g.subjectId)!))),
      unplaced: unplacedAll.filter((r) => wanted.has(r.assignmentId)),
    };

    return {
      term: { id: term.id, name: term.name, status: term.status },
      filters: { termId: term.id, formId: f.formId ?? null, classId: f.classId ?? null, departmentId: departmentId ?? null },
      options: { forms, classes: classesAll.map((c) => ({ id: c.id, name: c.name, formId: c.levelId })), departments },
      scope: wide ? 'SCHOOL' : 'DEPARTMENT', schoolDays: days.length, generatedOn: today,
      attendance, chronic, compliance, groups, coverage, schemes, load, gaps,
    };
  });
}

export type AnalyticsData = Awaited<ReturnType<typeof analytics>>;

const pct = (n: number | null | undefined): CsvCell => (n === null || n === undefined ? '' : n);

/** One panel as CSV rows. */
export function panelCsv(panel: Panel, d: AnalyticsData): { filename: string; csv: string } {
  const f = (name: string) => `${name}-${d.term.name.replace(/\s+/g, '-')}.csv`;
  switch (panel) {
    case 'attendance': return { filename: f('attendance-rate'), csv: toCsv(['Level', 'Name', 'Present %', 'Present', 'Late', 'Absent', 'Excused'], [
      ...(d.attendance?.byForm ?? []).map((r): CsvCell[] => ['Form', r.form, pct(r.rate), r.present, r.late, r.absent, r.excused]),
      ...(d.attendance?.byClass ?? []).map((r): CsvCell[] => ['Class', r.class, pct(r.rate), r.present, r.late, r.absent, r.excused]),
      ...(d.attendance?.trend ?? []).map((r): CsvCell[] => ['Week', `Week ${r.week} (from ${r.weekStart})`, pct(r.rate), '', '', '', '']),
    ]) };
    case 'chronic': return { filename: f('chronic-absence'), csv: toCsv(['Student', 'Class', 'Attendance %', 'Days absent', 'Days in a row', 'Why', 'Guardian', 'Guardian phone'], (d.chronic ?? []).map((r): CsvCell[] => [r.student, r.class, pct(r.rate), r.daysAbsent, r.streak, r.reason, r.guardian, r.guardianPhone])) };
    case 'compliance': return { filename: f('register-compliance'), csv: toCsv(['Class', 'Class teacher', 'School days', 'Registers marked', 'Marked on the day', 'Days missed', 'On time %'], (d.compliance ?? []).map((r): CsvCell[] => [r.class, r.classTeacher, r.schoolDays, r.marked, r.onTime, r.missed, pct(r.onTimePct)])) };
    case 'groups': return { filename: f('attendance-by-group'), csv: toCsv(['Kind', 'Group', 'Present %'], [
      ...(d.groups?.gender ?? []).map((r): CsvCell[] => ['Gender', r.group, pct(r.rate)]), ...(d.groups?.boarding ?? []).map((r): CsvCell[] => ['Boarding', r.group, pct(r.rate)]), ...(d.groups?.dayOfWeek ?? []).map((r): CsvCell[] => ['Day', r.day, pct(r.rate)]),
    ]) };
    case 'coverage': return { filename: f('syllabus-coverage'), csv: toCsv(['Level', 'Name', 'Covered', 'Due by now', 'Coverage %', 'Planned by now %'], [
      ...d.coverage.byDepartment.map((r): CsvCell[] => ['Department', r.name, r.covered, r.due, pct(r.coverage), pct(r.plannedByNow)]),
      ...d.coverage.bySubject.map((r): CsvCell[] => ['Subject', r.name, r.covered, r.due, pct(r.coverage), pct(r.plannedByNow)]),
      ...d.coverage.schemes.map((r): CsvCell[] => ['Scheme', `${r.subject} ${r.target} (${r.teacher})`, r.covered, r.due, pct(r.coverage), pct(r.plannedByNow)]),
    ]) };
    case 'schemes': return { filename: f('scheme-compliance'), csv: toCsv(['Teacher', 'Subject', 'Class', 'Status', 'Late'], d.schemes.rows.map((r): CsvCell[] => [r.teacher, r.subject, r.target, r.status, r.late ? 'Yes' : 'No'])) };
    case 'load': return { filename: f('teaching-load'), csv: toCsv(['Teacher', 'Periods a week', `% of ${d.load.maxPeriods}`, 'Status', 'Cover lessons taken'], d.load.teachers.map((r): CsvCell[] => [r.name, r.periods, r.pct, r.status, r.covers])) };
    case 'gaps': return { filename: f('gaps'), csv: toCsv(['Kind', 'Class', 'Subject', 'Detail'], [
      ...d.gaps.subjects.map((g): CsvCell[] => ['No teacher', g.className, g.subjectName, `${g.uncovered} of ${g.students} students`]),
      ...d.gaps.unplaced.map((u): CsvCell[] => ['Unplaced lessons', u.target, u.subject, `${u.placed} of ${u.needed} periods placed (${u.teacher})`]),
    ]) };
  }
}

/** Exports a panel (audit-logged). The filters are the same as the page's. */
export async function exportPanel(user: Actor, panel: Panel, filter: AnalyticsFilter) {
  if (!PANELS.includes(panel)) throw new ServiceError('Unknown panel', 404);
  const d = await analytics(user, filter);
  const out = panelCsv(panel, d);
  await getScopedDb(user.schoolId, user.id).$tx((tx) =>
    logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'EXPORT_ACADEMICS', entityType: 'AcademicTerm', entityId: d.term.id, detail: `Analytics panel "${panel}" exported (${d.term.name})`, after: { panel, filters: d.filters } }, tx),
  );
  return out;
}

