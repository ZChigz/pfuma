import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ClassListData } from '@/lib/students/class-list';
import type { PdfImage } from '@/lib/system/pdf-image';
import { Letterhead } from './Letterhead';

const S = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 10, paddingTop: 34, paddingBottom: 48, paddingHorizontal: 44, color: '#14301f' },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  sub: { textAlign: 'center', color: '#4b5a50', marginTop: 2, marginBottom: 10 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 3 },
  head: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#14301f', paddingVertical: 3, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e0e7e2', paddingVertical: 2.5 },
  foot: { position: 'absolute', bottom: 22, left: 44, right: 44, fontSize: 8, color: '#8a968e', textAlign: 'center' },
});

/** An A4 class list per class: the school header, the class teacher, and numbered names by surname. */
export function ClassListDocument({ data, logo }: { data: ClassListData; logo: PdfImage | null }) {
  return (
    <Document title="Class list">
      {data.pages.map((p) => (
        <Page key={p.className} size="A4" style={S.page}>
          <Letterhead school={{ ...data.school, logo }} />
          <Text style={S.title}>Class list: {p.className}</Text>
          <Text style={S.sub}>
            {p.termName}  ·  Class teacher: {p.classTeacher ?? 'not assigned'}  ·  {p.total} student{p.total === 1 ? '' : 's'} ({p.boys} boys, {p.girls} girls)
          </Text>
          {p.sections.map((s, i) => (
            <View key={i}>
              {s.title ? <Text style={S.h2}>{s.title} ({s.students.length})</Text> : null}
              <View style={S.head}><Text style={{ width: 28 }}>No.</Text><Text style={{ width: 90 }}>Admission no.</Text><Text style={{ flex: 1 }}>Name</Text></View>
              {s.students.map((x) => (
                <View key={x.admissionNumber} style={S.row} wrap={false}><Text style={{ width: 28 }}>{x.n}</Text><Text style={{ width: 90 }}>{x.admissionNumber}</Text><Text style={{ flex: 1 }}>{x.fullName}</Text></View>
              ))}
            </View>
          ))}
          {p.total === 0 ? <Text style={{ marginTop: 14, color: '#6b7a70' }}>There are no students in this class.</Text> : null}
          <Text style={S.foot} fixed render={({ pageNumber, totalPages }) => `${p.className} · printed ${data.printedOn} · page ${pageNumber} of ${totalPages}`} />
        </Page>
      ))}
    </Document>
  );
}
