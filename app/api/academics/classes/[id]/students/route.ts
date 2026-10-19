import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { csvResponse, toCsv } from '@/lib/csv';
import { classStudents } from '@/lib/academics/classes';

export const runtime = 'nodejs';

async function _GET(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.classes.view');
  const { id } = (ctx as { params: { id: string } }).params;
  const q = new URL(req.url).searchParams;
  const data = await classStudents(user, id, q.get('termId') ?? undefined);
  if (q.get('format') === 'csv') {
    return csvResponse(`${data.className}-class-list.csv`, toCsv(['No', 'Admission number', 'Surname', 'First name', 'Gender', 'Boarding'], data.students.map((s) => [s.n, s.admissionNumber, s.surname, s.firstName, s.gender ?? '', s.boarding])));
  }
  return apiSuccess(data);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/classes/[id]/students', _GET as H);
