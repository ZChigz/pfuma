import { requirePermission } from '@/lib/access';
import { apiError, withApi } from '@/lib/api';
import { csvResponse } from '@/lib/csv';
import { AlumniQuerySchema, exportAlumni } from '@/lib/students/alumni';

// A contact list for reunions or fundraising. Needs students.alumni.export, and every export is audit-logged.
async function _GET(req: Request) {
  const user = await requirePermission('students.alumni.export');
  const f = AlumniQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  const out = await exportAlumni(user, f.success ? f.data : {});
  if (out.count === 0) return apiError('No alumni match, so there is nothing to export', 404);
  return csvResponse(`alumni-${new Date().toISOString().slice(0, 10)}.csv`, out.csv);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/alumni/export', _GET as H);
