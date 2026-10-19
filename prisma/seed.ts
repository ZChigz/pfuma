import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SCHOOL_ID = 'seed-school';
const YEAR      = 2026;
const TERM_ID   = 'seed-term-2026-2'; // the open term

// ─── helpers ──────────────────────────────────────────────────────────────────

function d(iso: string) {
  return new Date(iso);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. School ────────────────────────────────────────────────────────────────
  const school = await prisma.school.upsert({
    where:  { id: SCHOOL_ID },
    update: { name: 'Ruvimbo Independent College', location: 'Glen Lorne, Harare' },
    create: {
      id:          SCHOOL_ID,
      name:        'Ruvimbo Independent College',
      location:    'Glen Lorne, Harare',
    },
  });

  // ── 1b. Levels (Form 1–6) and the 2026 academic year ─────────────────────────
  const levelIds: Record<number, string> = {};
  for (let order = 1; order <= 6; order++) {
    const level = await prisma.level.upsert({
      where:  { schoolId_order: { schoolId: SCHOOL_ID, order } },
      update: {},
      create: { id: `seed-level-${order}`, schoolId: SCHOOL_ID, name: `Form ${order}`, order, category: order <= 4 ? 'O_LEVEL' : 'A_LEVEL' },
    });
    levelIds[order] = level.id;
  }

  await prisma.academicYear.upsert({
    where:  { schoolId_year: { schoolId: SCHOOL_ID, year: YEAR } },
    update: {},
    create: { id: 'seed-year-2026', schoolId: SCHOOL_ID, year: YEAR, startDate: d('2026-01-01'), endDate: d('2026-12-31') },
  });
  const termDefs = [
    { id: 'seed-term-2026-1', termNumber: 1, start: '2026-01-13', end: '2026-04-10', status: 'CLOSED'  as const },
    { id: TERM_ID,            termNumber: 2, start: '2026-05-05', end: '2026-08-07', status: 'OPEN'    as const },
    { id: 'seed-term-2026-3', termNumber: 3, start: '2026-09-08', end: '2026-12-04', status: 'PLANNED' as const },
  ];
  for (const t of termDefs) {
    await prisma.academicTerm.upsert({
      where:  { id: t.id },
      update: {},
      create: {
        id: t.id, schoolId: SCHOOL_ID, academicYearId: 'seed-year-2026', termNumber: t.termNumber,
        name: `Term ${t.termNumber} ${YEAR}`, startDate: d(t.start), endDate: d(t.end), status: t.status,
        closedAt: t.status === 'CLOSED' ? d('2026-04-10') : undefined,
      },
    });
  }

  // ── 2. Users ─────────────────────────────────────────────────────────────────
  const pw = await bcrypt.hash('School@2026', 12);

  const [director, head, bursar, teacher, librarian, admin, teacher2] = await Promise.all([
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
    prisma.user.upsert({
      where:  { schoolId_email: { schoolId: SCHOOL_ID, email: 'admin@ruvimbo.co.zw' } },
      update: {},
      create: {
        id:           'seed-u-admin',
        schoolId:     SCHOOL_ID,
        email:        'admin@ruvimbo.co.zw',
        fullName:     'Mrs T. Chikwanda',
        passwordHash: pw,
        role:         'ADMIN',
      },
    }),
    prisma.user.upsert({
      where:  { schoolId_email: { schoolId: SCHOOL_ID, email: 'mrs.chikomo@ruvimbo.co.zw' } },
      update: {},
      create: {
        id:           'seed-u-teacher2',
        schoolId:     SCHOOL_ID,
        email:        'mrs.chikomo@ruvimbo.co.zw',
        fullName:     'Mrs B. Chikomo',
        passwordHash: pw,
        role:         'TEACHER',
      },
    }),
  ]);

  // ── 3. Classes ───────────────────────────────────────────────────────────────
  const classesData = [
    { id: 'seed-class-form1a', name: 'Form 1 North', order: 1, stream: 'North' },
    { id: 'seed-class-form2a', name: 'Form 2 North', order: 2, stream: 'North' },
    { id: 'seed-class-form3a', name: 'Form 3 North', order: 3, stream: 'North' },
    { id: 'seed-class-form4a', name: 'Form 4 North', order: 4, stream: 'North' },
  ];

  for (const c of classesData) {
    await prisma.schoolClass.upsert({
      where:  { id: c.id },
      update: {},
      create: { id: c.id, name: c.name, levelId: levelIds[c.order], stream: c.stream, capacity: 45, schoolId: SCHOOL_ID },
    });
  }

  const classIdByGrade: Record<string, string> = {
    'Form 1': 'seed-class-form1a',
    'Form 2': 'seed-class-form2a',
    'Form 3': 'seed-class-form3a',
    'Form 4': 'seed-class-form4a',
  };

  // ── 4. AssetCategories ───────────────────────────────────────────────────────
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

  // ── 5. GradeBoundaries ───────────────────────────────────────────────────────
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

  // ── 6. Students ──────────────────────────────────────────────────────────────
  const studentsData = [
    { id: 'seed-stu-tanaka',   firstName: 'Tanaka',   surname: 'Mutasa', gender: 'M' as const, dob: '2010-03-14', grade: 'Form 4', parentName: 'Shamiso Mutasa',   relationship: 'MOTHER' as const, parentPhone: '+263772114552' },
    { id: 'seed-stu-nyasha',   firstName: 'Nyasha',   surname: 'Banda',  gender: 'F' as const, dob: '2010-07-02', grade: 'Form 4', parentName: 'Kudakwashe Banda', relationship: 'FATHER' as const, parentPhone: '+263783220117' },
    { id: 'seed-stu-rutendo',  firstName: 'Rutendo',  surname: 'Zhou',   gender: 'F' as const, dob: '2011-01-20', grade: 'Form 3', parentName: 'Tsitsi Zhou',      relationship: 'MOTHER' as const, parentPhone: '+263712889030' },
    { id: 'seed-stu-farai',    firstName: 'Farai',    surname: 'Gumbo',  gender: 'M' as const, dob: '2011-05-11', grade: 'Form 3', parentName: 'Lovemore Gumbo',   relationship: 'FATHER' as const, parentPhone: '+263775661204' },
    { id: 'seed-stu-anesu',    firstName: 'Anesu',    surname: 'Phiri',  gender: 'F' as const, dob: '2012-02-28', grade: 'Form 2', parentName: 'Precious Phiri',   relationship: 'MOTHER' as const, parentPhone: '+263719442880' },
    { id: 'seed-stu-chiedza',  firstName: 'Chiedza',  surname: 'Mhaka',  gender: 'F' as const, dob: '2012-09-09', grade: 'Form 2', parentName: 'Daniel Mhaka',     relationship: 'FATHER' as const, parentPhone: '+263773005661' },
    { id: 'seed-stu-takudzwa', firstName: 'Takudzwa', surname: 'Dube',   gender: 'M' as const, dob: '2013-04-17', grade: 'Form 1', parentName: 'Chipo Dube',       relationship: 'MOTHER' as const, parentPhone: '+263788119743' },
    { id: 'seed-stu-tinashe',  firstName: 'Tinashe',  surname: 'Ncube',  gender: 'M' as const, dob: '2013-11-30', grade: 'Form 1', parentName: 'Bongani Ncube',    relationship: 'FATHER' as const, parentPhone: '+263714770218' },
    { id: 'seed-stu-vimbai',   firstName: 'Vimbai',   surname: 'Nhari',  gender: 'F' as const, dob: '2011-08-05', grade: 'Form 3', parentName: 'Memory Nhari',     relationship: 'MOTHER' as const, parentPhone: '+263786233540' },
    { id: 'seed-stu-kudzai',   firstName: 'Kudzai',   surname: 'Mutisi', gender: 'M' as const, dob: '2012-06-21', grade: 'Form 2', parentName: 'Arthur Mutisi',    relationship: 'FATHER' as const, parentPhone: '+263772660391' },
  ];

  for (let i = 0; i < studentsData.length; i++) {
    const s = studentsData[i];
    const classId = classIdByGrade[s.grade];
    await prisma.student.upsert({
      where:  { id: s.id },
      update: { currentClassId: classId },
      create: {
        id: s.id,
        schoolId: SCHOOL_ID,
        admissionNumber: `STU2026${String(i + 1).padStart(4, '0')}`,
        firstName: s.firstName,
        surname: s.surname,
        fullName: `${s.firstName} ${s.surname}`,
        gender: s.gender,
        dateOfBirth: d(s.dob),
        admissionDate: d('2026-01-13'),
        currentClassId: classId,
        address: 'Glen Lorne, Harare',
      },
    });
    await prisma.enrollment.upsert({
      where:  { studentId_termId: { studentId: s.id, termId: TERM_ID } },
      update: {},
      create: { schoolId: SCHOOL_ID, studentId: s.id, classId, termId: TERM_ID, status: 'ACTIVE', startDate: d('2026-05-05') },
    });
    const guardianId = `seed-guardian-${s.id}`;
    await prisma.guardian.upsert({
      where:  { id: guardianId },
      update: {},
      create: { id: guardianId, schoolId: SCHOOL_ID, fullName: s.parentName, phone: s.parentPhone },
    });
    await prisma.studentGuardian.upsert({
      where:  { studentId_guardianId: { studentId: s.id, guardianId } },
      update: {},
      create: { studentId: s.id, guardianId, relationship: s.relationship, isPrimary: true, isFeePayer: true },
    });
  }

  // ── 7. FeeStructures ─────────────────────────────────────────────────────────
  const feeStructures = [
    { id: 'seed-fs-f4-tuition',   level: 4,    label: 'Tuition',        currency: 'USD' as const, amount: 320  },
    { id: 'seed-fs-f4-transport', level: 4,    label: 'Transport Levy', currency: 'USD' as const, amount: 45   },
    { id: 'seed-fs-f3-tuition',   level: 3,    label: 'Tuition',        currency: 'USD' as const, amount: 300  },
    { id: 'seed-fs-f3-transport', level: 3,    label: 'Transport Levy', currency: 'USD' as const, amount: 45   },
    { id: 'seed-fs-f2-tuition',   level: 2,    label: 'Tuition',        currency: 'USD' as const, amount: 280  },
    { id: 'seed-fs-f2-transport', level: 2,    label: 'Transport Levy', currency: 'USD' as const, amount: 40   },
    { id: 'seed-fs-f1-tuition',   level: 1,    label: 'Tuition',        currency: 'USD' as const, amount: 280  },
    { id: 'seed-fs-f1-transport', level: 1,    label: 'Transport Levy', currency: 'USD' as const, amount: 40   },
    { id: 'seed-fs-all-sports',   level: null, label: 'Sports Levy',    currency: 'ZIG' as const, amount: 1450 },
  ];

  for (const fs of feeStructures) {
    await prisma.feeStructure.upsert({
      where:  { id: fs.id },
      update: {},
      create: {
        id: fs.id, label: fs.label, currency: fs.currency, amount: fs.amount,
        levelId: fs.level ? levelIds[fs.level] : null, schoolId: SCHOOL_ID, termId: TERM_ID,
      },
    });
  }

  // ── 8. Charges ───────────────────────────────────────────────────────────────
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
        create: { ...c, schoolId: SCHOOL_ID, studentId: s.id, termId: TERM_ID },
      });
    }
  }

  // ── 9. Payments ──────────────────────────────────────────────────────────────
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

  // ── 10. Expenses ─────────────────────────────────────────────────────────────
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

  // ── 10b. Expense Requests ────────────────────────────────────────────────────
  await prisma.expenseRequest.upsert({
    where:  { id: 'seed-req-1' },
    update: {},
    create: {
      id:              'seed-req-1',
      schoolId:        SCHOOL_ID,
      requestNumber:   'REQ-2026-001',
      title:           '5x Science laboratory chemicals',
      type:            'PURCHASE_ORDER',
      department:      'Science Department',
      justification:   'Stock depleted for Form 3 experiments',
      currency:        'USD',
      estimatedTotal:  48,
      actualTotal:     48,
      status:          'DISBURSED',
      requestedById:   teacher.id,
      requestedAt:     d('2026-05-20T08:00:00Z'),
      approvedById:    head.id,
      approvedAt:      d('2026-05-21T09:00:00Z'),
      disbursedById:   bursar.id,
      disbursedAt:     d('2026-05-22T10:00:00Z'),
      paymentMethod:   'CASH',
      items: {
        create: [
          { id: 'seed-req-1-item-1', description: 'Hydrochloric acid 1L',  quantity: 2, unitPrice: 12, total: 24 },
          { id: 'seed-req-1-item-2', description: 'Sodium hydroxide 500g', quantity: 3, unitPrice: 8,  total: 24 },
        ],
      },
    },
  });

  await prisma.expense.upsert({
    where:  { id: 'seed-exp-req1' },
    update: {},
    create: {
      id:               'seed-exp-req1',
      schoolId:         SCHOOL_ID,
      category:         'Purchase Order',
      currency:         'USD',
      amount:           48,
      note:             '5x Science laboratory chemicals — REQ-2026-001',
      spentOn:          d('2026-05-22'),
      recordedBy:       bursar.id,
      status:           'ACTIVE',
      expenseRequestId: 'seed-req-1',
    },
  });

  await prisma.expenseRequest.upsert({
    where:  { id: 'seed-req-2' },
    update: {},
    create: {
      id:              'seed-req-2',
      schoolId:        SCHOOL_ID,
      requestNumber:   'REQ-2026-002',
      title:           '2x Dell computers for IT lab',
      type:            'PURCHASE_ORDER',
      department:      'IT Department',
      justification:   'Existing computers are 8 years old',
      currency:        'USD',
      estimatedTotal:  700,
      status:          'PENDING',
      requestedById:   teacher.id,
      requestedAt:     d('2026-06-08T08:00:00Z'),
      items: {
        create: [
          { id: 'seed-req-2-item-1', description: 'Dell Optiplex 3000', quantity: 2, unitPrice: 350, total: 700 },
        ],
      },
    },
  });

  // ── 11. Subjects ─────────────────────────────────────────────────────────────
  const subjectsData = [
    { id: 'seed-sub-math', name: 'Mathematics',       code: 'MATH',  maxMark: 100, type: 'CORE' as const },
    { id: 'seed-sub-eng',  name: 'English Language',  code: 'ENG',   maxMark: 100, type: 'CORE' as const },
    { id: 'seed-sub-sci',  name: 'Combined Science',  code: 'SCI',   maxMark: 100, type: 'CORE' as const },
    { id: 'seed-sub-geo',  name: 'Geography',         code: 'GEO',   maxMark: 100, type: 'CORE' as const },
    { id: 'seed-sub-hist', name: 'History',           code: 'HIST',  maxMark: 100, type: 'CORE' as const },
    { id: 'seed-sub-sho',  name: 'Shona',             code: 'SHONA', maxMark: 100, type: 'CORE' as const },
    { id: 'seed-sub-comp', name: 'Computer Studies',  code: 'COMP',  maxMark: 100, type: 'ELECTIVE' as const },
  ];

  for (const s of subjectsData) {
    await prisma.subject.upsert({
      where:  { id: s.id },
      update: { name: s.name, code: s.code, maxMark: s.maxMark, type: s.type },
      create: { ...s, schoolId: SCHOOL_ID },
    });
  }

  // ── 12. SubjectAssignments ───────────────────────────────────────────────────
  const assignmentsData = [
    { id: 'seed-sa-1', teacherId: teacher.id,  subjectId: 'seed-sub-math', classId: 'seed-class-form4a' },
    { id: 'seed-sa-2', teacherId: teacher.id,  subjectId: 'seed-sub-math', classId: 'seed-class-form3a' },
    { id: 'seed-sa-3', teacherId: teacher.id,  subjectId: 'seed-sub-sci',  classId: 'seed-class-form3a' },
    { id: 'seed-sa-4', teacherId: teacher2.id, subjectId: 'seed-sub-eng',  classId: 'seed-class-form4a' },
    { id: 'seed-sa-5', teacherId: teacher2.id, subjectId: 'seed-sub-eng',  classId: 'seed-class-form3a' },
    { id: 'seed-sa-6', teacherId: teacher2.id, subjectId: 'seed-sub-sho',  classId: 'seed-class-form4a' },
  ];

  for (const a of assignmentsData) {
    await prisma.subjectAssignment.upsert({
      where:  { id: a.id },
      update: {},
      create: {
        id:        a.id,
        schoolId:  SCHOOL_ID,
        teacherId: a.teacherId,
        subjectId: a.subjectId,
        classId:   a.classId,
        termId:    TERM_ID,
      },
    });
  }

  // ── 13. Marks ────────────────────────────────────────────────────────────────
  const marksData = [
    { studentId: 'seed-stu-tanaka', subjectId: 'seed-sub-math', rawMark: 78, percentage: 78, letterGrade: 'B', enteredBy: teacher.id },
    { studentId: 'seed-stu-tanaka', subjectId: 'seed-sub-eng',  rawMark: 82, percentage: 82, letterGrade: 'A', enteredBy: teacher2.id },
    { studentId: 'seed-stu-nyasha', subjectId: 'seed-sub-math', rawMark: 65, percentage: 65, letterGrade: 'C', enteredBy: teacher.id },
    { studentId: 'seed-stu-nyasha', subjectId: 'seed-sub-eng',  rawMark: 71, percentage: 71, letterGrade: 'B', enteredBy: teacher2.id },
  ];

  for (const m of marksData) {
    await prisma.mark.upsert({
      where:  { studentId_subjectId_termId: { studentId: m.studentId, subjectId: m.subjectId, termId: TERM_ID } },
      update: {},
      create: {
        schoolId:    SCHOOL_ID,
        studentId:   m.studentId,
        subjectId:   m.subjectId,
        termId:      TERM_ID,
        rawMark:     m.rawMark,
        percentage:  m.percentage,
        letterGrade: m.letterGrade,
        enteredBy:   m.enteredBy,
      },
    });
  }

  // ── 14. Assets ───────────────────────────────────────────────────────────────
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

  // ── 15. Books & Copies ───────────────────────────────────────────────────────
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

  // ── 16. LibraryMembers ───────────────────────────────────────────────────────
  // NOTE: LibraryMember.userId references the User table. The 10 students are in
  // the Student table (no User record), so only the 6 staff users can be members.
  const staffUsers = [director, head, bursar, teacher, librarian, admin];
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

  // ── 17. Borrowings ───────────────────────────────────────────────────────────
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
  console.log('  Users: 7  Classes: 4  Students: 10  Books: 6 titles  Assets: 8');
  console.log('  Subjects: 7  Subject assignments: 6');
  console.log(`
    ADMIN:     admin@ruvimbo.co.zw       → /admin
    DIRECTOR:  director@ruvimbo.co.zw    → /director
    HEAD:      head@ruvimbo.co.zw        → /head
    BURSAR:    bursar@ruvimbo.co.zw      → /bursar/students
    TEACHER:   teacher@ruvimbo.co.zw     → /teacher/marks
    TEACHER:   mrs.chikomo@ruvimbo.co.zw → /teacher/marks
    LIBRARIAN: librarian@ruvimbo.co.zw   → /library
    Password for all: School@2026
  `);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
