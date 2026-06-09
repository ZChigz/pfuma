import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';

export interface ReportCardData {
  schoolName:    string;
  studentName:   string;
  grade:         string;
  term:          string;
  classPosition: number | null;
  percentage:    number;
  headRemark:    string | null;
  marks: Array<{
    subjectName: string;
    rawMark:     number;
    maxMark:     number;
    percentage:  number;
    letterGrade: string | null;
  }>;
}

const S = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    paddingTop: 36,
    paddingBottom: 52,
    paddingHorizontal: 40,
    color: '#292524',
  },

  // ── Header
  header: { alignItems: 'center', marginBottom: 20 },
  schoolName: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: '#065f46', marginBottom: 3 },
  reportTitle: { fontSize: 11, color: '#78716c', letterSpacing: 1.5 },

  divider: { borderBottomWidth: 1, borderBottomColor: '#e7e5e4', borderBottomStyle: 'solid', marginVertical: 10 },

  // ── Info grid
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  infoCell: { width: '50%', paddingVertical: 4, paddingRight: 8 },
  infoLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#78716c', textTransform: 'uppercase', marginBottom: 2, letterSpacing: 0.8 },
  infoValue: { fontSize: 11 },

  // ── Section heading
  sectionHead: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#065f46', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },

  // ── Marks table
  tableHead: { flexDirection: 'row', backgroundColor: '#065f46', paddingVertical: 6, paddingHorizontal: 8 },
  tableHeadCell: { color: 'white', fontFamily: 'Helvetica-Bold', fontSize: 8 },
  row: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: '#e7e5e4', borderBottomStyle: 'solid' },
  rowAlt: { backgroundColor: '#f5f5f4' },

  colSubject: { width: '42%', paddingRight: 6 },
  colMark:    { width: '14%', textAlign: 'right' },
  colMax:     { width: '14%', textAlign: 'right' },
  colPct:     { width: '15%', textAlign: 'right' },
  colGrade:   { width: '15%', textAlign: 'center' },

  // ── Remark
  remarkBox: { marginTop: 16, padding: 10, borderWidth: 1, borderColor: '#e7e5e4', borderStyle: 'solid', borderRadius: 4 },
  remarkLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#78716c', marginBottom: 4 },
  remarkText: { fontSize: 10, lineHeight: 1.5 },

  // ── Footer
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 8,
    color: '#78716c',
    borderTopWidth: 0.5,
    borderTopColor: '#e7e5e4',
    borderTopStyle: 'solid',
    paddingTop: 6,
  },
});

interface Props { data: ReportCardData }

export function ReportCardDocument({ data }: Props) {
  const { schoolName, studentName, grade, term, classPosition, percentage, headRemark, marks } = data;

  return (
    <Document title={`${studentName} — ${term}`} author={schoolName}>
      <Page size="A4" style={S.page}>

        {/* Header */}
        <View style={S.header}>
          <Text style={S.schoolName}>{schoolName}</Text>
          <Text style={S.reportTitle}>ACADEMIC REPORT CARD</Text>
        </View>

        <View style={S.divider} />

        {/* Student info */}
        <View style={S.infoGrid}>
          {[
            { label: 'Student Name', value: studentName },
            { label: 'Grade / Class', value: grade },
            { label: 'Term',          value: term },
            { label: 'Class Position', value: classPosition != null ? `${classPosition}` : '—' },
            { label: 'Overall %',     value: `${percentage.toFixed(1)}%` },
            { label: 'Total Subjects', value: `${marks.length}` },
          ].map(({ label, value }) => (
            <View key={label} style={S.infoCell}>
              <Text style={S.infoLabel}>{label}</Text>
              <Text style={S.infoValue}>{value}</Text>
            </View>
          ))}
        </View>

        <View style={S.divider} />

        {/* Marks table */}
        <Text style={S.sectionHead}>Subject Results</Text>

        <View style={S.tableHead}>
          <Text style={[S.tableHeadCell, S.colSubject]}>Subject</Text>
          <Text style={[S.tableHeadCell, S.colMark]}>Mark</Text>
          <Text style={[S.tableHeadCell, S.colMax]}>Max</Text>
          <Text style={[S.tableHeadCell, S.colPct]}>%</Text>
          <Text style={[S.tableHeadCell, S.colGrade]}>Grade</Text>
        </View>

        {marks.map((m, i) => (
          <View key={i} style={[S.row, i % 2 === 1 ? S.rowAlt : {}]}>
            <Text style={S.colSubject}>{m.subjectName}</Text>
            <Text style={S.colMark}>{m.rawMark.toFixed(1)}</Text>
            <Text style={S.colMax}>{m.maxMark}</Text>
            <Text style={S.colPct}>{m.percentage.toFixed(1)}%</Text>
            <Text style={S.colGrade}>{m.letterGrade ?? '—'}</Text>
          </View>
        ))}

        {marks.length === 0 && (
          <View style={S.row}>
            <Text style={{ color: '#78716c', fontSize: 9 }}>No marks recorded for this term.</Text>
          </View>
        )}

        {/* Head's remark */}
        {headRemark && (
          <View style={S.remarkBox}>
            <Text style={S.remarkLabel}>Head Teacher's Remark</Text>
            <Text style={S.remarkText}>{headRemark}</Text>
          </View>
        )}

        {/* Footer */}
        <Text style={S.footer}>Produced by Pfuma School Management System — {schoolName}</Text>
      </Page>
    </Document>
  );
}
