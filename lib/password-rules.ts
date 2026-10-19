// Password rules shared by the server (lib/password.ts) and the browser. No
// imports, so it is safe in client components.
export const PASSWORD_MIN_LENGTH = 10;
// bcrypt ignores everything after 72 bytes; refuse such passwords instead of silently truncating.
export const PASSWORD_MAX_BYTES = 72;

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `Password must be at most ${PASSWORD_MAX_BYTES} bytes`;
  }
  return null;
}
