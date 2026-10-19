import { guarded, body } from '@/lib/exams/route';
import { previewImport } from '@/lib/exams/import';
import { rowsFromFile } from '@/lib/exams/files';
import { ServiceError } from '@/lib/api';

export const runtime = 'nodejs';

// Checks an uploaded template against the class list and the maximum mark, without saving anything. Either JSON with the rows
// (a CSV read in the browser) or a multipart upload of the file (.xlsx or .csv) with the target in the form fields.
export const POST = guarded('POST /api/exams/marks/import/preview', 'exams.marks.enter', async ({ user, req }) => {
  if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new ServiceError('Choose the file to upload', 422);
    const rows = await rowsFromFile(file.name, Buffer.from(await file.arrayBuffer()));
    return previewImport(user, { assignmentId: String(form.get('assignmentId') ?? ''), assessmentId: String(form.get('assessmentId') ?? ''), stageId: form.get('stageId') ? String(form.get('stageId')) : null, rows });
  }
  return previewImport(user, await body(req));
});
