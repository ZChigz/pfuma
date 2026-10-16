import { describe, expect, it } from 'vitest';
import { normalizeZimbabwePhone } from '@/lib/phone';
import { fetchPdfImage } from '@/lib/system/pdf-image';
import { PROVINCES, SchoolProfileSchema } from '@/lib/validations/system';

describe('phone numbers', () => {
  it('are stored as +263 and digits', () => {
    for (const [input, expected] of [
      ['0242 700 123', '+263242700123'],
      ['+263 242 700123', '+263242700123'],
      ['263242700123', '+263242700123'],
      ['00263 242 700123', '+263242700123'],
      ['(0242) 700-123', '+263242700123'],
      ['+263 77 123 4567', '+263771234567'],
      ['0771234567', '+263771234567'],
      ['+263 (0)77 123 4567', '+263771234567'],
      ['  +263771234567  ', '+263771234567'],
    ]) expect(normalizeZimbabwePhoneOrNull(input), input).toBe(expected);
  });
  it('rejects what cannot be a Zimbabwe number', () => {
    for (const input of ['', 'abc', '12345', '+27 82 123 4567', '+263 12', '+263 12345678901', '0771234567x', '+', '077 123 456 789 0123']) {
      expect(normalizeZimbabwePhone(input), input).toBeNull();
    }
  });
  it('gives the same answer when run twice', () => {
    const once = normalizeZimbabwePhone('0242 700123')!;
    expect(normalizeZimbabwePhone(once)).toBe(once);
  });
});
function normalizeZimbabwePhoneOrNull(s: string) {
  return normalizeZimbabwePhone(s);
}

describe('school profile rules (Zod)', () => {
  const ok = {
    name: 'Chinhoyi High', schoolType: 'GOVERNMENT', boarding: 'DAY', studentGender: 'CO_ED', district: 'Chinhoyi', physicalAddress: '12 Main Street',
  };
  const accepts = (over: object) => SchoolProfileSchema.safeParse({ ...ok, ...over }).success;

  it('needs only the required fields, and fills the rest with nothing', () => {
    const r = SchoolProfileSchema.parse(ok);
    expect(r.offersCambridge).toBe(false);
    expect(accepts({})).toBe(true);
  });

  it('needs a name, district and physical address', () => {
    expect(accepts({ name: ' ' })).toBe(false);
    expect(accepts({ name: 'x' })).toBe(false);
    expect(accepts({ district: '' })).toBe(false);
    expect(accepts({ physicalAddress: '' })).toBe(false);
    expect(accepts({ physicalAddress: 'abc' })).toBe(false);
  });

  it('knows the school types, boarding options, genders and provinces', () => {
    for (const t of ['GOVERNMENT', 'COUNCIL', 'MISSION_CHURCH', 'TRUST', 'PRIVATE']) expect(accepts({ schoolType: t }), t).toBe(true);
    expect(accepts({ schoolType: 'ACADEMY' })).toBe(false);
    for (const b of ['DAY', 'BOARDING', 'DAY_AND_BOARDING']) expect(accepts({ boarding: b }), b).toBe(true);
    expect(accepts({ boarding: 'FLEXI' })).toBe(false);
    for (const g of ['BOYS', 'GIRLS', 'CO_ED']) expect(accepts({ studentGender: g }), g).toBe(true);
    expect(accepts({ studentGender: 'OTHER' })).toBe(false);
    expect(PROVINCES).toHaveLength(10);
    for (const p of PROVINCES) expect(accepts({ province: p }), p).toBe(true);
    expect(accepts({ province: 'Gauteng' })).toBe(false);
    expect(accepts({ province: '' })).toBe(true);
  });

  it('stores the phone as +263 and refuses a bad one', () => {
    expect(SchoolProfileSchema.parse({ ...ok, phone: '0242 700123' }).phone).toBe('+263242700123');
    expect(SchoolProfileSchema.parse({ ...ok, phone: '' }).phone).toBeNull();
    expect(accepts({ phone: '+27 82 123 4567' })).toBe(false);
    expect(accepts({ phone: 'call us' })).toBe(false);
  });

  it('checks email and website', () => {
    expect(SchoolProfileSchema.parse({ ...ok, email: ' Office@School.CO.ZW ' }).email).toBe('office@school.co.zw');
    expect(accepts({ email: 'nope' })).toBe(false);
    expect(accepts({ website: 'https://www.school.co.zw' })).toBe(true);
    expect(accepts({ website: 'http://school.co.zw/about' })).toBe(true);
    for (const w of ['www.school.co.zw', 'ftp://school.co.zw', 'https://', 'javascript:alert(1)', 'https://a b.co.zw']) expect(accepts({ website: w }), w).toBe(false);
    expect(accepts({ website: '' })).toBe(true);
  });

  it('checks the ZIMSEC centre and EMIS numbers', () => {
    expect(SchoolProfileSchema.parse({ ...ok, zimsecCentreNumber: ' 14a123 ' }).zimsecCentreNumber).toBe('14A123');
    expect(accepts({ zimsecCentreNumber: '12' })).toBe(false);
    expect(accepts({ zimsecCentreNumber: 'AB CD' })).toBe(false);
    expect(accepts({ emisNumber: 'EMIS-2231' })).toBe(true);
    expect(accepts({ emisNumber: 'x' })).toBe(false);
    expect(accepts({ emisNumber: '<script>' })).toBe(false);
  });

  it('only takes uploaded images for the logo and signature', () => {
    for (const f of ['logoUrl', 'headSignatureUrl']) {
      expect(accepts({ [f]: 'https://utfs.io/f/abc.png' }), f).toBe(true);
      expect(accepts({ [f]: 'https://abc123.ufs.sh/f/abc.jpg' }), f).toBe(true);
      expect(accepts({ [f]: 'http://utfs.io/f/abc.png' }), f).toBe(false);
      expect(accepts({ [f]: 'https://evil.example/pixel.png' }), f).toBe(false);
      expect(accepts({ [f]: 'https://utfs.io.evil.example/f/a.png' }), f).toBe(false);
      expect(accepts({ [f]: '' }), f).toBe(true);
    }
  });

  it('limits lengths', () => {
    expect(accepts({ name: 'x'.repeat(121) })).toBe(false);
    expect(accepts({ motto: 'x'.repeat(151) })).toBe(false);
    expect(accepts({ responsibleAuthority: 'x'.repeat(121) })).toBe(false);
    expect(accepts({ postalAddress: 'x'.repeat(251) })).toBe(false);
    expect(accepts({ headName: 'x'.repeat(101) })).toBe(false);
  });

  it('keeps Cambridge optional and ZIMSEC out of the form (it is always on)', () => {
    expect(SchoolProfileSchema.parse({ ...ok, offersCambridge: true }).offersCambridge).toBe(true);
    expect(accepts({ offersCambridge: 'yes' })).toBe(false);
    expect(Object.keys(SchoolProfileSchema.shape)).not.toContain('offersZimsec');
  });
});

describe('images for PDFs', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
  const respond = (body: Buffer, type: string, ok = true) =>
    (async () => new Response(new Uint8Array(body), { status: ok ? 200 : 404, headers: { 'content-type': type } })) as unknown as typeof fetch;
  const URL = 'https://utfs.io/f/logo.png';

  it('loads an uploaded PNG or JPG', async () => {
    expect(await fetchPdfImage(URL, respond(png, 'image/png'))).toMatchObject({ format: 'png' });
    expect(await fetchPdfImage('https://abc.ufs.sh/f/s.jpg', respond(jpg, 'image/jpeg'))).toMatchObject({ format: 'jpg' });
  });
  it('leaves the image out rather than failing', async () => {
    expect(await fetchPdfImage(null)).toBeNull();
    expect(await fetchPdfImage('')).toBeNull();
    expect(await fetchPdfImage('https://evil.example/x.png', respond(png, 'image/png'))).toBeNull(); // not an upload
    expect(await fetchPdfImage(URL, respond(png, 'image/png', false))).toBeNull();                    // host says no
    expect(await fetchPdfImage(URL, respond(png, 'image/gif'))).toBeNull();                           // wrong type
    expect(await fetchPdfImage(URL, respond(jpg, 'image/png'))).toBeNull();                           // labelled PNG, really JPG
    expect(await fetchPdfImage(URL, respond(Buffer.from('<svg/>'), 'image/png'))).toBeNull();         // not an image at all
    expect(await fetchPdfImage(URL, respond(Buffer.alloc(2 * 1024 * 1024, 1), 'image/png'))).toBeNull(); // too big
    expect(await fetchPdfImage(URL, (async () => { throw new Error('network down'); }) as unknown as typeof fetch)).toBeNull();
  });
});
