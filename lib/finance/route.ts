// The same thin wrapper the Examinations routes use: ask can() first (any one of the permissions will do), read the parameters,
// answer { success, data }. The service behind each route checks the permission again and every money rule.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import type { Cur } from '@/lib/finance/money';

export { guarded, body, requireAny, type RouteCtx } from '@/lib/exams/route';

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD');
const cur = z.enum(['USD', 'ZIG']);

/** Query-string values the report routes accept; a bad one is a 422, never a silent default. */
export function readQuery<T extends z.ZodRawShape>(query: URLSearchParams, shape: T): z.infer<z.ZodObject<T>> {
  const raw: Record<string, string | undefined> = {};
  for (const k of Object.keys(shape)) raw[k] = query.get(k) || undefined;
  const parsed = z.object(shape).safeParse(raw);
  if (!parsed.success) throw new ServiceError(parsed.error.issues[0]?.message ?? 'Invalid request', 422);
  return parsed.data;
}

export const q = {
  iso: iso.optional(),
  id: z.string().trim().min(1).max(64).optional(),
  currency: cur.optional() as z.ZodOptional<z.ZodType<Cur>>,
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  text: z.string().trim().max(80).optional(),
  bool: z.enum(['1', 'true']).optional().transform((v) => !!v),
};
