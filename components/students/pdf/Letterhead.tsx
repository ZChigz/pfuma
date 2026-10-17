import { Image, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { PdfImage } from '@/lib/system/pdf-image';

const S = StyleSheet.create({
  header: { alignItems: 'center', marginBottom: 14, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#14613f' },
  logo: { height: 46, maxWidth: 150, objectFit: 'contain', marginBottom: 4 },
  name: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#14613f' },
  motto: { fontSize: 8.5, color: '#6b7a70', fontStyle: 'italic', marginTop: 1 },
  line: { fontSize: 8.5, color: '#4b5a50', marginTop: 2, textAlign: 'center' },
});

export interface LetterheadData {
  name: string;
  motto?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logo?: PdfImage | null;
}

/** The school header at the top of every student PDF: logo, name, motto and contact line. */
export function Letterhead({ school }: { school: LetterheadData }) {
  const contact = [school.address, school.phone, school.email].filter(Boolean).join('  ·  ');
  return (
    <View style={S.header}>
      {school.logo ? <Image style={S.logo} src={{ data: school.logo.data, format: school.logo.format }} /> : null}
      <Text style={S.name}>{school.name}</Text>
      {school.motto ? <Text style={S.motto}>{school.motto}</Text> : null}
      {contact ? <Text style={S.line}>{contact}</Text> : null}
    </View>
  );
}
