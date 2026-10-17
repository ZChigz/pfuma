// The school's subscription with Pfuma: plan, status, renewal date and what is billed. Pfuma staff
// set these in the platform console; the school only reads them (Subscription page, banner).
import type { SchoolStatus } from '@prisma/client';

const DAY = 864e5;
/** The banner starts this many days before the renewal date. */
export const RENEWAL_BANNER_DAYS = 14;

export type Banner =
  | { kind: 'renewal'; days: number; text: string }
  | { kind: 'overdue'; text: string }
  | { kind: 'suspended'; text: string };

export interface SubscriptionView {
  /** What the school is: a stored OVERDUE/SUSPENDED stays; ACTIVE/TRIAL past the renewal date reads as OVERDUE. */
  status: SchoolStatus;
  renewalDate: Date | null;
  /** Whole days from today to the renewal date (negative once past). */
  daysToRenewal: number | null;
  studentLimit: number | null;
  banner: Banner | null;
}

const startOfDayUtc = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export function subscriptionView(
  school: { status: SchoolStatus; renewalDate: Date | null; studentLimit: number | null },
  now = new Date(),
): SubscriptionView {
  const days = school.renewalDate ? Math.round((startOfDayUtc(school.renewalDate) - startOfDayUtc(now)) / DAY) : null;
  const lapsed = days !== null && days < 0;
  const status: SchoolStatus = (school.status === 'ACTIVE' || school.status === 'TRIAL') && lapsed ? 'OVERDUE' : school.status;

  let banner: Banner | null = null;
  if (status === 'SUSPENDED') {
    banner = { kind: 'suspended', text: 'Your school’s subscription is suspended. You can sign in and look at records, but nothing can be added or changed until it is paid.' };
  } else if (status === 'OVERDUE') {
    banner = { kind: 'overdue', text: 'Your subscription is overdue. Please pay your Pfuma invoice so your school is not suspended.' };
  } else if (days !== null && days >= 0 && days <= RENEWAL_BANNER_DAYS) {
    banner = {
      kind: 'renewal', days,
      text: days === 0 ? 'Your subscription renews today.' : `Your subscription renews in ${days} day${days === 1 ? '' : 's'}.`,
    };
  }
  return { status, renewalDate: school.renewalDate, daysToRenewal: days, studentLimit: school.studentLimit, banner };
}
