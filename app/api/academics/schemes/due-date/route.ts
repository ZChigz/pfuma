import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { setSchemeDueDate } from '@/lib/academics/settings';

export const runtime = 'nodejs';

async function _POST(req: Request) {
  const user = await requirePermission('academics.schemes.approve');
  const b = (await readBody(req)) as { termId?: string; dueDate?: string | null };
  return apiSuccess(await setSchemeDueDate(user, b.termId ?? '', b.dueDate ?? null));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/schemes/due-date', _POST as H);
