// Generated from the Finance route list: each route asks can() first, then the service checks the permission and every money rule again.
import { guarded } from '@/lib/finance/route';
import * as statements from '@/lib/finance/statements';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/statements/student/[id]', ['finance.accounts.view', 'finance.statements.view'], async ({ user, params, query }) => statements.studentStatement(user, params.id, query.get('termId') || undefined));
