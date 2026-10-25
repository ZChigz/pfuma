// Finds a learner by name or by the number on the ID card. Any facilities permission may look.
import { guarded } from '@/lib/finance/route';
import { ANY_FACILITIES, searchLearners } from '@/lib/facilities/people';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/learners', ANY_FACILITIES, async ({ user, query }) =>
  searchLearners(user, { q: query.get('q') || undefined, code: query.get('code') || undefined, boarders: query.get('boarders') === '1' }));
