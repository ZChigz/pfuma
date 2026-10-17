import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { AssignHouseSchema, assignHouse } from '@/lib/students/houses';

// Put selected students in a house (houseId null takes them out). One audit entry per student.
async function _POST(req: Request) {
  const user = await requirePermission('students.profiles.edit');
  const body = await parseBody(req, AssignHouseSchema);
  if ('error' in body) return body.error;
  return apiSuccess(await assignHouse(user, body.data));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/house', _POST as H);
