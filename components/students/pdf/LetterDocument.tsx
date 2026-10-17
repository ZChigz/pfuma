import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { LetterSnapshot } from '@/lib/students/documents';
import type { PdfImage } from '@/lib/system/pdf-image';
import { Letterhead } from './Letterhead';

const S = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 10.5, paddingTop: 36, paddingBottom: 56, paddingHorizontal: 48, color: '#14301f', lineHeight: 1.45 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14, fontSize: 9, color: '#4b5a50' },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginBottom: 14, letterSpacing: 1 },
  p: { marginBottom: 9 },
  bold: { fontFamily: 'Helvetica-Bold' },
  table: { marginVertical: 8, borderWidth: 0.7, borderColor: '#cfd8d1' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e6ece7', paddingVertical: 4, paddingHorizontal: 8 },
  label: { width: 150, color: '#4b5a50' },
  value: { flex: 1 },
  signature: { marginTop: 30, width: 220 },
  signatureImage: { height: 38, maxWidth: 170, objectFit: 'contain' },
  signatureLine: { borderTopWidth: 1, borderTopColor: '#14301f', marginTop: 3, paddingTop: 3, fontSize: 9.5 },
  foot: { position: 'absolute', bottom: 22, left: 48, right: 48, fontSize: 8, color: '#8a968e', textAlign: 'center' },
});

const long = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—';

const TITLE: Record<LetterSnapshot['type'], string> = {
  LETTER_ADMISSION: 'ADMISSION LETTER',
  LETTER_PROOF_OF_ENROLMENT: 'PROOF OF ENROLMENT',
  LETTER_TRANSFER: 'TRANSFER LETTER',
  LETTER_TESTIMONIAL: 'TESTIMONIAL',
  LETTER_LEAVING_CERTIFICATE: 'SCHOOL LEAVING CERTIFICATE',
  LETTER_OFFER: 'OFFER OF A PLACE',
};

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

function Table({ rows }: { rows: [string, string | null][] }) {
  return (
    <View style={S.table}>
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <View key={k} style={S.row}>
          <Text style={S.label}>{k}</Text>
          <Text style={S.value}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

function Body({ l }: { l: LetterSnapshot }) {
  const name = l.student?.fullName ?? str(l.body.applicantName) ?? '';
  const b = l.body;
  const school = l.school.name;
  switch (l.type) {
    case 'LETTER_ADMISSION':
      return (
        <>
          <Text style={S.p}>Dear Parent / Guardian,</Text>
          <Text style={S.p}>
            We are pleased to confirm that <Text style={S.bold}>{name}</Text> (admission number {l.student?.admissionNumber}) has been admitted to <Text style={S.bold}>{str(b.className)}</Text> at {school}.
          </Text>
          <Table rows={[['Admission number', l.student?.admissionNumber ?? null], ['Class', str(b.className)], ['Reporting date', str(b.reportingDateLong)]]} />
          <Text style={S.p}>Please make sure the student reports on the date above with everything on the requirements list.</Text>
        </>
      );
    case 'LETTER_PROOF_OF_ENROLMENT':
      return (
        <>
          <Text style={S.p}>To whom it may concern,</Text>
          <Text style={S.p}>
            This is to confirm that <Text style={S.bold}>{name}</Text> (admission number {l.student?.admissionNumber}) is enrolled at {school} in <Text style={S.bold}>{str(b.className)}</Text> for {str(b.termName)}.
          </Text>
          <Table rows={[['Term', str(b.termName)], ['Term dates', `${long(str(b.termStart))} to ${long(str(b.termEnd))}`], ['Issued for', str(b.purpose)]]} />
          <Text style={S.p}>This letter is issued at the request of the guardian and is valid only for the term shown.</Text>
        </>
      );
    case 'LETTER_TRANSFER':
      return (
        <>
          <Text style={S.p}>To the Head, {str(b.destinationSchool) ?? 'the receiving school'}{str(b.destinationDistrict) ? ` (${str(b.destinationDistrict)})` : ''},</Text>
          <Text style={S.p}>
            <Text style={S.bold}>{name}</Text> (admission number {l.student?.admissionNumber}) attended {school} and is transferring to your school.
          </Text>
          <Table rows={[
            ['Last class', str(b.className)], ['Attended', `${long(str(b.attendedFrom))} to ${long(str(b.attendedTo))}`],
            ['Subjects', list(b.subjects).join(', ') || null], ['Conduct', str(b.conduct)],
          ]} />
          <Text style={S.p}>We wish the student every success.</Text>
        </>
      );
    case 'LETTER_TESTIMONIAL':
      return (
        <>
          <Text style={S.p}>To whom it may concern,</Text>
          <Text style={S.p}><Text style={S.bold}>{name}</Text> (admission number {l.student?.admissionNumber}) was a student at {school}.</Text>
          <Table rows={[
            ['Attended', `${long(str(b.attendedFrom))} to ${long(str(b.attendedTo))}`], ['Final class', str(b.className)], ['Conduct', str(b.conduct)],
            ['Activities', str(b.activities)], ['Positions held', str(b.positions)],
          ]} />
        </>
      );
    case 'LETTER_LEAVING_CERTIFICATE':
      return (
        <>
          <Text style={S.p}>This is to certify that</Text>
          <Text style={[S.p, S.bold, { fontSize: 14, textAlign: 'center' }]}>{name}</Text>
          <Text style={S.p}>(admission number {l.student?.admissionNumber}) was a student at {school}.</Text>
          <Table rows={[['Attended', `${long(str(b.attendedFrom))} to ${long(str(b.attendedTo))}`], ['Last class', str(b.className)], ['Reason for leaving', str(b.reason)]]} />
        </>
      );
    case 'LETTER_OFFER':
      return (
        <>
          <Text style={S.p}>Dear Parent / Guardian of {name},</Text>
          <Text style={S.p}>
            We are pleased to offer <Text style={S.bold}>{name}</Text> a place in <Text style={S.bold}>{str(b.intakeName)}</Text> at {school}.
          </Text>
          <Table rows={[['Reporting date', str(b.reportingDateLong)], ['Class', str(b.className)]]} />
          {list(b.requirements).length ? (
            <>
              <Text style={[S.p, S.bold]}>Please bring on the reporting date:</Text>
              {list(b.requirements).map((r, i) => <Text key={i} style={{ marginLeft: 12, marginBottom: 2 }}>•  {r}</Text>)}
            </>
          ) : null}
          <Text style={[S.p, { marginTop: 8 }]}>Please confirm acceptance of the place with the school office.</Text>
        </>
      );
  }
}

/** Every letter the school issues, drawn from the saved snapshot so a reprint reads exactly as the original did. */
export function LetterDocument({ letter, logo, signature }: { letter: LetterSnapshot; logo: PdfImage | null; signature: PdfImage | null }) {
  return (
    <Document title={`${TITLE[letter.type]} ${letter.referenceNo}`}>
      <Page size="A4" style={S.page}>
        <Letterhead school={{ ...letter.school, logo }} />
        <View style={S.meta}>
          <Text>Reference: {letter.referenceNo}</Text>
          <Text>Date: {long(letter.issuedOn)}</Text>
        </View>
        <Text style={S.title}>{TITLE[letter.type]}</Text>
        <Body l={letter} />
        <View style={S.signature}>
          {signature ? <Image style={S.signatureImage} src={{ data: signature.data, format: signature.format }} /> : <View style={{ height: 38 }} />}
          <Text style={S.signatureLine}>{letter.school.headName ? `${letter.school.headName}, Head` : 'Head of school'}</Text>
        </View>
        <Text style={S.foot} fixed>Reference {letter.referenceNo}. The school can confirm that this letter is genuine from its reference number.</Text>
      </Page>
    </Document>
  );
}
