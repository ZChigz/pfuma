// Scope resolvers: one function per scope, each returning the ids the person can reach. "Own" is never typed in by an administrator; it
// is worked out from records that already exist (the timetable, the class teacher table, the hostel's master, the store's keeper), so
// when those change the person's reach follows. Results are cached for the life of the request (the AccessContext object).
//
// A scope only narrows: a CLASS grant reaches the classes below and nothing else. Pins (a role assigned to one department, class,
// hostel or store) add that one place to the person's own.
import type { AccessUser } from '@/lib/access-core';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import type { Scope } from './types';

export interface DepartmentReach { departmentIds: string[]; subjectIds: string[]; employeeIds: string[] }
export interface ClassReach { classIds: string[]; termIds: string[] }
export interface AssignedReach {
  assignmentIds: string[];
  /** Classes taught directly, and the classes the students of a teaching group sit in. */
  classIds: string[];
  /** Only the classes taught directly: a teaching group reaches its own students, not the whole class. */
  directClassIds: string[];
  groupIds: string[];
  subjectIds: string[];
  termIds: string[];
}
export interface HostelReach { hostelIds: string[]; studentIds: string[] }
export interface StoreReach { storeIds: string[] }
export interface SelfReach { userId: string; employeeId: string | null }
export interface RecordedReach { userId: string }
export interface SchoolReach { schoolId: string }
export interface NoReach { none: true }

export interface ReachByScope {
  SCHOOL: SchoolReach;
  DEPARTMENT: DepartmentReach;
  CLASS: ClassReach;
  ASSIGNED: AssignedReach;
  HOSTEL: HostelReach;
  STORE: StoreReach;
  RECORDED_BY_ME: RecordedReach;
  SELF: SelfReach;
  CHILDREN: NoReach;
}

export interface ReachOptions {
  /** Run the lookups on this transaction (when the caller is inside one) instead of opening another connection. */
  db?: Db;
  /** Places the person's role assignments are pinned to at this scope. */
  pins?: readonly string[];
  /** Looking (view, export) also reaches the term that closed within the school's "previous term" window. Changing does not. */
  includePrevious?: boolean;
}

/** Whatever the user context carries that the resolvers need beyond AccessUser. */
export type ReachUser = AccessUser & { previousTermReadDays?: number };

const caches = new WeakMap<object, Map<string, Promise<unknown>>>();
const memo = <T>(user: object, key: string, make: () => Promise<T>): Promise<T> => {
  let m = caches.get(user);
  if (!m) caches.set(user, (m = new Map()));
  let p = m.get(key) as Promise<T> | undefined;
  if (!p) m.set(key, (p = make()));
  return p;
};

const dbOf = (user: AccessUser) => getScopedDb(user.schoolId, user.id) as unknown as Db;
const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => !!x)));
const today = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

/**
 * The terms a teacher's own records belong to: the open one, and (for looking) the one that closed within the last N days, so a teacher
 * can still read last term's marks for a while after the term changes. After that only the department head and above reach them.
 */
export async function readableTermIds(user: ReachUser, includePrevious: boolean, tx?: Db): Promise<string[]> {
  return memo(user, `terms|${includePrevious}`, async () => {
    const db = tx ?? dbOf(user);
    const open = await db.academicTerm.findFirst({ where: { status: 'OPEN' }, select: { id: true } });
    const ids = open ? [open.id] : [];
    const days = user.previousTermReadDays ?? 30;
    if (includePrevious && days > 0) {
      const since = new Date(Date.now() - days * 86_400_000);
      const prev = await db.academicTerm.findFirst({ where: { status: 'CLOSED', closedAt: { gte: since } }, orderBy: { closedAt: 'desc' }, select: { id: true } });
      if (prev) ids.push(prev.id);
    }
    return ids;
  });
}

// ─── One resolver per scope ──────────────────────────────────────────────────

export const resolveSchool = async (user: ReachUser): Promise<SchoolReach> => ({ schoolId: user.schoolId });

/** Departments the person heads (Department.hodUserId) or is pinned to; their subjects and staff. */
export async function resolveDepartment(user: ReachUser, opts: ReachOptions = {}): Promise<DepartmentReach> {
  return memo(user, `DEPARTMENT|${(opts.pins ?? []).join(',')}`, async () => {
    const db = opts.db ?? dbOf(user);
    const pinned = opts.pins?.length ? await db.department.findMany({ where: { id: { in: [...opts.pins] } }, select: { id: true } }) : [];
    const headed = await db.department.findMany({ where: { hodUserId: user.id }, select: { id: true } });
    const departmentIds = uniq([...headed.map((d) => d.id), ...pinned.map((d) => d.id)]);
    if (!departmentIds.length) return { departmentIds, subjectIds: [], employeeIds: [] };
    const [subjects, employees] = await Promise.all([
      db.subject.findMany({ where: { departmentId: { in: departmentIds } }, select: { id: true } }),
      db.employee.findMany({ where: { departmentId: { in: departmentIds } }, select: { id: true } }),
    ]);
    return { departmentIds, subjectIds: subjects.map((s) => s.id), employeeIds: employees.map((e) => e.id) };
  });
}

/** Classes the person is class teacher of in the open term (ClassTeacher), or is pinned to. */
export async function resolveClass(user: ReachUser, opts: ReachOptions = {}): Promise<ClassReach> {
  return memo(user, `CLASS|${(opts.pins ?? []).join(',')}|${!!opts.includePrevious}`, async () => {
    const db = opts.db ?? dbOf(user);
    const termIds = await readableTermIds(user, !!opts.includePrevious, opts.db);
    const [rows, legacy, pinned] = await Promise.all([
      termIds.length ? db.classTeacher.findMany({ where: { userId: user.id, termId: { in: termIds } }, select: { classId: true } }) : Promise.resolve([]),
      db.schoolClass.findMany({ where: { classTeacherId: user.id }, select: { id: true } }),
      opts.pins?.length ? db.schoolClass.findMany({ where: { id: { in: [...opts.pins] } }, select: { id: true } }) : Promise.resolve([]),
    ]);
    return { classIds: uniq([...rows.map((r) => r.classId), ...legacy.map((c) => c.id), ...pinned.map((c) => c.id)]), termIds };
  });
}

/** The lessons the person teaches (or co-teaches) in the open term: their classes, teaching groups and subjects. */
export async function resolveAssigned(user: ReachUser, opts: ReachOptions = {}): Promise<AssignedReach> {
  return memo(user, `ASSIGNED|${!!opts.includePrevious}`, async () => {
    const db = opts.db ?? dbOf(user);
    const termIds = await readableTermIds(user, !!opts.includePrevious, opts.db);
    if (!termIds.length) return { assignmentIds: [], classIds: [], directClassIds: [], groupIds: [], subjectIds: [], termIds };
    const rows = await db.teacherAssignment.findMany({
      where: { termId: { in: termIds }, status: 'ACTIVE', OR: [{ teacherId: user.id }, { coTeacherId: user.id }] },
      select: { id: true, classId: true, groupId: true, subjectId: true, termId: true },
    });
    // Lessons recorded in the older table (a school that began before the Academics module, or marks entry) count too.
    const legacy = await db.subjectAssignment.findMany({ where: { termId: { in: termIds }, teacherId: user.id }, select: { classId: true, subjectId: true } });
    const groupIds = uniq(rows.map((r) => r.groupId));
    let groupClasses: string[] = [];
    if (groupIds.length) {
      // A teaching group (an elective taught across classes) reaches the classes its students sit in.
      const enrolled = await db.enrollment.findMany({
        where: { termId: { in: termIds }, status: 'ACTIVE', student: { teachingGroups: { some: { groupId: { in: groupIds } } } } },
        select: { classId: true }, distinct: ['classId'],
      });
      groupClasses = enrolled.map((e) => e.classId);
    }
    return {
      assignmentIds: rows.map((r) => r.id),
      classIds: uniq([...rows.map((r) => r.classId), ...legacy.map((l) => l.classId), ...groupClasses]),
      directClassIds: uniq([...rows.map((r) => r.classId), ...legacy.map((l) => l.classId)]),
      groupIds, subjectIds: uniq([...rows.map((r) => r.subjectId), ...legacy.map((l) => l.subjectId)]), termIds,
    };
  });
}

/** Hostels the person is boarding master or matron of (or pinned to), and the boarders sleeping there now. */
export async function resolveHostel(user: ReachUser, opts: ReachOptions = {}): Promise<HostelReach> {
  return memo(user, `HOSTEL|${(opts.pins ?? []).join(',')}`, async () => {
    const db = opts.db ?? dbOf(user);
    const [own, pinned] = await Promise.all([
      db.facHostel.findMany({ where: { active: true, OR: [{ boardingMasterId: user.id }, { matronId: user.id }] }, select: { id: true } }),
      opts.pins?.length ? db.facHostel.findMany({ where: { id: { in: [...opts.pins] } }, select: { id: true } }) : Promise.resolve([]),
    ]);
    const hostelIds = uniq([...own.map((h) => h.id), ...pinned.map((h) => h.id)]);
    if (!hostelIds.length) return { hostelIds, studentIds: [] };
    const rooms = await db.facRoom.findMany({ where: { hostelId: { in: hostelIds } }, select: { id: true } });
    const beds = rooms.length ? await db.facBed.findMany({ where: { roomId: { in: rooms.map((r) => r.id) } }, select: { id: true } }) : [];
    const stays = beds.length
      ? await db.facBedAllocation.findMany({ where: { bedId: { in: beds.map((b) => b.id) }, fromDate: { lte: today() }, OR: [{ toDate: null }, { toDate: { gte: today() } }] }, select: { studentId: true } })
      : [];
    return { hostelIds, studentIds: uniq(stays.map((s) => s.studentId)) };
  });
}

/** Stores the person keeps (FacStore.storekeeperId), or is pinned to. */
export async function resolveStore(user: ReachUser, opts: ReachOptions = {}): Promise<StoreReach> {
  return memo(user, `STORE|${(opts.pins ?? []).join(',')}`, async () => {
    const db = opts.db ?? dbOf(user);
    const [own, pinned] = await Promise.all([
      db.facStore.findMany({ where: { active: true, storekeeperId: user.id }, select: { id: true } }),
      opts.pins?.length ? db.facStore.findMany({ where: { id: { in: [...opts.pins] } }, select: { id: true } }) : Promise.resolve([]),
    ]);
    return { storeIds: uniq([...own.map((s) => s.id), ...pinned.map((s) => s.id)]) };
  });
}

/** The person's own staff record (Employee.userId): their payslips, leave, attendance and duties hang from it. */
export async function resolveSelf(user: ReachUser, opts: ReachOptions = {}): Promise<SelfReach> {
  return memo(user, 'SELF', async () => {
    const e = await (opts.db ?? dbOf(user)).employee.findFirst({ where: { userId: user.id }, select: { id: true } });
    return { userId: user.id, employeeId: e?.id ?? null };
  });
}

export const resolveRecordedByMe = async (user: ReachUser): Promise<RecordedReach> => ({ userId: user.id });

/** Reserved for the parent portal: reaches nothing yet. */
export const resolveChildren = async (): Promise<NoReach> => ({ none: true });

/** The resolver for a scope. */
export function reach<S extends Scope>(user: ReachUser, scope: S, opts: ReachOptions = {}): Promise<ReachByScope[S]> {
  switch (scope) {
    case 'SCHOOL': return resolveSchool(user) as Promise<ReachByScope[S]>;
    case 'DEPARTMENT': return resolveDepartment(user, opts) as Promise<ReachByScope[S]>;
    case 'CLASS': return resolveClass(user, opts) as Promise<ReachByScope[S]>;
    case 'ASSIGNED': return resolveAssigned(user, opts) as Promise<ReachByScope[S]>;
    case 'HOSTEL': return resolveHostel(user, opts) as Promise<ReachByScope[S]>;
    case 'STORE': return resolveStore(user, opts) as Promise<ReachByScope[S]>;
    case 'RECORDED_BY_ME': return resolveRecordedByMe(user) as Promise<ReachByScope[S]>;
    case 'SELF': return resolveSelf(user, opts) as Promise<ReachByScope[S]>;
    default: return resolveChildren() as Promise<ReachByScope[S]>;
  }
}
