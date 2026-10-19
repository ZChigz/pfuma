// One small wrapper for the Examinations API routes: it asks can() before anything else (any one of the listed permissions
// will do), reads the route parameters and query, and answers { success, data }. The service behind each route narrows the
// permission to the person's own assignments, department or class and checks every rule again.
import { requirePermission, type AccessContext } from '@/lib/access';
import type { PermissionKey } from '@/lib/access-core';
import { apiSuccess, withApi } from '@/lib/api';

export interface RouteCtx {
  user: AccessContext;
  req: Request;
  params: Record<string, string>;
  query: URLSearchParams;
}

/** Resolves to the user when they hold at least one of the permissions. */
export async function requireAny(perms: PermissionKey | PermissionKey[]): Promise<AccessContext> {
  const list = Array.isArray(perms) ? perms : [perms];
  let last: unknown;
  for (const p of list) {
    try {
      return await requirePermission(p);
    } catch (e) {
      last = e;
      if (e instanceof Response && e.status === 401) throw e;
    }
  }
  throw last;
}

type Handler = (c: RouteCtx) => Promise<unknown>;

/** `export const GET = guarded('GET /api/exams/types', 'exams.setup.manage', async ({ user }) => listTypes(user))` */
export function guarded(label: string, perms: PermissionKey | PermissionKey[], fn: Handler, status = 200) {
  return withApi(label, async (req: Request, ctx?: unknown) => {
    const user = await requireAny(perms);
    const params = ((ctx as { params?: Record<string, string> } | undefined)?.params ?? {}) as Record<string, string>;
    const result = await fn({ user, req, params, query: new URL(req.url).searchParams });
    return result instanceof Response ? result : apiSuccess(result, status);
  });
}

export async function body(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    const { ServiceError } = await import('@/lib/api');
    throw new ServiceError('Invalid JSON', 400);
  }
}

/** Every permission that lets a person look at examination set-up and results. */
export const ANY_EXAM_VIEW: PermissionKey[] = [
  'exams.setup.manage', 'exams.assessments.create', 'exams.projects.manage', 'exams.marks.view', 'exams.marks.enter', 'exams.marks.verify', 'exams.marks.unlock',
  'exams.results.view', 'exams.results.publish',
];
