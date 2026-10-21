// Bank statements are read and matched by pure functions; Paynow's hash is the whole of its trust, so it is tested on its own.
import { describe, expect, it } from 'vitest';
import { applyMapping, matchLines, parseCsv, parseDate, parseMoney, type Mapping } from '@/lib/finance/bank';
import { paynowHash } from '@/lib/finance/paynow';
import { bucketOf } from '@/lib/finance/statements';
import { methodBucket } from '@/lib/finance/methods';

describe('reading a bank statement', () => {
  it('splits CSV with quoted commas, quotes and line breaks', () => {
    const rows = parseCsv('Date,Details,Amount\r\n01/10/2026,"EcoCash, Tendai ""T"" Moyo",120.50\r\n02/10/2026,"two\nlines",(5.00)\r\n');
    expect(rows).toEqual([['Date', 'Details', 'Amount'], ['01/10/2026', 'EcoCash, Tendai "T" Moyo', '120.50'], ['02/10/2026', 'two\nlines', '(5.00)']]);
  });

  it('reads dates by the format of the bank and rejects the impossible', () => {
    expect(parseDate('03/10/2026', 'DMY')).toBe('2026-10-03');
    expect(parseDate('10/03/2026', 'MDY')).toBe('2026-10-03');
    expect(parseDate('2026-10-03 14:22', 'DMY')).toBe('2026-10-03');
    expect(parseDate('31/13/2026', 'DMY')).toBeNull();
    expect(parseDate('', 'DMY')).toBeNull();
  });

  it('reads amounts in whole cents, with commas, currency marks and brackets for money out', () => {
    expect(parseMoney('1,250.50')).toBe(125050);
    expect(parseMoney('$ 20')).toBe(2000);
    expect(parseMoney('(5.00)')).toBe(-500);
    expect(parseMoney('-0.5')).toBe(-50);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1.234')).toBeNull(); // never rounds a third decimal away
  });

  it('applies a column mapping, with one amount column or separate money in and money out columns', () => {
    const rows = [['Date', 'Ref', 'In', 'Out', 'Narrative'], ['01/10/2026', 'EC123', '100.00', '', 'Fees'], ['02/10/2026', '', '', '25.00', 'Bank charge'], ['bad', 'x', '1', '', ''], ['03/10/2026', 'Z', '', '', 'empty']];
    const m: Mapping = { hasHeader: true, dateCol: 0, dateFormat: 'DMY', creditCol: 2, debitCol: 3, referenceCol: 1, descriptionCol: 4 };
    const { lines, skipped } = applyMapping(rows, m);
    expect(lines).toEqual([
      { date: '2026-10-01', amountCents: 10000, reference: 'EC123', description: 'Fees' },
      { date: '2026-10-02', amountCents: -2500, reference: null, description: 'Bank charge' },
    ]);
    expect(skipped).toBe(2);
  });
});

describe('matching bank lines to payments', () => {
  const cands = [
    { id: 'p1', kind: 'PAYMENT' as const, reference: 'EC123', cents: 10000, date: '2026-10-01' },
    { id: 'p2', kind: 'PAYMENT' as const, reference: 'TX9', cents: 5000, date: '2026-10-02' },
    { id: 'p3', kind: 'PAYMENT' as const, reference: 'AAA', cents: 7000, date: '2026-10-05' },
    { id: 'p4', kind: 'PAYMENT' as const, reference: 'BBB', cents: 7000, date: '2026-10-06' },
  ];

  it('matches by reference and amount first, then by amount within three days when it is the only candidate', () => {
    const lines = [
      { id: 'l1', date: '2026-10-01', amountCents: 10000, reference: 'ec123' },
      { id: 'l2', date: '2026-10-04', amountCents: 5000, reference: null },
      { id: 'l3', date: '2026-10-05', amountCents: 7000, reference: null },
      { id: 'l4', date: '2026-10-05', amountCents: -300, reference: null },
    ];
    const out = matchLines(lines, cands, []);
    expect(out.get('l1')).toEqual({ kind: 'PAYMENT', id: 'p1' });
    expect(out.get('l2')).toEqual({ kind: 'PAYMENT', id: 'p2' });
    expect(out.has('l3')).toBe(false); // two payments of the same amount nearby: a person must choose
    expect(out.has('l4')).toBe(false); // money out is never matched to a receipt
  });

  it('never matches one payment to two lines, and matches a cash deposit slip by reference and amount', () => {
    const lines = [{ id: 'a', date: '2026-10-01', amountCents: 10000, reference: 'EC123' }, { id: 'b', date: '2026-10-01', amountCents: 10000, reference: 'EC123' }, { id: 'c', date: '2026-10-03', amountCents: 25000, reference: 'DEP77' }];
    const out = matchLines(lines, cands, [{ ref: 'DEP77', cents: 25000 }]);
    expect(out.get('a')).toEqual({ kind: 'PAYMENT', id: 'p1' });
    expect(out.has('b')).toBe(false);
    expect(out.get('c')).toEqual({ kind: 'DEPOSIT', id: 'DEP77' });
  });
});

describe('Paynow signatures', () => {
  it('hashes every value in order with the integration key, as SHA-512 in capitals', () => {
    const a = paynowHash(['123', 'PFM-1', '10.00', 'Paid'], 'key-1');
    expect(a).toMatch(/^[0-9A-F]{128}$/);
    expect(paynowHash(['123', 'PFM-1', '10.00', 'Paid'], 'key-1')).toBe(a);
    expect(paynowHash(['123', 'PFM-1', '10.00', 'Paid'], 'key-2')).not.toBe(a); // another key, another hash
    expect(paynowHash(['123', 'PFM-1', '10.01', 'Paid'], 'key-1')).not.toBe(a); // an altered amount, another hash
    expect(paynowHash(['PFM-1', '123', '10.00', 'Paid'], 'key-1')).not.toBe(a); // order matters
  });
});

describe('arrears ageing and payment buckets', () => {
  it('puts what is owed into current, 1–30, 31–60, 61–90 and over 90 days', () => {
    expect([0, -5, 1, 30, 31, 60, 61, 90, 91, 400].map(bucketOf)).toEqual(['CURRENT', 'CURRENT', 'D30', 'D30', 'D60', 'D60', 'D90', 'D90', 'D90P', 'D90P']);
  });

  it('groups payment methods as cash, EcoCash, bank, Paynow and others', () => {
    expect(['CASH', 'ECOCASH', 'BANK_TRANSFER', 'ZIPIT', 'BANK_DEPOSIT', 'CHEQUE', 'PAYNOW', 'SWIPE', 'ONEMONEY', 'INNBUCKS'].map(methodBucket)).toEqual(['Cash', 'EcoCash', 'Bank', 'Bank', 'Bank', 'Bank', 'Paynow', 'Others', 'Others', 'Others']);
  });
});
