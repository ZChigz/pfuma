import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { GenerateLetterSchema, generateLetter } from '@/lib/students/documents';

// Generate a letter (admission letter, proof of enrolment, transfer letter, testimonial, leaving certificate).
// It is filed on the student's Documents tab with a reference number and printed from there.
async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.documents.generate');
  const { id } = (ctx as { params: { id: string } }).params;
  let json: Record<string, unknown>;
  try { json = await req.json(); } catch { return Response.json({ success: false, message: 'Invalid JSON' }, { status: 400 }); }
  const input = { ...json, studentId: id };
  const parsed = GenerateLetterSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  const doc = await generateLetter(user, input as never);
  return apiSuccess({ id: doc.id, referenceNo: doc.referenceNo }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/[id]/letters', _POST as H);
