import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { requirePlatformAdmin } from '@/lib/platform/session';
import { createSchool, listSchools } from '@/lib/platform/schools';
import { CreateSchoolSchema } from '@/lib/validations/platform';

async function _GET(req: Request) {
  await requirePlatformAdmin(req);
  const p = new URL(req.url).searchParams;
  const page = Math.max(1, Number(p.get('page')) || 1);
  const pageSize = [10, 25, 50, 100].includes(Number(p.get('pageSize'))) ? Number(p.get('pageSize')) : 25;
  return apiSuccess(await listSchools({ q: (p.get('q') ?? '').trim().slice(0, 100) || undefined, status: p.get('status') ?? undefined, page, pageSize }));
}

// Creates the school and its first Owner and Administrator. The invite links are in the response, once.
async function _POST(req: Request) {
  const admin = await requirePlatformAdmin(req);
  const parsed = await parseBody(req, CreateSchoolSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess(await createSchool(admin, parsed.data), 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/platform/schools', _GET as H);
export const POST = withApi('POST /api/platform/schools', _POST as H);
