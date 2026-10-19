import { requirePermission } from '@/lib/access';
import { withApi } from '@/lib/api';
import { csvResponse } from '@/lib/csv';
import { exportPanel } from '@/lib/academics/analytics';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.analytics.view');
  const q = new URL(req.url).searchParams;
  const out = await exportPanel(user, (q.get('panel') ?? '') as 'attendance', { termId: q.get('termId') ?? undefined, formId: q.get('formId') ?? undefined, classId: q.get('classId') ?? undefined, departmentId: q.get('departmentId') ?? undefined });
  return csvResponse(out.filename, out.csv);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/analytics/export', _GET as H);
