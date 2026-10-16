/**
 * Reads a Zimbabwe phone number the way people write it and returns it as "+263…"
 * (digits only after the plus), or null when it cannot be one.
 *   "0242 700 123"  → "+263242700123"
 *   "+263 77 123 4567" → "+263771234567"
 *   "263-242-700123"   → "+263242700123"
 * The part after +263 must be 8 to 10 digits.
 */
export function normalizeZimbabwePhone(input: string): string | null {
  const cleaned = input.trim().replace(/[\s().-]/g, '');
  if (!/^\+?[0-9]+$/.test(cleaned)) return null;
  let national: string;
  if (cleaned.startsWith('+263')) national = cleaned.slice(4);
  else if (cleaned.startsWith('+')) return null; // another country
  else if (cleaned.startsWith('00263')) national = cleaned.slice(5);
  else if (cleaned.startsWith('263')) national = cleaned.slice(3);
  else if (cleaned.startsWith('0')) national = cleaned.slice(1);
  else return null;
  // A "(0)" after the country code, as in +263 (0)242…, leaves a stray leading zero.
  if (national.startsWith('0')) national = national.slice(1);
  return /^[0-9]{8,10}$/.test(national) ? `+263${national}` : null;
}
