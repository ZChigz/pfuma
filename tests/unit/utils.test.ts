import { describe, it, expect } from 'vitest';
import {
  formatUSD,
  formatZiG,
  formatDate,
  getDaysOverdue,
  buildWhatsAppLink,
} from '@/lib/utils';

describe('formatUSD', () => {
  it('formats a typical positive amount with two decimal places', () => {
    expect(formatUSD(1234.5)).toBe('$1,234.50');
  });

  it('formats zero', () => {
    expect(formatUSD(0)).toBe('$0.00');
  });

  it('formats a negative amount', () => {
    expect(formatUSD(-50)).toBe('-$50.00');
  });

  it('formats a large amount with thousands separator', () => {
    expect(formatUSD(10000)).toBe('$10,000.00');
  });

  it('accepts a Decimal-like object (toNumber)', () => {
    expect(formatUSD({ toNumber: () => 99.9 })).toBe('$99.90');
  });

  it('accepts a Decimal-like object with value zero', () => {
    expect(formatUSD({ toNumber: () => 0 })).toBe('$0.00');
  });
});

describe('formatZiG', () => {
  it('formats a positive integer amount with ZiG prefix', () => {
    expect(formatZiG(1450)).toBe('ZiG 1,450');
  });

  it('rounds a fraction ≥ 0.5 up', () => {
    expect(formatZiG(999.6)).toBe('ZiG 1,000');
  });

  it('rounds a fraction < 0.5 down', () => {
    expect(formatZiG(999.4)).toBe('ZiG 999');
  });

  it('formats zero', () => {
    expect(formatZiG(0)).toBe('ZiG 0');
  });

  it('accepts a Decimal-like object (toNumber)', () => {
    expect(formatZiG({ toNumber: () => 2500 })).toBe('ZiG 2,500');
  });
});

describe('formatDate', () => {
  it('formats a Date object using dd MMM yyyy', () => {
    expect(formatDate(new Date(2026, 4, 20))).toBe('20 May 2026');
  });

  it('pads a single-digit day with a leading zero', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('05 Jan 2026');
  });

  it('handles a UTC ISO string at noon (timezone-safe)', () => {
    expect(formatDate('2026-06-15T12:00:00.000Z')).toBe('15 Jun 2026');
  });

  it('formats the last day of December correctly', () => {
    expect(formatDate(new Date(2025, 11, 31))).toBe('31 Dec 2025');
  });
});

describe('getDaysOverdue', () => {
  it('returns 0 for a date issued right now', () => {
    expect(getDaysOverdue(new Date())).toBe(0);
  });

  it('returns 0 for a future date — does not go negative', () => {
    const future = new Date(Date.now() + 7 * 86_400_000);
    expect(getDaysOverdue(future)).toBe(0);
  });

  it('returns the number of complete days elapsed (floor, not ceil)', () => {
    const twoDaysAgo = new Date(Date.now() - 2.5 * 86_400_000);
    expect(getDaysOverdue(twoDaysAgo)).toBe(2);
  });

  it('returns 1 for a date issued exactly 25 hours ago', () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 3_600_000);
    expect(getDaysOverdue(twentyFiveHoursAgo)).toBe(1);
  });

  it('handles exactly 30 days ago', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    expect(getDaysOverdue(thirtyDaysAgo)).toBe(30);
  });
});

describe('buildWhatsAppLink', () => {
  it('builds a correct link from a local Zimbabwean number', () => {
    expect(buildWhatsAppLink('0772114552', 'Hello'))
      .toBe('https://wa.me/0772114552?text=Hello');
  });

  it('strips the leading + from an international number', () => {
    expect(buildWhatsAppLink('+263772114552', 'Hello'))
      .toBe('https://wa.me/263772114552?text=Hello');
  });

  it('strips spaces and hyphens from a formatted international number', () => {
    expect(buildWhatsAppLink('+263 772 114-552', 'Hello'))
      .toBe('https://wa.me/263772114552?text=Hello');
  });

  it('URL-encodes special characters in the message', () => {
    const url = buildWhatsAppLink('0772114552', 'Fee balance: $100.00');
    expect(url).toBe(
      `https://wa.me/0772114552?text=${encodeURIComponent('Fee balance: $100.00')}`,
    );
  });

  it('URL-encodes ampersands and spaces in the message', () => {
    const url = buildWhatsAppLink('0772114552', 'Dear parent & guardian');
    expect(url).toContain(encodeURIComponent('Dear parent & guardian'));
  });
});
