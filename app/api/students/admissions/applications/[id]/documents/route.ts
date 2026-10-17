import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { uploadApplicationDocument } from '@/lib/students/admissions';
import { UploadDocumentSchema } from '@/lib/students/documents';

// A document uploaded for an applicant (birth certificate, Grade 7 or O Level results slip ...). Private, like every student file.
async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.admissions.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = UploadDocumentSchema.safeParse(json);
  if (!parsed.success) return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: parsed.error.flatten().fieldErrors }, { status: 422 });
  const doc = await uploadApplicationDocument(user, id, json as never);
  return apiSuccess({ id: doc.id }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/admissions/applications/[id]/documents', _POST as H);
