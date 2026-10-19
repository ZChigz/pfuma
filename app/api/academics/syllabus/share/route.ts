import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { shareSyllabus } from '@/lib/academics/curriculum';

export const runtime = 'nodejs';

async function _POST(req: Request) {
  const user = await requirePermission('academics.syllabus.manage');
  const b = (await readBody(req)) as { subjectId?: string; levelId?: string; name?: string };
  return apiSuccess(await shareSyllabus(user, b.subjectId ?? '', b.levelId ?? '', b.name), 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/syllabus/share', _POST as H);
