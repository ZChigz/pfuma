'use client';

// Small pieces the Examinations screens share (the same helpers the Academics screens use, plus status badges for mark sheets).
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
export { api, problem, fieldMessages, Tabs, Section, Notice, ClosedNotice, Th, Td, linkButton, primaryLink, type ApiResult } from '@/components/academics/shared';

export const SHEET_VARIANT: Record<string, BadgeVariant> = {
  NOT_STARTED: 'neutral', IN_PROGRESS: 'info', SUBMITTED: 'warning', VERIFIED: 'success', PUBLISHED: 'success', RETURNED: 'danger', UNLOCKED: 'warning',
};
export const SHEET_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', SUBMITTED: 'Submitted', VERIFIED: 'Verified', PUBLISHED: 'Published', RETURNED: 'Returned', UNLOCKED: 'Unlocked',
};

export function SheetBadge({ status }: { status: string }) {
  return <Badge variant={SHEET_VARIANT[status] ?? 'neutral'} label={SHEET_LABEL[status] ?? status} />;
}

export const fieldClass = 'h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-canvas disabled:text-muted';
export const labelClass = 'text-sm font-medium text-ink';
