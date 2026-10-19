import { guarded, ANY_EXAM_VIEW } from '@/lib/exams/route';
import { evidenceLink } from '@/lib/exams/projects';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/evidence/[id]/link', ANY_EXAM_VIEW, async ({ user, params }) => evidenceLink(user, params.id!));
