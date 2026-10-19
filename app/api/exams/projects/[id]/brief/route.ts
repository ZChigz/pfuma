import { guarded } from '@/lib/exams/route';
import { briefLink } from '@/lib/exams/projects';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/projects/[id]/brief', ['exams.projects.manage', 'exams.assessments.create'], async ({ user, params }) => briefLink(user, params.id!));
