import { requireSignedIn } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { lookupGuardianByPhone } from '@/lib/students/guardians';

// Search for a guardian by phone first, so siblings share one guardian record. Never returns an ID number.
async function _GET(req: Request) {
  const user = await requireSignedIn();
  const phone = new URL(req.url).searchParams.get('phone') ?? '';
  return apiSuccess({ guardian: await lookupGuardianByPhone(user, phone) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/guardians/lookup', _GET as H);
