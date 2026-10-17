import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ProfilePrintData } from '@/lib/students/class-list';
import { STATUS_LABEL } from '@/lib/students/rules';
import type { PdfImage } from '@/lib/system/pdf-image';
import { Letterhead } from './Letterhead';

const S = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9.5, paddingTop: 32, paddingBottom: 48, paddingHorizontal: 42, color: '#14301f' },
  name: { fontSize: 15, fontFamily: 'Helvetica-Bold' },
  sub: { color: '#4b5a50', marginTop: 2, marginBottom: 6 },
  alert: { backgroundColor: '#fff4d6', padding: 5, marginBottom: 4, borderRadius: 3 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 3, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: '#14613f' },
  row: { flexDirection: 'row', paddingVertical: 2 },
  label: { width: 130, color: '#4b5a50' },
  value: { flex: 1 },
  card: { borderWidth: 0.5, borderColor: '#cfd8d1', padding: 6, marginBottom: 5 },
  foot: { position: 'absolute', bottom: 22, left: 42, right: 42, fontSize: 8, color: '#8a968e', textAlign: 'center' },
});

const long = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

function Rows({ rows }: { rows: [string, string | null | undefined][] }) {
  return <>{rows.filter(([, v]) => v).map(([k, v]) => <View key={k} style={S.row}><Text style={S.label}>{k}</Text><Text style={S.value}>{v}</Text></View>)}</>;
}

/** The profile for files and transfers: Overview, Guardians and Enrolment, with the school header. */
export function ProfileDocument({ data, logo }: { data: ProfilePrintData; logo: PdfImage | null }) {
  const { header: h, overview: o, guardians, enrolment } = data;
  return (
    <Document title={`Student profile ${h.admissionNumber}`}>
      <Page size="A4" style={S.page}>
        <Letterhead school={{ ...data.school, logo }} />
        <Text style={S.name}>{h.fullName}{h.preferredName ? ` ("${h.preferredName}")` : ''}</Text>
        <Text style={S.sub}>{h.admissionNumber}  ·  {h.className ?? 'No class'}  ·  {STATUS_LABEL[h.status as keyof typeof STATUS_LABEL] ?? h.status}  ·  {h.boarding === 'BOARDER' ? 'Boarder' : 'Day scholar'}{h.houseName ? `  ·  ${h.houseName} house` : ''}</Text>
        {h.alerts.map((a, i) => <Text key={i} style={S.alert}>{a.text}</Text>)}

        <Text style={S.h2}>Personal details</Text>
        <Rows rows={[
          ['Gender', o.gender === 'M' ? 'Male' : o.gender === 'F' ? 'Female' : null], ['Date of birth', o.dateOfBirth ? `${long(o.dateOfBirth)}${o.age !== null ? ` (${o.age} years)` : ''}` : null],
          ['Birth certificate number', o.birthCertificateNumber], ['Nationality', o.nationality], ['Home language', o.homeLanguage], ['Religion', o.religion], ['Address', o.address],
          ['Admission date', long(o.admissionDate)], ['Entry', o.entryType ? o.entryType.replace(/_/g, ' ').toLowerCase() : null], ['Previous school', o.previousSchool],
          ['Entry results', o.entryResults ? JSON.stringify(o.entryResults).replace(/[{}"]/g, '').replace(/,/g, ', ') : null],
          ['BEAM beneficiary', yesNo(o.isBeam)], ['Sponsor', o.sponsorName], ['Special educational needs', o.specialNeeds ? `Yes${o.specialNeedsNote ? `: ${o.specialNeedsNote}` : ''}` : null],
        ]} />
        {o.siblings.length ? <Rows rows={[['Siblings at the school', o.siblings.map((s) => `${s.fullName}${s.className ? ` (${s.className})` : ''}`).join(', ')]]} /> : null}

        {guardians ? (
          <>
            <Text style={S.h2}>Guardians</Text>
            {guardians.map((g) => (
              <View key={g.guardianId} style={S.card} wrap={false}>
                <Text style={{ fontFamily: 'Helvetica-Bold' }}>{g.fullName}  ·  {g.relationship.toLowerCase()}{g.isPrimary ? '  ·  primary contact' : ''}{g.isFeePayer ? '  ·  fee payer' : ''}</Text>
                <Rows rows={[['Phone', [g.phone, g.altPhone].filter(Boolean).join(', ')], ['Email', g.email], ['National ID', g.nationalId], ['Occupation', g.occupation], ['May collect the student', yesNo(g.canCollect)], ['Receives SMS', yesNo(g.receivesSms)], ['Custody note', g.custodyNote]]} />
              </View>
            ))}
          </>
        ) : null}

        {enrolment ? (
          <>
            <Text style={S.h2}>Enrolment</Text>
            {enrolment.history.map((e) => (
              <View key={e.termId} style={S.row} wrap={false}><Text style={{ width: 110 }}>{e.term}</Text><Text style={{ width: 120 }}>{e.className}</Text><Text style={{ flex: 1 }}>{e.status.toLowerCase().replace(/_/g, ' ')}{e.reason ? ` (${e.reason})` : ''}</Text></View>
            ))}
            {enrolment.moves.length ? <Text style={{ marginTop: 6, fontFamily: 'Helvetica-Bold' }}>Class moves</Text> : null}
            {enrolment.moves.map((m) => (
              <View key={m.id} style={S.row} wrap={false}><Text style={{ width: 110 }}>{long(m.effectiveDate)}</Text><Text style={{ flex: 1 }}>{m.from ?? '—'} to {m.to}: {m.reason}{m.reasonNote ? ` (${m.reasonNote})` : ''}, {m.status.toLowerCase()}{m.approvedBy ? ` by ${m.approvedBy}` : ''}</Text></View>
            ))}
          </>
        ) : null}
        <Text style={S.foot} fixed render={({ pageNumber, totalPages }) => `${h.fullName} · ${h.admissionNumber} · printed ${data.printedOn} · confidential · page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>
  );
}
