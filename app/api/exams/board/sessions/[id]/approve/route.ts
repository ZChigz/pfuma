import { guarded } from '@/lib/exams/route';
import { approveEntryList } from '@/lib/exams/board';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/board/sessions/[id]/approve', 'exams.zimsec.approve', async ({ user, params }) => approveEntryList(user, params.id!));
