import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { SickBayVisitSchema, recordSickBayVisit } from '@/lib/students/medical';

// A sick bay visit: date, complaint, treatment, sent home or to clinic, guardian informed.
async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.medical.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  const body = await parseBody(req, SickBayVisitSchema);
  if ('error' in body) return body.error;
  const visit = await recordSickBayVisit(user, id, body.data);
  return apiSuccess({ id: visit.id }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/[id]/medical/sick-bay', _POST as H);
