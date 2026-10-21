// CSV files of the finance reports. Amounts are written as plain decimals (125.50) with the currency in its own column,
// so a spreadsheet can total each currency without ever mixing them.
import { toCsv } from '@/lib/csv';
import { plainAmount, CURRENCIES } from '@/lib/finance/money';
import type { ArrearsRow, CashUp, FundRow } from '@/lib/finance/reports';
import type { PaymentRow } from '@/lib/finance/payments';
import type { ExpenseRow } from '@/lib/finance/expenses';

export function arrearsCsv(rows: ArrearsRow[]): string {
  return toCsv(
    ['Admission number', 'Student', 'Class', 'Currency', 'Charged', 'Adjustments', 'Paid', 'Refunded', 'Owing'],
    rows.flatMap((r) =>
      CURRENCIES.filter((c) => r.balances[c].charged !== 0 || r.balances[c].outstanding !== 0).map((c) => [
        r.admissionNumber, r.name, r.className ?? '', c, plainAmount(r.balances[c].charged), plainAmount(r.balances[c].adjusted), plainAmount(r.balances[c].paid),
        plainAmount(r.balances[c].refunded), plainAmount(r.balances[c].outstanding),
      ]),
    ),
  );
}

export function fundsCsv(rows: FundRow[]): string {
  return toCsv(
    ['Fund', 'Currency', 'Billed', 'Adjustments', 'Collected', 'Refunded', 'Spent', 'Net', 'Still owed', 'Credit on account'],
    rows.map((r) => [r.fundName, r.currency, plainAmount(r.billed), plainAmount(r.adjusted), plainAmount(r.collected), plainAmount(r.refunded), plainAmount(r.spent), plainAmount(r.net), plainAmount(r.outstanding), plainAmount(r.credit)]),
  );
}

export function cashUpCsv(c: CashUp): string {
  const rows: (string | number)[][] = [];
  for (const r of c.receipts) rows.push(['Receipts', r.method, r.currency, r.count, plainAmount(r.cents)]);
  for (const r of c.refundsPaid) rows.push(['Refunds paid', r.method, r.currency, r.count, plainAmount(-r.cents)]);
  for (const r of c.expenses) rows.push(['Expenses', r.method, r.currency, r.count, plainAmount(-r.cents)]);
  for (const cur of CURRENCIES) rows.push(['Expected cash in hand', 'CASH', cur, '', plainAmount(c.expectedCash[cur])]);
  for (const w of c.warnings) rows.push(['Warning', w.code, '', '', w.message]);
  return toCsv(['Section', 'Method', 'Currency', 'Count', 'Amount'], rows);
}

export function paymentsCsv(rows: PaymentRow[]): string {
  return toCsv(
    ['Receipt', 'Date', 'Admission number', 'Student', 'Fund', 'Method', 'Reference', 'Currency', 'Amount', 'Status', 'Recorded by', 'Verified by', 'Verified by Owner/Administrator (no other finance person)'],
    rows.map((r) => [r.receiptNumber, r.receivedOn, r.admissionNumber, r.studentName, r.fundName, r.method, r.reference ?? '', r.currency, plainAmount(r.amountCents), r.voided ? 'VOIDED' : r.status, r.recordedBy ?? '', r.verifiedBy ?? '', r.verifierFallback ? 'Yes' : '']),
  );
}

export function expensesCsv(rows: ExpenseRow[]): string {
  return toCsv(
    ['Date', 'Fund', 'Category', 'Description', 'Payee', 'Method', 'Reference', 'Currency', 'Amount', 'Source', 'Request', 'Recorded by', 'Voided'],
    rows.map((r) => [r.paidOn, r.fundName, r.category, r.description, r.payee ?? '', r.method, r.reference ?? '', r.currency, plainAmount(r.amountCents), r.source, r.requestNumber ?? '', r.recordedBy ?? '', r.voided ? 'Yes' : '']),
  );
}
