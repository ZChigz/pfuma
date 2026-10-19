import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { UploadDocumentSchema, listDocuments, uploadDocument } from '@/lib/students/documents';

// The Documents tab: uploads and generated letters, plus the checklist of required documents that are missing.
async function _GET(_req: Request, ctx?: unknown) {
  const user = await requirePermission('students.documents.view');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await listDocuments(user, id));
}

// Record a file that has just been uploaded (UploadThing keeps it private). Type, title, date, optional expiry, notes.
async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.documents.upload');
  const { id } = (ctx as { params: { id: string } }).params;
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  const parsed = UploadDocumentSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  const doc = await uploadDocument(user, id, json as never);
  return apiSuccess({ id: doc.id }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/[id]/documents', _GET as H);
export const POST = withApi('POST /api/students/[id]/documents', _POST as H);
