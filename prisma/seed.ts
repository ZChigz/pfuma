import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SCHOOL_ID = 'seed-school';
const TERM      = 'Term 2, 2026';

// ─── helpers ──────────────────────────────────────────────────────────────────

function d(iso: string) {
  return new Date(iso);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. School ────────────────────────────────────────────────────────────────
  const school = await prisma.school.upsert({
    where:  { id: SCHOOL_ID },
    update: { name: 'Ruvimbo Independent College', location: 'Glen Lorne, Harare', currentTerm: TERM },
    create: {
      id:          SCHOOL_ID,
      name:        'Ruvimbo Independent College',
      location:    'Glen Lorne, Harare',
      currentTerm: TERM,
    },
  });

  // ── 2. Users ─────────────────────────────────────────────────────────────────
  const pw = await bcrypt.hash('School@2026', 10);

  const [director, head, bursar, teacher, librarian] = await Promise.all([
    prisma.user.upsert({
      where:  { schoolId_email: { schoolId: SCHOOL_ID, email: 'director@ruvimbo.co.zw' } },
      update: {},
      create: {
        id:           'seed-u-director',
        schoolId:     SCHOOL_ID,
        email:        'director@ruvimbo.co.zw',
        fullName:     'Tendai Moyo',
        passwordHash: pw,
        role:         'DIRECTOR',
      },
    }),
    prisma.user.upsert({
      where:  { schoolId_email: { schoolId: SCHOOL_ID, email: 'head@ruvimbo.co.zw' } },
      update: {},
      create: {
        id:           'seed-u-head',
        schoolId:     SCHOOL_ID,
        email:        'head@ruvimbo.co.zw',
        fullName:     'Mrs Rutendo Chikomo',
        passwordHash: pw,
        role:         'HEAD',
      },
    }),
    prisma.user.upsert({
      where:  { schoolId_email: { schoolId: SCHOOL_ID, email: 'bursar@ruvimbo.co.zw' } },
      update: {},
      create: {
        id:           'seed-u-bursar',
        schoolId:     SCHOOL_ID,
        email:        'bursar@ruvimbo.co.zw',
        fullName:     'Mr Farai Ncube',
        passwordHash: pw,
        role:         'BURSAR',
      },
    }),
    prisma.user.upsert({
      where:  { schoolId_email: { schoolId: SCHOOL_ID, email: 'teacher@ruvimbo.co.zw' } },
      update: {},
      create: {
        id:           'seed-u-teacher',
        schoolId:     SCHOOL_ID,
        email:        'teacher@ruvimbo.co.zw',
        fullName:     'Mr Kudzai Dube',
        passwordHash: pw,
        role:         'TEACHER',
      },
    }),
    prisma.user.upsert({
      where:  { schoolId_email: { schoolId: SCHOOL_ID, email: 'librarian@ruvimbo.co.zw' } },
      update: {},
      create: {
        id:           'seed-u-librarian',
        schoolId:     SCHOOL_ID,
        email:        'librarian@ruvimbo.co.zw',
        fullName:     'Miss Vimbai Sibanda',
        passwordHash: pw,
        role:         'LIBRARIAN',
      },
    }),
  ]);

  // ── 3. AssetCategories ───────────────────────────────────────────────────────
  const catNames = [
    'Furniture',
    'ICT Equipment',
    'Sports Equipment',
    'Vehicles',
    'Facilities',
    'Other',
  ] as const;

  const catIds: Record<string, string> = {};
  for (const name of catNames) {
    const id = `seed-cat-${name.toLowerCase().replace(/\s+/g, '-')}`;
    await prisma.assetCategory.upsert({
      where:  { id },
      update: {},
      create: { id, schoolId: SCHOOL_ID, name },
    });
    catIds[name] = id;
  }

  // ── 4. GradeBoundaries ───────────────────────────────────────────────────────
  const boundaries = [
    { id: 'seed-gb-a', min: 80, max: 100, letter: 'A' },
    { id: 'seed-gb-b', min: 70, max: 79,  letter: 'B' },
    { id: 'seed-gb-c', min: 60, max: 69,  letter: 'C' },
    { id: 'seed-gb-d', min: 50, max: 59,  letter: 'D' },
    { id: 'seed-gb-e', min: 40, max: 49,  letter: 'E' },
    { id: 'seed-gb-f', min: 0,  max: 39,  letter: 'F' },
  ];
  for (const gb of boundaries) {
    await prisma.gradeBoundary.upsert({
      where:  { id: gb.id },
      update: {},
      create: {
        id:          gb.id,
        schoolId:    SCHOOL_ID,
        minPercent:  gb.min,
        maxPercent:  gb.max,
        letterGrade: gb.letter,
      },
    });
  }

  // ── 5. Students ──────────────────────────────────────────────────────────────
  const studentsData = [
    { id: 'seed-stu-tanaka',   fullName: 'Tanaka Mutasa',   grade: 'Form 4', parentName: 'Mrs S. Mutasa', parentPhone: '0772114552' },
    { id: 'seed-stu-nyasha',   fullName: 'Nyasha Banda',    grade: 'Form 4', parentName: 'Mr K. Banda',   parentPhone: '0783220117' },
    { id: 'seed-stu-rutendo',  fullName: 'Rutendo Zhou',    grade: 'Form 3', parentName: 'Mrs T. Zhou',   parentPhone: '0712889030' },
    { id: 'seed-stu-farai',    fullName: 'Farai Gumbo',     grade: 'Form 3', parentName: 'Mr L. Gumbo',   parentPhone: '0775661204' },
    { id: 'seed-stu-anesu',    fullName: 'Anesu Phiri',     grade: 'Form 2', parentName: 'Mrs P. Phiri',  parentPhone: '0719442880' },
    { id: 'seed-stu-chiedza',  fullName: 'Chiedza Mhaka',   grade: 'Form 2', parentName: 'Mr D. Mhaka',   parentPhone: '0773005661' },
    { id: 'seed-stu-takudzwa', fullName: 'Takudzwa Dube',   grade: 'Form 1', parentName: 'Mrs C. Dube',   parentPhone: '0788119743' },
    { id: 'seed-stu-tinashe',  fullName: 'Tinashe Ncube',   grade: 'Form 1', parentName: 'Mr B. Ncube',   parentPhone: '0714770218' },
    { id: 'seed-stu-vimbai',   fullName: 'Vimbai Nhari',    grade: 'Form 3', parentName: 'Mrs M. Nhari',  parentPhone: '0786233540' },
    { id: 'seed-stu-kudzai',   fullName: 'Kudzai Mutisi',   grade: 'Form 2', parentName: 'Mr A. Mutisi',  parentPhone: '0772660391' },
  ];

  for (const s of studentsData) {
    await prisma.student.upsert({
      where:  { id: s.id },
      update: {},
      create: { ...s, schoolId: SCHOOL_ID },
    });
  }

  // ── 6. FeeStructures ─────────────────────────────────────────────────────────
  const feeStructures = [
    { id: 'seed-fs-f4-tuition',   grade: 'Form 4', label: 'Tuition',        currency: 'USD' as const, amount: 320  },
    { id: 'seed-fs-f4-transport', grade: 'Form 4', label: 'Transport Levy', currency: 'USD' as const, amount: 45   },
    { id: 'seed-fs-f3-tuition',   grade: 'Form 3', label: 'Tuition',        currency: 'USD' as const, amount: 300  },
    { id: 'seed-fs-f3-transport', grade: 'Form 3', label: 'Transport Levy', currency: 'USD' as const, amount: 45   },
    { id: 'seed-fs-f2-tuition',   grade: 'Form 2', label: 'Tuition',        currency: 'USD' as const, amount: 280  },
    { id: 'seed-fs-f2-transport', grade: 'Form 2', label: 'Transport Levy', currency: 'USD' as const, amount: 40   },
    { id: 'seed-fs-f1-tuition',   grade: 'Form 1', label: 'Tuition',        currency: 'USD' as const, amount: 280  },
    { id: 'seed-fs-f1-transport', grade: 'Form 1', label: 'Transport Levy', currency: 'USD' as const, amount: 40   },
    { id: 'seed-fs-all-sports',   grade: 'All',    label: 'Sports Levy',    currency: 'ZIG' as const, amount: 1450 },
  ];

  for (const fs of feeStructures) {
    await prisma.feeStructure.upsert({
      where:  { id: fs.id },
      update: {},
      create: { ...fs, schoolId: SCHOOL_ID, term: TERM },
    });
  }

  // ── 7. Charges ───────────────────────────────────────────────────────────────
  // tuition + transport amount by grade
  const gradeCharges: Record<string, { tuition: number; transport: number }> = {
    'Form 4': { tuition: 320, transport: 45 },
    'Form 3': { tuition: 300, transport: 45 },
    'Form 2': { tuition: 280, transport: 40 },
    'Form 1': { tuition: 280, transport: 40 },
  };

  for (const s of studentsData) {
    const gc = gradeCharges[s.grade];
    const charges = [
      { id: `seed-chg-${s.id}-tuition`,   label: 'Tuition',        currency: 'USD' as const, amount: gc.tuition   },
      { id: `seed-chg-${s.id}-transport`, label: 'Transport Levy', currency: 'USD' as const, amount: gc.transport },
      { id: `seed-chg-${s.id}-sports`,    label: 'Sports Levy',    currency: 'ZIG' as const, amount: 1450         },
    ];
    for (const c of charges) {
      await prisma.charge.upsert({
        where:  { id: c.id },
        update: {},
        create: { ...c, schoolId: SCHOOL_ID, studentId: s.id, term: TERM },
      });
    }
  }

  // ── 8. Payments ──────────────────────────────────────────────────────────────
  type PaymentSeed = {
    id:         string;
    studentId:  string;
    currency:   'USD' | 'ZIG';
    amount:     number;
    method:     'CASH' | 'ECOCASH' | 'SWIPE' | 'ZIPIT';
    reference?: string;
    feeLabel:   string;
    status:     'PENDING' | 'VERIFIED';
    recordedAt: Date;
  };

  const VERIFIED_AT = d('2026-05-03T09:00:00Z');

  const paymentsData: PaymentSeed[] = [
    { id: 'seed-pay-tanaka',   studentId: 'seed-stu-tanaka',   currency: 'USD', amount: 365,  method: 'CASH',    feeLabel: 'Term 2 Tuition & Transport', status: 'VERIFIED', recordedAt: d('2026-05-02T08:00:00Z') },
    { id: 'seed-pay-nyasha',   studentId: 'seed-stu-nyasha',   currency: 'USD', amount: 200,  method: 'ECOCASH', reference: 'EC-7741203', feeLabel: 'Term 2 Tuition Partial',     status: 'VERIFIED', recordedAt: d('2026-05-02T08:15:00Z') },
    { id: 'seed-pay-rutendo',  studentId: 'seed-stu-rutendo',  currency: 'USD', amount: 345,  method: 'ZIPIT',   reference: 'ZP-884556',  feeLabel: 'Term 2 Tuition & Transport', status: 'PENDING',  recordedAt: d('2026-05-03T10:00:00Z') },
    { id: 'seed-pay-farai',    studentId: 'seed-stu-farai',    currency: 'ZIG', amount: 1450, method: 'ECOCASH', reference: 'EC-6620114', feeLabel: 'Sports Levy',                status: 'VERIFIED', recordedAt: d('2026-05-04T11:00:00Z') },
    { id: 'seed-pay-anesu',    studentId: 'seed-stu-anesu',    currency: 'USD', amount: 140,  method: 'CASH',    feeLabel: 'Term 2 Tuition Partial',     status: 'VERIFIED', recordedAt: d('2026-05-05T08:00:00Z') },
    { id: 'seed-pay-takudzwa', studentId: 'seed-stu-takudzwa', currency: 'USD', amount: 280,  method: 'SWIPE',   reference: 'SW-552190',  feeLabel: 'Term 2 Tuition',             status: 'VERIFIED', recordedAt: d('2026-05-06T08:30:00Z') },
    { id: 'seed-pay-tinashe',  studentId: 'seed-stu-tinashe',  currency: 'USD', amount: 150,  method: 'ECOCASH', reference: 'EC-7790551', feeLabel: 'Term 2 Tuition Partial',     status: 'PENDING',  recordedAt: d('2026-05-06T09:00:00Z') },
    { id: 'seed-pay-vimbai',   studentId: 'seed-stu-vimbai',   currency: 'USD', amount: 300,  method: 'CASH',    feeLabel: 'Term 2 Tuition',             status: 'VERIFIED', recordedAt: d('2026-05-07T08:00:00Z') },
    { id: 'seed-pay-kudzai',   studentId: 'seed-stu-kudzai',   currency: 'ZIG', amount: 1450, method: 'SWIPE',   reference: 'SW-552774',  feeLabel: 'Sports Levy',                status: 'VERIFIED', recordedAt: d('2026-05-07T08:30:00Z') },
  ];

  for (const p of paymentsData) {
    await prisma.payment.upsert({
      where:  { id: p.id },
      update: {},
      create: {
        id:          p.id,
        schoolId:    SCHOOL_ID,
        studentId:   p.studentId,
        currency:    p.currency,
        amount:      p.amount,
        method:      p.method,
        reference:   p.reference,
        feeLabel:    p.feeLabel,
        status:      p.status,
        recordedBy:  bursar.id,
        verifiedBy:  p.status === 'VERIFIED' ? bursar.id : undefined,
        recordedAt:  p.recordedAt,
        verifiedAt:  p.status === 'VERIFIED' ? VERIFIED_AT : undefined,
      },
    });
  }

  // ── 9. Expenses ──────────────────────────────────────────────────────────────
  const expensesData = [
    { id: 'seed-exp-salaries',    category: 'Staff Salaries', currency: 'USD' as const, amount: 1850, note: 'January teaching staff',  spentOn: '2026-05-02' },
    { id: 'seed-exp-fuel',        category: 'Fuel',           currency: 'USD' as const, amount: 140,  note: 'Bus reg ABW 1234',         spentOn: '2026-05-05' },
    { id: 'seed-exp-utilities',   category: 'Utilities',      currency: 'ZIG' as const, amount: 2300, note: 'ZESA prepaid units',       spentOn: '2026-05-06' },
    { id: 'seed-exp-canteen',     category: 'Canteen',        currency: 'ZIG' as const, amount: 3100, note: 'Weekly groceries',         spentOn: '2026-05-08' },
    { id: 'seed-exp-stationery',  category: 'Stationery',     currency: 'USD' as const, amount: 75,   note: 'Exam paper and ink',       spentOn: '2026-05-10' },
    { id: 'seed-exp-maintenance', category: 'Maintenance',    currency: 'USD' as const, amount: 60,   note: 'Plumbing Block B',         spentOn: '2026-05-12' },
  ];

  for (const e of expensesData) {
    await prisma.expense.upsert({
      where:  { id: e.id },
      update: {},
      create: {
        id:         e.id,
        schoolId:   SCHOOL_ID,
        category:   e.category,
        currency:   e.currency,
        amount:     e.amount,
        note:       e.note,
        spentOn:    d(e.spentOn),
        recordedBy: bursar.id,
        status:     'ACTIVE',
      },
    });
  }

  // ── 10. Subjects ─────────────────────────────────────────────────────────────
  const subjectsData = [
    { id: 'seed-sub-math', name: 'Mathematics', code: 'MATH', grade: 'Form 4', maxMark: 100, type: 'CORE' as const },
    { id: 'seed-sub-eng',  name: 'English',     code: 'ENG',  grade: 'Form 4', maxMark: 100, type: 'CORE' as const },
    { id: 'seed-sub-sci',  name: 'Science',     code: 'SCI',  grade: 'Form 3', maxMark: 100, type: 'CORE' as const },
    { id: 'seed-sub-sho',  name: 'Shona',       code: 'SHO',  grade: 'Form 3', maxMark: 100, type: 'CORE' as const },
  ];

  for (const s of subjectsData) {
    await prisma.subject.upsert({
      where:  { id: s.id },
      update: {},
      create: { ...s, schoolId: SCHOOL_ID },
    });
  }

  // ── 11. SubjectAssignments ───────────────────────────────────────────────────
  for (const s of subjectsData) {
    await prisma.subjectAssignment.upsert({
      where:  { teacherId_subjectId_term: { teacherId: teacher.id, subjectId: s.id, term: TERM } },
      update: {},
      create: {
        id:        `seed-sa-${s.id}`,
        schoolId:  SCHOOL_ID,
        teacherId: teacher.id,
        subjectId: s.id,
        term:      TERM,
      },
    });
  }

  // ── 12. Marks ────────────────────────────────────────────────────────────────
  const marksData = [
    { studentId: 'seed-stu-tanaka', subjectId: 'seed-sub-math', rawMark: 78, percentage: 78, letterGrade: 'B' },
    { studentId: 'seed-stu-tanaka', subjectId: 'seed-sub-eng',  rawMark: 82, percentage: 82, letterGrade: 'A' },
    { studentId: 'seed-stu-nyasha', subjectId: 'seed-sub-math', rawMark: 65, percentage: 65, letterGrade: 'C' },
    { studentId: 'seed-stu-nyasha', subjectId: 'seed-sub-eng',  rawMark: 71, percentage: 71, letterGrade: 'B' },
  ];

  for (const m of marksData) {
    await prisma.mark.upsert({
      where:  { studentId_subjectId_term: { studentId: m.studentId, subjectId: m.subjectId, term: TERM } },
      update: {},
      create: {
        schoolId:    SCHOOL_ID,
        studentId:   m.studentId,
        subjectId:   m.subjectId,
        term:        TERM,
        rawMark:     m.rawMark,
        percentage:  m.percentage,
        letterGrade: m.letterGrade,
        enteredBy:   teacher.id,
      },
    });
  }

  // ── 13. Assets ───────────────────────────────────────────────────────────────
  const assetsData = [
    { id: 'seed-ast-bus',       name: 'School Bus',      catKey: 'Vehicles',         tag: 'VEH-001', cost: 45000, currency: 'USD' as const, location: 'School Yard',       condition: 'GOOD'      as const, status: 'ACTIVE'            as const, acquired: '2022-01-15' },
    { id: 'seed-ast-proj-a',    name: 'Projector A',     catKey: 'ICT Equipment',    tag: 'ICT-001', cost: 800,   currency: 'USD' as const, location: 'Science Lab',       condition: 'GOOD'      as const, status: 'ACTIVE'            as const, acquired: '2023-03-10' },
    { id: 'seed-ast-proj-b',    name: 'Projector B',     catKey: 'ICT Equipment',    tag: 'ICT-002', cost: 800,   currency: 'USD' as const, location: 'Main Hall',         condition: 'GOOD'      as const, status: 'ACTIVE'            as const, acquired: '2023-03-10' },
    { id: 'seed-ast-desks',     name: 'Student Desks',   catKey: 'Furniture',        tag: 'FRN-001', cost: 1200,  currency: 'USD' as const, location: 'Form 4 Classroom',  condition: 'FAIR'      as const, status: 'ACTIVE'            as const, acquired: '2021-01-20' },
    { id: 'seed-ast-laptop',    name: 'Staff Laptop',    catKey: 'ICT Equipment',    tag: 'ICT-003', cost: 650,   currency: 'USD' as const, location: 'Admin Office',      condition: 'EXCELLENT' as const, status: 'ACTIVE'            as const, acquired: '2024-07-05' },
    { id: 'seed-ast-football',  name: 'Football Set',    catKey: 'Sports Equipment', tag: 'SPT-001', cost: 120,   currency: 'USD' as const, location: 'Sports Store',      condition: 'GOOD'      as const, status: 'ACTIVE'            as const, acquired: '2025-01-10' },
    { id: 'seed-ast-generator', name: 'Generator',       catKey: 'Facilities',       tag: 'FAC-001', cost: 2200,  currency: 'USD' as const, location: 'Back Building',     condition: 'GOOD'      as const, status: 'UNDER_MAINTENANCE' as const, acquired: '2020-06-18' },
    { id: 'seed-ast-shelves',   name: 'Library Shelves', catKey: 'Furniture',        tag: 'FRN-002', cost: 350,   currency: 'USD' as const, location: 'Library',           condition: 'GOOD'      as const, status: 'ACTIVE'            as const, acquired: '2023-08-22' },
  ];

  for (const a of assetsData) {
    await prisma.asset.upsert({
      where:  { id: a.id },
      update: {},
      create: {
        id:              a.id,
        schoolId:        SCHOOL_ID,
        name:            a.name,
        categoryId:      catIds[a.catKey],
        tagNumber:       a.tag,
        acquisitionDate: d(a.acquired),
        acquisitionCost: a.cost,
        currency:        a.currency,
        location:        a.location,
        condition:       a.condition,
        status:          a.status,
      },
    });
  }

  // Generator maintenance record
  await prisma.assetMaintenance.upsert({
    where:  { id: 'seed-maint-generator' },
    update: {},
    create: {
      id:              'seed-maint-generator',
      schoolId:        SCHOOL_ID,
      assetId:         'seed-ast-generator',
      maintenanceDate: d('2026-05-20'),
      description:     'Annual service and oil change',
      provider:        'Powertech Services',
      nextServiceDate: d('2026-11-20'),
      recordedBy:      bursar.id,
    },
  });

  // ── 14. Books & Copies ───────────────────────────────────────────────────────
  const booksData = [
    { id: 'seed-book-math', isbn: '9780333564561', title: 'Mathematics for Zimbabwe', author: 'A. Macrae',     subject: 'Mathematics',     publisher: 'Macmillan',                  year: 2006, shelf: 'M1',  acc: ['SCH-2026-0001', 'SCH-2026-0002'] },
    { id: 'seed-book-eng',  isbn: '9780521544856', title: 'English Language Skills',  author: 'B. Heaton',     subject: 'English',         publisher: 'Cambridge',                  year: 2004, shelf: 'E1',  acc: ['SCH-2026-0003', 'SCH-2026-0004'] },
    { id: 'seed-book-hist', isbn: '9781779223456', title: 'History of Zimbabwe',      author: 'T. Zvobgo',     subject: 'History',         publisher: 'Longman',                    year: 2010, shelf: 'H1',  acc: ['SCH-2026-0005', 'SCH-2026-0006'] },
    { id: 'seed-book-sci',  isbn: '9780521698566', title: 'Combined Science',         author: 'S. Sadler',     subject: 'Science',         publisher: 'Cambridge',                  year: 2007, shelf: 'S1',  acc: ['SCH-2026-0007', 'SCH-2026-0008'] },
    { id: 'seed-book-sho',  isbn: null,            title: 'Shona Literature',         author: 'P. Chifunyise', subject: 'Shona',           publisher: null,                         year: 2015, shelf: 'SH1', acc: ['SCH-2026-0009', 'SCH-2026-0010'] },
    { id: 'seed-book-comp', isbn: '9781779230012', title: 'Computer Studies',         author: 'R. Manyanga',   subject: 'Computer Studies', publisher: 'Zimbabwe Publishing House', year: 2018, shelf: 'C1',  acc: ['SCH-2026-0011', 'SCH-2026-0012'] },
  ];

  for (const b of booksData) {
    await prisma.book.upsert({
      where:  { id: b.id },
      update: {},
      create: {
        id:            b.id,
        schoolId:      SCHOOL_ID,
        isbn:          b.isbn ?? undefined,
        title:         b.title,
        author:        b.author,
        subject:       b.subject,
        publisher:     b.publisher ?? undefined,
        year:          b.year,
        shelfLocation: b.shelf,
        totalCopies:   2,
      },
    });

    for (let i = 0; i < 2; i++) {
      const copyId  = `${b.id}-copy-${i + 1}`;
      const accNum  = b.acc[i];
      await prisma.bookCopy.upsert({
        where:  { schoolId_accessionNumber: { schoolId: SCHOOL_ID, accessionNumber: accNum } },
        update: {},
        create: {
          id:              copyId,
          schoolId:        SCHOOL_ID,
          bookId:          b.id,
          accessionNumber: accNum,
          condition:       'GOOD',
          status:          'AVAILABLE',
        },
      });
    }
  }

  // ── 15. LibraryMembers ───────────────────────────────────────────────────────
  // NOTE: LibraryMember.userId references the User table. The 10 students are in
  // the Student table (no User record), so only the 5 staff users can be members.
  const staffUsers = [director, head, bursar, teacher, librarian];
  const memberIds: Record<string, string> = {};

  for (const u of staffUsers) {
    const memberId = `seed-lm-${u.id}`;
    await prisma.libraryMember.upsert({
      where:  { userId: u.id },
      update: {},
      create: {
        id:       memberId,
        schoolId: SCHOOL_ID,
        userId:   u.id,
      },
    });
    memberIds[u.id] = memberId;
  }

  // ── 16. Borrowings ───────────────────────────────────────────────────────────
  // Borrowing 1 — Librarian: Mathematics for Zimbabwe copy 1 (active)
  //   checkoutDate 2026-05-20, dueDate 2026-06-03
  await prisma.borrowing.upsert({
    where:  { id: 'seed-borrow-1' },
    update: {},
    create: {
      id:           'seed-borrow-1',
      schoolId:     SCHOOL_ID,
      copyId:       'seed-book-math-copy-1',
      memberId:     memberIds[librarian.id],
      checkoutDate: d('2026-05-20'),
      dueDate:      d('2026-06-03'),
    },
  });
  await prisma.bookCopy.update({
    where: { id: 'seed-book-math-copy-1' },
    data:  { status: 'BORROWED' },
  });

  // Borrowing 2 — Teacher: English Language Skills copy 1 (overdue)
  //   checkoutDate 2026-05-10, dueDate 2026-05-24
  await prisma.borrowing.upsert({
    where:  { id: 'seed-borrow-2' },
    update: {},
    create: {
      id:           'seed-borrow-2',
      schoolId:     SCHOOL_ID,
      copyId:       'seed-book-eng-copy-1',
      memberId:     memberIds[teacher.id],
      checkoutDate: d('2026-05-10'),
      dueDate:      d('2026-05-24'),
    },
  });
  await prisma.bookCopy.update({
    where: { id: 'seed-book-eng-copy-1' },
    data:  { status: 'BORROWED' },
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n✓ Seed complete');
  console.log('  School: Ruvimbo Independent College');
  console.log('  Users: 5  Students: 10  Books: 6 titles  Assets: 8');
  console.log('  Login: director@ruvimbo.co.zw / School@2026');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
