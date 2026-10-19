import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { importSyllabusCsv } from '@/lib/academics/curriculum';

export const runtime = 'nodejs';

async function _POST(req: Request) {
  const user = await requirePermission('academics.syllabus.manage');
  const b = (await readBody(req)) as { csv?: string };
  return apiSuccess(await importSyllabusCsv(user, typeof b.csv === 'string' ? b.csv : ''));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/syllabus/import', _POST as H);
