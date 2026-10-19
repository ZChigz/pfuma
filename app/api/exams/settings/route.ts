import { guarded, body, ANY_EXAM_VIEW } from '@/lib/exams/route';
import { getExamSettings, saveExamSettings } from '@/lib/exams/setup';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/settings', ANY_EXAM_VIEW, async ({ user }) => getExamSettings(user));
export const PUT = guarded('PUT /api/exams/settings', ['exams.setup.manage', 'exams.reportcards.settings'], async ({ user, req }) => saveExamSettings(user, await body(req)));
