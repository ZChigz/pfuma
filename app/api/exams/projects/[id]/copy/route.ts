import { guarded, body } from '@/lib/exams/route';
import { copyTemplate } from '@/lib/exams/projects';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/projects/[id]/copy', 'exams.projects.manage', async ({ user, req, params }) => copyTemplate(user, params.id!, await body(req).catch(() => ({}))), 201);
