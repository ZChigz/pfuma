/* eslint-disable jsx-a11y/alt-text -- react-pdf images have no alt text */
// The term report card, A4 portrait: school letterhead and logo, subjects with the score of each part of the term mark, term
// mark, grade, subject position, teacher comment and initials, the summary, attendance, conduct, comments, the date the next
// term opens, signatures, a stamp area and a verification code with its QR. Schools choose which parts appear in the report
// card settings. Drawn from the published snapshot, so every copy of a card is the same card.
import { Document, Page, View, Text, Image, Svg, Rect, StyleSheet } from '@react-pdf/renderer';
import type { PdfImage } from '@/lib/system/pdf-image';
import type { ReportCardData } from '@/lib/exams/publish';

export interface CardAssets {
  logo: PdfImage | null;
  signature: PdfImage | null;
  photo: PdfImage | null;
  /** The QR as rows of dark/light modules, or null when there is no code (a draft). */
  qr: boolean[][] | null;
}

export interface CardProps { card: ReportCardData; assets: CardAssets }

const INK = '#14301f';
const GREEN = '#14613f';
const MUTED = '#6b7a70';
const LINE = '#e3e9e4';

const S = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, paddingTop: 28, paddingBottom: 40, paddingHorizontal: 32, color: INK },
  head: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1.5, borderBottomColor: GREEN, borderBottomStyle: 'solid', paddingBottom: 8, marginBottom: 8 },
  logo: { height: 52, width: 52, objectFit: 'contain', marginRight: 10 },
  school: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: GREEN },
  motto: { fontSize: 8, color: MUTED, fontStyle: 'italic', marginTop: 1 },
  contact: { fontSize: 7.5, color: MUTED, marginTop: 2 },
  title: { textAlign: 'center', fontSize: 11, fontFamily: 'Helvetica-Bold', letterSpacing: 1, marginBottom: 6 },
  draft: { textAlign: 'center', fontSize: 9, color: '#b91c1c', fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  who: { flexDirection: 'row', marginBottom: 8 },
  photo: { width: 52, height: 62, objectFit: 'cover', marginRight: 10, borderWidth: 0.5, borderColor: LINE, borderStyle: 'solid' },
  whoGrid: { flexDirection: 'row', flexWrap: 'wrap', flexGrow: 1 },
  cell: { width: '50%', paddingVertical: 2 },
  label: { fontSize: 6.5, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
  value: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  th: { flexDirection: 'row', backgroundColor: GREEN, color: 'white', paddingVertical: 4, paddingHorizontal: 4 },
  thText: { color: 'white', fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
  tr: { flexDirection: 'row', paddingVertical: 3.5, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: LINE, borderBottomStyle: 'solid' },
  trAlt: { backgroundColor: '#f4f6f4' },
  box: { borderWidth: 0.7, borderColor: LINE, borderStyle: 'solid', borderRadius: 3, padding: 6, marginTop: 8 },
  boxTitle: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: GREEN, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 3 },
  summary: { flexDirection: 'row', flexWrap: 'wrap' },
  sumCell: { width: '25%', paddingVertical: 2 },
  comment: { fontSize: 9, lineHeight: 1.4 },
  foot: { flexDirection: 'row', marginTop: 10 },
  sign: { width: 150, marginRight: 14 },
  signImg: { height: 28, maxWidth: 110, objectFit: 'contain' },
  signLine: { borderTopWidth: 0.8, borderTopColor: INK, borderTopStyle: 'solid', paddingTop: 2, fontSize: 7.5 },
  stamp: { width: 80, height: 62, borderWidth: 0.7, borderColor: LINE, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  small: { fontSize: 7, color: MUTED },
  code: { fontSize: 11, fontFamily: 'Helvetica-Bold', letterSpacing: 1 },
});

const fmt = (n: number | null, d = 0) => (n === null ? '' : d ? n.toFixed(d) : String(Math.round(n)));
const dayText = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)) : '');

function Qr({ modules, size }: { modules: boolean[][]; size: number }) {
  const n = modules.length;
  const cell = size / n;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Rect x={0} y={0} width={size} height={size} fill="#ffffff" />
      {modules.flatMap((row, y) => row.map((dark, x) => (dark ? <Rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell + 0.2} height={cell + 0.2} fill="#000000" /> : null)))}
    </Svg>
  );
}

export function CardPage({ card, assets }: CardProps) {
  const { parts } = card;
  const showTypes = parts.typeScores && card.planColumns.length > 0 && card.planColumns.length <= 4;
  const typeW = 34;
  const L = card.school;
  return (
    <Page size="A4" style={S.page}>
      <View style={S.head}>
        {assets.logo && <Image src={assets.logo} style={S.logo} />}
        <View>
          <Text style={S.school}>{L.name}</Text>
          {L.motto && <Text style={S.motto}>{L.motto}</Text>}
          <Text style={S.contact}>{[L.address, L.phone, L.email].filter(Boolean).join('  ·  ')}</Text>
        </View>
      </View>
      <Text style={S.title}>TERM REPORT · {card.term.name.toUpperCase()}</Text>
      {card.draft && <Text style={S.draft}>DRAFT: NOT YET PUBLISHED</Text>}

      <View style={S.who}>
        {assets.photo && <Image src={assets.photo} style={S.photo} />}
        <View style={S.whoGrid}>
          <View style={S.cell}><Text style={S.label}>Student</Text><Text style={S.value}>{card.student.name}</Text></View>
          <View style={S.cell}><Text style={S.label}>Admission number</Text><Text style={S.value}>{card.student.admissionNumber}</Text></View>
          <View style={S.cell}><Text style={S.label}>Class</Text><Text style={S.value}>{card.student.className}</Text></View>
          <View style={S.cell}><Text style={S.label}>Term</Text><Text style={S.value}>{card.term.name}</Text></View>
        </View>
      </View>

      <View style={S.th}>
        <Text style={[S.thText, { width: 92 }]}>Subject</Text>
        {showTypes && card.planColumns.map((c) => <Text key={c} style={[S.thText, { width: typeW, textAlign: 'right' }]}>{c.length > 9 ? `${c.slice(0, 8)}.` : c}</Text>)}
        <Text style={[S.thText, { width: 34, textAlign: 'right' }]}>Mark</Text>
        <Text style={[S.thText, { width: 28, textAlign: 'center' }]}>Grade</Text>
        {parts.subjectPositions && <Text style={[S.thText, { width: 40, textAlign: 'center' }]}>Position</Text>}
        <Text style={[S.thText, { flexGrow: 1, paddingLeft: 6 }]}>Teacher&apos;s comment</Text>
        <Text style={[S.thText, { width: 24, textAlign: 'center' }]}>Init.</Text>
      </View>
      {card.subjects.map((s, i) => (
        <View key={s.subject} style={[S.tr, i % 2 ? S.trAlt : {}]} wrap={false}>
          <Text style={{ width: 92 }}>{s.subject}</Text>
          {showTypes && s.typeScores.map((v, j) => <Text key={j} style={{ width: typeW, textAlign: 'right' }}>{v === null ? '-' : fmt(v)}</Text>)}
          <Text style={{ width: 34, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{s.rounded}</Text>
          <Text style={{ width: 28, textAlign: 'center', fontFamily: 'Helvetica-Bold' }}>{s.grade ?? ''}</Text>
          {parts.subjectPositions && <Text style={{ width: 40, textAlign: 'center' }}>{s.position}</Text>}
          <Text style={{ flexGrow: 1, paddingLeft: 6, fontSize: 7.5 }}>{s.comment ?? ''}</Text>
          <Text style={{ width: 24, textAlign: 'center', fontSize: 7.5 }}>{s.initials ?? ''}</Text>
        </View>
      ))}

      <View style={S.box} wrap={false}>
        <Text style={S.boxTitle}>Summary</Text>
        <View style={S.summary}>
          <View style={S.sumCell}><Text style={S.label}>Overall average</Text><Text style={S.value}>{fmt(card.summary.average, 1)}%{card.summary.overallGrade ? `  (${card.summary.overallGrade})` : ''}</Text></View>
          {parts.classPosition && <View style={S.sumCell}><Text style={S.label}>Class position</Text><Text style={S.value}>{card.summary.classPosition || '-'}</Text></View>}
          {parts.formPosition && <View style={S.sumCell}><Text style={S.label}>Form position</Text><Text style={S.value}>{card.summary.formPosition || '-'}</Text></View>}
          {parts.previousAverage && <View style={S.sumCell}><Text style={S.label}>Last term&apos;s average</Text><Text style={S.value}>{card.summary.previousAverage === null ? '-' : `${fmt(card.summary.previousAverage, 1)}%`}</Text></View>}
          {card.summary.isOLevel && card.summary.passes !== null && <View style={S.sumCell}><Text style={S.label}>Subjects passed</Text><Text style={S.value}>{card.summary.passes}{card.summary.fivePasses === null ? '' : card.summary.fivePasses ? '  (5+ incl. Eng & Maths)' : ''}</Text></View>}
          {!card.summary.isOLevel && card.summary.aLevelPoints !== null && <View style={S.sumCell}><Text style={S.label}>Points (best 3)</Text><Text style={S.value}>{card.summary.aLevelPoints}</Text></View>}
          {parts.attendance && card.attendance && <View style={S.sumCell}><Text style={S.label}>Attendance</Text><Text style={S.value}>{card.attendance.present ?? 0} of {card.attendance.schoolDays} days{card.attendance.late ? `, late ${card.attendance.late}` : ''}</Text></View>}
          {parts.conduct && card.conduct && <View style={S.sumCell}><Text style={S.label}>Discipline incidents</Text><Text style={S.value}>{card.conduct.incidents ?? 0}</Text></View>}
        </View>
      </View>

      <View style={S.box} wrap={false}>
        <Text style={S.boxTitle}>Class teacher&apos;s comment</Text>
        <Text style={S.comment}>{card.comments.classTeacher ?? ''}</Text>
        <Text style={[S.boxTitle, { marginTop: 6 }]}>Head&apos;s remark</Text>
        <Text style={S.comment}>{card.comments.head ?? ''}</Text>
      </View>

      <View style={S.foot} wrap={false}>
        <View style={S.stamp}><Text style={S.small}>School stamp</Text></View>
        <View style={S.sign}>
          <View style={{ height: 30 }} />
          <Text style={S.signLine}>Class teacher{card.comments.classTeacherName ? `: ${card.comments.classTeacherName}` : ''}</Text>
        </View>
        <View style={S.sign}>
          <View style={{ height: 30, justifyContent: 'flex-end' }}>{assets.signature && <Image src={assets.signature} style={S.signImg} />}</View>
          <Text style={S.signLine}>Head{L.headName ? `: ${L.headName}` : ''}</Text>
        </View>
        <View style={{ flexGrow: 1, alignItems: 'flex-end' }}>
          {assets.qr && <Qr modules={assets.qr} size={52} />}
          {card.verificationCode && <Text style={S.code}>{card.verificationCode}</Text>}
          <Text style={S.small}>Check this card at /verify</Text>
        </View>
      </View>
      {card.nextTermStart && <Text style={[S.small, { marginTop: 6 }]}>Next term opens on {dayText(card.nextTermStart)}.</Text>}
    </Page>
  );
}

export function ReportCardsDocument({ cards }: { cards: CardProps[] }) {
  return (
    <Document title={cards.length === 1 ? `${cards[0]!.card.student.name} · ${cards[0]!.card.term.name}` : `Report cards · ${cards[0]?.card.student.className ?? ''}`} author={cards[0]?.card.school.name}>
      {cards.map((c) => <CardPage key={c.card.student.id} card={c.card} assets={c.assets} />)}
    </Document>
  );
}
