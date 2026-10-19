import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { KIND_INFO, monthName, rangeText, timeText } from '@/lib/system/calendar-types';
import type { CalendarItem } from '@/lib/system/calendar';

const S = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 10, padding: 36, color: '#14301f' },
  school: { fontSize: 11, color: '#6b7a70' },
  title: { fontSize: 20, fontWeight: 700, marginTop: 2 },
  sub: { fontSize: 10, color: '#6b7a70', marginTop: 2, marginBottom: 14 },
  month: { fontSize: 12, fontWeight: 700, marginTop: 12, marginBottom: 4, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: '#e3e9e4' },
  row: { flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: '#eef4ef' },
  date: { width: 120 },
  what: { flex: 1 },
  type: { width: 80, textAlign: 'right' },
  muted: { color: '#6b7a70', fontSize: 9 },
  empty: { marginTop: 20, color: '#6b7a70' },
  foot: { position: 'absolute', bottom: 20, left: 36, right: 36, fontSize: 8, color: '#8a968e', textAlign: 'center' },
});

export interface CalendarPdfData {
  schoolName: string;
  termName: string;
  termStart: string;
  termEnd: string;
  items: CalendarItem[];
  printedOn: string;
}

/** A notice-board sheet: the term's dates, holidays and events, month by month. */
export function CalendarPdf({ data }: { data: CalendarPdfData }) {
  const byMonth = new Map<string, CalendarItem[]>();
  for (const i of data.items) byMonth.set(i.startDate.slice(0, 7), [...(byMonth.get(i.startDate.slice(0, 7)) ?? []), i]);
  return (
    <Document title={`${data.termName} calendar`}>
      <Page size="A4" style={S.page} wrap>
        <Text style={S.school}>{data.schoolName}</Text>
        <Text style={S.title}>{data.termName}: calendar</Text>
        <Text style={S.sub}>{rangeText(data.termStart, data.termEnd)}</Text>
        {data.items.length === 0 && <Text style={S.empty}>Nothing is on the calendar for this term.</Text>}
        {Array.from(byMonth.entries()).map(([ym, items]) => (
          <View key={ym} wrap={false}>
            <Text style={S.month}>{monthName(Number(ym.slice(5)) - 1)} {ym.slice(0, 4)}</Text>
            {items.map((i) => (
              <View key={i.key} style={S.row}>
                <Text style={S.date}>{rangeText(i.startDate, i.endDate).replace(/ \d{4}/g, '')}</Text>
                <View style={S.what}>
                  <Text>{i.title}</Text>
                  <Text style={S.muted}>{[timeText(i), i.location].filter(Boolean).join(' · ')}</Text>
                </View>
                <Text style={S.type}>{KIND_INFO[i.kind].label}</Text>
              </View>
            ))}
          </View>
        ))}
        <Text style={S.foot} fixed>Printed {data.printedOn}. Dates can change; check the school calendar in Pfuma.</Text>
      </Page>
    </Document>
  );
}
