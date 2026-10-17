import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { RequiredDocumentsSchema, setRequiredDocuments } from '@/lib/students/documents';

// The school chooses which document types every student file must hold (the Documents tab checklist).
async function _PUT(req: Request) {
  const user = await requirePermission('system.settings.edit');
  const body = await parseBody(req, RequiredDocumentsSchema);
  if ('error' in body) return body.error;
  return apiSuccess({ types: await setRequiredDocuments(user, body.data) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PUT = withApi('PUT /api/system/settings/documents', _PUT as H);
