import { can } from '@/lib/access-core';
import { requireSignedIn } from '@/lib/access';
import { apiForbidden, apiSuccess, withApi } from '@/lib/api';
import { searchStudentsLite } from '@/lib/students/list';

// Pick students by name, admission number, birth certificate number or guardian phone (at least 2 characters).
// For anyone who may see students or record incidents; only the students they can reach are found.
async function _GET(req: Request) {
  const user = await requireSignedIn();
  if (!(can(user, 'students.profiles.view') || can(user, 'students.discipline.create'))) return apiForbidden();
  const q = new URL(req.url).searchParams.get('q') ?? '';
  return apiSuccess({ students: await searchStudentsLite(user, q) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/search', _GET as H);
