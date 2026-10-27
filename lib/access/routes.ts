// Which permission a page needs, so a whole page can be refused on the server before it renders. The map is the sidebar (lib/nav.ts): an
// item's href is the page and its permission (or any of its `or` keys) is what opens it, so the menu and the guard cannot disagree.
// A path under an item's href (/students/123 under /students) needs the same key; the longest matching href wins.
import { can, type AccessUser } from '@/lib/access-core';
import { NAV_GROUPS } from '@/lib/nav';

interface Rule { href: string; keys: string[] }

const RULES: Rule[] = NAV_GROUPS.flatMap((g) => g.items)
  .filter((i): i is typeof i & { href: string } => !!i.href)
  .map((i) => ({ href: i.href, keys: [i.permission, ...(i.or ?? [])] }))
  .sort((a, b) => b.href.length - a.href.length);

/** The keys, any one of which opens the page; null when the page is not one the menu knows (the page itself checks, or it is open). */
export function requiredKeysFor(pathname: string): string[] | null {
  const path = pathname.split('?')[0]!.replace(/\/+$/, '') || '/';
  const rule = RULES.find((r) => path === r.href || path.startsWith(`${r.href}/`));
  return rule ? rule.keys : null;
}

/** Whether the person may open the page. A page the menu does not know is left to its own check. */
export function mayOpen(user: AccessUser, pathname: string): boolean {
  const keys = requiredKeysFor(pathname);
  return keys === null || keys.some((k) => can(user, k));
}

/** Every page the menu knows and the keys that open it (for the "what can this user do" view and for tests). */
export const routeRules = (): readonly Rule[] => RULES;
