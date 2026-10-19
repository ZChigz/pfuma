import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { importTemplate, listTemplates } from '@/lib/academics/curriculum';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.syllabus.manage');
  const q = new URL(req.url).searchParams;
  return apiSuccess({ templates: await listTemplates(user, { subjectName: q.get('subject') ?? undefined, levelOrder: q.get('level') ? Number(q.get('level')) : undefined }) });
}

async function _POST(req: Request) {
  const user = await requirePermission('academics.syllabus.manage');
  const b = (await readBody(req)) as { templateId?: string; subjectId?: string; levelId?: string };
  return apiSuccess(await importTemplate(user, b.templateId ?? '', b.subjectId ?? '', b.levelId ?? ''), 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/syllabus/templates', _GET as H);
export const POST = withApi('POST /api/academics/syllabus/templates', _POST as H);
