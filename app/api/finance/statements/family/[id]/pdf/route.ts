import { guarded } from '@/lib/finance/route';
import { familyStatement } from '@/lib/finance/statements';
import { schoolHead } from '@/lib/finance/downloads';
import { pdfResponse } from '@/lib/students/pdf';
import { StatementDocument } from '@/components/finance/pdf/Documents';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/statements/family/[id]/pdf', ['finance.statements.view', 'finance.accounts.view'], async ({ user, params, query }) => {
  const f = await familyStatement(user, params.id, query.get('termId') || undefined);
  return pdfResponse(StatementDocument, { statements: f.statements, head: await schoolHead(user) }, `family-statement-${params.id}.pdf`);
});
