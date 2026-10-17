import type { BadgeVariant } from '@/components/ui/Badge';

export const STATUS_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  TRIAL: { label: 'Trial', variant: 'info' },
  ACTIVE: { label: 'Active', variant: 'success' },
  OVERDUE: { label: 'Overdue', variant: 'warning' },
  SUSPENDED: { label: 'Suspended', variant: 'danger' },
};
