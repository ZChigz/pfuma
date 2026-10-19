import { z } from 'zod';
import { requirePermission, requireSignedIn } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { approveLeaving, cancelLeaving, completeLeaving, tickClearance } from '@/lib/students/leavers';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('tick'), key: z.enum(['fees', 'library', 'hostel', 'property', 'sports_kit']), ticked: z.boolean() }),
  z.object({ action: z.literal('approve'), overrideReason: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('complete'), conduct: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('cancel'), reason: z.string().trim().min(3).max(300) }),
]);

// One endpoint for the steps after "start": tick a hand-checked line, approve (the Head), finish, or cancel.
// Each step needs its own permission.
async function _POST(req: Request, ctx?: unknown) {
  await requireSignedIn(); // who is calling, before anything is read; the step decides which permission it needs
  const { id } = (ctx as { params: { id: string } }).params;
  const body = await parseBody(req, Body);
  if ('error' in body) return body.error;
  const b = body.data;
  if (b.action === 'approve') {
    const user = await requirePermission('students.leavers.approve');
    return apiSuccess(await approveLeaving(user, id, { overrideReason: b.overrideReason }));
  }
  const user = await requirePermission('students.leavers.manage');
  if (b.action === 'tick') return apiSuccess({ clearance: await tickClearance(user, id, b.key, b.ticked) });
  if (b.action === 'cancel') { await cancelLeaving(user, id, b.reason); return apiSuccess({ state: 'CANCELLED' }); }
  return apiSuccess(await completeLeaving(user, id, { conduct: b.conduct }));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/leaving/[id]', _POST as H);
