// School-scoped Prisma client — the only database handle API routes and pages
// may use (the raw client in lib/prisma.ts is banned outside lib/ by ESLint).
//
//   const db = getScopedDb(user.schoolId, user.id);
//   await db.student.findMany();                         // only this school's students
//   await db.$tx(async (tx) => { … tx.payment.create … }); // one transaction
//
// Three layers, so one mistake cannot leak data between schools:
//   1. Every query on a model with a "schoolId" column gets `schoolId` added to
//      its where clause (reads, updates, deletes) or its data (creates).
//      Writes that name another school throw ScopeViolationError.
//   2. Each query runs in a transaction that first sets Postgres settings
//      app.school_id / app.user_id; the row-level-security policies created in
//      migration 20261017000200 then refuse any row of another school.
//   3. The same migration's audit trigger reads app.user_id to log who changed
//      Student, Guardian, Enrollment, Charge, Payment, Expense, Mark and User rows.
import { headers } from 'next/headers';
import { Prisma } from '@prisma/client';
import { SchoolSuspendedError } from '@/lib/errors';
import { prisma as base } from '@/lib/prisma';

export class ScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeViolationError';
  }
}

// ─── Which models are scoped, derived from schema.prisma ─────────────────────

type DmmfModel = (typeof Prisma.dmmf.datamodel.models)[number];

const MODELS = new Map<string, DmmfModel>(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

const hasSchoolId = (m: DmmfModel) => m.fields.some((f) => f.name === 'schoolId' && f.kind === 'scalar');

// Models with their own schoolId column.
const SCOPED = new Set(Array.from(MODELS.values()).filter(hasSchoolId).map((m) => m.name));

// Child tables without a schoolId column are scoped through their parent.
const VIA_PARENT: Record<string, string> = {
  StudentGuardian: 'student',
  ExpenseRequestItem: 'request',
};

// Models that must never be reached through the school-scoped client (none at the moment;
// the Auth.js adapter tables were removed).
const BLOCKED = new Set<string>();

const WHERE_UNIQUE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete']);
const WHERE_FILTER_OPS = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany',
]);

/* eslint-disable @typescript-eslint/no-explicit-any */
type Args = Record<string, any> | undefined;

function relationKeys(model: string): Set<string> {
  return new Set((MODELS.get(model)?.fields ?? []).filter((f) => f.kind === 'object').map((f) => f.name));
}

function assertSchool(model: string, value: unknown, schoolId: string) {
  if (value !== undefined && value !== schoolId) {
    throw new ScopeViolationError(`${model}: cannot write a row for another school`);
  }
}

function scopeData(model: string, data: Record<string, any>, schoolId: string): Record<string, any> {
  assertSchool(model, data.schoolId, schoolId);
  if (data.school !== undefined) {
    const target = data.school?.connect?.id;
    if (target !== schoolId) throw new ScopeViolationError(`${model}: cannot write a row for another school`);
    return data;
  }
  // Prisma does not allow mixing scalar foreign keys with relation connects, so
  // follow the style the caller used. Nested creates (e.g. items: { create })
  // are allowed with scalar keys.
  const rels = relationKeys(model);
  const connects = Object.keys(data).some(
    (k) => rels.has(k) && data[k] && typeof data[k] === 'object' && (data[k].connect !== undefined || data[k].connectOrCreate !== undefined),
  );
  return connects ? { ...data, school: { connect: { id: schoolId } } } : { ...data, schoolId };
}

function guardUpdateData(model: string, data: Record<string, any> | undefined, schoolId: string) {
  if (!data) return;
  assertSchool(model, typeof data.schoolId === 'object' ? data.schoolId?.set : data.schoolId, schoolId);
  if (data.school !== undefined) throw new ScopeViolationError(`${model}: cannot move a row to another school`);
}

function scopeArgs(model: string, operation: string, args: Args, schoolId: string): Args {
  const a: Record<string, any> = { ...(args ?? {}) };

  if (BLOCKED.has(model)) {
    throw new ScopeViolationError(`${model} is not available through the school-scoped client`);
  }

  if (model === 'School') {
    // A school-scoped client can only reach its own school row.
    assertSchool('School', a.where?.id, schoolId);
    if (WHERE_UNIQUE_OPS.has(operation)) return { ...a, where: { ...a.where, id: schoolId } };
    if (WHERE_FILTER_OPS.has(operation)) return { ...a, where: { AND: [a.where ?? {}, { id: schoolId }] } };
    throw new ScopeViolationError(`School: ${operation} is not allowed through the school-scoped client`);
  }

  const parent = VIA_PARENT[model];
  if (parent) {
    const guard = { [parent]: { schoolId } };
    if (WHERE_UNIQUE_OPS.has(operation)) return { ...a, where: { ...a.where, ...guard } };
    if (WHERE_FILTER_OPS.has(operation)) return { ...a, where: { AND: [a.where ?? {}, guard] } };
    if (operation === 'upsert') return { ...a, where: { ...a.where, ...guard } };
    return a; // creates: the row-level-security policy checks the parent
  }

  if (!SCOPED.has(model)) return a;

  if (WHERE_UNIQUE_OPS.has(operation)) {
    assertSchool(model, a.where?.schoolId, schoolId);
    if (operation === 'update') guardUpdateData(model, a.data, schoolId);
    return { ...a, where: { ...a.where, schoolId } };
  }
  if (WHERE_FILTER_OPS.has(operation)) {
    if (operation === 'updateMany') guardUpdateData(model, a.data, schoolId);
    return { ...a, where: { AND: [a.where ?? {}, { schoolId }] } };
  }
  switch (operation) {
    case 'create':
      return { ...a, data: scopeData(model, a.data, schoolId) };
    case 'createMany':
    case 'createManyAndReturn': {
      const rows = Array.isArray(a.data) ? a.data : [a.data];
      return { ...a, data: rows.map((r: Record<string, any>) => scopeData(model, r, schoolId)) };
    }
    case 'upsert':
      assertSchool(model, a.where?.schoolId, schoolId);
      guardUpdateData(model, a.update, schoolId);
      return {
        ...a,
        where: { ...a.where, schoolId },
        create: scopeData(model, a.create, schoolId),
      };
    default:
      throw new ScopeViolationError(`${model}.${operation} is not supported by the school-scoped client`);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Exported for tests.
export const _internal = { scopeArgs, SCOPED, VIA_PARENT };

// ─── Client ──────────────────────────────────────────────────────────────────

// Who is calling and from where, for the audit log (the database copies these onto each entry).
// Outside a request (scripts, tests, the scheduler) there are no headers and both stay empty.
function requestMeta(): { ip: string; ua: string } {
  try {
    const h = headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '';
    return { ip: ip.slice(0, 64), ua: (h.get('user-agent') ?? '').slice(0, 300) };
  } catch {
    return { ip: '', ua: '' };
  }
}

const setContext = (schoolId: string, actorId: string | undefined) => {
  const { ip, ua } = requestMeta();
  return Prisma.sql`SELECT set_config('app.school_id', ${schoolId}, true), set_config('app.user_id', ${actorId ?? ''}, true), set_config('app.ip', ${ip}, true), set_config('app.user_agent', ${ua}, true)`;
};

// ─── Suspended schools can look but not change ───────────────────────────────
// Writes are refused while the school's status is SUSPENDED. The permission check already hides the
// buttons and refuses the routes (can() is read-only for a suspended school); this is the second
// lock for code that never asks can(). The status is remembered for a few seconds per school.
const STILL_WRITABLE = new Set(['AuditLog', 'Notification', 'PasswordResetToken']);
// People can still change their own record (password, profile, last sign-in) but no new account is made.
const STILL_UPDATABLE = new Set(['User']);
// Pfuma's own records about the school: the school reads them and never writes them.
const READ_ONLY_MODELS = new Set(['SubscriptionInvoice']);
const WRITES = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']);
const STATUS_TTL_MS = 5_000;
const statusCache = new Map<string, { suspended: boolean; at: number }>();

/** For tests: forget remembered statuses. */
export function _resetSuspendedCache() {
  statusCache.clear();
}

/** Reads the status when it is not remembered (or the memory is old). Never called inside a transaction. */
async function refreshSuspended(schoolId: string) {
  const hit = statusCache.get(schoolId);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return;
  const [, school] = await base.$transaction([base.$executeRaw(setContext(schoolId, undefined)), base.school.findUnique({ where: { id: schoolId }, select: { status: true } })]);
  statusCache.set(schoolId, { suspended: school?.status === 'SUSPENDED', at: Date.now() });
}

/** Uses what was last read, however old: a long transaction must not read the status again. */
function assertWritable(schoolId: string, model: string, operation: string) {
  if (WRITES.has(operation) && READ_ONLY_MODELS.has(model)) throw new ScopeViolationError(`${model} cannot be changed through the school-scoped client`);
  if (!WRITES.has(operation) || STILL_WRITABLE.has(model)) return;
  if (STILL_UPDATABLE.has(model) && (operation === 'update' || operation === 'updateMany')) return;
  if (statusCache.get(schoolId)?.suspended) throw new SchoolSuspendedError();
}

// Adds schoolId; used on its own inside interactive transactions, where the
// Postgres settings have already been applied once.
function makeScoped(schoolId: string) {
  return base.$extends({
    name: 'school-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          assertWritable(schoolId, model, operation);
          return query(scopeArgs(model, operation, args as Args, schoolId) as never);
        },
      },
    },
  });
}

/** What the callback of `db.$tx` receives. */
export type ScopedTx = Omit<ReturnType<typeof makeScoped>, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

function build(schoolId: string, actorId?: string) {
  if (!schoolId) throw new ScopeViolationError('getScopedDb needs a schoolId');
  const scoped = makeScoped(schoolId);

  // Public client: single queries run in their own transaction together with
  // the settings; `$tx` opens one transaction for many.
  return scoped.$extends({
    name: 'school-context',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (WRITES.has(operation) && !STILL_WRITABLE.has(model) && !(STILL_UPDATABLE.has(model) && (operation === 'update' || operation === 'updateMany'))) await refreshSuspended(schoolId);
          const [, result] = await base.$transaction([base.$executeRaw(setContext(schoolId, actorId)), query(args)]);
          return result;
        },
      },
    },
    client: {
      $tx<T>(
        fn: (tx: ScopedTx) => Promise<T>,
        options?: { maxWait?: number; timeout?: number },
      ): Promise<T> {
        return refreshSuspended(schoolId).then(() => scoped.$transaction(async (tx) => {
          await tx.$executeRaw(setContext(schoolId, actorId));
          return fn(tx as unknown as ScopedTx);
        }, options));
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof build>;
/** Anything service code can query with: the scoped client or a scoped transaction. */
export type Db = ScopedTx;

export function getScopedDb(schoolId: string, actorId?: string): ScopedDb {
  return build(schoolId, actorId);
}
