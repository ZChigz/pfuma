// scopeWhere(user, key, model): the Prisma `where` for a list, search or export of `model`, limited to what the person's grants of `key`
// reach. Every list query goes through it, so a class teacher's student list only ever holds their class.
//
// Rules: the school is always in the filter; a school-wide grant adds nothing more; every other grant adds one OR branch worked out from
// the records that make the scope (scopes.ts); a model with no branch for a scope contributes nothing for it (it narrows, never widens);
// and with no grant at all the filter matches nothing.
import { grantsFor } from './effective';
import { effectiveOf } from './user';
import { LOOKING_ACTIONS, type Scope } from './types';
import type { Db } from '@/lib/scoped-db';
import { reach, type ReachByScope, type ReachUser } from './scopes';

type Where = Record<string, unknown>;
type Maker<S extends Scope> = (r: ReachByScope[S]) => Where | null;
type ModelScopes = { [S in Scope]?: Maker<S> };

const NOTHING: Where = { id: { in: [] as string[] } };
const inIds = (field: string, ids: string[]): Where => ({ [field]: { in: ids } });

/** How each model's records relate to each scope. Add a model here when a list of it needs narrowing. */
export const MODEL_SCOPES: Record<string, ModelScopes> = {
  Student: {
    CLASS: (r) => ({ OR: [inIds('currentClassId', r.classIds), { enrollments: { some: { termId: { in: r.termIds }, classId: { in: r.classIds } } } }] }),
    ASSIGNED: (r) => ({
      OR: [
        inIds('currentClassId', r.directClassIds),
        { enrollments: { some: { termId: { in: r.termIds }, classId: { in: r.directClassIds } } } },
        { teachingGroups: { some: { groupId: { in: r.groupIds } } } },
      ],
    }),
    DEPARTMENT: (r) => ({ subjectChoices: { some: { subjectId: { in: r.subjectIds } } } }),
    HOSTEL: (r) => inIds('id', r.studentIds),
  },
  SchoolClass: {
    CLASS: (r) => inIds('id', r.classIds),
    ASSIGNED: (r) => inIds('id', r.classIds),
    DEPARTMENT: (r) => ({ assignments: { some: { subjectId: { in: r.subjectIds } } } }),
  },
  TeacherAssignment: {
    ASSIGNED: (r) => inIds('id', r.assignmentIds),
    CLASS: (r) => inIds('classId', r.classIds),
    DEPARTMENT: (r) => inIds('subjectId', r.subjectIds),
  },
  FinPayment: { RECORDED_BY_ME: (r) => ({ recordedById: r.userId }) },
  FinExpense: { RECORDED_BY_ME: (r) => ({ recordedById: r.userId }) },
  FinAdjustment: { RECORDED_BY_ME: (r) => ({ createdById: r.userId }) },
  FinRefund: { RECORDED_BY_ME: (r) => ({ requestedById: r.userId }) },
  CashUp: { RECORDED_BY_ME: (r) => ({ userId: r.userId }) },
  Employee: {
    SELF: (r) => ({ userId: r.userId }),
    DEPARTMENT: (r) => inIds('id', r.employeeIds),
  },
  Payslip: employeeOwned(),
  LeaveRequest: employeeOwned(),
  DutyAssignment: employeeOwned(),
  StaffAttendance: employeeOwned(),
  FacHostel: { HOSTEL: (r) => inIds('id', r.hostelIds) },
  FacBedAllocation: { HOSTEL: (r) => inIds('studentId', r.studentIds) },
  FacExeat: { HOSTEL: (r) => inIds('studentId', r.studentIds) },
  FacSickBayVisit: { HOSTEL: (r) => inIds('studentId', r.studentIds) },
  FacStore: { STORE: (r) => inIds('id', r.storeIds) },
};

/** Records that hang from a staff record: the person's own (SELF) or those of the department they head. */
function employeeOwned(): ModelScopes {
  return {
    SELF: (r) => (r.employeeId ? { employeeId: r.employeeId } : null),
    DEPARTMENT: (r) => inIds('employeeId', r.employeeIds),
  };
}

const SCOPE_ORDER: Scope[] = ['DEPARTMENT', 'CLASS', 'ASSIGNED', 'HOSTEL', 'STORE', 'RECORDED_BY_ME', 'SELF'];

export function registeredModels(): string[] {
  return Object.keys(MODEL_SCOPES);
}

export async function scopeWhere(user: ReachUser, key: string, model: string, db?: Db): Promise<Where> {
  const base: Where = { schoolId: user.schoolId };
  const eff = effectiveOf(user);
  const grants = grantsFor(eff, key);
  if (!grants.length) return { ...base, ...NOTHING };
  if (grants.some((g) => g.scope === 'SCHOOL')) return base;

  const map = MODEL_SCOPES[model];
  if (!map) throw new Error(`scopeWhere: "${model}" has no scope map (lib/access/where.ts). Add one before listing it for a narrower grant.`);

  const action = key.split('.')[2] ?? '';
  const includePrevious = LOOKING_ACTIONS.has(action);
  const denies = eff.scopedDenies.get(key) ?? [];
  const branches: Where[] = [];
  for (const scope of SCOPE_ORDER) {
    const mine = grants.filter((g) => g.scope === scope);
    if (!mine.length) continue;
    const make = map[scope] as Maker<typeof scope> | undefined;
    if (!make) continue;
    const pins = mine.map((g) => g.scopeId).filter((x): x is string => !!x);
    const denied = new Set(denies.filter((d) => d.scope === scope && d.scopeId).map((d) => d.scopeId!));
    const r = withoutDenied(await reach(user, scope, { pins: pins.filter((p) => !denied.has(p)), includePrevious, db }), denied);
    const where = make(r as never);
    if (where) branches.push(where);
  }
  if (!branches.length) return { ...base, ...NOTHING };
  return { ...base, OR: branches };
}

/** A DENY override that names one place takes that place out of the reach (the person's own and the pinned alike). */
function withoutDenied<T extends object>(r: T, denied: Set<string>): T {
  if (!denied.size) return r;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) out[k] = Array.isArray(v) && /^(departmentIds|classIds|directClassIds|hostelIds|storeIds)$/.test(k) ? v.filter((x) => !denied.has(x)) : v;
  return out as T;
}
