// Proof-of-payment files are private: stored under a custom id that starts with
// the school id, and opened only through signed URLs that expire.
import { randomUUID } from 'node:crypto';

export const POP_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const POP_MAX_BYTES = 5 * 1024 * 1024;
/** How long a signed link to a proof stays valid. */
export const POP_URL_TTL = '5m';

export const newProofKey = (schoolId: string) => `pop:${schoolId}:${randomUUID()}`;

/** A key is only acceptable for a payment of the school whose id it carries. */
export const proofKeyBelongsTo = (key: string, schoolId: string) =>
  key.startsWith(`pop:${schoolId}:`) && key.length > `pop:${schoolId}:`.length;
