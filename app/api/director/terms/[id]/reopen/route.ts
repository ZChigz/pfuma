import { z } from 'zod';
import { auth } from '@/lib/auth';
import { apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { canReopenTerm } from '@/lib/permissions';
import { reopenTerm } from '@/lib/academic/terms';
import type { SessionUser } from '@/types';

const Schema = z.object({ reason: z.string().trim().min(10, 'Give a reason of at least 10 characters') });

// Only the Director can reopen a closed term, and must say why.
async function _POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  try { await canReopenTerm(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, Schema);
  if ('error' in parsed) return parsed.error;
  const term = await reopenTerm(user.schoolId, user.id, params.id, parsed.data.reason);
  return apiSuccess({ term });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/director/terms/[id]/reopen', _POST as unknown as H);
