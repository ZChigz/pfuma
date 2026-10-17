import { z } from 'zod';
import { requirePermission } from '@/lib/access';
import { apiError, parseBody, withApi } from '@/lib/api';
import { csvResponse } from '@/lib/csv';
import { exportStudents } from '@/lib/students/export';
import { parseStudentListQuery } from '@/lib/students/list';

const Body = z.object({
  /** The rows ticked in the list; without them the whole filtered list is taken. */
  ids: z.array(z.string().min(1).max(64)).min(1).max(5000).optional(),
  /** Asking for a column the user may not have does nothing; it is simply left out. */
  columns: z.array(z.string().max(40)).max(40).optional(),
  filters: z.record(z.string(), z.string().max(100)).default({}),
});

// POST so that the selection and filters travel in the body. Every export is audit-logged, with the
// columns that were actually included.
async function _POST(req: Request) {
  const user = await requirePermission('students.profiles.export');
  const body = await parseBody(req, Body);
  if ('error' in body) return body.error;
  const query = parseStudentListQuery(new URLSearchParams(body.data.filters));
  const result = await exportStudents(user, query, {
    ids: body.data.ids, columns: body.data.columns, purpose: body.data.ids ? 'Selected students' : 'Student list',
  });
  if (result.count === 0) return apiError('No students match, so there is nothing to export', 404);
  return csvResponse(`students-${new Date().toISOString().slice(0, 10)}.csv`, result.csv);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/students/export', _POST as H);
