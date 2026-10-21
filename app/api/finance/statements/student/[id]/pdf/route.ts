import { guarded } from '@/lib/finance/route';
import { studentStatement } from '@/lib/finance/statements';
import { schoolHead } from '@/lib/finance/downloads';
import { pdfResponse } from '@/lib/students/pdf';
import { StatementDocument } from '@/components/finance/pdf/Documents';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/statements/student/[id]/pdf', ['finance.statements.view', 'finance.accounts.view'], async ({ user, params, query }) => {
  const st = await studentStatement(user, params.id, query.get('termId') || undefined);
  return pdfResponse(StatementDocument, { statements: [st], head: await schoolHead(user) }, `statement-${st.student.admissionNumber ?? st.student.id}.pdf`);
});
