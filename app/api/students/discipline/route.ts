import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { RecordIncidentSchema, disciplineReport, pendingDecisions, recordIncident } from '@/lib/students/discipline';

// Record an incident (any teacher who may log incidents, for the students they can reach).
async function _POST(req: Request) {
  const user = await requirePermission('students.discipline.create');
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = RecordIncidentSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  return apiSuccess(await recordIncident(user, json as never), 201);
}

// Reports: incidents by category, class and month; students with 3 or more incidents this term; open suspensions.
// Scoped to the students the user can reach. With ?pending=1: the suspensions and expulsion recommendations waiting for the Head.
async function _GET(req: Request) {
  const params = new URL(req.url).searchParams;
  if (params.get('pending') === '1') {
    const approver = await requirePermission('students.discipline.approve');
    return apiSuccess({ pending: await pendingDecisions(approver) });
  }
  const user = await requirePermission('students.discipline.view');
  return apiSuccess(await disciplineReport(user, params.get('termId') || undefined));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/discipline', _POST as H);
export const GET = withApi('GET /api/students/discipline', _GET as H);
