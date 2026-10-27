import { can, type AccessUser } from '@/lib/access-core';
import type { Row } from './mask';

const FINANCE_ENTITIES = /^(Fin[A-Z]|Payment$|Charge$|Expense|CashUp|Fund|Refund|FeeStructure|ExchangeRate)/;

/** The same test as a database filter, so a list is cut before it is counted and paged: everything that is not a finance entry. */
export const withoutFinanceEntries = {
  NOT: { OR: [{ module: 'finance' }, { entityType: { startsWith: 'Fin' } }, { entityType: { startsWith: 'Expense' } }, { entityType: { in: ['Payment', 'Charge', 'CashUp', 'Fund', 'Refund', 'FeeStructure', 'ExchangeRate'] } }] },
} as const;

/** The filter to add to an audit query for this person: nothing for someone who holds finance.reports.view, else no finance entries. */
export const auditFinanceFilter = (user: AccessUser) => (can(user, 'finance.reports.view') ? {} : withoutFinanceEntries);

/** An audit entry is a finance entry when the database says so (its module) or its entity is a finance table. */
export const isFinanceEntry = (entry: Row): boolean => entry.module === 'finance' || FINANCE_ENTITIES.test(String(entry.entityType ?? ''));

/**
 * The audit log: finance entries need system.audit.view AND finance.reports.view; everyone with system.audit.view sees the rest.
 * Returns null for an entry the person may not see (the caller drops it).
 */
export function serializeAuditEntry(user: AccessUser, entry: Row): Row | null {
  if (!can(user, 'system.audit.view')) return null;
  if (isFinanceEntry(entry) && !can(user, 'finance.reports.view')) return null;
  return { ...entry };
}
