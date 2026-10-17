import { requirePermission } from '@/lib/access';
import { withApi } from '@/lib/api';
import { promotionReport } from '@/lib/students/promotion';
import { pdfResponse } from '@/lib/students/pdf';
import { PromotionReportDocument } from '@/components/students/pdf/PromotionReportDocument';

export const runtime = 'nodejs';

// The report of a confirmed promotion as a PDF: where each class went, the counts and everyone who left.
async function _GET(_req: Request, ctx?: unknown) {
  const user = await requirePermission('students.promotion.manage');
  const { runId } = (ctx as { params: { runId: string } }).params;
  const data = await promotionReport(user, runId);
  return pdfResponse(PromotionReportDocument, { data }, `promotion-${data.fromYear}-${data.toYear}.pdf`);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/promotion/[runId]/report', _GET as H);
