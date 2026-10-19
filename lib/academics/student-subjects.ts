// Which subjects each student takes in a term (StudentSubject), the named subject combinations, and the rules around
// them. Core subjects come from the student's form automatically; electives are chosen, one by one in the grid or in
// one step by applying a combination. Exams, report cards and per-lesson attendance read this list.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import {
  assertClassReachable, currentTimetableId, dedupe, idSchema, loadSettings, subjectLimits, writableTerm, resolveTerm, type Actor,
} from '@/lib/academics/common';

// ─── Core subjects ───────────────────────────────────────────────────────────

/**
 * Gives every enrolled student the core subjects of their form for the term (the ones they do not have yet).
 * Safe to run again. Returns how many rows were added.
 */
export async function ensureCoreSubjects(tx: Db, actor: Actor, termId: string, opts: { studentIds?: string[]; classId?: string } = {}): Promise<number> {
  const [enrollments, core] = await Promise.all([
    tx.enrollment.findMany({
      where: { termId, status: 'ACTIVE', ...(opts.studentIds ? { studentId: { in: opts.studentIds } } : {}), ...(opts.classId ? { classId: opts.classId } : {}) },
      select: { studentId: true, class: { select: { levelId: true } } },
    }),
    tx.subjectLevel.findMany({ where: { type: 'CORE', subject: { active: true } }, select: { levelId: true, subjectId: true } }),
  ]);
  const coreByLevel = new Map<string, string[]>();
  for (const c of core) coreByLevel.set(c.levelId, [...(coreByLevel.get(c.levelId) ?? []), c.subjectId]);
  const data = enrollments.flatMap((e) =>
    (coreByLevel.get(e.class.levelId) ?? []).map((subjectId) => ({ schoolId: actor.schoolId, studentId: e.studentId, subjectId, termId, source: 'CORE' as const })),
  );
  if (data.length === 0) return 0;
  const r = await tx.studentSubject.createMany({ data, skipDuplicates: true });
  if (r.count > 0) {
    await logAudit(
      { schoolId: actor.schoolId, actorId: actor.id, action: 'ASSIGN_STUDENT_SUBJECTS', entityType: 'AcademicTerm', entityId: termId, detail: `Core subjects added for ${new Set(data.map((d) => d.studentId)).size} students (${r.count} subject entries)`, after: { added: r.count, source: 'CORE' } },
      tx,
    );
  }
  return r.count;
}

export async function syncCoreSubjects(user: Actor, termId?: string, classId?: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await writableTerm(tx, user.schoolId, termId);
    return { added: await ensureCoreSubjects(tx, user, term.id, { classId }) };
  });
}

// ─── Timetable clashes between a student's electives ─────────────────────────

export interface ElectiveClash { studentId: string; subjectIds: [string, string]; when: string }

/**
 * Pairs of a student's chosen subjects that the timetable cannot fit together. A subject can be offered several ways (the class's own
 * lessons, or one of several teaching groups of the form); a student already in a group has only that way. Two subjects clash when
 * every way of taking one overlaps every way of taking the other. A subject that is not on the timetable yet cannot clash.
 */
export async function electiveClashes(tx: Db, termId: string, students: { studentId: string; classId: string; subjectIds: string[] }[]): Promise<ElectiveClash[]> {
  const timetableId = await currentTimetableId(tx, termId);
  if (!timetableId || students.length === 0) return [];
  const [slots, classes] = await Promise.all([
    tx.timetableSlot.findMany({
      where: { timetableId },
      select: { periodId: true, assignment: { select: { subjectId: true, classId: true, groupId: true, group: { select: { levelId: true } } } }, period: { select: { dayOfWeek: true, periodNo: true } } },
    }),
    tx.schoolClass.findMany({ where: { id: { in: students.map((s) => s.classId) } }, select: { id: true, levelId: true } }),
  ]);
  const levelOf = new Map(classes.map((c) => [c.id, c.levelId]));
  const memberships = await tx.teachingGroupStudent.findMany({ where: { studentId: { in: students.map((s) => s.studentId) }, group: { termId } }, select: { studentId: true, groupId: true } });
  const groupsOf = new Map<string, Set<string>>();
  for (const g of memberships) groupsOf.set(g.studentId, (groupsOf.get(g.studentId) ?? new Set()).add(g.groupId));
  const days = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const label = new Map<string, string>(slots.map((s) => [s.periodId, `${days[s.period.dayOfWeek]} period ${s.period.periodNo}`]));
  // subject → option key (class id or group id) → periods
  const options = new Map<string, Map<string, Set<string>>>();
  for (const sl of slots) {
    const a = sl.assignment;
    const key = a.classId ?? a.groupId!;
    const bySubject = options.get(a.subjectId) ?? new Map<string, Set<string>>();
    bySubject.set(key, (bySubject.get(key) ?? new Set()).add(sl.periodId));
    options.set(a.subjectId, bySubject);
  }
  const groupLevel = new Map<string, string>();
  for (const sl of slots) if (sl.assignment.groupId && sl.assignment.group) groupLevel.set(sl.assignment.groupId, sl.assignment.group.levelId);

  const out: ElectiveClash[] = [];
  for (const st of students) {
    const mine = groupsOf.get(st.studentId) ?? new Set<string>();
    const level = levelOf.get(st.classId);
    const waysOf = (subjectId: string): Set<string>[] => {
      const all = options.get(subjectId);
      if (!all) return [];
      const ways: Set<string>[] = [];
      for (const [key, periods] of Array.from(all)) {
        const isClass = key === st.classId;
        const isGroup = groupLevel.has(key);
        if (isClass) ways.push(periods);
        else if (isGroup && (mine.has(key) || (groupLevel.get(key) === level && !Array.from(mine).some((g) => options.get(subjectId)?.has(g))))) ways.push(periods);
      }
      return ways;
    };
    const ids = st.subjectIds;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const wi = waysOf(ids[i]!), wj = waysOf(ids[j]!);
        if (wi.length === 0 || wj.length === 0) continue;
        let shared: string | null = null;
        const allOverlap = wi.every((x) => wj.every((y) => {
          const hit = Array.from(x).find((p) => y.has(p));
          if (hit) shared ??= hit;
          return !!hit;
        }));
        if (allOverlap && shared) out.push({ studentId: st.studentId, subjectIds: [ids[i]!, ids[j]!], when: label.get(shared) ?? 'the same period' });
      }
    }
  }
  return out;
}

// ─── The grid ────────────────────────────────────────────────────────────────

export interface GridWarning { code: 'TOO_FEW' | 'TOO_MANY' | 'CLASH'; message: string }

function countWarnings(count: number, limits: { min: number; max: number }): GridWarning[] {
  const out: GridWarning[] = [];
  if (count < limits.min) out.push({ code: 'TOO_FEW', message: `Takes ${count} subject${count === 1 ? '' : 's'}; the school's minimum is ${limits.min}` });
  if (count > limits.max) out.push({ code: 'TOO_MANY', message: `Takes ${count} subjects; the school's maximum is ${limits.max}` });
  return out;
}

export async function studentSubjectGrid(user: Actor, classId: string, termId?: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    await assertClassReachable(tx, user, classId, term.id);
    const klass = await tx.schoolClass.findFirst({ where: { id: classId }, include: { level: true } });
    if (!klass) throw new ServiceError('Class not found', 404);
    const [settings, offered, enrollments, taken, combos] = await Promise.all([
      loadSettings(tx, user.schoolId),
      tx.subjectLevel.findMany({ where: { levelId: klass.levelId, subject: { active: true } }, include: { subject: { select: { id: true, name: true, shortName: true, colour: true } } } }),
      tx.enrollment.findMany({
        where: { termId: term.id, classId, status: 'ACTIVE' },
        select: { student: { select: { id: true, fullName: true, surname: true, firstName: true, admissionNumber: true, gender: true } } },
      }),
      tx.studentSubject.findMany({ where: { termId: term.id, student: { enrollments: { some: { termId: term.id, classId, status: 'ACTIVE' } } } }, select: { studentId: true, subjectId: true, source: true } }),
      tx.subjectCombination.findMany({
        where: { levelId: klass.levelId, OR: [{ classes: { none: {} } }, { classes: { some: { classId } } }] },
        include: { items: { select: { subjectId: true } } }, orderBy: { name: 'asc' },
      }),
    ]);
    const limits = subjectLimits(settings, klass.level.order);
    const subjects = offered
      .map((o) => ({ id: o.subject.id, name: o.subject.name, shortName: o.subject.shortName ?? o.subject.name, colour: o.subject.colour, type: o.type }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'CORE' ? -1 : 1));
    const coreIds = subjects.filter((s) => s.type === 'CORE').map((s) => s.id);
    const students = enrollments.map((e) => e.student).sort((a, b) => a.surname.localeCompare(b.surname) || a.firstName.localeCompare(b.firstName));
    const bySt = new Map<string, Map<string, string>>();
    for (const t of taken) bySt.set(t.studentId, (bySt.get(t.studentId) ?? new Map()).set(t.subjectId, t.source));

    const offeredIds = new Set(subjects.map((s) => s.id));
    const clashes = await electiveClashes(tx, term.id, students.map((s) => ({ studentId: s.id, classId, subjectIds: Array.from(bySt.get(s.id)?.keys() ?? []).filter((id) => offeredIds.has(id) && !coreIds.includes(id)) })));
    const nameOf = new Map(subjects.map((s) => [s.id, s.name]));
    const rows = students.map((s) => {
      const mine = bySt.get(s.id) ?? new Map<string, string>();
      // A core subject counts even before it is stored: it is automatic for the form.
      const ids = dedupe([...coreIds, ...Array.from(mine.keys()).filter((id) => offeredIds.has(id))]);
      const warnings: GridWarning[] = [
        ...countWarnings(ids.length, limits),
        ...clashes.filter((c) => c.studentId === s.id).map((c): GridWarning => ({ code: 'CLASH', message: `${nameOf.get(c.subjectIds[0])} and ${nameOf.get(c.subjectIds[1])} are both ${c.when}` })),
      ];
      return {
        id: s.id, fullName: s.fullName, surname: s.surname, admissionNumber: s.admissionNumber, gender: s.gender,
        subjects: Object.fromEntries(ids.map((id) => [id, mine.get(id) ?? 'CORE'])), count: ids.length, warnings,
      };
    });
    return {
      term: { id: term.id, name: term.name, status: term.status }, class: { id: klass.id, name: klass.name, level: klass.level.name, levelOrder: klass.level.order },
      limits, subjects, students: rows,
      combinations: combos.map((c) => ({ id: c.id, name: c.name, subjectIds: c.items.map((i) => i.subjectId) })),
    };
  });
}

// ─── Saving choices ──────────────────────────────────────────────────────────

export const SaveChoicesSchema = z.object({
  termId: idSchema.optional(),
  classId: idSchema,
  /** For each student whose choices changed: the full list of electives they now take. */
  changes: z.array(z.object({ studentId: idSchema, subjectIds: z.array(idSchema).max(40) })).min(1).max(200),
});

async function loadClassStudents(tx: Db, termId: string, classId: string, studentIds: string[]) {
  const rows = await tx.enrollment.findMany({ where: { termId, classId, status: 'ACTIVE', studentId: { in: studentIds } }, select: { studentId: true, student: { select: { fullName: true } } } });
  if (rows.length !== new Set(studentIds).size) throw new ServiceError('One or more students are not in this class this term', 404);
  return new Map(rows.map((r) => [r.studentId, r.student.fullName]));
}

/** Changes the electives of students in one class. Returns warnings (too few / too many / timetable clash); they do not stop the save. */
export async function saveStudentChoices(user: Actor, raw: z.input<typeof SaveChoicesSchema>) {
  const input = SaveChoicesSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await writableTerm(tx, user.schoolId, input.termId);
    await assertClassReachable(tx, user, input.classId, term.id);
    const klass = await tx.schoolClass.findFirst({ where: { id: input.classId }, include: { level: true } });
    if (!klass) throw new ServiceError('Class not found', 404);
    const names = await loadClassStudents(tx, term.id, input.classId, input.changes.map((c) => c.studentId));
    const offered = await tx.subjectLevel.findMany({ where: { levelId: klass.levelId, subject: { active: true } }, include: { subject: { select: { name: true } } } });
    const type = new Map(offered.map((o) => [o.subjectId, o.type]));
    const subjectName = new Map(offered.map((o) => [o.subjectId, o.subject.name]));
    await ensureCoreSubjects(tx, user, term.id, { studentIds: input.changes.map((c) => c.studentId), classId: input.classId });

    let added = 0, removed = 0;
    const log: { student: string; added: string[]; removed: string[] }[] = [];
    for (const ch of input.changes) {
      const wanted = new Set(ch.subjectIds);
      for (const id of Array.from(wanted)) {
        if (!type.has(id)) throw new ServiceError(`That subject is not offered in ${klass.level.name} (or is inactive)`, 422);
        if (type.get(id) === 'CORE') wanted.delete(id); // core subjects are automatic
      }
      const current = await tx.studentSubject.findMany({ where: { studentId: ch.studentId, termId: term.id, source: { not: 'CORE' } } });
      const toRemove = current.filter((c) => !wanted.has(c.subjectId));
      const have = new Set(current.map((c) => c.subjectId));
      const toAdd = Array.from(wanted).filter((id) => !have.has(id));
      if (toRemove.length) {
        await tx.studentSubject.deleteMany({ where: { id: { in: toRemove.map((r) => r.id) } } });
        // Out of the subject means out of its teaching group too.
        await tx.teachingGroupStudent.deleteMany({ where: { studentId: ch.studentId, group: { termId: term.id, subjectId: { in: toRemove.map((r) => r.subjectId) } } } });
      }
      if (toAdd.length) await tx.studentSubject.createMany({ data: toAdd.map((subjectId) => ({ schoolId: user.schoolId, studentId: ch.studentId, subjectId, termId: term.id, source: 'CHOSEN' as const })) });
      added += toAdd.length; removed += toRemove.length;
      if (toAdd.length || toRemove.length) log.push({ student: names.get(ch.studentId)!, added: toAdd.map((i) => subjectName.get(i) ?? i), removed: toRemove.map((r) => subjectName.get(r.subjectId) ?? r.subjectId) });
    }
    if (log.length) {
      await logAudit(
        { schoolId: user.schoolId, actorId: user.id, action: 'ASSIGN_STUDENT_SUBJECTS', entityType: 'SchoolClass', entityId: klass.id, detail: `${klass.name}: subjects changed for ${log.length} student${log.length === 1 ? '' : 's'} (+${added}, -${removed})`, after: { term: term.name, changes: log } },
        tx,
      );
    }
    return { changedStudents: log.length, added, removed, warnings: await warningsFor(tx, user.schoolId, term.id, klass.id, klass.level.order, input.changes.map((c) => c.studentId)) };
  });
}

async function warningsFor(tx: Db, schoolId: string, termId: string, classId: string, levelOrder: number, studentIds: string[]) {
  const settings = await loadSettings(tx, schoolId);
  const limits = subjectLimits(settings, levelOrder);
  const [rows, students] = await Promise.all([
    tx.studentSubject.findMany({ where: { termId, studentId: { in: studentIds } }, select: { studentId: true, subjectId: true, subject: { select: { name: true, levels: { select: { type: true, level: { select: { order: true } } } } } } } }),
    tx.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, fullName: true } }),
  ]);
  const name = new Map(students.map((s) => [s.id, s.fullName]));
  const subjName = new Map(rows.map((r) => [r.subjectId, r.subject.name]));
  const mineBy = new Map<string, string[]>();
  for (const r of rows) mineBy.set(r.studentId, [...(mineBy.get(r.studentId) ?? []), r.subjectId]);
  const electiveOf = (r: (typeof rows)[number]) => r.subject.levels.some((l) => l.level.order === levelOrder && l.type === 'ELECTIVE');
  const electives = new Map<string, string[]>();
  for (const r of rows.filter(electiveOf)) electives.set(r.studentId, [...(electives.get(r.studentId) ?? []), r.subjectId]);
  const clashes = await electiveClashes(tx, termId, studentIds.map((id) => ({ studentId: id, classId, subjectIds: electives.get(id) ?? [] })));
  const out: { studentId: string; studentName: string; code: GridWarning['code']; message: string }[] = [];
  for (const id of studentIds) {
    for (const w of countWarnings((mineBy.get(id) ?? []).length, limits)) out.push({ studentId: id, studentName: name.get(id) ?? '', ...w });
  }
  for (const c of clashes) out.push({ studentId: c.studentId, studentName: name.get(c.studentId) ?? '', code: 'CLASH', message: `${subjName.get(c.subjectIds[0])} and ${subjName.get(c.subjectIds[1])} are both ${c.when}` });
  return out;
}

// ─── Combinations ────────────────────────────────────────────────────────────

export const CombinationSchema = z.object({
  name: z.string().trim().min(2, 'Give the combination a name').max(60),
  levelId: idSchema,
  subjectIds: z.array(idSchema).min(1, 'Choose at least one subject').max(12),
  classIds: z.array(idSchema).max(60).default([]),
});
export type CombinationInput = z.input<typeof CombinationSchema>;

export async function listCombinations(user: Actor) {
  const db = getScopedDb(user.schoolId, user.id);
  const rows = await db.subjectCombination.findMany({
    orderBy: [{ level: { order: 'asc' } }, { name: 'asc' }],
    include: { level: { select: { name: true, order: true } }, items: { select: { subject: { select: { id: true, name: true, shortName: true } } } }, classes: { select: { class: { select: { id: true, name: true } } } } },
  });
  return rows.map((c) => ({
    id: c.id, name: c.name, levelId: c.levelId, level: c.level.name,
    subjects: c.items.map((i) => ({ id: i.subject.id, name: i.subject.name, shortName: i.subject.shortName ?? i.subject.name })),
    classes: c.classes.map((x) => x.class),
  }));
}

export async function saveCombination(user: Actor, id: string | null, raw: CombinationInput) {
  const input = CombinationSchema.parse(raw);
  const subjectIds = dedupe(input.subjectIds);
  const classIds = dedupe(input.classIds);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (id && !(await tx.subjectCombination.findFirst({ where: { id }, select: { id: true } }))) throw new ServiceError('Combination not found', 404);
    const level = await tx.level.findFirst({ where: { id: input.levelId } });
    if (!level) throw new ServiceError('Form not found', 404);
    const offered = await tx.subjectLevel.findMany({ where: { levelId: level.id, subjectId: { in: subjectIds }, subject: { active: true } }, include: { subject: { select: { name: true } } } });
    if (offered.length !== subjectIds.length) throw new ServiceError(`Every subject in a combination must be offered in ${level.name}`, 422);
    const classes = classIds.length ? await tx.schoolClass.findMany({ where: { id: { in: classIds } }, select: { id: true, levelId: true, name: true } }) : [];
    if (classes.length !== classIds.length) throw new ServiceError('Class not found', 404);
    const wrong = classes.find((c) => c.levelId !== level.id);
    if (wrong) throw new ServiceError(`${wrong.name} is not in ${level.name}`, 422);
    const clash = await tx.subjectCombination.findFirst({ where: { levelId: level.id, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
    if (clash) throw new ServiceError(`${level.name} already has a combination called ${clash.name}`, 409);

    let before: unknown = null;
    if (id) {
      const cur = await tx.subjectCombination.findFirst({ where: { id }, include: { items: true, classes: true } });
      if (!cur) throw new ServiceError('Combination not found', 404);
      before = { name: cur.name, subjects: cur.items.map((i) => i.subjectId), classes: cur.classes.map((c) => c.classId) };
      await tx.subjectCombinationItem.deleteMany({ where: { combinationId: id } });
      await tx.subjectCombinationClass.deleteMany({ where: { combinationId: id } });
      await tx.subjectCombination.update({ where: { id }, data: { name: input.name, levelId: level.id } });
    }
    const combo = id ? { id } : await tx.subjectCombination.create({ data: { schoolId: user.schoolId, name: input.name, levelId: level.id } });
    await tx.subjectCombinationItem.createMany({ data: subjectIds.map((subjectId) => ({ schoolId: user.schoolId, combinationId: combo.id, subjectId })) });
    if (classIds.length) await tx.subjectCombinationClass.createMany({ data: classIds.map((classId) => ({ schoolId: user.schoolId, combinationId: combo.id, classId })) });
    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'SAVE_SUBJECT_COMBINATION', entityType: 'SubjectCombination', entityId: combo.id,
        detail: `${level.name} combination ${input.name}: ${offered.map((o) => o.subject.name).join(', ')}`, ...(before ? { before: before as never } : {}),
        after: { name: input.name, subjects: subjectIds, classes: classIds },
      },
      tx,
    );
    return { id: combo.id };
  });
}

export async function deleteCombination(user: Actor, id: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.subjectCombination.findFirst({ where: { id } });
    if (!c) throw new ServiceError('Combination not found', 404);
    await tx.subjectCombination.delete({ where: { id } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'DELETE_SUBJECT_COMBINATION', entityType: 'SubjectCombination', entityId: id, detail: `Combination ${c.name} deleted (students keep the subjects they were given)`, before: { name: c.name } }, tx);
  });
}

export const ApplyCombinationSchema = z.object({
  termId: idSchema.optional(),
  classId: idSchema,
  combinationId: idSchema,
  studentIds: z.array(idSchema).min(1, 'Choose at least one student').max(200),
});

/**
 * Gives the chosen students the electives of a combination in one step: their other electives are replaced, their core
 * subjects stay. The combination's form must be the class's form (and, if it is linked to classes, the class must be one).
 */
export async function applyCombination(user: Actor, raw: z.input<typeof ApplyCombinationSchema>) {
  const input = ApplyCombinationSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await writableTerm(tx, user.schoolId, input.termId);
    await assertClassReachable(tx, user, input.classId, term.id);
    const [klass, combo] = await Promise.all([
      tx.schoolClass.findFirst({ where: { id: input.classId }, include: { level: true } }),
      tx.subjectCombination.findFirst({ where: { id: input.combinationId }, include: { items: { include: { subject: { select: { name: true, active: true } } } }, classes: true } }),
    ]);
    if (!klass) throw new ServiceError('Class not found', 404);
    if (!combo) throw new ServiceError('Combination not found', 404);
    if (combo.levelId !== klass.levelId) throw new ServiceError(`${combo.name} is a combination for another form, not ${klass.level.name}`, 422);
    if (combo.classes.length && !combo.classes.some((c) => c.classId === klass.id)) throw new ServiceError(`${combo.name} is not linked to ${klass.name}`, 422);
    const inactive = combo.items.find((i) => !i.subject.active);
    if (inactive) throw new ServiceError(`${inactive.subject.name} is inactive, so ${combo.name} cannot be applied`, 409);
    const levels = await tx.subjectLevel.findMany({ where: { levelId: klass.levelId, subjectId: { in: combo.items.map((i) => i.subjectId) } } });
    const type = new Map(levels.map((l) => [l.subjectId, l.type]));
    const missing = combo.items.find((i) => !type.has(i.subjectId));
    if (missing) throw new ServiceError(`${missing.subject.name} is not offered in ${klass.level.name}`, 422);
    const names = await loadClassStudents(tx, term.id, klass.id, input.studentIds);
    await ensureCoreSubjects(tx, user, term.id, { studentIds: input.studentIds, classId: klass.id });

    const electives = combo.items.filter((i) => type.get(i.subjectId) === 'ELECTIVE').map((i) => i.subjectId);
    for (const studentId of input.studentIds) {
      const current = await tx.studentSubject.findMany({ where: { studentId, termId: term.id, source: { not: 'CORE' } } });
      const drop = current.filter((c) => !electives.includes(c.subjectId));
      if (drop.length) {
        await tx.studentSubject.deleteMany({ where: { id: { in: drop.map((d) => d.id) } } });
        await tx.teachingGroupStudent.deleteMany({ where: { studentId, group: { termId: term.id, subjectId: { in: drop.map((d) => d.subjectId) } } } });
      }
      const have = new Set(current.map((c) => c.subjectId));
      const add = electives.filter((id) => !have.has(id));
      if (add.length) await tx.studentSubject.createMany({ data: add.map((subjectId) => ({ schoolId: user.schoolId, studentId, subjectId, termId: term.id, source: 'COMBINATION' as const })) });
      // Subjects they already had keep working, but now they belong to the combination.
      await tx.studentSubject.updateMany({ where: { studentId, termId: term.id, subjectId: { in: electives }, source: 'CHOSEN' }, data: { source: 'COMBINATION' } });
    }
    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'ASSIGN_STUDENT_SUBJECTS', entityType: 'SchoolClass', entityId: klass.id,
        detail: `${klass.name}: combination ${combo.name} applied to ${input.studentIds.length} student${input.studentIds.length === 1 ? '' : 's'}`,
        after: { term: term.name, combination: combo.name, students: input.studentIds.map((s) => names.get(s) ?? s), subjects: combo.items.map((i) => i.subject.name) },
      },
      tx,
    );
    return { applied: input.studentIds.length, warnings: await warningsFor(tx, user.schoolId, term.id, klass.id, klass.level.order, input.studentIds) };
  });
}
