// Departments and the school's own, editable list of subjects. Nothing about subjects is hard-coded: the starter list
// below is only a starting point a school edits before it is saved. Every change to the subject list needs Head
// approval (academics.subjects.approve). Someone who holds that permission is the approver of their own change (it is
// recorded); everyone else's change waits as a SubjectChange and the approvers are told.
import { z } from 'zod';
import type { Prisma, SubjectExamBoard, SubjectType } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { can } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { notifyUsers } from '@/lib/system/notifications';
import { colourSchema, dedupe, idSchema, noteSchema, peopleWith, type Actor } from '@/lib/academics/common';
import { grantScopedRole, revokeScopedRole } from '@/lib/academics/roles';

// ─── Departments ─────────────────────────────────────────────────────────────

export const DepartmentSchema = z.object({
  name: z.string().trim().min(2, 'Give the department a name').max(60),
  hodUserId: idSchema.nullable().optional(),
});
export type DepartmentInput = z.input<typeof DepartmentSchema>;

/** Makes the person the head of the department: they get the HOD role scoped to it; the previous head loses it. */
async function setHod(tx: Db, schoolId: string, deptId: string, previous: string | null, next: string | null) {
  if (previous === next) return;
  if (next) {
    const u = await tx.user.findFirst({ where: { id: next, schoolId, isSupport: false }, select: { active: true, fullName: true } });
    if (!u) throw new ServiceError('The head of department was not found', 404);
    if (!u.active) throw new ServiceError(`${u.fullName} is not an active user`, 409);
    await grantScopedRole(tx, schoolId, next, 'HOD', 'DEPARTMENT', deptId);
  }
  if (previous) await revokeScopedRole(tx, schoolId, previous, 'HOD', 'DEPARTMENT', deptId);
}

export async function listDepartments(user: Actor) {
  const db = getScopedDb(user.schoolId, user.id);
  const rows = await db.department.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, hodUserId: true, hod: { select: { fullName: true } }, _count: { select: { subjects: true } } },
  });
  return rows.map((d) => ({ id: d.id, name: d.name, hodUserId: d.hodUserId, hodName: d.hod?.fullName ?? null, subjects: d._count.subjects }));
}

export async function createDepartment(user: Actor, raw: DepartmentInput) {
  const input = DepartmentSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const clash = await tx.department.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' } } });
    if (clash) throw new ServiceError(`There is already a department called ${clash.name}`, 409);
    const d = await tx.department.create({ data: { schoolId: user.schoolId, name: input.name } });
    await setHod(tx, user.schoolId, d.id, null, input.hodUserId ?? null);
    if (input.hodUserId) await tx.department.update({ where: { id: d.id }, data: { hodUserId: input.hodUserId } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'CREATE_DEPARTMENT', entityType: 'Department', entityId: d.id, detail: `Department ${d.name} added`, after: { name: d.name, hodUserId: input.hodUserId ?? null } }, tx);
    return d;
  });
}

export async function updateDepartment(user: Actor, id: string, raw: DepartmentInput) {
  const input = DepartmentSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const d = await tx.department.findFirst({ where: { id } });
    if (!d) throw new ServiceError('Department not found', 404);
    const clash = await tx.department.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' }, id: { not: id } } });
    if (clash) throw new ServiceError(`There is already a department called ${clash.name}`, 409);
    const hod = input.hodUserId === undefined ? d.hodUserId : input.hodUserId;
    await setHod(tx, user.schoolId, id, d.hodUserId, hod);
    const after = await tx.department.update({ where: { id }, data: { name: input.name, hodUserId: hod } });
    await logAudit(
      { schoolId: user.schoolId, actorId: user.id, action: 'UPDATE_DEPARTMENT', entityType: 'Department', entityId: id, detail: `Department ${after.name} changed`, before: { name: d.name, hodUserId: d.hodUserId }, after: { name: after.name, hodUserId: after.hodUserId } },
      tx,
    );
    return after;
  });
}

export async function deleteDepartment(user: Actor, id: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const d = await tx.department.findFirst({ where: { id }, include: { _count: { select: { subjects: true } } } });
    if (!d) throw new ServiceError('Department not found', 404);
    if (d._count.subjects > 0) throw new ServiceError(`${d.name} still has ${d._count.subjects} subject${d._count.subjects === 1 ? '' : 's'}. Move them to another department first.`, 409);
    await setHod(tx, user.schoolId, id, d.hodUserId, null);
    await tx.department.delete({ where: { id } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'DELETE_DEPARTMENT', entityType: 'Department', entityId: id, detail: `Department ${d.name} deleted`, before: { name: d.name } }, tx);
  });
}

// ─── Subjects ────────────────────────────────────────────────────────────────

export const EXAM_BOARDS = ['ZIMSEC', 'CAMBRIDGE', 'SCHOOL'] as const satisfies readonly SubjectExamBoard[];
export const EXAM_BOARD_LABEL: Record<SubjectExamBoard, string> = { ZIMSEC: 'ZIMSEC', CAMBRIDGE: 'Cambridge', SCHOOL: 'School only' };

const optionalCode = (label: string) =>
  z.string().trim().max(20, `${label} is too long`).optional().nullable().transform((v) => (v ? v.toUpperCase() : null));

export const SubjectSchema = z.object({
  name: z.string().trim().min(2, 'Give the subject a name').max(60),
  shortName: z.string().trim().min(1, 'Give the subject a short name for the timetable').max(14, 'The short name is at most 14 characters'),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, 'The school code is 2 to 12 capital letters, digits or dashes'),
  zimsecCode: optionalCode('The ZIMSEC code'),
  cambridgeCode: optionalCode('The Cambridge code'),
  departmentId: idSchema,
  examBoard: z.enum(EXAM_BOARDS, { error: 'Choose an exam board' }),
  isPractical: z.boolean().default(false),
  colour: colourSchema.default('#0F766E'),
  active: z.boolean().default(true),
  levels: z
    .array(z.object({ levelId: idSchema, type: z.enum(['CORE', 'ELECTIVE'] as const satisfies readonly SubjectType[]) }))
    .min(1, 'Tick at least one form that offers the subject')
    .max(6),
});
export type SubjectInput = z.input<typeof SubjectSchema>;
type SubjectData = z.output<typeof SubjectSchema>;

/** Checks the subject against the school's data (department, forms, code, exam board). */
async function checkSubject(tx: Db, schoolId: string, data: SubjectData, selfId: string | null) {
  const [dept, levels, school, codeClash, nameClash] = await Promise.all([
    tx.department.findFirst({ where: { id: data.departmentId } }),
    tx.level.findMany({ where: { id: { in: data.levels.map((l) => l.levelId) } } }),
    tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { offersCambridge: true } }),
    tx.subject.findFirst({ where: { code: data.code, ...(selfId ? { id: { not: selfId } } : {}) } }),
    tx.subject.findFirst({ where: { name: { equals: data.name, mode: 'insensitive' }, ...(selfId ? { id: { not: selfId } } : {}) } }),
  ]);
  if (!dept) throw new ServiceError('Department not found', 404);
  if (levels.length !== new Set(data.levels.map((l) => l.levelId)).size) throw new ServiceError('One of the forms was not found', 404);
  const off = levels.find((l) => !l.active);
  if (off) throw new ServiceError(`${off.name} is switched off for this school`, 409);
  if (codeClash) throw new ServiceError(`The school code ${data.code} is already used by ${codeClash.name}`, 409);
  if (nameClash) throw new ServiceError(`There is already a subject called ${nameClash.name}`, 409);
  if (data.examBoard === 'CAMBRIDGE' && !school.offersCambridge) throw new ServiceError('This school does not offer Cambridge. Switch it on in School Settings first.', 409);
}

async function writeSubject(tx: Db, schoolId: string, selfId: string | null, data: SubjectData) {
  const legacyType: SubjectType = data.levels.some((l) => l.type === 'CORE') ? 'CORE' : 'ELECTIVE';
  const row = {
    name: data.name, shortName: data.shortName, code: data.code, zimsecCode: data.zimsecCode, cambridgeCode: data.cambridgeCode,
    departmentId: data.departmentId, examBoard: data.examBoard, isPractical: data.isPractical, colour: data.colour, active: data.active, type: legacyType,
  };
  const subject = selfId
    ? await tx.subject.update({ where: { id: selfId }, data: row })
    : await tx.subject.create({ data: { schoolId, ...row } });

  const existing = await tx.subjectLevel.findMany({ where: { subjectId: subject.id } });
  const wanted = new Map(data.levels.map((l) => [l.levelId, l.type]));
  const removed = existing.filter((e) => !wanted.has(e.levelId));
  if (removed.length) {
    // A form can stop offering a subject only when no class of that form is taught it any more.
    const taught = await tx.teacherAssignment.findMany({
      where: { subjectId: subject.id, status: 'ACTIVE', term: { status: { not: 'CLOSED' } }, OR: [{ class: { levelId: { in: removed.map((r) => r.levelId) } } }, { group: { levelId: { in: removed.map((r) => r.levelId) } } }] },
      select: { class: { select: { name: true } }, group: { select: { name: true } } },
    });
    if (taught.length) {
      const names = dedupe(taught.map((t) => t.class?.name ?? t.group?.name ?? '')).join(', ');
      throw new ServiceError(`${subject.name} is still taught in ${names}. End those assignments before the form stops offering it.`, 409);
    }
    await tx.subjectLevel.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
  }
  for (const [levelId, type] of Array.from(wanted)) {
    await tx.subjectLevel.upsert({
      where: { subjectId_levelId: { subjectId: subject.id, levelId } },
      update: { type },
      create: { schoolId, subjectId: subject.id, levelId, type },
    });
  }
  return subject;
}

const snapshot = (s: { name: string; shortName: string | null; code: string; departmentId: string | null; examBoard: SubjectExamBoard; isPractical: boolean; active: boolean }, levels: { levelId: string; type: SubjectType }[]) => ({
  name: s.name, shortName: s.shortName, code: s.code, departmentId: s.departmentId, examBoard: s.examBoard, isPractical: s.isPractical, active: s.active,
  levels: levels.map((l) => `${l.levelId}:${l.type}`).sort(),
});

export interface SubjectSaveResult { applied: boolean; subjectId: string | null; changeId: string }

/** Applies a validated change now. The caller has checked who may. */
async function applyChange(tx: Db, actor: Actor, kind: 'CREATE' | 'UPDATE' | 'DEACTIVATE' | 'REACTIVATE', subjectId: string | null, data: SubjectData, approvedBy: string): Promise<string> {
  const schoolId = actor.schoolId;
  let before: ReturnType<typeof snapshot> | null = null;
  if (subjectId) {
    const cur = await tx.subject.findFirst({ where: { id: subjectId }, include: { levels: true } });
    if (!cur) throw new ServiceError('Subject not found', 404);
    before = snapshot(cur, cur.levels);
  }
  await checkSubject(tx, schoolId, data, subjectId);
  const s = await writeSubject(tx, schoolId, subjectId, data);
  const levels = await tx.subjectLevel.findMany({ where: { subjectId: s.id } });
  await logAudit(
    {
      schoolId, actorId: actor.id, action: kind === 'CREATE' ? 'CREATE_SUBJECT' : 'UPDATE_SUBJECT', entityType: 'Subject', entityId: s.id,
      detail: `${s.name}: ${kind === 'CREATE' ? 'added' : kind === 'DEACTIVATE' ? 'made inactive' : kind === 'REACTIVATE' ? 'made active' : 'changed'} (approved by ${approvedBy})`,
      ...(before ? { before } : {}), after: snapshot(s, levels),
    },
    tx,
  );
  return s.id;
}

/**
 * Adds or changes a subject. A person who may approve subject changes makes the change now (and is recorded as its
 * approver); anyone else's change waits for approval and the approvers are notified.
 */
export async function saveSubject(user: Actor, subjectId: string | null, raw: SubjectInput): Promise<SubjectSaveResult> {
  const data = SubjectSchema.parse(raw);
  const kind = subjectId ? 'UPDATE' : 'CREATE';
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    // Validate now even when it will wait, so the form shows the problem to the person who is typing.
    await checkSubject(tx, user.schoolId, data, subjectId);
    if (subjectId && !(await tx.subject.findFirst({ where: { id: subjectId }, select: { id: true } }))) throw new ServiceError('Subject not found', 404);
    const change = await tx.subjectChange.create({ data: { schoolId: user.schoolId, kind, subjectId, payload: data as Prisma.InputJsonValue, requestedById: user.id } });
    if (can(user, 'academics.subjects.approve')) {
      const id = await applyChange(tx, user, kind, subjectId, data, user.fullName ?? user.id);
      await tx.subjectChange.update({ where: { id: change.id }, data: { status: 'APPROVED', subjectId: id, decidedById: user.id, decidedAt: new Date() } });
      return { applied: true, subjectId: id, changeId: change.id };
    }
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'REQUEST_SUBJECT_CHANGE', entityType: 'SubjectChange', entityId: change.id, detail: `${kind === 'CREATE' ? 'New subject' : 'Change to'} ${data.name} sent for Head approval`, after: { kind, name: data.name, code: data.code } }, tx);
    await notifyUsers(tx, user.schoolId, await peopleWith(tx, user.schoolId, 'academics.subjects.approve', user.id), {
      type: 'SUBJECT_CHANGE', title: 'A change to the subject list needs approval', body: `${data.name} (${kind === 'CREATE' ? 'new' : 'changed'})`, link: '/academics/subjects?tab=requests',
    });
    return { applied: false, subjectId, changeId: change.id };
  });
}

/** Makes a subject inactive (it keeps its history but cannot be assigned) or active again. */
export async function setSubjectActive(user: Actor, subjectId: string, active: boolean): Promise<SubjectSaveResult> {
  const cur = await getScopedDb(user.schoolId, user.id).subject.findFirst({ where: { id: subjectId }, include: { levels: true } });
  if (!cur) throw new ServiceError('Subject not found', 404);
  if (!cur.departmentId) throw new ServiceError(`Give ${cur.name} a department before changing it`, 409);
  const payload: SubjectInput = {
    name: cur.name, shortName: cur.shortName ?? cur.name.slice(0, 14), code: cur.code, zimsecCode: cur.zimsecCode, cambridgeCode: cur.cambridgeCode,
    departmentId: cur.departmentId, examBoard: cur.examBoard, isPractical: cur.isPractical, colour: cur.colour, active,
    levels: cur.levels.map((l) => ({ levelId: l.levelId, type: l.type })),
  };
  const data = SubjectSchema.parse(payload);
  const kind = active ? 'REACTIVATE' : 'DEACTIVATE';
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const change = await tx.subjectChange.create({ data: { schoolId: user.schoolId, kind, subjectId, payload: data as Prisma.InputJsonValue, requestedById: user.id } });
    if (can(user, 'academics.subjects.approve')) {
      await applyChange(tx, user, kind, subjectId, data, user.fullName ?? user.id);
      await tx.subjectChange.update({ where: { id: change.id }, data: { status: 'APPROVED', decidedById: user.id, decidedAt: new Date() } });
      return { applied: true, subjectId, changeId: change.id };
    }
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'REQUEST_SUBJECT_CHANGE', entityType: 'SubjectChange', entityId: change.id, detail: `${cur.name}: ${active ? 'make active' : 'make inactive'} sent for Head approval` }, tx);
    await notifyUsers(tx, user.schoolId, await peopleWith(tx, user.schoolId, 'academics.subjects.approve', user.id), {
      type: 'SUBJECT_CHANGE', title: 'A change to the subject list needs approval', body: `${cur.name}: ${active ? 'make active' : 'make inactive'}`, link: '/academics/subjects?tab=requests',
    });
    return { applied: false, subjectId, changeId: change.id };
  });
}

export const DecisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: noteSchema(300) });

/** The Head approves or rejects a waiting change. Approving applies it, checked again against today's data. */
export async function decideSubjectChange(user: Actor, changeId: string, raw: z.input<typeof DecisionSchema>) {
  const { decision, note } = DecisionSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const change = await tx.subjectChange.findFirst({ where: { id: changeId } });
    if (!change) throw new ServiceError('Change not found', 404);
    if (change.status !== 'PENDING') throw new ServiceError('This change has already been decided', 409);
    if (decision === 'REJECT' && !note) throw new ServiceError('Say why the change is rejected', 422);
    let subjectId = change.subjectId;
    if (decision === 'APPROVE') {
      const data = SubjectSchema.parse(change.payload);
      subjectId = await applyChange(tx, user, change.kind, change.subjectId, data, user.fullName ?? user.id);
    }
    await tx.subjectChange.update({ where: { id: change.id }, data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', subjectId, decidedById: user.id, decidedAt: new Date(), decisionNote: note ?? null } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'DECIDE_SUBJECT_CHANGE', entityType: 'SubjectChange', entityId: change.id, detail: `Subject change ${decision === 'APPROVE' ? 'approved' : 'rejected'}${note ? `: ${note}` : ''}`, after: { decision, kind: change.kind } }, tx);
    await notifyUsers(tx, user.schoolId, [change.requestedById].filter((id) => id !== user.id), {
      type: 'SUBJECT_CHANGE', title: `Your subject change was ${decision === 'APPROVE' ? 'approved' : 'rejected'}`, body: note, link: '/academics/subjects',
    });
    return { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' };
  });
}

export async function listSubjectChanges(user: Actor, status: 'PENDING' | 'ALL' = 'PENDING') {
  const db = getScopedDb(user.schoolId, user.id);
  const rows = await db.subjectChange.findMany({ where: status === 'PENDING' ? { status: 'PENDING' } : {}, orderBy: { createdAt: 'desc' }, take: 100 });
  const people = await db.user.findMany({ where: { id: { in: dedupe(rows.flatMap((r) => [r.requestedById, r.decidedById].filter((x): x is string => !!x))) } }, select: { id: true, fullName: true } });
  const name = new Map(people.map((p) => [p.id, p.fullName]));
  return rows.map((r) => ({
    id: r.id, kind: r.kind, status: r.status, subjectId: r.subjectId, payload: r.payload as Record<string, unknown>, note: r.decisionNote,
    requestedBy: name.get(r.requestedById) ?? '', decidedBy: r.decidedById ? name.get(r.decidedById) ?? '' : null, createdAt: r.createdAt.toISOString(),
  }));
}

export async function listSubjects(user: Actor, opts: { includeInactive?: boolean } = {}) {
  const db = getScopedDb(user.schoolId, user.id);
  const [subjects, levels] = await Promise.all([
    db.subject.findMany({
      where: opts.includeInactive === false ? { active: true } : {},
      orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
      include: { department: { select: { id: true, name: true } }, levels: { select: { levelId: true, type: true } } },
    }),
    db.level.findMany({ where: { active: true }, orderBy: { order: 'asc' }, select: { id: true, name: true, order: true } }),
  ]);
  return {
    levels,
    subjects: subjects.map((s) => ({
      id: s.id, name: s.name, shortName: s.shortName ?? s.name.slice(0, 14), code: s.code, zimsecCode: s.zimsecCode, cambridgeCode: s.cambridgeCode,
      departmentId: s.departmentId, department: s.department?.name ?? null, examBoard: s.examBoard, isPractical: s.isPractical, colour: s.colour, active: s.active,
      levels: s.levels,
    })),
  };
}

// ─── The starter list ────────────────────────────────────────────────────────

type StarterLevels = Partial<Record<1 | 2 | 3 | 4 | 5 | 6, 'CORE' | 'ELECTIVE'>>;
const F14 = (t: 'CORE' | 'ELECTIVE'): StarterLevels => ({ 1: t, 2: t, 3: t, 4: t });
const F12 = (t: 'CORE' | 'ELECTIVE'): StarterLevels => ({ 1: t, 2: t });
const F34 = (t: 'CORE' | 'ELECTIVE'): StarterLevels => ({ 3: t, 4: t });
const F56 = (t: 'CORE' | 'ELECTIVE'): StarterLevels => ({ 5: t, 6: t });

export interface StarterSubject {
  name: string; shortName: string; code: string; department: string; examBoard: SubjectExamBoard; isPractical: boolean; colour: string; levels: StarterLevels;
}

/** Common Zimbabwe secondary subjects. A school edits this list (and drops what it does not teach) before saving. */
export const STARTER_SUBJECTS: StarterSubject[] = [
  { name: 'English Language', shortName: 'English', code: 'ENG', department: 'Languages', examBoard: 'ZIMSEC', isPractical: false, colour: '#2563EB', levels: { ...F14('CORE'), ...F56('ELECTIVE') } },
  { name: 'Shona', shortName: 'Shona', code: 'SHO', department: 'Languages', examBoard: 'ZIMSEC', isPractical: false, colour: '#7C3AED', levels: { ...F14('CORE'), ...F56('ELECTIVE') } },
  { name: 'Ndebele', shortName: 'Ndebele', code: 'NDE', department: 'Languages', examBoard: 'ZIMSEC', isPractical: false, colour: '#9333EA', levels: { ...F14('ELECTIVE'), ...F56('ELECTIVE') } },
  { name: 'Literature in English', shortName: 'Literature', code: 'LIT', department: 'Languages', examBoard: 'ZIMSEC', isPractical: false, colour: '#DB2777', levels: { ...F34('ELECTIVE'), ...F56('ELECTIVE') } },
  { name: 'French', shortName: 'French', code: 'FRE', department: 'Languages', examBoard: 'ZIMSEC', isPractical: false, colour: '#E11D48', levels: F14('ELECTIVE') },
  { name: 'Mathematics', shortName: 'Maths', code: 'MAT', department: 'Sciences', examBoard: 'ZIMSEC', isPractical: false, colour: '#DC2626', levels: { ...F14('CORE'), ...F56('ELECTIVE') } },
  { name: 'Combined Science', shortName: 'Comb Sci', code: 'CSC', department: 'Sciences', examBoard: 'ZIMSEC', isPractical: true, colour: '#059669', levels: { ...F12('CORE'), ...F34('ELECTIVE') } },
  { name: 'Physics', shortName: 'Physics', code: 'PHY', department: 'Sciences', examBoard: 'ZIMSEC', isPractical: true, colour: '#0891B2', levels: { ...F34('ELECTIVE'), ...F56('ELECTIVE') } },
  { name: 'Chemistry', shortName: 'Chemistry', code: 'CHE', department: 'Sciences', examBoard: 'ZIMSEC', isPractical: true, colour: '#65A30D', levels: { ...F34('ELECTIVE'), ...F56('ELECTIVE') } },
  { name: 'Biology', shortName: 'Biology', code: 'BIO', department: 'Sciences', examBoard: 'ZIMSEC', isPractical: true, colour: '#16A34A', levels: { ...F34('ELECTIVE'), ...F56('ELECTIVE') } },
  { name: 'Computer Science', shortName: 'Comp Sci', code: 'CSD', department: 'Sciences', examBoard: 'ZIMSEC', isPractical: true, colour: '#0D9488', levels: { ...F14('ELECTIVE'), ...F56('ELECTIVE') } },
  { name: 'Heritage Studies', shortName: 'Heritage', code: 'HER', department: 'Humanities', examBoard: 'ZIMSEC', isPractical: false, colour: '#B45309', levels: F14('CORE') },
  { name: 'Geography', shortName: 'Geography', code: 'GEO', department: 'Humanities', examBoard: 'ZIMSEC', isPractical: false, colour: '#CA8A04', levels: { ...F14('ELECTIVE'), ...F56('ELECTIVE') } },
  { name: 'History', shortName: 'History', code: 'HIS', department: 'Humanities', examBoard: 'ZIMSEC', isPractical: false, colour: '#92400E', levels: { ...F14('ELECTIVE'), ...F56('ELECTIVE') } },
  { name: 'Religious Studies', shortName: 'Rel Studies', code: 'REL', department: 'Humanities', examBoard: 'ZIMSEC', isPractical: false, colour: '#A16207', levels: { ...F14('ELECTIVE'), ...F56('ELECTIVE') } },
  { name: 'Accounts', shortName: 'Accounts', code: 'ACC', department: 'Commercials', examBoard: 'ZIMSEC', isPractical: false, colour: '#4F46E5', levels: { ...F34('ELECTIVE'), ...F56('ELECTIVE') } },
  { name: 'Business Studies', shortName: 'Business', code: 'BUS', department: 'Commercials', examBoard: 'ZIMSEC', isPractical: false, colour: '#6366F1', levels: { ...F34('ELECTIVE'), ...F56('ELECTIVE') } },
  { name: 'Commerce', shortName: 'Commerce', code: 'COM', department: 'Commercials', examBoard: 'ZIMSEC', isPractical: false, colour: '#818CF8', levels: F34('ELECTIVE') },
  { name: 'Economics', shortName: 'Economics', code: 'ECO', department: 'Commercials', examBoard: 'ZIMSEC', isPractical: false, colour: '#4338CA', levels: { ...F34('ELECTIVE'), ...F56('ELECTIVE') } },
  { name: 'Agriculture', shortName: 'Agric', code: 'AGR', department: 'Technical and Vocational', examBoard: 'ZIMSEC', isPractical: true, colour: '#15803D', levels: { ...F12('CORE'), ...F34('ELECTIVE'), ...F56('ELECTIVE') } },
  { name: 'Building Technology', shortName: 'Building', code: 'BLD', department: 'Technical and Vocational', examBoard: 'ZIMSEC', isPractical: true, colour: '#78716C', levels: F14('ELECTIVE') },
  { name: 'Woodwork', shortName: 'Woodwork', code: 'WDW', department: 'Technical and Vocational', examBoard: 'ZIMSEC', isPractical: true, colour: '#A16207', levels: F14('ELECTIVE') },
  { name: 'Metalwork', shortName: 'Metalwork', code: 'MTW', department: 'Technical and Vocational', examBoard: 'ZIMSEC', isPractical: true, colour: '#57534E', levels: F14('ELECTIVE') },
  { name: 'Food and Nutrition', shortName: 'Food & Nutr', code: 'FDN', department: 'Technical and Vocational', examBoard: 'ZIMSEC', isPractical: true, colour: '#EA580C', levels: F14('ELECTIVE') },
  { name: 'Art', shortName: 'Art', code: 'ART', department: 'Arts and Physical Education', examBoard: 'ZIMSEC', isPractical: true, colour: '#C026D3', levels: { ...F14('ELECTIVE'), ...F56('ELECTIVE') } },
  { name: 'Music', shortName: 'Music', code: 'MUS', department: 'Arts and Physical Education', examBoard: 'ZIMSEC', isPractical: false, colour: '#A21CAF', levels: F14('ELECTIVE') },
  { name: 'Physical Education and Sport', shortName: 'PE', code: 'PES', department: 'Arts and Physical Education', examBoard: 'SCHOOL', isPractical: true, colour: '#0284C7', levels: F14('CORE') },
  { name: 'Guidance and Counselling', shortName: 'Guidance', code: 'GUI', department: 'Arts and Physical Education', examBoard: 'SCHOOL', isPractical: false, colour: '#64748B', levels: F14('CORE') },
];

/**
 * Saves a (possibly edited) list of subjects at once, making any department that does not exist yet. Used by "Start from
 * the starter list". Each subject goes through the same approval as a single one.
 */
export const StarterSchema = z.object({
  subjects: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(60), shortName: z.string().trim().min(1).max(14), code: SubjectSchema.shape.code,
        department: z.string().trim().min(2).max(60), examBoard: z.enum(EXAM_BOARDS), isPractical: z.boolean(), colour: colourSchema,
        levels: z.record(z.string(), z.enum(['CORE', 'ELECTIVE'])),
      }),
    )
    .min(1, 'Choose at least one subject')
    .max(80),
});

export async function loadStarterSubjects(user: Actor, raw: z.input<typeof StarterSchema>) {
  const { subjects } = StarterSchema.parse(raw);
  const codes = subjects.map((s) => s.code);
  if (new Set(codes).size !== codes.length) throw new ServiceError('Two subjects in the list have the same school code', 422);
  const canApply = can(user, 'academics.subjects.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const levels = await tx.level.findMany({ where: { active: true }, select: { id: true, order: true } });
    const levelByOrder = new Map(levels.map((l) => [l.order, l.id]));
    const depts = new Map((await tx.department.findMany({ select: { id: true, name: true } })).map((d) => [d.name.toLowerCase(), d.id]));
    const existing = await tx.subject.findMany({ select: { code: true, name: true } });
    const takenCodes = new Set(existing.map((e) => e.code));
    const takenNames = new Set(existing.map((e) => e.name.toLowerCase()));
    let created = 0, queued = 0, skipped = 0;
    for (const s of subjects) {
      if (takenCodes.has(s.code) || takenNames.has(s.name.toLowerCase())) { skipped++; continue; }
      let deptId = depts.get(s.department.toLowerCase());
      if (!deptId) {
        deptId = (await tx.department.create({ data: { schoolId: user.schoolId, name: s.department } })).id;
        depts.set(s.department.toLowerCase(), deptId);
      }
      const lv = Object.entries(s.levels)
        .map(([order, type]) => ({ levelId: levelByOrder.get(Number(order)), type }))
        .filter((l): l is { levelId: string; type: 'CORE' | 'ELECTIVE' } => !!l.levelId);
      if (lv.length === 0) { skipped++; continue; }
      const data = SubjectSchema.parse({ name: s.name, shortName: s.shortName, code: s.code, departmentId: deptId, examBoard: s.examBoard, isPractical: s.isPractical, colour: s.colour, active: true, levels: lv });
      const change = await tx.subjectChange.create({ data: { schoolId: user.schoolId, kind: 'CREATE', payload: data as Prisma.InputJsonValue, requestedById: user.id } });
      if (canApply) {
        const id = await applyChange(tx, user, 'CREATE', null, data, user.fullName ?? user.id);
        await tx.subjectChange.update({ where: { id: change.id }, data: { status: 'APPROVED', subjectId: id, decidedById: user.id, decidedAt: new Date() } });
        created++;
      } else queued++;
      takenCodes.add(s.code); takenNames.add(s.name.toLowerCase());
    }
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'LOAD_STARTER_SUBJECTS', entityType: 'Subject', entityId: user.schoolId, detail: `Starter list: ${created} added, ${queued} sent for approval, ${skipped} skipped`, after: { created, queued, skipped } }, tx);
    if (queued) {
      await notifyUsers(tx, user.schoolId, await peopleWith(tx, user.schoolId, 'academics.subjects.approve', user.id), {
        type: 'SUBJECT_CHANGE', title: 'New subjects need approval', body: `${queued} subject${queued === 1 ? '' : 's'} from the starter list`, link: '/academics/subjects?tab=requests',
      });
    }
    return { created, queued, skipped };
  });
}

/**
 * A subject made on the older Admin → Subjects page has only a name and a code. Give it what the Academics module needs
 * (a department, a short name, the forms it is offered in with the type it was given) so it can be assigned and timetabled.
 * The person who made it is one of the administrators who approve subject changes, and the audit log names them.
 */
export async function completeLegacySubject(user: { id: string; schoolId: string }, subjectId: string): Promise<void> {
  await getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.subject.findFirst({ where: { id: subjectId }, include: { levels: true } });
    if (!s) return;
    let departmentId = s.departmentId;
    if (!departmentId) {
      const general = (await tx.department.findFirst({ where: { name: 'General' } })) ?? (await tx.department.create({ data: { schoolId: user.schoolId, name: 'General' } }));
      departmentId = general.id;
    }
    await tx.subject.update({ where: { id: s.id }, data: { departmentId, shortName: s.shortName ?? s.name.slice(0, 14) } });
    if (s.levels.length === 0) {
      const levels = await tx.level.findMany({ where: { active: true }, select: { id: true } });
      if (levels.length) await tx.subjectLevel.createMany({ data: levels.map((l) => ({ schoolId: user.schoolId, subjectId: s.id, levelId: l.id, type: s.type })), skipDuplicates: true });
    }
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'CREATE_SUBJECT', entityType: 'Subject', entityId: s.id, detail: `${s.name}: added on the Admin subjects page and offered in every form (edit it under Academics, Subjects)` }, tx);
  });
}
