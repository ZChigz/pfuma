import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { PromotionReportData } from '@/lib/students/promotion';
import { OUTCOME_LABEL, type Outcome } from '@/lib/students/promotion-rules';
import { EXIT_REASON_LABEL } from '@/lib/students/rules';

const S = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9.5, paddingTop: 36, paddingBottom: 48, paddingHorizontal: 40, color: '#14301f' },
  school: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#14613f' },
  title: { fontSize: 13, marginTop: 2, marginBottom: 4 },
  meta: { color: '#4b5a50', marginBottom: 12 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e0e7e2', paddingVertical: 3 },
  head: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#14301f', paddingVertical: 3, fontFamily: 'Helvetica-Bold' },
  foot: { position: 'absolute', bottom: 22, left: 40, right: 40, fontSize: 8, color: '#8a968e', textAlign: 'center' },
});

const long = (iso: string) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Harare' }) : '—');

/** The year-end promotion report: counts, where each class went, and everyone who left. */
export function PromotionReportDocument({ data }: { data: PromotionReportData }) {
  return (
    <Document title={`Promotion ${data.fromYear} to ${data.toYear}`}>
      <Page size="A4" style={S.page}>
        <Text style={S.school}>{data.schoolName}</Text>
        <Text style={S.title}>Year-end promotion, {data.fromYear} to {data.toYear}</Text>
        <Text style={S.meta}>Confirmed on {long(data.confirmedAt)} by {data.approvedBy}</Text>

        <Text style={S.h2}>Decisions</Text>
        {Object.entries(data.counts).filter(([, n]) => n > 0).map(([k, n]) => (
          <View key={k} style={S.row}><Text style={{ flex: 1 }}>{OUTCOME_LABEL[k as Outcome] ?? k}</Text><Text style={{ width: 50, textAlign: 'right' }}>{n}</Text></View>
        ))}

        <Text style={S.h2}>Where each class went</Text>
        <View style={S.head}><Text style={{ flex: 1 }}>From</Text><Text style={{ flex: 1 }}>To</Text><Text style={{ width: 50, textAlign: 'right' }}>Students</Text></View>
        {data.movements.map((m, i) => (
          <View key={i} style={S.row} wrap={false}><Text style={{ flex: 1 }}>{m.from}</Text><Text style={{ flex: 1 }}>{m.to}</Text><Text style={{ width: 50, textAlign: 'right' }}>{m.count}</Text></View>
        ))}

        <Text style={S.h2}>Leaving the school ({data.leavers.length})</Text>
        <View style={S.head}><Text style={{ width: 90 }}>Admission no.</Text><Text style={{ flex: 1 }}>Name</Text><Text style={{ width: 90 }}>Class</Text><Text style={{ width: 130 }}>Reason</Text></View>
        {data.leavers.map((l, i) => (
          <View key={i} style={S.row} wrap={false}><Text style={{ width: 90 }}>{l.admissionNumber}</Text><Text style={{ flex: 1 }}>{l.fullName}</Text><Text style={{ width: 90 }}>{l.fromClassName}</Text><Text style={{ width: 130 }}>{EXIT_REASON_LABEL[l.reason]}</Text></View>
        ))}
        <Text style={S.foot} fixed render={({ pageNumber, totalPages }) => `${data.schoolName} · promotion ${data.fromYear} to ${data.toYear} · page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>
  );
}
