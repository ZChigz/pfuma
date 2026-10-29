// Where a signed-in person lands. Anyone who manages users lands on the admin dashboard (/admin); everyone else lands on the first
// page the sidebar offers them, so nobody is sent to a page they cannot open.
import { can, type AccessUser } from '@/lib/access-core';
import { buildNav } from '@/lib/nav';
import { workspaceFor } from '@/components/layout/nav-config';

/** Open to every signed-in person, so it is the last resort. */
const FALLBACK = '/system/profile';

export function homeFor(user: AccessUser): string {
  if (can(user, 'system.users.view')) return '/admin';
  const fromNav = buildNav(user).flatMap((g) => g.items).find((i) => i.href)?.href;
  if (fromNav) return fromNav;
  const fromWorkspace = workspaceFor(user, '')?.sections[0]?.items[0]?.href;
  return fromWorkspace ?? FALLBACK;
}
