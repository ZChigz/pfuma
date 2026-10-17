import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { GuardianMeetingSchema, recordGuardianMeeting } from '@/lib/students/discipline';

// A guardian meeting: date, who attended, the outcome, and optionally the signed letter (uploaded first as a document).
async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.discipline.create');
  const { id } = (ctx as { params: { id: string } }).params;
  const body = await parseBody(req, GuardianMeetingSchema);
  if ('error' in body) return body.error;
  await recordGuardianMeeting(user, id, body.data);
  return apiSuccess({ recorded: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/discipline/actions/[id]/meeting', _POST as H);
