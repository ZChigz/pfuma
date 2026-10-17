import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { MedicalSchema, saveMedical, viewMedical } from '@/lib/students/medical';

// Opening the Medical tab. Every call is audit-logged (MEDICAL_VIEWED) in the same transaction as the read.
async function _GET(_req: Request, ctx?: unknown) {
  const user = await requirePermission('students.medical.view');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess({ medical: await viewMedical(user, id) });
}

// Replace the medical details. The audit entry names the sections that changed, never their values.
async function _PUT(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.medical.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = MedicalSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  return apiSuccess(await saveMedical(user, id, json as never));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/[id]/medical', _GET as H);
export const PUT = withApi('PUT /api/students/[id]/medical', _PUT as H);
