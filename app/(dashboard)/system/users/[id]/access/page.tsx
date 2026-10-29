import { redirect } from 'next/navigation';

// Moved to /admin/users/[id]/access. Old links and notifications still land on the right page.
export default function MovedUserAccess({ params }: { params: { id: string } }) {
  redirect(`/admin/users/${params.id}/access`);
}
