import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { importTemplateCsv } from '@/lib/students/import-map';
import { ImportBodySchema, importStudents } from '@/lib/students/import';
import { csvResponse } from '@/lib/csv';

// The CSV template (first_name, surname, gender, date_of_birth, ...).
async function _GET() {
  await requirePermission('students.profiles.import');
  return csvResponse('students-import-template.csv', importTemplateCsv());
}

// Import every row that is not an Error, in one transaction. The rows are checked again here, so the preview
// can never be used to slip in a row that would not pass. The answer carries the report of skipped rows.
async function _POST(req: Request) {
  const user = await requirePermission('students.profiles.import');
  const body = await parseBody(req, ImportBodySchema);
  if ('error' in body) return body.error;
  return apiSuccess(await importStudents(user, body.data), 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/import', _GET as H);
export const POST = withApi('POST /api/students/import', _POST as H);
