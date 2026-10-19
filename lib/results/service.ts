// The results service: turns the marks of VERIFIED mark sheets into SubjectResult and TermResult rows for one level (form) in
// one term. It is the only code that stores calculated results, so the report card, analytics and exports always agree.
//
//  1. every student's subject term mark comes from lib/results (the plan, the marks, the grading scale of the level)
//  2. subject positions in the class and in the whole form
//  3. overall average over the subjects the student takes, class position and form position, passes / A Level points
//
// Run when a sheet is verified, when a verified sheet changes, and when the Head publishes. Rows that are already published
// are a snapshot and are never touched: they change only through unpublish and republish.
import type { Prisma } from '@prisma/client';
import { logAudit } from '@/lib/audit';
import type { Db } from '@/lib/scoped-db';
import {
  aLevelPoints, countPasses, fivePassesWithEnglishAndMaths, markKey, overallAverage, previewTermMarks, rankDescending, round2,
  type CalcAssessment, type PlanLine, type StoredMark, type SubjectOutcome,
} from '@/lib/results';
import { initialsOf, loadExamSettings, num, previousTerm, type Actor } from '@/lib/exams/common';
import { scaleFor } from '@/lib/exams/scales';
import { resolvePlan, type PlanView } from '@/lib/exams/setup';

export interface RecalcSummary {
  subjectResults: number;
  termResults: number;
  /** Subjects with verified sheets but no weighting plan, so no result could be calculated. */
  missingPlans: string[];
}

interface Computed {
  studentId: string;
  subjectId: string;
  classId: string;
  assignmentId: string;
  termMark: number;
  roundedMark: number;
  grade: string | null;
  points: number | null;
  remark: string | null;
  typeScores: { label: string; score: number | null; weight: number }[];
  teacherComment: string | null;
  teacherInitials: string | null;
}

/** Recalculates every subject and overall result of a level for a term from its verified mark sheets. */
export async function recalculateLevel(tx: Db, actor: Pick<Actor, 'id' | 'schoolId'>, termId: string, levelId: string): Promise<RecalcSummary> {
  const sid = actor.schoolId;
  const [term, level, scale, settings] = await Promise.all([
    tx.academicTerm.findFirstOrThrow({ where: { id: termId, schoolId: sid } }),
    tx.level.findFirstOrThrow({ where: { id: levelId, schoolId: sid } }),
    scaleFor(tx, sid, levelId, termId),
    loadExamSettings(tx, sid),
  ]);

  // Who is where.
  const classes = await tx.schoolClass.findMany({ where: { schoolId: sid, levelId }, select: { id: true } });
  const classIds = classes.map((c) => c.id);
  const enrollments = await tx.enrollment.findMany({ where: { schoolId: sid, termId, classId: { in: classIds }, status: 'ACTIVE' }, select: { studentId: true, classId: true } });
  const classOf = new Map(enrollments.map((e) => [e.studentId, e.classId]));

  // Verified and published sheets of this level.
  const sheets = await tx.markSheet.findMany({
    where: {
      schoolId: sid, termId, status: { in: ['VERIFIED', 'PUBLISHED'] },
      assignment: { OR: [{ class: { levelId } }, { group: { levelId } }] },
    },
    include: { assignment: { include: { teacher: { select: { fullName: true } } } } },
  });
  const assignments = sheets.map((s) => s.assignment);
  const subjectIds = Array.from(new Set(assignments.map((a) => a.subjectId)));

  const [takers, groups, assessments, comments, marks] = await Promise.all([
    tx.studentSubject.findMany({ where: { schoolId: sid, termId, subjectId: { in: subjectIds }, studentId: { in: Array.from(classOf.keys()) } }, select: { studentId: true, subjectId: true } }),
    tx.teachingGroupStudent.findMany({ where: { schoolId: sid, groupId: { in: assignments.map((a) => a.groupId).filter((x): x is string => !!x) } }, select: { groupId: true, studentId: true } }),
    tx.assessment.findMany({ where: { schoolId: sid, termId, levelId, subjectId: { in: subjectIds } }, select: { id: true, assignmentId: true, subjectId: true, typeId: true, maxMark: true, countsToTerm: true, projectId: true } }),
    tx.sheetStudentComment.findMany({ where: { schoolId: sid, sheetId: { in: sheets.map((s) => s.id) } }, select: { sheetId: true, studentId: true, text: true } }),
    tx.assessmentMark.findMany({ where: { schoolId: sid, assignmentId: { in: assignments.map((a) => a.id) } }, select: { assignmentId: true, assessmentId: true, studentId: true, stageId: true, value: true, code: true } }),
  ]);
  const projectIds = Array.from(new Set(assessments.map((x) => x.projectId).filter((x): x is string => !!x)));
  const stages = projectIds.length ? await tx.projectStage.findMany({ where: { schoolId: sid, templateId: { in: projectIds } }, select: { id: true, templateId: true, maxMark: true } }) : [];

  const takes = new Set(takers.map((t) => `${t.studentId}|${t.subjectId}`));
  const groupMembers = new Map<string, Set<string>>();
  for (const g of groups) (groupMembers.get(g.groupId) ?? groupMembers.set(g.groupId, new Set()).get(g.groupId)!).add(g.studentId);
  const commentOf = new Map(comments.map((c) => [`${c.sheetId}|${c.studentId}`, c.text]));
  const marksByAssignment = new Map<string, Map<string, StoredMark>>();
  for (const m of marks) {
    const lookup = marksByAssignment.get(m.assignmentId) ?? marksByAssignment.set(m.assignmentId, new Map()).get(m.assignmentId)!;
    lookup.set(markKey(m.studentId, m.assessmentId, m.stageId), { value: num(m.value), code: m.code });
  }

  const plans = new Map<string, PlanView | null>();
  for (const subjectId of subjectIds) plans.set(subjectId, await resolvePlan(tx, sid, termId, levelId, subjectId));
  const missingPlans = subjectIds.filter((id) => !plans.get(id));

  // 1. Subject term marks. A live assignment wins over an ended one for the same student and subject.
  const ordered = [...sheets].sort((a, b) => Number(b.assignment.status === 'ACTIVE') - Number(a.assignment.status === 'ACTIVE'));
  const computed = new Map<string, Computed>();
  for (const sheet of ordered) {
    const a = sheet.assignment;
    const plan = plans.get(a.subjectId);
    if (!plan) continue;
    const members = a.classId ? null : groupMembers.get(a.groupId!) ?? new Set<string>();
    const students = Array.from(classOf.keys()).filter((id) => takes.has(`${id}|${a.subjectId}`) && (a.classId ? classOf.get(id) === a.classId : members!.has(id)));
    const calc: CalcAssessment[] = assessments
      .filter((x) => x.subjectId === a.subjectId && (x.assignmentId === a.id || x.assignmentId === null))
      .map((x) => ({
        id: x.id, typeId: x.typeId, maxMark: num(x.maxMark)!, countsToTerm: x.countsToTerm,
        ...(x.projectId ? { stages: stages.filter((s) => s.templateId === x.projectId).map((s) => ({ id: s.id, maxMark: num(s.maxMark)! })) } : {}),
      }));
    const previews = previewTermMarks({ plan: plan.lines as PlanLine[], scale: scale.scale, assessments: calc, marks: marksByAssignment.get(a.id) ?? new Map(), studentIds: students });
    for (const [studentId, r] of Array.from(previews)) {
      if (r.termMark === null || r.roundedMark === null) continue; // everything exempt: the subject is left out for this student
      const key = `${studentId}|${a.subjectId}`;
      if (computed.has(key)) continue;
      computed.set(key, {
        studentId, subjectId: a.subjectId, classId: classOf.get(studentId)!, assignmentId: a.id, termMark: r.termMark, roundedMark: r.roundedMark,
        grade: r.grade, points: r.points, remark: r.remark,
        typeScores: r.lines.map((l) => ({ label: l.label, score: l.score, weight: l.weight })),
        teacherComment: commentOf.get(`${sheet.id}|${studentId}`) ?? null, teacherInitials: initialsOf(a.teacher.fullName),
      });
    }
  }

  // Published rows are a snapshot: they stay as they are, and count in the positions with their published marks.
  const existing = await tx.subjectResult.findMany({ where: { schoolId: sid, termId, levelId } });
  const existingByKey = new Map(existing.map((r) => [`${r.studentId}|${r.subjectId}`, r]));
  const frozen = new Set(existing.filter((r) => r.published).map((r) => `${r.studentId}|${r.subjectId}`));

  const rows = new Map<string, { studentId: string; subjectId: string; classId: string; termMark: number; roundedMark: number; points: number | null; published: boolean }>();
  for (const r of existing) if (r.published) rows.set(`${r.studentId}|${r.subjectId}`, { studentId: r.studentId, subjectId: r.subjectId, classId: r.classId, termMark: num(r.termMark)!, roundedMark: r.roundedMark, points: r.points, published: true });
  for (const [key, c] of Array.from(computed)) if (!frozen.has(key)) rows.set(key, { ...c, published: false });

  // 2. Subject positions in the class and in the form.
  const classPos = new Map<string, { position: number; size: number }>();
  const formPos = new Map<string, { position: number; size: number }>();
  for (const subjectId of Array.from(new Set(Array.from(rows.values()).map((r) => r.subjectId)))) {
    const inSubject = Array.from(rows.values()).filter((r) => r.subjectId === subjectId);
    for (const [id, p] of Array.from(rankDescending(inSubject.map((r) => ({ id: r.studentId, value: r.termMark }))))) formPos.set(`${id}|${subjectId}`, p);
    for (const classId of Array.from(new Set(inSubject.map((r) => r.classId)))) {
      const mates = inSubject.filter((r) => r.classId === classId);
      for (const [id, p] of Array.from(rankDescending(mates.map((r) => ({ id: r.studentId, value: r.termMark }))))) classPos.set(`${id}|${subjectId}`, p);
    }
  }

  // Store the subject results that are not frozen.
  let subjectResults = 0;
  const toCreate: Prisma.SubjectResultCreateManyInput[] = [];
  for (const [key, c] of Array.from(computed)) {
    if (frozen.has(key)) continue;
    const cp = classPos.get(key);
    const fp = formPos.get(key);
    const data = {
      classId: c.classId, levelId, assignmentId: c.assignmentId, termMark: c.termMark, roundedMark: c.roundedMark, grade: c.grade, points: c.points, remark: c.remark,
      classPosition: cp?.position ?? null, classSize: cp?.size ?? null, formPosition: fp?.position ?? null, formSize: fp?.size ?? null,
      teacherComment: c.teacherComment, teacherInitials: c.teacherInitials, typeScores: c.typeScores as unknown as Prisma.InputJsonValue, calculatedAt: new Date(),
    };
    const old = existingByKey.get(key);
    if (old) await tx.subjectResult.update({ where: { id: old.id }, data });
    else toCreate.push({ schoolId: sid, studentId: c.studentId, subjectId: c.subjectId, termId, ...data });
    subjectResults++;
  }
  if (toCreate.length) await tx.subjectResult.createMany({ data: toCreate });
  // Results that no longer apply (the sheet was unlocked, or everything became exempt) are removed; published ones never are.
  const stale = existing.filter((r) => !r.published && !computed.has(`${r.studentId}|${r.subjectId}`)).map((r) => r.id);
  if (stale.length) await tx.subjectResult.deleteMany({ where: { id: { in: stale } } });

  // 3. Overall results per student.
  const byStudent = new Map<string, typeof rows extends Map<string, infer V> ? V[] : never>();
  for (const r of Array.from(rows.values())) (byStudent.get(r.studentId) ?? byStudent.set(r.studentId, []).get(r.studentId)!).push(r);
  const averages = new Map<string, number>();
  for (const [studentId, subs] of Array.from(byStudent)) {
    const avg = overallAverage(subs.map((s) => s.termMark));
    if (avg !== null) averages.set(studentId, avg);
  }
  const formRank = rankDescending(Array.from(averages, ([id, value]) => ({ id, value })));
  const classRank = new Map<string, { position: number; size: number }>();
  for (const classId of classIds) {
    const mates = Array.from(averages).filter(([id]) => classOf.get(id) === classId);
    for (const [id, p] of Array.from(rankDescending(mates.map(([id, value]) => ({ id, value }))))) classRank.set(id, p);
  }

  const existingTerm = await tx.termResult.findMany({ where: { schoolId: sid, termId, studentId: { in: Array.from(averages.keys()) } } });
  const termByStudent = new Map(existingTerm.map((r) => [r.studentId, r]));
  const prev = await previousTerm(tx, sid, term);
  const prevAverages = prev
    ? new Map((await tx.termResult.findMany({ where: { schoolId: sid, termId: prev.id, published: true, studentId: { in: Array.from(averages.keys()) } }, select: { studentId: true, averagePercentage: true, percentage: true } }))
      .map((r) => [r.studentId, num(r.averagePercentage ?? r.percentage)]))
    : new Map<string, number | null>();

  let termResults = 0;
  const termCreates: Prisma.TermResultCreateManyInput[] = [];
  for (const [studentId, avg] of Array.from(averages)) {
    const old = termByStudent.get(studentId);
    if (old?.published) continue;
    const subs = byStudent.get(studentId)!;
    const outcomes: SubjectOutcome[] = subs.map((s) => ({ subjectId: s.subjectId, roundedMark: s.roundedMark, points: s.points }));
    const cr = classRank.get(studentId);
    const fr = formRank.get(studentId);
    const data = {
      classId: classOf.get(studentId)!, totalMarks: round2(subs.reduce((a, s) => a + s.termMark, 0)), percentage: avg, averagePercentage: avg,
      subjectsTaken: subs.length, subjectsSat: subs.length, subjectsPassed: level.category === 'O_LEVEL' ? countPasses(outcomes, scale.passMark) : null,
      fivePassesEngMaths: level.category === 'O_LEVEL' ? fivePassesWithEnglishAndMaths(outcomes, scale.passMark, settings.passesRequired, settings.englishSubjectId, settings.mathsSubjectId) : null,
      aLevelPoints: level.category === 'A_LEVEL' ? aLevelPoints(outcomes) : null,
      classPosition: cr?.position ?? null, classSize: cr?.size ?? null, rankedOutOf: cr?.size ?? null, formPosition: fr?.position ?? null, formSize: fr?.size ?? null,
      previousAverage: prevAverages.get(studentId) ?? null, calculatedAt: new Date(),
    };
    if (old) await tx.termResult.update({ where: { id: old.id }, data });
    else termCreates.push({ schoolId: sid, studentId, termId, ...data });
    termResults++;
  }
  if (termCreates.length) await tx.termResult.createMany({ data: termCreates });
  // Students who no longer have any subject result lose their unpublished overall row.
  await tx.termResult.deleteMany({ where: { schoolId: sid, termId, published: false, classId: { in: classIds }, studentId: { notIn: Array.from(averages.keys()) } } });

  await logAudit({
    schoolId: sid, actorId: actor.id, action: 'CALCULATE_RESULTS', entityType: 'Level', entityId: levelId,
    detail: `${level.name}, ${term.name}: ${subjectResults} subject result(s) and ${termResults} overall result(s) calculated${missingPlans.length ? `; ${missingPlans.length} subject(s) have no weighting plan` : ''}`,
  }, tx);
  return { subjectResults, termResults, missingPlans };
}
