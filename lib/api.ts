import { NextResponse } from 'next/server';
import { ZodError, type ZodSchema } from 'zod';
import { SchoolSuspendedError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status });
}

export function apiError(message: string, status = 400): NextResponse {
  return NextResponse.json({ success: false, message }, { status });
}

export function apiUnauthorized(): NextResponse {
  return apiError('Unauthorized', 401);
}

export function apiForbidden(): NextResponse {
  return apiError('Forbidden', 403);
}

export function apiNotFound(entity = 'Resource'): NextResponse {
  return apiError(`${entity} not found`, 404);
}

export function apiValidationError(errors: ZodError): NextResponse {
  return NextResponse.json(
    {
      success: false,
      message: 'Validation failed',
      errors: errors.flatten().fieldErrors,
    },
    { status: 422 },
  );
}

// ─── Service errors ──────────────────────────────────────────────────────────
// Thrown by the service layer (lib/academic, lib/students…) when a business
// rule is broken. withApi turns it into a JSON error with the given status.

export class ServiceError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'ServiceError';
  }
}

// ─── Route error wrapper ─────────────────────────────────────────────────────
// Catches any unhandled error thrown inside a route handler, logs it with
// structured context, and returns a clean 500 response instead of bubbling
// up to Next.js's default handler.

type NextHandler = (req: Request, ctx?: unknown) => Promise<Response>;

export function withApi(label: string, handler: NextHandler): NextHandler {
  return async (req: Request, ctx?: unknown) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ServiceError) return apiError(err.message, err.status);
      // A service that checks its own input (Zod) answers with the same 422 shape as parseBody.
      if (err instanceof ZodError) return apiValidationError(err);
      if (err instanceof Response) return err;
      if (err instanceof SchoolSuspendedError) return apiError(err.message, 403);
      // The database refused a reference into another school (trigger
      // check_same_school). Treat it like any record the caller cannot see.
      if (err instanceof Error && err.message.includes('Cross-school reference')) {
        logger.warn(`Cross-school reference refused: ${label}`, { url: req.url });
        return NextResponse.json({ success: false, message: 'Referenced record not found' }, { status: 404 });
      }
      logger.error(`Unhandled route error: ${label}`, err, { url: req.url });
      return NextResponse.json(
        { success: false, message: 'Internal server error' },
        { status: 500 },
      );
    }
  };
}

/** The JSON body of a request, for routes whose service validates it with its own schema. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new ServiceError('Invalid JSON', 400);
  }
}

export async function parseBody<T>(
  req: Request,
  schema: ZodSchema<T>,
): Promise<{ data: T } | { error: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: apiError('Invalid JSON', 400) };
  }

  try {
    return { data: schema.parse(body) };
  } catch (e) {
    if (e instanceof ZodError) return { error: apiValidationError(e) };
    throw e;
  }
}
