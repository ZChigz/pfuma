import { redirect } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { homeFor } from '@/lib/home';

// "/" sends each person to their home: the admin dashboard for those who manage users, otherwise the first page their permissions
// open (lib/home.ts).
export default async function HomePage() {
  const { user } = await getAccess();
  redirect(homeFor(user));
}
