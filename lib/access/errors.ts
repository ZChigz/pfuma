// The one error the access engine throws. It is a ServiceError, so withApi and the module route wrappers return it as a JSON message
// with its status: 403 for "you may not", 404 for a record of another school (so ids do not leak), 401 when not signed in.
import { ServiceError } from '@/lib/api';

export type AccessErrorCode =
  | 'NOT_SIGNED_IN'
  | 'MODULE_OFF'
  | 'MISSING_PERMISSION'
  | 'OUT_OF_SCOPE'
  | 'OTHER_SCHOOL'
  | 'SEPARATION_OF_DUTIES'
  | 'RECORD_CLOSED'
  | 'READ_ONLY'
  | 'PROTECTED_ROLE';

export class AccessError extends ServiceError {
  constructor(
    message: string,
    status: 401 | 403 | 404,
    public readonly code: AccessErrorCode,
    /** The permission that is missing or was refused, if there is one. */
    public readonly key?: string,
    /** For a separation-of-duties refusal: the rule number (1 to 10). */
    public readonly rule?: number,
  ) {
    super(message, status);
    this.name = 'AccessError';
  }
}

/** A record that belongs to another school, or does not exist: the same answer for both. */
export const notFound = (what = 'Record') => new AccessError(`${what} not found`, 404, 'OTHER_SCHOOL');
