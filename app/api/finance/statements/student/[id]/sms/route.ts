// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as statements from '@/lib/finance/statements';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/finance/statements/student/[id]/sms', 'finance.statements.view', async ({ user, params }) => statements.sendStatementSms(user, params.id));
