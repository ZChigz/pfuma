// Reminder letters: a statement with the amount due for each chosen learner, ready to print (POST { studentIds }).
import { z } from 'zod';
import { guarded, body } from '@/lib/finance/route';
import { getScopedDb } from '@/lib/scoped-db';
import { buildStatement } from '@/lib/finance/statements';
import { schoolHead } from '@/lib/finance/downloads';
import { pdfResponse } from '@/lib/students/pdf';
import { StatementDocument } from '@/components/finance/pdf/Documents';

export const runtime = 'nodejs';

const Schema = z.object({ studentIds: z.array(z.string().min(1)).min(1).max(200) });

export const POST = guarded('POST /api/finance/arrears/letters', 'finance.statements.view', async ({ user, req }) => {
  const { studentIds } = Schema.parse(await body(req));
  const statements = await getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const out = [];
    for (const id of studentIds) out.push(await buildStatement(tx, user.schoolId, id));
    return out.filter((s) => s.closing.USD > 0 || s.closing.ZIG > 0);
  });
  return pdfResponse(StatementDocument, { statements, head: await schoolHead(user) }, 'reminder-letters.pdf');
});
