import { describe, expect, it } from 'vitest';
import { calcPay, calcPaye, casualPay, netMovedFlag, prorate, splitPay, unpaidLeaveDeduction, assertValidBands, bpsOf, type StatutoryRates } from '@/lib/payroll/calc';
import { DEFAULT_RATES, DEFAULT_USD_BANDS, DEFAULT_ZIG_BANDS, inForce, ratesFor } from '@/lib/payroll/settings';

const usdRates: StatutoryRates = { bands: DEFAULT_USD_BANDS, aidsLevyBps: 300, nssaEmployeeBps: 450, nssaEmployerBps: 450, nssaCeilingCents: 70_000, nssaDeductibleBeforePaye: false, zimdefBps: 100 };
const basic = (cents: number) => ({ currency: 'USD' as const, earnings: [{ code: 'BASIC', label: 'Basic', amountCents: cents, taxable: true }], deductions: [] });

describe('worked example: basic US$500, NSSA not deducted before PAYE', () => {
  const r = calcPay(basic(50_000), usdRates);
  it('gross', () => expect(r.grossCents).toBe(50_000));
  it('PAYE = 0% of 100 + 20% of 200 + 25% of 200 = 90.00', () => expect(r.payeCents).toBe(9_000));
  it('AIDS levy = 3% of 90.00 = 2.70', () => expect(r.aidsLevyCents).toBe(270));
  it('NSSA employee 22.50', () => expect(r.nssaEmployeeCents).toBe(2_250));
  it('net = 384.80', () => expect(r.netCents).toBe(38_480));
  it('employer NSSA 22.50, ZIMDEF 5.00, cost 527.50', () => {
    expect(r.nssaEmployerCents).toBe(2_250);
    expect(r.zimdefCents).toBe(500);
    expect(r.costToSchoolCents).toBe(52_750);
  });
});

describe('PAYE bands', () => {
  it('nothing owed at or under the tax-free amount', () => {
    expect(calcPaye(0, DEFAULT_USD_BANDS)).toBe(0);
    expect(calcPaye(10_000, DEFAULT_USD_BANDS)).toBe(0);
  });
  it('crosses into the 40% band above $3,000', () => {
    // 200*20% + 2700*25% + 500*40% = 40 + 675 + 200
    expect(calcPaye(350_000, DEFAULT_USD_BANDS)).toBe(91_500);
  });
  it('ZiG uses its own table: tax-free up to ZiG 2,800', () => {
    expect(calcPaye(280_000, DEFAULT_ZIG_BANDS)).toBe(0);
    expect(calcPaye(380_000, DEFAULT_ZIG_BANDS)).toBe(20_000);
  });
  it('rejects broken tables', () => {
    expect(() => assertValidBands([])).toThrow();
    expect(() => assertValidBands([{ fromCents: 100, rateBps: 0 }])).toThrow();
    expect(() => assertValidBands([{ fromCents: 0, rateBps: 0 }, { fromCents: 0, rateBps: 100 }])).toThrow();
    expect(() => assertValidBands([{ fromCents: 0, rateBps: 20000 }])).toThrow();
    expect(() => assertValidBands(DEFAULT_USD_BANDS)).not.toThrow();
    expect(() => assertValidBands(DEFAULT_ZIG_BANDS)).not.toThrow();
  });
});

describe('NSSA', () => {
  it('is capped at the ceiling', () => {
    const r = calcPay(basic(200_000), usdRates);
    expect(r.insurableCents).toBe(70_000);
    expect(r.nssaEmployeeCents).toBe(3_150);
    expect(r.nssaEmployerCents).toBe(3_150);
  });
  it('no ceiling when none is set', () => {
    const r = calcPay(basic(200_000), { ...usdRates, nssaCeilingCents: null });
    expect(r.nssaEmployeeCents).toBe(9_000);
  });
  it('deductible before PAYE lowers the taxable pay and so the PAYE', () => {
    const r = calcPay(basic(50_000), { ...usdRates, nssaDeductibleBeforePaye: true });
    expect(r.taxableCents).toBe(47_750);
    expect(r.payeCents).toBe(calcPaye(47_750, DEFAULT_USD_BANDS));
    expect(r.payeCents).toBeLessThan(9_000);
  });
});

describe('allowances and deductions', () => {
  it('a non-taxable allowance counts in gross and NSSA but not in PAYE', () => {
    const r = calcPay({ currency: 'USD', earnings: [{ code: 'BASIC', label: 'Basic', amountCents: 50_000, taxable: true }, { code: 'TRANSPORT', label: 'Transport', amountCents: 10_000, taxable: false }], deductions: [] }, usdRates);
    expect(r.grossCents).toBe(60_000);
    expect(r.taxableCents).toBe(50_000);
    expect(r.payeCents).toBe(9_000);
    expect(r.nssaEmployeeCents).toBe(2_700);
    expect(r.zimdefCents).toBe(600);
  });
  it('other deductions come off net and do not change tax', () => {
    const r = calcPay({ ...basic(50_000), deductions: [{ code: 'UNION', label: 'Union', amountCents: 1_000 }] }, usdRates);
    expect(r.payeCents).toBe(9_000);
    expect(r.netCents).toBe(37_480);
  });
  it('refuses negative or fractional amounts', () => {
    expect(() => calcPay(basic(-1), usdRates)).toThrow();
    expect(() => calcPay(basic(10.5), usdRates)).toThrow();
  });
  it('each currency is calculated on its own', () => {
    const usd = calcPay(basic(40_000), usdRates);
    const zig = calcPay({ currency: 'ZIG', earnings: [{ code: 'BASIC', label: 'Basic', amountCents: 270_000, taxable: true }], deductions: [] }, { ...usdRates, bands: DEFAULT_ZIG_BANDS, nssaCeilingCents: null });
    expect(usd.currency).toBe('USD');
    expect(zig.currency).toBe('ZIG');
    expect(zig.payeCents).toBe(0); // under ZiG 2,800
    expect(usd.payeCents).toBe(calcPaye(40_000, DEFAULT_USD_BANDS));
  });
});

describe('pro-rating, casual pay, unpaid leave', () => {
  it('a full month is unchanged; a part month rounds half up', () => {
    expect(prorate(50_000, 30, 30)).toBe(50_000);
    expect(prorate(50_000, 15, 30)).toBe(25_000);
    expect(prorate(10_000, 10, 31)).toBe(3_226);
    expect(prorate(50_000, 0, 30)).toBe(0);
  });
  it('casual pay is units times rate', () => {
    expect(casualPay(12, 1_500)).toBe(18_000);
    expect(casualPay(7.5, 1_000)).toBe(7_500);
  });
  it('unpaid leave takes the days off', () => {
    expect(unpaidLeaveDeduction(60_000, 3, 30)).toBe(6_000);
    expect(unpaidLeaveDeduction(60_000, 0, 30)).toBe(0);
  });
  it('splits pay by rule', () => {
    expect(splitPay(100_000, 7000, 2750)).toEqual({ USD: 70_000, ZIG: 825_000 });
  });
  it('bpsOf rounds half up', () => expect(bpsOf(1_050, 450)).toBe(47));
});

describe('the 10% flag', () => {
  it('flags moves over 10% either way, not exactly 10%, not first pay', () => {
    expect(netMovedFlag(100_000, 111_000).flagged).toBe(true);
    expect(netMovedFlag(100_000, 89_000).flagged).toBe(true);
    expect(netMovedFlag(100_000, 110_000).flagged).toBe(false);
    expect(netMovedFlag(null, 100_000).flagged).toBe(false);
    expect(netMovedFlag(0, 100).flagged).toBe(true);
  });
});

describe('settings with effective dates', () => {
  const dated = [
    { effectiveFrom: '2026-01-01', value: 'old' },
    { effectiveFrom: '2026-07-01', value: 'new' },
  ];
  it('picks the newest entry in force for the month', () => {
    expect(inForce(dated, '2026-06', 'x')).toBe('old');
    expect(inForce(dated, '2026-07', 'x')).toBe('new');
    expect(inForce(dated, '2027-01', 'x')).toBe('new');
  });
  it('throws when none is in force', () => expect(() => inForce(dated, '2025-12', 'tax table')).toThrow(/tax table/));
  it('a rate change takes effect from its date only', () => {
    const tables = { USD: [{ effectiveFrom: '2026-01-01', value: DEFAULT_USD_BANDS }], ZIG: [{ effectiveFrom: '2026-01-01', value: DEFAULT_ZIG_BANDS }] };
    const rates = [{ effectiveFrom: '2026-01-01', value: DEFAULT_RATES }, { effectiveFrom: '2026-09-01', value: { ...DEFAULT_RATES, zimdefBps: 200 } }];
    expect(ratesFor('USD', '2026-08', tables, rates).zimdefBps).toBe(100);
    expect(ratesFor('USD', '2026-09', tables, rates).zimdefBps).toBe(200);
    expect(ratesFor('ZIG', '2026-09', tables, rates).nssaCeilingCents).toBeNull();
    expect(ratesFor('USD', '2026-09', tables, rates).nssaCeilingCents).toBe(70_000);
  });
});
