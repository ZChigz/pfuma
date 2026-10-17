import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const S = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 10, padding: 40, color: '#14301f' },
  from: { fontSize: 11, color: '#6b7a70' },
  title: { fontSize: 22, fontWeight: 700, marginTop: 2 },
  box: { marginTop: 18, borderWidth: 1, borderColor: '#e3e9e4', borderRadius: 6 },
  row: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 10, borderBottomWidth: 0.5, borderBottomColor: '#eef4ef' },
  label: { width: 120, color: '#6b7a70' },
  value: { flex: 1 },
  total: { marginTop: 14, fontSize: 14, fontWeight: 700, textAlign: 'right' },
  status: { marginTop: 4, textAlign: 'right', color: '#6b7a70' },
  foot: { position: 'absolute', bottom: 24, left: 40, right: 40, fontSize: 8, color: '#8a968e', textAlign: 'center' },
});

export interface SubscriptionPdfData {
  number: string;
  schoolName: string;
  issuedOn: string;
  dueOn: string | null;
  paidOn: string | null;
  description: string;
  amount: string;
  currency: string;
  status: string;
}

/** Pfuma's invoice to a school. */
export function SubscriptionPdf({ data }: { data: SubscriptionPdfData }) {
  const rows: [string, string][] = [
    ['Billed to', data.schoolName],
    ['Invoice date', data.issuedOn],
    ['Due date', data.dueOn ?? '—'],
    ['Description', data.description],
  ];
  return (
    <Document title={`Invoice ${data.number}`}>
      <Page size="A4" style={S.page}>
        <Text style={S.from}>Pfuma</Text>
        <Text style={S.title}>Invoice {data.number}</Text>
        <View style={S.box}>
          {rows.map(([k, v]) => (
            <View key={k} style={S.row}>
              <Text style={S.label}>{k}</Text>
              <Text style={S.value}>{v}</Text>
            </View>
          ))}
        </View>
        <Text style={S.total}>{data.currency} {data.amount}</Text>
        <Text style={S.status}>{data.status === 'PAID' ? `Paid${data.paidOn ? ` on ${data.paidOn}` : ''}` : data.status === 'VOID' ? 'Cancelled' : 'Unpaid'}</Text>
        <Text style={S.foot} fixed>Thank you. Questions about this invoice: contact Pfuma support.</Text>
      </Page>
    </Document>
  );
}
