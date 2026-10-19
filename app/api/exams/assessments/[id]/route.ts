import { guarded, body } from '@/lib/exams/route';
import { updateAssessment, deleteAssessment } from '@/lib/exams/assessments';

export const runtime = 'nodejs';

export const PATCH = guarded('PATCH /api/exams/assessments/[id]', ['exams.assessments.create', 'exams.setup.manage'], async ({ user, req, params }) => updateAssessment(user, params.id!, await body(req)));
export const DELETE = guarded('DELETE /api/exams/assessments/[id]', ['exams.assessments.create', 'exams.setup.manage'], async ({ user, params }) => deleteAssessment(user, params.id!));
