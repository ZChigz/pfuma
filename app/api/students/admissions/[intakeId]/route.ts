import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { IntakeSchema, RANK_BY, intakeReport, listApplicants, rankApplicants, saveIntake, type RankBy } from '@/lib/students/admissions';

// One intake: its applicants (board and table), the ranking with the cut-off line at the number of places, and the report.
async function _GET(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.admissions.view');
  const { intakeId } = (ctx as { params: { intakeId: string } }).params;
  const params = new URL(req.url).searchParams;
  const by = (RANK_BY as readonly string[]).includes(params.get('by') ?? '') ? (params.get('by') as RankBy) : 'units';
  const { intake, applicants } = await listApplicants(user, intakeId);
  return apiSuccess({ intake, applicants, ranking: rankApplicants(applicants, by, intake.places), rankedBy: by, report: await intakeReport(user, intakeId) });
}

async function _PATCH(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.admissions.manage');
  const { intakeId } = (ctx as { params: { intakeId: string } }).params;
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = IntakeSchema.safeParse(json);
  if (!parsed.success) return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: parsed.error.flatten().fieldErrors }, { status: 422 });
  await saveIntake(user, json as never, intakeId);
  return apiSuccess({ saved: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/admissions/[intakeId]', _GET as H);
export const PATCH = withApi('PATCH /api/students/admissions/[intakeId]', _PATCH as H);
