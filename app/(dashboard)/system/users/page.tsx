import { redirect } from 'next/navigation';

// The Users page lives at /admin/users now. Old links (notifications, audit log, bookmarks) keep their query, e.g. ?q= or ?new=1.
export default function MovedUsersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) for (const one of [v].flat()) if (one !== undefined) qs.append(k, one);
  const s = qs.toString();
  redirect(`/admin/users${s ? `?${s}` : ''}`);
}
