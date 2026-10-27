// Curriculum: the syllabus (what must be taught), the scheme of work (the plan, week by week), the record of work
// (what was actually covered) and the optional lesson plans. Together they let the HOD and the Head see coverage
// without collecting exercise books.
//
// Who may do what: a teacher writes the scheme and the record for their own assignments only; the HOD of the subject's
// department (or an administrator) approves schemes; syllabus topics are entered by the HOD or an administrator.
import { z } from 'zod';
import { heldAt } from '@/lib/access-core';
import type { Prisma, SchemeStatus } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { notifyUsers } from '@/lib/system/notifications';
import { parseCsv } from '@/lib/students/csv';
import {
  dedupe, holds, idSchema, isoOf, loadSettings, noteSchema, peopleWith, resolveTerm, todayInHarare, toDay, writableTerm, type Actor,
} from '@/lib/academics/common';
import { weeksOfTerm } from '@/lib/academics/school-days';

// ─── Who reaches which department ────────────────────────────────────────────

/**
 * 'ALL' for a school-wide person (the administrator, the Head, the Deputy, or anyone given the permission school-wide);
 * the departments they head for a head of department.
 */
export async function departmentScope(tx: Db, user: Actor): Promise<'ALL' | string[]> {
  if (heldAt(user, 'academics.syllabus.manage', 'SCHOOL') || heldAt(user, 'academics.schemes.approve', 'SCHOOL')) return 'ALL';
  const heads = await tx.department.findMany({ where: { hodUserId: user.id }, select: { id: true } });
  return heads.length ? heads.map((h) => h.id) : 'ALL';
}

async function assertSubjectInScope(tx: Db, user: Actor, subjectId: string) {
  const s = await tx.subject.findFirst({ where: { id: subjectId }, select: { id: true, name: true, departmentId: true } });
  if (!s) throw new ServiceError('Subject not found', 404);
  const scope = await departmentScope(tx, user);
  if (scope !== 'ALL' && !(s.departmentId && scope.includes(s.departmentId))) throw new ServiceError('Subject not found', 404);
  return s;
}

// ─── Syllabus ────────────────────────────────────────────────────────────────

export interface TopicNode { id: string; title: string; objectives: string | null; order: number; parentId: string | null; children: TopicNode[] }
const MAX_DEPTH = 4;

export function buildTree(rows: { id: string; title: string; objectives: string | null; order: number; parentId: string | null }[]): TopicNode[] {
  const nodes = new Map<string, TopicNode>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: TopicNode[] = [];
  for (const n of Array.from(nodes.values())) (n.parentId && nodes.get(n.parentId) ? nodes.get(n.parentId)!.children : roots).push(n);
  const sort = (xs: TopicNode[]) => { xs.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)); xs.forEach((x) => sort(x.children)); };
  sort(roots);
  return roots;
}

export async function syllabusTree(user: Actor, subjectId: string, levelId: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const [subject, level] = await Promise.all([tx.subject.findFirst({ where: { id: subjectId }, select: { id: true, name: true } }), tx.level.findFirst({ where: { id: levelId }, select: { id: true, name: true } })]);
    if (!subject || !level) throw new ServiceError('Subject or form not found', 404);
    const rows = await tx.syllabusTopic.findMany({ where: { subjectId, levelId }, select: { id: true, title: true, objectives: true, order: true, parentId: true } });
    return { subject, level, topics: buildTree(rows), count: rows.length };
  });
}

/** Which subject/form combinations have a syllabus, with their topic counts. */
export async function syllabusIndex(user: Actor) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const scope = await departmentScope(tx, user);
    const [subjects, levels, counts] = await Promise.all([
      tx.subject.findMany({ where: { active: true, ...(scope === 'ALL' ? {} : { departmentId: { in: scope } }) }, orderBy: { name: 'asc' }, select: { id: true, name: true, levels: { select: { levelId: true } } } }),
      tx.level.findMany({ where: { active: true }, orderBy: { order: 'asc' }, select: { id: true, name: true, order: true } }),
      tx.syllabusTopic.groupBy({ by: ['subjectId', 'levelId'], _count: { _all: true } }),
    ]);
    const n = new Map(counts.map((c) => [`${c.subjectId}:${c.levelId}`, c._count._all]));
    return { levels, subjects: subjects.map((s) => ({ id: s.id, name: s.name, levels: s.levels.map((l) => ({ levelId: l.levelId, topics: n.get(`${s.id}:${l.levelId}`) ?? 0 })) })) };
  });
}

export const TopicSchema = z.object({
  subjectId: idSchema,
  levelId: idSchema,
  parentId: idSchema.nullable().optional(),
  title: z.string().trim().min(1, 'Give the topic a title').max(200),
  objectives: z.string().trim().max(2000).nullish().transform((v) => v || null),
  order: z.number().int().min(0).max(10_000).optional(),
});
export type TopicInput = z.input<typeof TopicSchema>;

async function depthOf(tx: Db, parentId: string | null | undefined): Promise<number> {
  let depth = 1, cur = parentId ?? null;
  while (cur) {
    const p: { parentId: string | null } | null = await tx.syllabusTopic.findFirst({ where: { id: cur }, select: { parentId: true } });
    if (!p) break;
    depth++; cur = p.parentId;
    if (depth > MAX_DEPTH + 1) break;
  }
  return depth;
}

export async function saveTopic(user: Actor, id: string | null, raw: TopicInput) {
  const input = TopicSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (id && !(await tx.syllabusTopic.findFirst({ where: { id }, select: { id: true } }))) throw new ServiceError('Topic not found', 404);
    const subject = await assertSubjectInScope(tx, user, input.subjectId);
    if (!(await tx.level.findFirst({ where: { id: input.levelId } }))) throw new ServiceError('Form not found', 404);
    if (!(await tx.subjectLevel.findFirst({ where: { subjectId: subject.id, levelId: input.levelId } }))) throw new ServiceError(`${subject.name} is not offered in that form`, 422);
    if (input.parentId) {
      const p = await tx.syllabusTopic.findFirst({ where: { id: input.parentId } });
      if (!p || p.subjectId !== input.subjectId || p.levelId !== input.levelId) throw new ServiceError('The parent topic must be in the same subject and form', 422);
      if (id) {
        // A topic cannot move under itself or one of its own sub-topics.
        let cur: string | null = input.parentId;
        while (cur) { if (cur === id) throw new ServiceError('A topic cannot be put under itself', 422); cur = (await tx.syllabusTopic.findFirst({ where: { id: cur }, select: { parentId: true } }))?.parentId ?? null; }
      }
    }
    if ((await depthOf(tx, input.parentId)) > MAX_DEPTH) throw new ServiceError(`Topics go ${MAX_DEPTH} levels deep at most`, 422);
    const order = input.order ?? (await tx.syllabusTopic.count({ where: { subjectId: input.subjectId, levelId: input.levelId, parentId: input.parentId ?? null } }));
    const data = { title: input.title, objectives: input.objectives, parentId: input.parentId ?? null, order };
    let topic;
    if (id) {
      const cur = await tx.syllabusTopic.findFirst({ where: { id } });
      if (!cur || cur.subjectId !== input.subjectId || cur.levelId !== input.levelId) throw new ServiceError('Topic not found', 404);
      topic = await tx.syllabusTopic.update({ where: { id }, data });
    } else topic = await tx.syllabusTopic.create({ data: { schoolId: user.schoolId, subjectId: input.subjectId, levelId: input.levelId, ...data } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_SYLLABUS', entityType: 'SyllabusTopic', entityId: topic.id, detail: `${subject.name}: topic "${topic.title}" ${id ? 'changed' : 'added'}`, after: { title: topic.title, parentId: topic.parentId } }, tx);
    return topic;
  });
}

export async function deleteTopic(user: Actor, id: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const t = await tx.syllabusTopic.findFirst({ where: { id }, include: { _count: { select: { children: true } } } });
    if (!t) throw new ServiceError('Topic not found', 404);
    await assertSubjectInScope(tx, user, t.subjectId);
    if (t._count.children) throw new ServiceError('This topic has sub-topics. Delete or move them first.', 409);
    const used = await tx.schemeWeek.count({ where: { topicIds: { has: id } } });
    if (used) throw new ServiceError(`This topic is in ${used} week${used === 1 ? '' : 's'} of schemes of work, so it cannot be deleted`, 409);
    await tx.syllabusTopic.delete({ where: { id } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_SYLLABUS', entityType: 'SyllabusTopic', entityId: id, detail: `Topic "${t.title}" deleted`, before: { title: t.title } }, tx);
  });
}

export const MAX_IMPORT_ROWS = 2000;

export interface ImportReport { created: number; updated: number; errors: { row: number; message: string }[] }

const header = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, '');
const COLS = { subject: ['subject', 'subjectcode'], level: ['level', 'form'], topic: ['topic'], subtopic: ['subtopic', 'subtopics'], objectives: ['objectives', 'objective', 'learningobjectives'] } as const;

/**
 * Imports topics from a CSV: subject, level, topic, sub-topic, objectives. The subject is found by name or school code and
 * the level by name ("Form 2") or number. Everything is checked first; if any row is wrong nothing is imported.
 */
export async function importSyllabusCsv(user: Actor, text: string): Promise<ImportReport> {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new ServiceError('The file has no rows', 422);
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new ServiceError(`The file has more than ${MAX_IMPORT_ROWS} rows. Split it into smaller files.`, 422);
  const heads = rows[0]!.map(header);
  const col = (k: keyof typeof COLS) => heads.findIndex((h) => (COLS[k] as readonly string[]).includes(h));
  const idx = { subject: col('subject'), level: col('level'), topic: col('topic'), subtopic: col('subtopic'), objectives: col('objectives') };
  const missing = (['subject', 'level', 'topic'] as const).filter((k) => idx[k] < 0);
  if (missing.length) throw new ServiceError(`The file needs these columns: ${missing.join(', ')}`, 422);

  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const scope = await departmentScope(tx, user);
    const [subjects, levels, offered] = await Promise.all([
      tx.subject.findMany({ select: { id: true, name: true, code: true, departmentId: true } }),
      tx.level.findMany({ select: { id: true, name: true, order: true } }),
      tx.subjectLevel.findMany({ select: { subjectId: true, levelId: true } }),
    ]);
    const bySubject = new Map<string, (typeof subjects)[number]>();
    for (const s of subjects) { bySubject.set(s.name.toLowerCase(), s); bySubject.set(s.code.toLowerCase(), s); }
    const byLevel = new Map<string, (typeof levels)[number]>();
    for (const l of levels) { byLevel.set(l.name.toLowerCase(), l); byLevel.set(String(l.order), l); }
    const offeredSet = new Set(offered.map((o) => `${o.subjectId}:${o.levelId}`));
    const errors: ImportReport['errors'] = [];
    interface Line { row: number; subjectId: string; levelId: string; topic: string; sub: string; objectives: string }
    const lines: Line[] = [];
    rows.slice(1).forEach((r, i) => {
      const row = i + 2;
      const cell = (k: number) => (k >= 0 ? (r[k] ?? '').trim() : '');
      const s = bySubject.get(cell(idx.subject).toLowerCase());
      const l = byLevel.get(cell(idx.level).toLowerCase()) ?? byLevel.get(`form ${cell(idx.level).toLowerCase()}`);
      const topic = cell(idx.topic);
      if (!s) return void errors.push({ row, message: `Subject "${cell(idx.subject)}" is not in this school's subject list` });
      if (scope !== 'ALL' && !(s.departmentId && scope.includes(s.departmentId))) return void errors.push({ row, message: `${s.name} is not in your department` });
      if (!l) return void errors.push({ row, message: `Form "${cell(idx.level)}" was not found` });
      if (!offeredSet.has(`${s.id}:${l.id}`)) return void errors.push({ row, message: `${s.name} is not offered in ${l.name}` });
      if (!topic) return void errors.push({ row, message: 'The topic is empty' });
      if (topic.length > 200 || cell(idx.subtopic).length > 200) return void errors.push({ row, message: 'A title is longer than 200 characters' });
      lines.push({ row, subjectId: s.id, levelId: l.id, topic, sub: cell(idx.subtopic), objectives: cell(idx.objectives).slice(0, 2000) });
    });
    if (errors.length) return { created: 0, updated: 0, errors: errors.slice(0, 50) };

    let created = 0, updated = 0;
    const cache = new Map<string, string>(); // "subject:level:parent:title" → topic id
    const find = async (subjectId: string, levelId: string, parentId: string | null, title: string, objectives: string) => {
      const key = `${subjectId}:${levelId}:${parentId ?? ''}:${title.toLowerCase()}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const existing = await tx.syllabusTopic.findFirst({ where: { subjectId, levelId, parentId, title: { equals: title, mode: 'insensitive' } } });
      if (existing) {
        if (objectives && objectives !== (existing.objectives ?? '')) { await tx.syllabusTopic.update({ where: { id: existing.id }, data: { objectives } }); updated++; }
        cache.set(key, existing.id);
        return existing.id;
      }
      const order = await tx.syllabusTopic.count({ where: { subjectId, levelId, parentId } });
      const t = await tx.syllabusTopic.create({ data: { schoolId: user.schoolId, subjectId, levelId, parentId, title, objectives: objectives || null, order } });
      created++;
      cache.set(key, t.id);
      return t.id;
    };
    for (const l of lines) {
      const top = await find(l.subjectId, l.levelId, null, l.topic, l.sub ? '' : l.objectives);
      if (l.sub) await find(l.subjectId, l.levelId, top, l.sub, l.objectives);
    }
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'IMPORT_SYLLABUS', entityType: 'SyllabusTopic', entityId: user.schoolId, detail: `Syllabus imported: ${created} topics added, ${updated} updated`, after: { created, updated, rows: lines.length } }, tx);
    return { created, updated, errors: [] };
  });
}

// ─── Sharing syllabus templates between schools ──────────────────────────────

interface TemplateTopic { title: string; objectives: string | null; children: TemplateTopic[] }
const toTemplate = (n: TopicNode): TemplateTopic => ({ title: n.title, objectives: n.objectives, children: n.children.map(toTemplate) });

/** Shares a subject's topics at a form as a template other schools can start from. It holds topics only, no school data. */
export async function shareSyllabus(user: Actor, subjectId: string, levelId: string, name?: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const subject = await assertSubjectInScope(tx, user, subjectId);
    const level = await tx.level.findFirst({ where: { id: levelId } });
    if (!level) throw new ServiceError('Form not found', 404);
    const rows = await tx.syllabusTopic.findMany({ where: { subjectId, levelId }, select: { id: true, title: true, objectives: true, order: true, parentId: true } });
    if (rows.length === 0) throw new ServiceError('There are no topics to share yet', 409);
    const school = await tx.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { name: true } });
    const tpl = await tx.syllabusTemplate.create({
      data: { name: name?.trim() || `${subject.name} ${level.name}`, subjectName: subject.name, levelOrder: level.order, topics: buildTree(rows).map(toTemplate) as unknown as Prisma.InputJsonValue, sharedBySchool: school.name },
    });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SHARE_SYLLABUS', entityType: 'SyllabusTemplate', entityId: tpl.id, detail: `${subject.name} ${level.name} syllabus shared as a template (${rows.length} topics)`, after: { topics: rows.length } }, tx);
    return { id: tpl.id, topics: rows.length };
  });
}

export async function listTemplates(user: Actor, opts: { subjectName?: string; levelOrder?: number } = {}) {
  const rows = await getScopedDb(user.schoolId, user.id).syllabusTemplate.findMany({
    where: { ...(opts.subjectName ? { subjectName: { equals: opts.subjectName, mode: 'insensitive' as const } } : {}), ...(opts.levelOrder ? { levelOrder: opts.levelOrder } : {}) },
    orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, name: true, subjectName: true, levelOrder: true, sharedBySchool: true, createdAt: true, topics: true },
  });
  const count = (t: unknown): number => (Array.isArray(t) ? t.reduce((s: number, x: { children?: unknown }) => s + 1 + count(x.children), 0) : 0);
  return rows.map((r) => ({ id: r.id, name: r.name, subjectName: r.subjectName, levelOrder: r.levelOrder, sharedBy: r.sharedBySchool, createdAt: r.createdAt.toISOString(), topics: count(r.topics) }));
}

/** Copies a shared syllabus into this school's subject and form (which must have no topics yet). */
export async function importTemplate(user: Actor, templateId: string, subjectId: string, levelId: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const subject = await assertSubjectInScope(tx, user, subjectId);
    const level = await tx.level.findFirst({ where: { id: levelId } });
    if (!level) throw new ServiceError('Form not found', 404);
    if (!(await tx.subjectLevel.findFirst({ where: { subjectId, levelId } }))) throw new ServiceError(`${subject.name} is not offered in ${level.name}`, 422);
    const tpl = await tx.syllabusTemplate.findFirst({ where: { id: templateId } });
    if (!tpl) throw new ServiceError('Template not found', 404);
    if (await tx.syllabusTopic.count({ where: { subjectId, levelId } })) throw new ServiceError(`${subject.name} ${level.name} already has topics. Import a template into an empty syllabus.`, 409);
    let n = 0;
    const add = async (nodes: TemplateTopic[], parentId: string | null) => {
      for (let order = 0; order < nodes.length; order++) {
        const t = nodes[order]!;
        const row = await tx.syllabusTopic.create({ data: { schoolId: user.schoolId, subjectId, levelId, parentId, title: String(t.title).slice(0, 200), objectives: t.objectives ? String(t.objectives).slice(0, 2000) : null, order } });
        n++;
        await add(Array.isArray(t.children) ? t.children : [], row.id);
      }
    };
    await add(tpl.topics as unknown as TemplateTopic[], null);
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'IMPORT_SYLLABUS', entityType: 'SyllabusTemplate', entityId: tpl.id, detail: `${subject.name} ${level.name}: ${n} topics imported from the template "${tpl.name}" (${tpl.sharedBySchool})`, after: { topics: n } }, tx);
    return { topics: n };
  });
}

// ─── Schemes of work ─────────────────────────────────────────────────────────

const SCHEME_EDITABLE: SchemeStatus[] = ['DRAFT', 'RETURNED'];

/** The assignment of a scheme, if the person may work on it as its teacher (or an administrator). */
async function ownAssignment(tx: Db, user: Actor, assignmentId: string) {
  const a = await tx.teacherAssignment.findFirst({
    where: { id: assignmentId },
    include: { subject: { select: { id: true, name: true, shortName: true, departmentId: true } }, class: { select: { name: true, levelId: true } }, group: { select: { name: true, levelId: true } }, teacher: { select: { id: true, fullName: true } } },
  });
  if (!a) throw new ServiceError('Assignment not found', 404);
  if (a.teacherId !== user.id && a.coTeacherId !== user.id) throw new ServiceError('Assignment not found', 404);
  return a;
}

/** The assignment of a scheme, if the person may read or decide it: its teacher, or someone whose department scope covers the subject. */
async function readableAssignment(tx: Db, user: Actor, assignmentId: string) {
  const a = await tx.teacherAssignment.findFirst({
    where: { id: assignmentId },
    include: { subject: { select: { id: true, name: true, shortName: true, departmentId: true } }, class: { select: { name: true, levelId: true } }, group: { select: { name: true, levelId: true } }, teacher: { select: { id: true, fullName: true } } },
  });
  if (!a) throw new ServiceError('Assignment not found', 404);
  if (a.teacherId === user.id || a.coTeacherId === user.id) return a;
  if (holds(user, 'academics.schemes.approve') || holds(user, 'academics.analytics.view')) {
    const scope = await departmentScope(tx, user);
    if (scope === 'ALL' || (a.subject.departmentId && scope.includes(a.subject.departmentId))) return a;
  }
  throw new ServiceError('Assignment not found', 404);
}

export const levelOfAssignment = (a: { class: { levelId: string } | null; group: { levelId: string } | null }) => (a.class?.levelId ?? a.group!.levelId);

export interface WeekView {
  id: string; weekNo: number; startDate: string; endDate: string; topicIds: string[]; topics: { id: string; title: string; parent: string | null }[];
  objectives: string | null; activities: string | null; resources: string | null; assessment: string | null;
  record: { coveredTopicIds: string[]; extraNotes: string | null; problems: string | null; recordedAt: string } | null; due: boolean; current: boolean;
}

export function coveragePercent(weeks: { topicIds: string[]; startDate: string; record: { coveredTopicIds: string[] } | null }[], asOf: string): { due: number; covered: number; pct: number | null } {
  const due = new Set(weeks.filter((w) => w.startDate <= asOf).flatMap((w) => w.topicIds));
  const covered = new Set(weeks.flatMap((w) => w.record?.coveredTopicIds ?? []).filter((t) => due.has(t)));
  return { due: due.size, covered: covered.size, pct: due.size === 0 ? null : Math.round((covered.size / due.size) * 100) };
}

/** A scheme of work with its weeks, the record of each week and the coverage so far. */
export async function getScheme(user: Actor, assignmentId: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await readableAssignment(tx, user, assignmentId);
    const term = await tx.academicTerm.findFirstOrThrow({ where: { id: a.termId } });
    const scheme = await tx.schemeOfWork.findUnique({ where: { assignmentId }, include: { weeks: { orderBy: { weekNo: 'asc' }, include: { record: true } } } });
    const levelId = levelOfAssignment(a);
    const topics = await tx.syllabusTopic.findMany({ where: { subjectId: a.subjectId, levelId }, select: { id: true, title: true, objectives: true, order: true, parentId: true } });
    const title = new Map(topics.map((t) => [t.id, t]));
    const today = todayInHarare();
    const weeks: WeekView[] = (scheme?.weeks ?? []).map((w, i, all) => {
      const start = isoOf(w.startDate);
      const nextStart = all[i + 1] ? isoOf(all[i + 1]!.startDate) : '9999-12-31';
      return {
        id: w.id, weekNo: w.weekNo, startDate: start, endDate: addDaysIso(start, 6), topicIds: w.topicIds,
        topics: w.topicIds.map((id) => ({ id, title: title.get(id)?.title ?? '(removed topic)', parent: title.get(id)?.parentId ? title.get(title.get(id)!.parentId!)?.title ?? null : null })),
        objectives: w.objectives, activities: w.activities, resources: w.resources, assessment: w.assessment,
        record: w.record ? { coveredTopicIds: w.record.coveredTopicIds, extraNotes: w.record.extraNotes, problems: w.record.problems, recordedAt: w.record.recordedAt.toISOString() } : null,
        due: start <= today, current: start <= today && today < nextStart,
      };
    });
    const mine = a.teacherId === user.id || a.coTeacherId === user.id;
    const dueDate = term.schemeDueDate ? isoOf(term.schemeDueDate) : null;
    const status = scheme?.status ?? 'NONE';
    return {
      assignment: { id: a.id, subject: a.subject.name, shortName: a.subject.shortName ?? a.subject.name, target: a.class?.name ?? a.group?.name ?? '', teacher: a.teacher.fullName, levelId, termId: term.id, termName: term.name, status: a.status },
      term: { id: term.id, name: term.name, status: term.status },
      scheme: scheme ? { id: scheme.id, status: scheme.status, submittedAt: scheme.submittedAt?.toISOString() ?? null, returnComment: scheme.returnComment, approvedAt: scheme.approvedAt?.toISOString() ?? null } : null,
      weeks, topics: buildTree(topics), dueDate, late: !!dueDate && dueDate < today && (status === 'NONE' || SCHEME_EDITABLE.includes(status as SchemeStatus)),
      coverage: coveragePercent(weeks.map((w) => ({ topicIds: w.topicIds, startDate: w.startDate, record: w.record })), today),
      canEdit: mine && holds(user, 'academics.schemes.edit') && term.status !== 'CLOSED' && (!scheme || SCHEME_EDITABLE.includes(scheme.status)),
      canRecord: mine && holds(user, 'academics.schemes.edit') && term.status !== 'CLOSED' && !!scheme,
      canDecide: holds(user, 'academics.schemes.approve') && scheme?.status === 'SUBMITTED',
    };
  });
}

function addDaysIso(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Makes the scheme of an assignment with one empty row per teaching week of the term (or adds the weeks it lacks). */
export async function createScheme(user: Actor, assignmentId: string) {
  const db = getScopedDb(user.schoolId, user.id);
  const pre = await db.teacherAssignment.findFirst({ where: { id: assignmentId }, select: { termId: true } });
  if (!pre) throw new ServiceError('Assignment not found', 404);
  const termRow = await db.academicTerm.findFirstOrThrow({ where: { id: pre.termId } });
  const weeks = await weeksOfTerm(db, user, termRow);
  return db.$tx(async (tx) => {
    const a = await ownAssignment(tx, user, assignmentId);
    const term = await writableTerm(tx, user.schoolId, a.termId);
    if (a.status !== 'ACTIVE') throw new ServiceError('This assignment has ended', 409);
    let scheme = await tx.schemeOfWork.findUnique({ where: { assignmentId } });
    if (scheme && !SCHEME_EDITABLE.includes(scheme.status)) throw new ServiceError('This scheme has been submitted, so it cannot be changed', 409);
    if (!scheme) scheme = await tx.schemeOfWork.create({ data: { schoolId: user.schoolId, termId: term.id, assignmentId } });
    const have = new Set((await tx.schemeWeek.findMany({ where: { schemeId: scheme.id }, select: { weekNo: true } })).map((w) => w.weekNo));
    const fresh = weeks.filter((w) => !have.has(w.weekNo));
    if (fresh.length) await tx.schemeWeek.createMany({ data: fresh.map((w) => ({ schoolId: user.schoolId, schemeId: scheme!.id, weekNo: w.weekNo, startDate: toDay(w.startDate) })) });
    if (fresh.length || !have.size) await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_SCHEME', entityType: 'SchemeOfWork', entityId: scheme.id, detail: `${a.subject.name} for ${a.class?.name ?? a.group?.name}: scheme of work started with ${fresh.length} week${fresh.length === 1 ? '' : 's'}`, after: { weeks: fresh.length } }, tx);
    return { id: scheme.id, weeks: fresh.length };
  });
}

const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
export const WeeksSchema = z.object({
  weeks: z.array(z.object({
    weekNo: z.number().int().min(1).max(60), topicIds: z.array(idSchema).max(40).default([]),
    objectives: text(2000), activities: text(2000), resources: text(1000), assessment: text(1000),
  })).min(1).max(60),
});

export async function saveSchemeWeeks(user: Actor, assignmentId: string, raw: z.input<typeof WeeksSchema>) {
  const input = WeeksSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await ownAssignment(tx, user, assignmentId);
    await writableTerm(tx, user.schoolId, a.termId);
    const scheme = await tx.schemeOfWork.findUnique({ where: { assignmentId }, include: { weeks: true } });
    if (!scheme) throw new ServiceError('Start the scheme first', 409);
    if (!SCHEME_EDITABLE.includes(scheme.status)) throw new ServiceError('This scheme has been submitted, so it cannot be changed', 409);
    const topicIds = dedupe(input.weeks.flatMap((w) => w.topicIds));
    if (topicIds.length) {
      const ok = await tx.syllabusTopic.count({ where: { id: { in: topicIds }, subjectId: a.subjectId, levelId: levelOfAssignment(a) } });
      if (ok !== topicIds.length) throw new ServiceError('A topic is not in this subject\'s syllabus for this form', 422);
    }
    const byNo = new Map(scheme.weeks.map((w) => [w.weekNo, w]));
    let changed = 0;
    for (const w of input.weeks) {
      const cur = byNo.get(w.weekNo);
      if (!cur) throw new ServiceError(`Week ${w.weekNo} is not a teaching week of this term`, 422);
      await tx.schemeWeek.update({ where: { id: cur.id }, data: { topicIds: dedupe(w.topicIds), objectives: w.objectives, activities: w.activities, resources: w.resources, assessment: w.assessment } });
      changed++;
    }
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_SCHEME', entityType: 'SchemeOfWork', entityId: scheme.id, detail: `${a.subject.name} for ${a.class?.name ?? a.group?.name}: ${changed} week${changed === 1 ? '' : 's'} of the scheme saved`, after: { weeks: changed } }, tx);
    return { saved: changed };
  });
}

/** Copies last year's scheme for the same subject and form into this one, re-dated to this term's weeks. */
export async function copySchemeFromLastYear(user: Actor, assignmentId: string, overwrite = false) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await ownAssignment(tx, user, assignmentId);
    const term = await writableTerm(tx, user.schoolId, a.termId);
    const scheme = await tx.schemeOfWork.findUnique({ where: { assignmentId }, include: { weeks: { orderBy: { weekNo: 'asc' } } } });
    if (!scheme) throw new ServiceError('Start the scheme first', 409);
    if (!SCHEME_EDITABLE.includes(scheme.status)) throw new ServiceError('This scheme has been submitted, so it cannot be changed', 409);
    if (!overwrite && scheme.weeks.some((w) => w.topicIds.length || w.objectives || w.activities)) throw new ServiceError('This scheme already has content. Confirm that you want to replace it.', 409);
    const year = await tx.academicYear.findFirstOrThrow({ where: { terms: { some: { id: term.id } } } });
    const levelId = levelOfAssignment(a);
    const source = await tx.schemeOfWork.findFirst({
      where: {
        assignmentId: { not: assignmentId }, assignment: { subjectId: a.subjectId, OR: [{ class: { levelId } }, { group: { levelId } }] },
        term: { termNumber: term.termNumber, academicYear: { year: { lt: year.year } } }, weeks: { some: { OR: [{ topicIds: { isEmpty: false } }, { objectives: { not: null } }] } },
      },
      orderBy: { term: { startDate: 'desc' } }, include: { weeks: { orderBy: { weekNo: 'asc' } }, term: { select: { name: true } } },
    });
    if (!source) throw new ServiceError('No scheme from an earlier year was found for this subject and form', 404);
    const mine = new Map(scheme.weeks.map((w) => [w.weekNo, w]));
    let copied = 0;
    for (const w of source.weeks) {
      const target = mine.get(w.weekNo);
      if (!target) continue; // this term is shorter: the extra weeks are left out
      await tx.schemeWeek.update({ where: { id: target.id }, data: { topicIds: w.topicIds, objectives: w.objectives, activities: w.activities, resources: w.resources, assessment: w.assessment } });
      copied++;
    }
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_SCHEME', entityType: 'SchemeOfWork', entityId: scheme.id, detail: `${a.subject.name} for ${a.class?.name ?? a.group?.name}: ${copied} weeks copied from ${source.term.name}`, after: { from: source.term.name, weeks: copied } }, tx);
    return { copied, from: source.term.name };
  });
}

export async function submitScheme(user: Actor, assignmentId: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await ownAssignment(tx, user, assignmentId);
    const term = await writableTerm(tx, user.schoolId, a.termId);
    const scheme = await tx.schemeOfWork.findUnique({ where: { assignmentId }, include: { weeks: true } });
    if (!scheme) throw new ServiceError('Start the scheme first', 409);
    if (!SCHEME_EDITABLE.includes(scheme.status)) throw new ServiceError('This scheme has already been submitted', 409);
    const filled = scheme.weeks.filter((w) => w.topicIds.length || w.objectives);
    if (filled.length === 0) throw new ServiceError('Plan at least one week (a topic or objectives) before submitting', 422);
    await tx.schemeOfWork.update({ where: { id: scheme.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), returnComment: null } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SUBMIT_SCHEME', entityType: 'SchemeOfWork', entityId: scheme.id, detail: `${a.teacher.fullName}: ${a.subject.name} scheme for ${a.class?.name ?? a.group?.name} submitted (${term.name})`, after: { filledWeeks: filled.length } }, tx);
    const hod = a.subject.departmentId ? await tx.department.findFirst({ where: { id: a.subject.departmentId }, select: { hodUserId: true } }) : null;
    const approvers = dedupe([hod?.hodUserId, ...(await peopleWith(tx, user.schoolId, 'academics.schemes.approve', user.id))].filter((x): x is string => !!x));
    await notifyUsers(tx, user.schoolId, approvers.filter((x) => x !== user.id), { type: 'SCHEME', title: `Scheme of work to approve: ${a.subject.shortName ?? a.subject.name}, ${a.class?.name ?? a.group?.name}`, body: a.teacher.fullName, link: `/academics/schemes/${assignmentId}` });
    return { status: 'SUBMITTED' };
  });
}

export const DecideSchemeSchema = z.object({ decision: z.enum(['APPROVE', 'RETURN']), comment: noteSchema(500) });

export async function decideScheme(user: Actor, assignmentId: string, raw: z.input<typeof DecideSchemeSchema>) {
  const input = DecideSchemeSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await readableAssignment(tx, user, assignmentId);
    await writableTerm(tx, user.schoolId, a.termId);
    const scheme = await tx.schemeOfWork.findUnique({ where: { assignmentId } });
    if (!scheme || scheme.status !== 'SUBMITTED') throw new ServiceError('This scheme is not waiting for approval', 409);
    if (input.decision === 'RETURN' && !input.comment) throw new ServiceError('Say what the teacher must change', 422);
    await tx.schemeOfWork.update({
      where: { id: scheme.id },
      data: input.decision === 'APPROVE'
        ? { status: 'APPROVED', approvedById: user.id, approvedAt: new Date(), returnComment: null }
        : { status: 'RETURNED', returnComment: input.comment!, approvedById: null, approvedAt: null },
    });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: input.decision === 'APPROVE' ? 'APPROVE_SCHEME' : 'RETURN_SCHEME', entityType: 'SchemeOfWork', entityId: scheme.id, detail: `${a.subject.name} scheme for ${a.class?.name ?? a.group?.name} (${a.teacher.fullName}) ${input.decision === 'APPROVE' ? 'approved' : 'returned'}${input.comment ? `: ${input.comment}` : ''}`, after: { decision: input.decision } }, tx);
    await notifyUsers(tx, user.schoolId, [a.teacherId].filter((x) => x !== user.id), { type: 'SCHEME', title: `Your scheme was ${input.decision === 'APPROVE' ? 'approved' : 'returned'}: ${a.subject.shortName ?? a.subject.name}, ${a.class?.name ?? a.group?.name}`, body: input.comment, link: `/academics/schemes/${assignmentId}` });
    return { status: input.decision === 'APPROVE' ? 'APPROVED' : 'RETURNED' };
  });
}

export interface SchemeRow {
  assignmentId: string; subject: string; target: string; teacher: string; teacherId: string; department: string | null; departmentId: string | null;
  status: SchemeStatus | 'NONE'; submittedAt: string | null; late: boolean; coverage: number | null; due: number;
}

/** Every live assignment of the term with the state of its scheme: mine, my department's or the school's, by what the person may see. */
export async function listSchemes(user: Actor, opts: { termId?: string; departmentId?: string; status?: string } = {}) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, opts.termId);
    const wide = holds(user, 'academics.schemes.approve');
    const scope = wide ? await departmentScope(tx, user) : null;
    const where: Prisma.TeacherAssignmentWhereInput = {
      termId: term.id, status: 'ACTIVE',
      ...(wide ? (scope === 'ALL' ? {} : { subject: { departmentId: { in: scope! } } }) : { OR: [{ teacherId: user.id }, { coTeacherId: user.id }] }),
      ...(opts.departmentId ? { subject: { departmentId: opts.departmentId } } : {}),
    };
    const list = await tx.teacherAssignment.findMany({
      where, include: { subject: { select: { name: true, shortName: true, department: { select: { id: true, name: true } } } }, class: { select: { name: true } }, group: { select: { name: true } }, teacher: { select: { id: true, fullName: true } },
        schemes: { include: { weeks: { include: { record: { select: { coveredTopicIds: true } } } } } } },
      orderBy: [{ subject: { name: 'asc' } }, { class: { name: 'asc' } }],
    });
    const today = todayInHarare();
    const due = term.schemeDueDate ? isoOf(term.schemeDueDate) : null;
    const rows: SchemeRow[] = list.map((a) => {
      const s = a.schemes[0];
      const status = (s?.status ?? 'NONE') as SchemeRow['status'];
      const cov = s ? coveragePercent(s.weeks.map((w) => ({ topicIds: w.topicIds, startDate: isoOf(w.startDate), record: w.record ? { coveredTopicIds: w.record.coveredTopicIds } : null })), today) : { pct: null, due: 0 };
      return {
        assignmentId: a.id, subject: a.subject.shortName ?? a.subject.name, target: a.class?.name ?? a.group?.name ?? '', teacher: a.teacher.fullName, teacherId: a.teacher.id,
        department: a.subject.department?.name ?? null, departmentId: a.subject.department?.id ?? null, status, submittedAt: s?.submittedAt?.toISOString() ?? null,
        late: !!due && due < today && (status === 'NONE' || status === 'DRAFT' || status === 'RETURNED'), coverage: cov.pct, due: cov.due,
      };
    }).filter((r) => !opts.status || r.status === opts.status);
    return { term: { id: term.id, name: term.name, status: term.status }, dueDate: due, rows, wide };
  });
}

// ─── Record of work ──────────────────────────────────────────────────────────

export const RecordSchema = z.object({
  coveredTopicIds: z.array(idSchema).max(40).default([]),
  extraNotes: text(1000),
  problems: text(1000),
});

/** What was actually covered in a week: the planned topics ticked, anything extra, and problems ("lost 2 lessons to sports day"). */
export async function saveRecord(user: Actor, schemeWeekId: string, raw: z.input<typeof RecordSchema>) {
  const input = RecordSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const week = await tx.schemeWeek.findFirst({ where: { id: schemeWeekId }, include: { scheme: true } });
    if (!week) throw new ServiceError('Week not found', 404);
    const a = await ownAssignment(tx, user, week.scheme.assignmentId);
    await writableTerm(tx, user.schoolId, a.termId);
    if (isoOf(week.startDate) > todayInHarare()) throw new ServiceError('This week has not started yet', 409);
    const covered = dedupe(input.coveredTopicIds);
    const bad = covered.find((t) => !week.topicIds.includes(t));
    if (bad) throw new ServiceError('You can only tick topics that were planned for this week. Write anything else under "extra".', 422);
    const rec = await tx.recordOfWork.upsert({
      where: { schemeWeekId },
      update: { coveredTopicIds: covered, extraNotes: input.extraNotes, problems: input.problems, recordedById: user.id, recordedAt: new Date() },
      create: { schoolId: user.schoolId, schemeWeekId, coveredTopicIds: covered, extraNotes: input.extraNotes, problems: input.problems, recordedById: user.id },
    });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'RECORD_WORK', entityType: 'RecordOfWork', entityId: rec.id, detail: `${a.subject.name} for ${a.class?.name ?? a.group?.name}, week ${week.weekNo}: ${covered.length} of ${week.topicIds.length} planned topics covered`, after: { covered: covered.length, planned: week.topicIds.length, problems: input.problems } }, tx);
    return { covered: covered.length, planned: week.topicIds.length };
  });
}

/**
 * On Fridays: teachers whose scheme has a week under way that has no record yet are reminded. Safe to run twice (one reminder per
 * teacher per week). Called by the daily schedule.
 */
export async function remindRecordOfWork(schoolId: string, today: string): Promise<number> {
  const d = new Date(`${today}T00:00:00Z`);
  if (d.getUTCDay() !== 5) return 0; // Friday
  const db = getScopedDb(schoolId);
  return db.$tx(async (tx) => {
    const term = await tx.academicTerm.findFirst({ where: { status: 'OPEN', startDate: { lte: toDay(today) }, endDate: { gte: toDay(today) } } });
    if (!term) return 0;
    const monday = addDaysIso(today, -4);
    const weeks = await tx.schemeWeek.findMany({
      where: { startDate: { gte: toDay(monday), lte: toDay(today) }, scheme: { termId: term.id, status: { in: ['SUBMITTED', 'APPROVED'] }, assignment: { status: 'ACTIVE' } }, topicIds: { isEmpty: false }, record: null },
      select: { weekNo: true, scheme: { select: { assignmentId: true, assignment: { select: { teacherId: true, subject: { select: { shortName: true, name: true } }, class: { select: { name: true } }, group: { select: { name: true } } } } } } },
    });
    let sent = 0;
    for (const w of weeks) {
      const a = w.scheme.assignment;
      sent += await notifyUsers(tx, schoolId, [a.teacherId], {
        type: 'RECORD_OF_WORK', title: `Record this week's work: ${a.subject.shortName ?? a.subject.name}, ${a.class?.name ?? a.group?.name}`, body: `Week ${w.weekNo}. It takes under a minute.`,
        link: `/academics/schemes/${w.scheme.assignmentId}`, dedupeKey: `record-of-work:${w.scheme.assignmentId}:${monday}`,
      });
    }
    return sent;
  });
}

// ─── Lesson plans (optional) ─────────────────────────────────────────────────

export const LessonPlanSchema = z.object({
  slotId: idSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  schemeWeekId: idSchema.nullish(),
  content: z.object({
    objectives: text(2000), introduction: text(2000), development: text(4000), conclusion: text(2000), evaluation: text(2000),
  }),
});

export async function saveLessonPlan(user: Actor, raw: z.input<typeof LessonPlanSchema>) {
  const input = LessonPlanSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const settings = await loadSettings(tx, user.schoolId);
    if (!settings.lessonPlans) throw new ServiceError('Lesson plans are switched off for this school', 409);
    const slot = await tx.timetableSlot.findFirst({ where: { id: input.slotId }, include: { assignment: true, timetable: { select: { termId: true } } } });
    if (!slot) throw new ServiceError('Lesson not found', 404);
    const a = await ownAssignment(tx, user, slot.assignmentId);
    await writableTerm(tx, user.schoolId, slot.timetable.termId);
    if (input.schemeWeekId) {
      const w = await tx.schemeWeek.findFirst({ where: { id: input.schemeWeekId, scheme: { assignmentId: a.id } } });
      if (!w) throw new ServiceError('That week is not in this lesson\'s scheme', 422);
    }
    const plan = await tx.lessonPlan.upsert({
      where: { slotId_date: { slotId: slot.id, date: toDay(input.date) } },
      update: { schemeWeekId: input.schemeWeekId ?? null, content: input.content as Prisma.InputJsonValue, teacherId: user.id },
      create: { schoolId: user.schoolId, slotId: slot.id, date: toDay(input.date), schemeWeekId: input.schemeWeekId ?? null, teacherId: user.id, content: input.content as Prisma.InputJsonValue },
    });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_LESSON_PLAN', entityType: 'LessonPlan', entityId: plan.id, detail: `Lesson plan saved for ${input.date}`, after: { slotId: slot.id, date: input.date } }, tx);
    return { id: plan.id };
  });
}

export async function getLessonPlan(user: Actor, slotId: string, date: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const slot = await tx.timetableSlot.findFirst({ where: { id: slotId }, select: { assignmentId: true } });
    if (!slot) throw new ServiceError('Lesson not found', 404);
    await readableAssignment(tx, user, slot.assignmentId);
    const p = await tx.lessonPlan.findUnique({ where: { slotId_date: { slotId, date: toDay(date) } } });
    return p ? { id: p.id, schemeWeekId: p.schemeWeekId, content: p.content as Record<string, string | null> } : null;
  });
}

