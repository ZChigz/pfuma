import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { lessonSheet } from '@/lib/academics/attendance';
import { todayInHarare } from '@/lib/academics/common';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { RegisterClient } from '@/components/academics/RegisterClient';

export const metadata = { title: 'Lesson register · Pfuma' };

// A register for one lesson: the students who take the subject. Optional (a school setting).
export default async function LessonRegisterPage({ searchParams }: { searchParams: { slotId?: string; date?: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.attendance.mark') && !can('academics.attendance.view')) return <AccessDenied />;
  try {
    const sheet = await lessonSheet(user, searchParams.slotId ?? '', searchParams.date ?? todayInHarare());
    return (
      <div className="flex flex-col gap-3">
        <nav className="text-sm"><Link href="/academics/attendance" className="font-semibold text-primary hover:underline">← All registers</Link></nav>
        <RegisterClient key={`${sheet.slotId}|${sheet.date}`} sheet={sheet} />
      </div>
    );
  } catch (err) {
    if (err instanceof ServiceError) return <EmptyState title="Lesson register not available" description={err.message} cta={{ label: 'All registers', href: '/academics/attendance' }} />;
    throw err;
  }
}
