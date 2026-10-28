// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded, body } from '@/lib/finance/route';
import { listCategories, saveCategory } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/assets/categories', ['facilities.assets.view', 'facilities.assets.manage', 'facilities.assets.maintain', 'facilities.assets.dispose', 'facilities.assets.verify'], async ({ user }) => listCategories(user));
export const POST = guarded('POST /api/facilities/assets/categories', ['facilities.assets.manage'], async ({ user, req }) => saveCategory(user, await body(req)), 201);
