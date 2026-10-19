/**
 * Tidies a person's name as it is typed: extra spaces go, and every part written all in lower case
 * or all in capitals gets a capital first letter and lower case after it, so "tendai MOYO-chari"
 * becomes "Tendai Moyo-Chari". A part that already mixes cases ("McDonald", "DeKlerk") is left as
 * the person wrote it.
 */
export function capitalizeName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(/([\s'’-])/)
    .map((part) => {
      if (part.length === 0 || /^[\s'’-]$/.test(part)) return part;
      const plain = part === part.toLowerCase() || part === part.toUpperCase();
      return plain ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part;
    })
    .join('');
}
