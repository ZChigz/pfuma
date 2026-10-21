// Finance PDFs: receipts (A4, 80 mm and 58 mm till paper, each with a QR code that opens the public check page), statements, invoices and plain tables.
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { Letterhead, type LetterheadData } from '@/components/students/pdf/Letterhead';
import { formatMoney, CURRENCIES, type Cur } from '@/lib/finance/money';
import { METHOD_LABEL } from '@/lib/finance/methods';
import type { ReceiptView } from '@/lib/finance/payments';
import type { StatementView } from '@/lib/finance/statements';
import type { InvoiceData } from '@/lib/finance/invoices';

const C = { ink: '#1b2a21', muted: '#6b7a70', line: '#d8e0da', brand: '#14613f' };
const S = StyleSheet.create({
  page: { padding: 36, fontSize: 9.5, fontFamily: 'Helvetica', color: C.ink },
  h1: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  label: { color: C.muted },
  bold: { fontFamily: 'Helvetica-Bold' },
  table: { marginTop: 8, borderTopWidth: 1, borderTopColor: C.line },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 3 },
  th: { fontFamily: 'Helvetica-Bold', backgroundColor: '#f2f6f3' },
  right: { textAlign: 'right' },
  foot: { marginTop: 14, fontSize: 8, color: C.muted },
});

const school = (r: { school: string; schoolAddress: string | null; schoolPhone: string | null }): LetterheadData => ({ name: r.school, address: r.schoolAddress, phone: r.schoolPhone });
const money = (c: number, cur: Cur) => formatMoney(c, cur);

export type ReceiptSize = 'A4' | '80mm' | '58mm';
const MM = 2.8346; // points per millimetre

export function ReceiptDocument({ r, size, qr }: { r: ReceiptView; size: ReceiptSize; qr: string }) {
  const narrow = size !== 'A4';
  const width = size === '80mm' ? 80 * MM : size === '58mm' ? 58 * MM : undefined;
  const pageSize = narrow ? ([width!, 520] as [number, number]) : 'A4';
  const pad = narrow ? 8 : 36;
  const fs = size === '58mm' ? 7.5 : narrow ? 8.5 : 9.5;
  const title = r.voided ? 'VOIDED' : r.receiptNumber ? 'OFFICIAL RECEIPT' : 'ACKNOWLEDGEMENT (NOT YET VERIFIED)';
  const L = ({ k, v }: { k: string; v: string }) => (<View style={S.row}><Text style={S.label}>{k}</Text><Text style={S.bold}>{v}</Text></View>);
  return (
    <Document title={`Receipt ${r.receiptNumber ?? r.ackNumber}`}>
      <Page size={pageSize} style={{ ...S.page, padding: pad, fontSize: fs }}>
        <Letterhead school={school(r)} />
        <Text style={{ ...S.h1, fontSize: narrow ? 10 : 14, textAlign: 'center' }}>{title}</Text>
        <L k={r.receiptNumber ? 'Receipt no.' : 'Acknowledgement no.'} v={r.receiptNumber ?? r.ackNumber} />
        <L k="Date" v={r.receivedOn} />
        <L k="Learner" v={`${r.studentName}${r.className ? ` (${r.className})` : ''}`} />
        <L k="Admission no." v={r.admissionNumber} />
        <L k="Fund" v={r.fundName} />
        <L k="Method" v={METHOD_LABEL[r.method] ?? r.method} />
        {r.reference ? <L k="Reference" v={r.reference} /> : null}
        {r.paidBy ? <L k="Paid by" v={r.paidBy} /> : null}
        {r.zig ? <L k="Received" v={`ZiG ${(r.zig.zigAmountCents / 100).toFixed(2)} at ${r.zig.rate} = ${money(r.amountCents, r.currency)}`} /> : null}
        <View style={{ ...S.row, marginTop: 4, borderTopWidth: 1, borderTopColor: C.line }}>
          <Text style={S.bold}>Amount</Text><Text style={{ ...S.bold, fontSize: fs + 3 }}>{money(r.amountCents, r.currency)}</Text>
        </View>
        {r.allocations.length > 0 ? (
          <View style={S.table}>
            {r.allocations.map((a, i) => (<View key={i} style={S.tr}><Text style={{ flex: 1 }}>{a.description}{a.studentName !== r.studentName ? ` (${a.studentName})` : ''}</Text><Text>{money(a.amountCents, r.currency)}</Text></View>))}
          </View>
        ) : null}
        {CURRENCIES.filter((c) => r.balanceRemaining[c] > 0).map((c) => (<L key={c} k="Balance remaining" v={money(r.balanceRemaining[c], c)} />))}
        <View style={{ alignItems: 'center', marginTop: 10 }}>
          <Image src={qr} style={{ width: narrow ? 70 : 84, height: narrow ? 70 : 84 }} />
          <Text style={{ fontSize: 7, color: C.muted, marginTop: 2 }}>Scan to check this receipt · {r.verifyCode}</Text>
        </View>
        <Text style={{ ...S.foot, textAlign: 'center' }}>Received by {r.recordedBy ?? '—'}{r.verifiedBy ? ` · Verified by ${r.verifiedBy}` : ''}</Text>
      </Page>
    </Document>
  );
}

function StatementPage({ st, head }: { st: StatementView; head: LetterheadData }) {
  const cur = CURRENCIES.filter((c) => st.entries.some((e) => e.currency === c) || st.closing[c] !== 0 || st.opening[c] !== 0);
  return (
    <Page size="A4" style={S.page}>
      <Letterhead school={head} />
      <Text style={S.h1}>Fee statement{st.term ? `: ${st.term.name}` : ''}</Text>
      <View style={S.row}><Text><Text style={S.bold}>{st.student.fullName}</Text>{st.student.className ? `  ·  ${st.student.className}` : ''}</Text><Text style={S.label}>{st.student.admissionNumber ?? ''}</Text></View>
      {st.term ? cur.map((c) => (<View key={c} style={S.row}><Text style={S.label}>Brought forward ({c === 'USD' ? 'US$' : 'ZiG'})</Text><Text>{money(st.opening[c], c)}</Text></View>)) : null}
      <View style={S.table}>
        <View style={{ ...S.tr, ...S.th }}><Text style={{ width: 62 }}>Date</Text><Text style={{ flex: 1 }}>Details</Text><Text style={{ width: 66, ...S.right }}>Charged</Text><Text style={{ width: 66, ...S.right }}>Paid / credited</Text><Text style={{ width: 70, ...S.right }}>Balance</Text></View>
        {st.entries.map((e) => (
          <View key={e.id} style={{ ...S.tr, color: e.counts ? C.ink : C.muted }}>
            <Text style={{ width: 62 }}>{e.at.slice(0, 10)}</Text>
            <Text style={{ flex: 1 }}>{e.description}{e.counts ? '' : ` (${e.status.toLowerCase()})`}</Text>
            <Text style={{ width: 66, ...S.right }}>{e.debitCents ? money(e.debitCents, e.currency) : ''}</Text>
            <Text style={{ width: 66, ...S.right }}>{e.creditCents ? money(e.creditCents, e.currency) : ''}</Text>
            <Text style={{ width: 70, ...S.right }}>{money(e.runningCents + (st.term ? st.opening[e.currency] : 0), e.currency)}</Text>
          </View>
        ))}
      </View>
      {cur.map((c) => (<View key={c} style={{ ...S.row, marginTop: 4 }}><Text style={S.bold}>{st.closing[c] > 0 ? 'Amount due' : 'Balance'} ({c === 'USD' ? 'US$' : 'ZiG'})</Text><Text style={S.bold}>{money(st.closing[c], c)}</Text></View>))}
      {CURRENCIES.filter((c) => st.credit[c] > 0).map((c) => (<View key={c} style={S.row}><Text style={S.label}>Credit held on account</Text><Text>{money(st.credit[c], c)}</Text></View>))}
      <Text style={S.foot}>Printed {st.generatedAt.slice(0, 10)}. Each currency is shown on its own; amounts in one currency are never added to the other.</Text>
    </Page>
  );
}

export function StatementDocument({ statements, head }: { statements: StatementView[]; head: LetterheadData }) {
  return <Document title="Fee statement">{statements.map((s) => <StatementPage key={s.student.id} st={s} head={head} />)}</Document>;
}

export function InvoiceDocument({ invoices, head }: { invoices: InvoiceData[]; head: LetterheadData }) {
  return (
    <Document title="Invoice">
      {invoices.map((inv) => (
        <Page key={inv.number} size="A4" style={S.page}>
          <Letterhead school={head} />
          <View style={S.row}><Text style={S.h1}>Invoice {inv.number}</Text><Text style={S.label}>{inv.issuedOn} · {inv.termName}</Text></View>
          {inv.statements.map((st) => {
            const charges = st.entries.filter((e) => e.kind === 'CHARGE' && e.counts);
            return (
              <View key={st.student.id} wrap={false} style={{ marginTop: 6 }}>
                <Text style={S.bold}>{st.student.fullName}{st.student.className ? ` (${st.student.className})` : ''}</Text>
                <View style={S.table}>
                  {charges.map((e) => (<View key={e.id} style={S.tr}><Text style={{ flex: 1 }}>{e.description}</Text><Text style={S.right}>{money(e.debitCents, e.currency)}</Text></View>))}
                </View>
                {CURRENCIES.filter((c) => st.closing[c] !== 0).map((c) => (<View key={c} style={S.row}><Text style={S.bold}>Balance due ({c === 'USD' ? 'US$' : 'ZiG'})</Text><Text style={S.bold}>{money(st.closing[c], c)}</Text></View>))}
              </View>
            );
          })}
          <Text style={S.foot}>Pay at the school bursary, by EcoCash, bank transfer or online. Quote the learner’s admission number as the reference.</Text>
        </Page>
      ))}
    </Document>
  );
}

export interface TableDoc { title: string; subtitle?: string; headers: string[]; rows: (string | number)[][]; align?: ('left' | 'right')[]; landscape?: boolean; totals?: (string | number)[] }

export function TableDocument({ doc, head }: { doc: TableDoc; head: LetterheadData }) {
  const w = 100 / doc.headers.length;
  const cell = (v: string | number, i: number, bold = false) => (<Text key={i} style={{ width: `${w}%`, paddingRight: 4, textAlign: doc.align?.[i] ?? 'left', ...(bold ? S.bold : {}) }}>{String(v)}</Text>);
  return (
    <Document title={doc.title}>
      <Page size="A4" orientation={doc.landscape ? 'landscape' : 'portrait'} style={{ ...S.page, fontSize: 8.5 }}>
        <Letterhead school={head} />
        <Text style={S.h1}>{doc.title}</Text>
        {doc.subtitle ? <Text style={{ ...S.label, marginBottom: 4 }}>{doc.subtitle}</Text> : null}
        <View style={S.table}>
          <View style={{ ...S.tr, ...S.th }} fixed>{doc.headers.map((h, i) => cell(h, i, true))}</View>
          {doc.rows.map((r, ri) => (<View key={ri} style={S.tr} wrap={false}>{r.map((v, i) => cell(v, i))}</View>))}
          {doc.totals ? <View style={{ ...S.tr, ...S.th }}>{doc.totals.map((v, i) => cell(v, i, true))}</View> : null}
        </View>
      </Page>
    </Document>
  );
}
