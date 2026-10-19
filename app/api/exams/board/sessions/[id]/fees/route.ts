import { guarded } from '@/lib/exams/route';
import { createFeeCharges } from '@/lib/exams/board';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/board/sessions/[id]/fees', 'exams.zimsec.manage', async ({ user, params }) => createFeeCharges(user, params.id!));
