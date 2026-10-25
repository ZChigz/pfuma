import { describe, expect, it } from 'vitest';
import { drawFirstExpiring, position, qtyOk } from '@/lib/facilities/stock-math';

describe('stock cost', () => {
  it('is the weighted average of what came in', () => {
    expect(position([{ qty: 10, unitCostCents: 100 }, { qty: 10, unitCostCents: 200 }])).toEqual({ qty: 20, valueCents: 3000, avgCents: 150 });
  });

  it('stock leaving takes the average with it, so the average does not move', () => {
    expect(position([{ qty: 10, unitCostCents: 100 }, { qty: 10, unitCostCents: 200 }, { qty: -5, unitCostCents: 0 }])).toEqual({ qty: 15, valueCents: 2250, avgCents: 150 });
  });

  it('a new delivery after an issue averages with what is left', () => {
    const p = position([{ qty: 10, unitCostCents: 100 }, { qty: -5, unitCostCents: 0 }, { qty: 5, unitCostCents: 300 }]);
    expect(p).toEqual({ qty: 10, valueCents: 2000, avgCents: 200 });
  });

  it('is nothing when everything has gone, and fractions of a kilogram are kept', () => {
    expect(position([{ qty: 2, unitCostCents: 50 }, { qty: -2, unitCostCents: 0 }])).toEqual({ qty: 0, valueCents: 0, avgCents: 0 });
    expect(position([{ qty: 2.5, unitCostCents: 100 }, { qty: -0.75, unitCostCents: 0 }]).qty).toBe(1.75);
  });
});

describe('which batch goes first', () => {
  const lots = [
    { lotId: 'late', expiry: '2027-06-01', qty: 8 },
    { lotId: 'soon', expiry: '2026-11-01', qty: 5 },
    { lotId: null, expiry: null, qty: 4 },
  ];

  it('takes the batch that expires first, then the next, then stock with no batch', () => {
    expect(drawFirstExpiring(lots, 17, 3)).toEqual([{ lotId: 'soon', qty: 3 }]);
    expect(drawFirstExpiring(lots, 17, 7)).toEqual([{ lotId: 'soon', qty: 5 }, { lotId: 'late', qty: 2 }]);
    expect(drawFirstExpiring(lots, 17, 15)).toEqual([{ lotId: 'soon', qty: 5 }, { lotId: 'late', qty: 8 }, { lotId: null, qty: 2 }]);
  });

  it('says there is not enough instead of going below zero', () => {
    expect(drawFirstExpiring(lots, 17, 18)).toBeNull();
    expect(drawFirstExpiring([{ lotId: null, expiry: null, qty: 3 }], 3, 4)).toBeNull();
  });
});

describe('quantities', () => {
  it('are whole for things counted one by one, and may have fractions for kilograms and litres', () => {
    expect(qtyOk('EACH', 3)).toBe(true);
    expect(qtyOk('EACH', 1.5)).toBe(false);
    expect(qtyOk('BOX', 0.5)).toBe(false);
    expect(qtyOk('KG', 2.25)).toBe(true);
    expect(qtyOk('LITRE', 0.0005)).toBe(false);
    expect(qtyOk('KG', 0)).toBe(false);
    expect(qtyOk('KG', -1)).toBe(false);
  });
});
