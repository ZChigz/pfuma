import { redirect } from 'next/navigation';

// The older Students page is replaced by Student Information (/students), which holds the same lists with the new rules.
export default function OldStudentsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const q = new URLSearchParams();
  if (searchParams.classId) q.set('classId', searchParams.classId);
  redirect(`/students${q.toString() ? `?${q.toString()}` : ''}`);
}
