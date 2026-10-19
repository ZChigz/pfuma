import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { MoveStudentsSchema } from '@/lib/validations/academic';
import { moveClass } from '@/lib/students/enrolment';

// Superseded by /api/students/move. Same rules: a reason is recorded, a move after the term has started needs
// approval (students.enrolment.approve), and the audit entry names who approved it.
async function _POST(req: Request) {
  const user = await requirePermission('students.enrolment.manage');
  const parsed = await parseBody(req, MoveStudentsSchema);
  if ('error' in parsed) return parsed.error;
  const r = await moveClass(user, {
    studentIds: parsed.data.studentIds, toClassId: parsed.data.classId, reason: 'OTHER', reasonNote: 'Moved from the older Students page', acknowledgeFull: true,
  });
  return apiSuccess({ moved: r.applied, pending: r.pending, termName: r.termName, className: r.className });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/admin/students/move', _POST as H);
