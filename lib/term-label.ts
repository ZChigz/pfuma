/** "Term 3 2026" (how terms are stored) → "2026 Term 3" (how the top bar shows them). Other names pass through. */
export function termLabel(name: string): string {
  const m = /^Term (\d+) (\d{4})$/.exec(name.trim());
  return m ? `${m[2]} Term ${m[1]}` : name;
}
