import { guarded } from '@/lib/exams/route';
import { analyticsPanel, type PanelKey } from '@/lib/exams/analytics';

export const runtime = 'nodejs';

const filtersOf = (q: URLSearchParams) => Object.fromEntries(['termId', 'levelId', 'classId', 'subjectId', 'gender', 'assessmentId', 'source', 'studentId', 'sessionId'].flatMap((k) => (q.get(k) ? [[k, q.get(k)!]] : [])));

export const GET = guarded('GET /api/exams/analytics', 'exams.analytics.view', async ({ user, query }) => analyticsPanel(user, (query.get('panel') ?? 'overview') as PanelKey, filtersOf(query)));
