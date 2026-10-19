import { guarded, body, ANY_EXAM_VIEW } from '@/lib/exams/route';
import { verifierSetup, setDepartmentVerifier } from '@/lib/exams/setup';
import { z } from 'zod';

export const runtime = 'nodejs';

const VerifierBody = z.object({ departmentId: z.string().min(1), userId: z.string().min(1).nullable() });
const saveVerifier = (user: Parameters<typeof setDepartmentVerifier>[0], raw: unknown) => {
  const b = VerifierBody.parse(raw);
  return setDepartmentVerifier(user, b.departmentId, b.userId);
};

export const GET = guarded('GET /api/exams/verifiers', ANY_EXAM_VIEW, async ({ user }) => verifierSetup(user));
export const PUT = guarded('PUT /api/exams/verifiers', 'exams.setup.manage', async ({ user, req }) => saveVerifier(user, await body(req)));
