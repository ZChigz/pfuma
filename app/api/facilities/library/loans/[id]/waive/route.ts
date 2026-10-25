// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded, body } from '@/lib/finance/route';
import { waiveFine } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/library/loans/[id]/waive', ['facilities.library.waive'], async ({ user, params, req }) => waiveFine(user, { ...(await body(req) as object), loanId: params.id }));
