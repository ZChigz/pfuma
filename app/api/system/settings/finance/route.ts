import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { updateFinanceSettings } from '@/lib/system/settings';
import { FinanceSettingsSchema } from '@/lib/validations/system';

async function _PATCH(req: Request) {
  const user = await requirePermission('system.finance.update');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, FinanceSettingsSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess({ school: await updateFinanceSettings(db, user, parsed.data) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/system/settings/finance', _PATCH as H);
