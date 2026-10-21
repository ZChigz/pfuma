// Money rules that need no database: whole cents only, no float arithmetic, two currencies never added, oldest charge settled first.
import { describe, expect, it } from 'vitest';
import { addTo, allocateOldestFirst, formatMoney, formatTotals, MAX_CENTS, outstandingOf, parseCents, plainAmount, zeroTotals } from '@/lib/finance/money';

describe('amounts are whole cents', () => {
  it('turns what a person types into exact cents', () => {
    expect(parseCents('125.50')).toBe(12550);
    expect(parseCents('125.5')).toBe(12550);
    expect(parseCents('125')).toBe(12500);
    expect(parseCents('1,250.00')).toBe(125000);
    expect(parseCents(19.99)).toBe(1999);
    expect(parseCents('0.01')).toBe(1);
  });

  it('is exact where floating point is not: 1.10 + 2.20 is 330 cents', () => {
    expect(parseCents('1.10') + parseCents('2.20')).toBe(330);
    expect(1.1 + 2.2).not.toBe(3.3); // the bug this rule avoids
    expect(() => parseCents(1.1 * 3)).toThrow(RangeError); // 3.3000000000000003 has too many decimals
  });

  it('refuses rounding: more than two decimals, signs, exponents, letters, empty', () => {
    for (const bad of ['10.005', '0.001', '-5', '+5', '1e3', 'abc', '', ' ', '12.', '.5', '1.2.3', 3.3000000000000003, Number.NaN]) {
      expect(() => parseCents(bad as string | number), String(bad)).toThrow(RangeError);
    }
  });

  it('refuses an amount a row cannot hold', () => {
    expect(parseCents(String(MAX_CENTS / 100))).toBe(MAX_CENTS);
    expect(() => parseCents(String(MAX_CENTS / 100 + 1))).toThrow(/too large/);
  });

  it('shows cents with the currency, and plain decimals for files', () => {
    expect(formatMoney(125050, 'USD')).toBe('US$1,250.50');
    expect(formatMoney(5, 'ZIG')).toBe('ZiG 0.05');
    expect(formatMoney(-500, 'USD')).toBe('-US$5.00');
    expect(plainAmount(12550)).toBe('125.50');
    expect(plainAmount(-7)).toBe('-0.07');
  });
});

describe('two currencies are never added', () => {
  it('keeps a total per currency and shows both side by side', () => {
    const t = zeroTotals();
    addTo(t, 'USD', 30000);
    addTo(t, 'ZIG', 50000);
    addTo(t, 'USD', 1000);
    expect(t).toEqual({ USD: 31000, ZIG: 50000 });
    expect(formatTotals(t)).toBe('US$310.00 · ZiG 500.00');
    expect(formatTotals({ USD: 0, ZIG: 100 })).toBe('ZiG 1.00');
    expect(formatTotals({})).toBe('US$0.00');
  });
});

describe('a balance is calculated, never stored', () => {
  it('is charges − approved adjustments − allocated payments + refunds', () => {
    expect(outstandingOf({ charged: 30000, adjusted: 5000, paid: 10000, refunded: 0 })).toBe(15000);
    expect(outstandingOf({ charged: 30000, adjusted: 0, paid: 30000, refunded: 30000 })).toBe(30000);
    expect(outstandingOf({ charged: 0, adjusted: 0, paid: 0, refunded: 0 })).toBe(0);
  });
});

describe('the oldest charge is settled first', () => {
  const owed = [{ chargeId: 'a', outstandingCents: 10000 }, { chargeId: 'b', outstandingCents: 5000 }, { chargeId: 'c', outstandingCents: 0 }, { chargeId: 'd', outstandingCents: 7000 }];
  it('fills charges in order and splits a payment across them', () => {
    expect(allocateOldestFirst(12000, owed)).toEqual({ splits: [{ chargeId: 'a', amountCents: 10000 }, { chargeId: 'b', amountCents: 2000 }], leftCents: 0 });
  });
  it('leaves what is over as credit, and never allocates to a settled charge', () => {
    const r = allocateOldestFirst(50000, owed);
    expect(r.splits.map((s) => s.chargeId)).toEqual(['a', 'b', 'd']);
    expect(r.leftCents).toBe(50000 - 22000);
  });
  it('allocates nothing for nothing', () => {
    expect(allocateOldestFirst(0, owed)).toEqual({ splits: [], leftCents: 0 });
    expect(allocateOldestFirst(100, [])).toEqual({ splits: [], leftCents: 100 });
  });
});
