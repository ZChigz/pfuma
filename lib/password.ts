import bcrypt from 'bcryptjs';

import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, passwordProblem } from '@/lib/password-rules';

export { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, passwordProblem };
export const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  return bcrypt.hash(password, BCRYPT_COST);
}

/** True when a stored hash was made with a cheaper cost than we use now. */
export function needsRehash(hash: string): boolean {
  try {
    return bcrypt.getRounds(hash) < BCRYPT_COST;
  } catch {
    return false;
  }
}

const TEMP_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Random temporary password (cryptographically secure), long enough for the password rules. */
export function generateTempPassword(length = 12): string {
  const n = Math.max(length, PASSWORD_MIN_LENGTH);
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = '';
  // Reject bytes that would bias the alphabet.
  const limit = 256 - (256 % TEMP_CHARS.length);
  for (let i = 0; out.length < n; i++) {
    if (i >= bytes.length) {
      crypto.getRandomValues(bytes);
      i = 0;
    }
    if (bytes[i] < limit) out += TEMP_CHARS[bytes[i] % TEMP_CHARS.length];
  }
  return out;
}
