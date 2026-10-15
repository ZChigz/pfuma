import type { SubscriptionStatus } from '@prisma/client';

const DAY = 864e5;
export const EXPIRY_WARNING_DAYS = 30;

export interface SubscriptionView {
  plan: string;
  /** Stored status, except that a plan past its end date reads as EXPIRED. */
  status: SubscriptionStatus;
  startsAt: Date;
  endsAt: Date | null;
  daysLeft: number | null;
  expiringSoon: boolean;
  studentLimit: number | null;
}

export function subscriptionView(
  sub: { plan: string; status: SubscriptionStatus; startsAt: Date; endsAt: Date | null; studentLimit: number | null },
  now = new Date(),
): SubscriptionView {
  const daysLeft = sub.endsAt ? Math.ceil((sub.endsAt.getTime() - now.getTime()) / DAY) : null;
  const lapsed = daysLeft !== null && daysLeft < 0;
  const status = lapsed && (sub.status === 'ACTIVE' || sub.status === 'TRIAL') ? 'EXPIRED' : sub.status;
  return {
    plan: sub.plan,
    status,
    startsAt: sub.startsAt,
    endsAt: sub.endsAt,
    daysLeft,
    expiringSoon: (status === 'ACTIVE' || status === 'TRIAL') && daysLeft !== null && daysLeft <= EXPIRY_WARNING_DAYS,
    studentLimit: sub.studentLimit,
  };
}
