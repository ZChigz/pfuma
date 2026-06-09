import { describe, it, expect } from 'vitest';

// Pure balance computation mirroring the API route logic in
// app/api/accounting/students/route.ts.
//
// Balance = Σ charges  −  Σ verified payments
// PENDING and VOIDED payments are excluded from the calculation.

type PaymentStatus = 'PENDING' | 'VERIFIED' | 'VOIDED';

interface Charge {
  amountUSD: number;
  amountZiG: number;
}

interface Payment {
  amountUSD: number;
  amountZiG: number;
  status: PaymentStatus;
}

function computeBalanceUSD(charges: Charge[], payments: Payment[]): number {
  const totalCharged = charges.reduce((sum, c) => sum + c.amountUSD, 0);
  const totalVerified = payments
    .filter((p) => p.status === 'VERIFIED')
    .reduce((sum, p) => sum + p.amountUSD, 0);
  return totalCharged - totalVerified;
}

function computeBalanceZiG(charges: Charge[], payments: Payment[]): number {
  const totalCharged = charges.reduce((sum, c) => sum + c.amountZiG, 0);
  const totalVerified = payments
    .filter((p) => p.status === 'VERIFIED')
    .reduce((sum, p) => sum + p.amountZiG, 0);
  return totalCharged - totalVerified;
}

// ─── USD balance ─────────────────────────────────────────────────────────────

describe('computeBalanceUSD', () => {
  it('returns 0 when there are no charges and no payments', () => {
    expect(computeBalanceUSD([], [])).toBe(0);
  });

  it('returns the full charged amount when there are no payments', () => {
    const charges: Charge[] = [{ amountUSD: 320, amountZiG: 0 }, { amountUSD: 45, amountZiG: 0 }];
    expect(computeBalanceUSD(charges, [])).toBe(365);
  });

  it('a verified payment reduces the balance to zero', () => {
    const charges: Charge[]  = [{ amountUSD: 365, amountZiG: 0 }];
    const payments: Payment[] = [{ amountUSD: 365, amountZiG: 0, status: 'VERIFIED' }];
    expect(computeBalanceUSD(charges, payments)).toBe(0);
  });

  it('a PENDING payment does NOT reduce the balance', () => {
    const charges: Charge[]  = [{ amountUSD: 365, amountZiG: 0 }];
    const payments: Payment[] = [{ amountUSD: 365, amountZiG: 0, status: 'PENDING' }];
    expect(computeBalanceUSD(charges, payments)).toBe(365);
  });

  it('a VOIDED payment does NOT reduce the balance', () => {
    const charges: Charge[]  = [{ amountUSD: 365, amountZiG: 0 }];
    const payments: Payment[] = [{ amountUSD: 365, amountZiG: 0, status: 'VOIDED' }];
    expect(computeBalanceUSD(charges, payments)).toBe(365);
  });

  it('a partial verified payment leaves the remaining balance', () => {
    const charges: Charge[]  = [{ amountUSD: 365, amountZiG: 0 }];
    const payments: Payment[] = [{ amountUSD: 200, amountZiG: 0, status: 'VERIFIED' }];
    expect(computeBalanceUSD(charges, payments)).toBe(165);
  });

  it('only verified payments count when mixed with voided and pending', () => {
    const charges: Charge[]  = [{ amountUSD: 365, amountZiG: 0 }];
    const payments: Payment[] = [
      { amountUSD: 200, amountZiG: 0, status: 'VERIFIED' },
      { amountUSD: 165, amountZiG: 0, status: 'VOIDED' },
      { amountUSD: 165, amountZiG: 0, status: 'PENDING' },
    ];
    // Only the $200 verified payment counts
    expect(computeBalanceUSD(charges, payments)).toBe(165);
  });

  it('multiple verified payments are summed before deducting', () => {
    const charges: Charge[]  = [{ amountUSD: 365, amountZiG: 0 }];
    const payments: Payment[] = [
      { amountUSD: 200, amountZiG: 0, status: 'VERIFIED' },
      { amountUSD: 165, amountZiG: 0, status: 'VERIFIED' },
    ];
    expect(computeBalanceUSD(charges, payments)).toBe(0);
  });

  it('overpayment produces a negative balance', () => {
    const charges: Charge[]  = [{ amountUSD: 100, amountZiG: 0 }];
    const payments: Payment[] = [{ amountUSD: 150, amountZiG: 0, status: 'VERIFIED' }];
    expect(computeBalanceUSD(charges, payments)).toBe(-50);
  });
});

// ─── ZiG balance ─────────────────────────────────────────────────────────────

describe('computeBalanceZiG', () => {
  it('returns 0 when there are no charges and no payments', () => {
    expect(computeBalanceZiG([], [])).toBe(0);
  });

  it('returns the full charged amount when there are no payments', () => {
    const charges: Charge[] = [{ amountUSD: 0, amountZiG: 1450 }];
    expect(computeBalanceZiG(charges, [])).toBe(1450);
  });

  it('a verified ZiG payment reduces the balance to zero', () => {
    const charges: Charge[]  = [{ amountUSD: 0, amountZiG: 1450 }];
    const payments: Payment[] = [{ amountUSD: 0, amountZiG: 1450, status: 'VERIFIED' }];
    expect(computeBalanceZiG(charges, payments)).toBe(0);
  });

  it('a PENDING ZiG payment does NOT reduce the balance', () => {
    const charges: Charge[]  = [{ amountUSD: 0, amountZiG: 1450 }];
    const payments: Payment[] = [{ amountUSD: 0, amountZiG: 1450, status: 'PENDING' }];
    expect(computeBalanceZiG(charges, payments)).toBe(1450);
  });

  it('a VOIDED ZiG payment does NOT reduce the balance', () => {
    const charges: Charge[]  = [{ amountUSD: 0, amountZiG: 1450 }];
    const payments: Payment[] = [{ amountUSD: 0, amountZiG: 1450, status: 'VOIDED' }];
    expect(computeBalanceZiG(charges, payments)).toBe(1450);
  });

  it('a partial ZiG payment leaves the remaining balance', () => {
    const charges: Charge[]  = [{ amountUSD: 0, amountZiG: 1450 }];
    const payments: Payment[] = [{ amountUSD: 0, amountZiG: 1000, status: 'VERIFIED' }];
    expect(computeBalanceZiG(charges, payments)).toBe(450);
  });
});

// ─── Dual-currency isolation ──────────────────────────────────────────────────

describe('currency independence', () => {
  it('USD charges and payments do not affect ZiG balance', () => {
    const charges: Charge[]  = [{ amountUSD: 365, amountZiG: 1450 }];
    const payments: Payment[] = [{ amountUSD: 365, amountZiG: 0, status: 'VERIFIED' }];
    expect(computeBalanceZiG(charges, payments)).toBe(1450);
    expect(computeBalanceUSD(charges, payments)).toBe(0);
  });
});
