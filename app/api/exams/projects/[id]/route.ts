import { guarded, body } from '@/lib/exams/route';
import { updateTemplate } from '@/lib/exams/projects';

export const runtime = 'nodejs';

export const PATCH = guarded('PATCH /api/exams/projects/[id]', 'exams.projects.manage', async ({ user, req, params }) => updateTemplate(user, params.id!, await body(req)));
