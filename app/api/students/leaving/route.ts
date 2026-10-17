import { z } from 'zod';
import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { EXIT_REASONS, StartLeavingSchema, listLeavers, startLeaving } from '@/lib/students/leavers';

// Start the leaving process for a student (reason, last day attended, clearance checklist).
async function _POST(req: Request) {
  const user = await requirePermission('students.leavers.manage');
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = StartLeavingSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  const exit = await startLeaving(user, parsed.data);
  return apiSuccess({ exit: { id: exit.id, state: exit.state, clearance: exit.clearance } }, 201);
}

const Filters = z.object({
  year: z.coerce.number().int().min(1950).max(2200).optional(),
  reason: z.enum(EXIT_REASONS).optional(),
  classId: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

// The leavers list, filterable by year, reason and last class.
async function _GET(req: Request) {
  const user = await requirePermission('students.leavers.manage');
  const raw = Object.fromEntries(new URL(req.url).searchParams);
  const f = Filters.safeParse(raw);
  return apiSuccess(await listLeavers(user, f.success ? f.data : { page: 1 }));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/leaving', _POST as H);
export const GET = withApi('GET /api/students/leaving', _GET as H);
