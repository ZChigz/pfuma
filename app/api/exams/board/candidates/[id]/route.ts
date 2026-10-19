import { guarded, body } from '@/lib/exams/route';
import { updateCandidate, removeCandidate } from '@/lib/exams/board';

export const runtime = 'nodejs';

export const PATCH = guarded('PATCH /api/exams/board/candidates/[id]', 'exams.zimsec.manage', async ({ user, req, params }) => updateCandidate(user, params.id!, await body(req)));
export const DELETE = guarded('DELETE /api/exams/board/candidates/[id]', 'exams.zimsec.manage', async ({ user, params }) => removeCandidate(user, params.id!));
