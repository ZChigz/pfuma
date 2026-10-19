-- Part 1 — step 2 of 3: DATA MIGRATION (backfill)
-- Moves existing rows into the new structure without deleting anything:
--   • Level rows (Form 1–6) for every school; classes and fee structures linked
--     to them after normalising grade spelling ("form 2", "F2", "Form two"…).
--   • AcademicYear/AcademicTerm rows from every distinct term string
--     ("Term 2, 2026", "Term 2 2026", "2026 Term 2"…); School.currentTerm (or
--     today's date) becomes the single OPEN term.
--   • termId on FeeStructure, Charge, SubjectAssignment, Mark and TermResult.
--   • Students: first name/surname split from fullName where missing,
--     admission number/date, cached current class, status synced from active.
--   • Enrollment rows: the current term from the student's class, earlier terms
--     reconstructed from marks/subject assignments.
--   • Guardian/StudentGuardian rows from parentName/parentPhone; siblings with
--     the same guardian name + phone share one Guardian row.
-- Any value that cannot be mapped aborts the migration with a message naming
-- it, so nothing is half-migrated and the previous deploy keeps running.

-- ─── Helpers (dropped at the end of this file) ──────────────────────────────

CREATE FUNCTION pfuma_mig_level_order(raw TEXT) RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  s TEXT;
  m TEXT[];
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  s := lower(regexp_replace(trim(raw), '\s+', ' ', 'g'));
  m := regexp_match(s, '^(?:form|frm|f)\s*[-.]?\s*([1-6])$');
  IF m IS NOT NULL THEN RETURN m[1]::INTEGER; END IF;
  m := regexp_match(s, '^(?:form|frm|f)\s*[-.]?\s*(one|two|three|four|five|six)$');
  IF m IS NOT NULL THEN
    RETURN array_position(ARRAY['one','two','three','four','five','six'], m[1]);
  END IF;
  IF s ~ '^(lower|l)\s*(6|six|6th|sixth)(\s*form)?$' THEN RETURN 5; END IF;
  IF s ~ '^(upper|u)\s*(6|six|6th|sixth)(\s*form)?$' THEN RETURN 6; END IF;
  RETURN NULL;
END
$fn$;

CREATE FUNCTION pfuma_mig_is_all_levels(raw TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT lower(trim(coalesce(raw, ''))) IN ('all', 'all levels', 'all grades', 'all forms', 'whole school', '');
$fn$;

CREATE FUNCTION pfuma_mig_parse_term(raw TEXT, OUT term_no INTEGER, OUT yr INTEGER)
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  s TEXT;
  m TEXT[];
BEGIN
  s := lower(regexp_replace(trim(coalesce(raw, '')), '\s+', ' ', 'g'));
  m := regexp_match(s, '^(?:term|t)\s*([1-3])\s*[,/-]?\s*(\d{4})$');
  IF m IS NOT NULL THEN term_no := m[1]::INTEGER; yr := m[2]::INTEGER; RETURN; END IF;
  m := regexp_match(s, '^(\d{4})\s*[,/-]?\s*(?:term|t)\s*([1-3])$');
  IF m IS NOT NULL THEN term_no := m[2]::INTEGER; yr := m[1]::INTEGER; RETURN; END IF;
  m := regexp_match(s, '^(first|second|third|1st|2nd|3rd) term\s*[,/-]?\s*(\d{4})$');
  IF m IS NOT NULL THEN
    term_no := CASE WHEN m[1] IN ('first', '1st') THEN 1 WHEN m[1] IN ('second', '2nd') THEN 2 ELSE 3 END;
    yr := m[2]::INTEGER;
    RETURN;
  END IF;
  term_no := NULL;
  yr := NULL;
END
$fn$;

-- Term inputs were free text, so never fail on them. Resolution order:
--   1. a full "Term N YYYY" form (exact);
--   2. a term number without a year ("Term 3") → year of the row's own date;
--   3. nothing usable → the term whose default date range contains the row's date.
-- The original text stays in the legacy column until the contract migration.
CREATE FUNCTION pfuma_mig_resolve_term(raw TEXT, ts TIMESTAMP, OUT term_no INTEGER, OUT yr INTEGER, OUT exact BOOLEAN)
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  s TEXT;
  m TEXT[];
  p RECORD;
BEGIN
  p := pfuma_mig_parse_term(raw);
  IF p.term_no IS NOT NULL THEN
    term_no := p.term_no; yr := p.yr; exact := true; RETURN;
  END IF;
  exact := false;
  s := lower(coalesce(raw, ''));
  m := regexp_match(s, '(?:term|t)\s*([1-3])(?!\d)');
  IF m IS NOT NULL THEN
    term_no := m[1]::INTEGER;
  ELSE
    m := regexp_match(s, '(first|second|third|1st|2nd|3rd)');
    IF m IS NOT NULL THEN
      term_no := CASE WHEN m[1] IN ('first', '1st') THEN 1 WHEN m[1] IN ('second', '2nd') THEN 2 ELSE 3 END;
    END IF;
  END IF;
  m := regexp_match(s, '((?:19|20)\d{2})');
  yr := coalesce(m[1]::INTEGER, EXTRACT(YEAR FROM coalesce(ts, CURRENT_TIMESTAMP))::INTEGER);
  IF term_no IS NULL THEN
    term_no := CASE WHEN EXTRACT(MONTH FROM coalesce(ts, CURRENT_TIMESTAMP)) <= 4 THEN 1
                    WHEN EXTRACT(MONTH FROM coalesce(ts, CURRENT_TIMESTAMP)) <= 8 THEN 2 ELSE 3 END;
  END IF;
END
$fn$;

CREATE FUNCTION pfuma_mig_level_id(school_id TEXT, level_order INTEGER) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'lvl_' || md5(school_id || ':' || level_order::TEXT); $fn$;

CREATE FUNCTION pfuma_mig_year_id(school_id TEXT, yr INTEGER) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'ay_' || md5(school_id || ':' || yr::TEXT); $fn$;

CREATE FUNCTION pfuma_mig_term_id(school_id TEXT, yr INTEGER, term_no INTEGER) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'at_' || md5(school_id || ':' || yr::TEXT || ':' || term_no::TEXT); $fn$;

CREATE FUNCTION pfuma_mig_term_id_for(school_id TEXT, raw TEXT, ts TIMESTAMP) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT pfuma_mig_term_id(school_id, r.yr, r.term_no) FROM pfuma_mig_resolve_term(raw, ts) r;
$fn$;

-- Default term dates (editable afterwards on the Academic calendar page):
-- Term 1 Jan–Apr, Term 2 May–Aug, Term 3 Sep–Dec.
CREATE FUNCTION pfuma_mig_term_start(yr INTEGER, term_no INTEGER) RETURNS DATE
LANGUAGE sql IMMUTABLE AS $fn$ SELECT make_date(yr, (term_no - 1) * 4 + 1, 1); $fn$;

CREATE FUNCTION pfuma_mig_term_end(yr INTEGER, term_no INTEGER) RETURNS DATE
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT (make_date(yr, (term_no - 1) * 4 + 1, 1) + INTERVAL '4 months' - INTERVAL '1 day')::DATE;
$fn$;

-- Accepts 07X…, 7X…, 263… or +263… (spaces/dashes ignored); returns +263XXXXXXXXX or NULL.
CREATE FUNCTION pfuma_mig_phone(raw TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN m IS NULL THEN NULL ELSE '+263' || m[1] END
  FROM (SELECT regexp_match(regexp_replace(coalesce(raw, ''), '[\s().-]', '', 'g'),
                            '^(?:\+263|00263|263|0)?(7[1378]\d{7})$') AS m) x;
$fn$;

CREATE FUNCTION pfuma_mig_relationship(raw TEXT) RETURNS "GuardianRelationship"
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT (CASE lower(trim(coalesce(raw, '')))
    WHEN 'father' THEN 'FATHER'   WHEN 'mother' THEN 'MOTHER'
    WHEN 'uncle' THEN 'UNCLE'     WHEN 'aunt' THEN 'AUNT'
    WHEN 'grandfather' THEN 'GRANDPARENT' WHEN 'grandmother' THEN 'GRANDPARENT' WHEN 'grandparent' THEN 'GRANDPARENT'
    WHEN 'brother' THEN 'SIBLING' WHEN 'sister' THEN 'SIBLING' WHEN 'sibling' THEN 'SIBLING'
    WHEN 'guardian' THEN 'GUARDIAN' WHEN '' THEN 'GUARDIAN'
    ELSE 'OTHER' END)::"GuardianRelationship";
$fn$;

-- ─── Backfill ────────────────────────────────────────────────────────────────

DO $mig$
DECLARE
  bad TEXT;
  n   INTEGER;
BEGIN
  -- 1. Every grade must map to Form 1–6 ---------------------------------------
  SELECT string_agg(DISTINCT format('"%s" (%s)', g, src), ', ') INTO bad
  FROM (
    SELECT grade AS g, 'class ' || name AS src FROM "SchoolClass" WHERE grade IS NOT NULL
    UNION ALL
    SELECT grade, 'fee structure ' || label FROM "FeeStructure" WHERE NOT pfuma_mig_is_all_levels(grade)
  ) x
  WHERE pfuma_mig_level_order(g) IS NULL;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Part 1 data migration stopped: these grade values do not match Form 1–6: %. Correct them in the database and redeploy.', bad;
  END IF;

  -- 2. Term strings: resolve every row (never fails; see pfuma_mig_resolve_term)
  CREATE TEMP TABLE mig_term_rows ON COMMIT DROP AS
  SELECT school_id, raw, src, (r).term_no, (r).yr, (r).exact
  FROM (
    SELECT "schoolId" AS school_id, term AS raw, 'fee structure' AS src, pfuma_mig_resolve_term(term, "createdAt") AS r FROM "FeeStructure"
    UNION ALL SELECT "schoolId", term, 'charge',             pfuma_mig_resolve_term(term, "issuedAt")  FROM "Charge"
    UNION ALL SELECT "schoolId", term, 'subject assignment', pfuma_mig_resolve_term(term, "createdAt") FROM "SubjectAssignment"
    UNION ALL SELECT "schoolId", term, 'mark',               pfuma_mig_resolve_term(term, "enteredAt") FROM "Mark"
    UNION ALL SELECT "schoolId", term, 'term result',        pfuma_mig_resolve_term(term, "publishedAt") FROM "TermResult"
  ) x;

  SELECT string_agg(DISTINCT format('"%s" (%s) → Term %s %s', raw, src, term_no, yr), '; ') INTO bad
  FROM mig_term_rows WHERE NOT exact;
  IF bad IS NOT NULL THEN
    RAISE NOTICE 'Part 1: these term values had no full "Term N YYYY" form and were matched by date: %', bad;
  END IF;

  -- 3. Levels -----------------------------------------------------------------
  INSERT INTO "Level" ("id", "schoolId", "name", "order", "category")
  SELECT pfuma_mig_level_id(s.id, o), s.id, 'Form ' || o, o,
         (CASE WHEN o <= 4 THEN 'O_LEVEL' ELSE 'A_LEVEL' END)::"LevelCategory"
  FROM "School" s CROSS JOIN generate_series(1, 6) AS o;

  -- 4. Academic years and terms -------------------------------------------------
  CREATE TEMP TABLE mig_current ON COMMIT DROP AS
  SELECT s.id AS school_id,
         coalesce((pfuma_mig_parse_term(s."currentTerm")).yr, EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER) AS yr,
         coalesce((pfuma_mig_parse_term(s."currentTerm")).term_no,
                  CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) <= 4 THEN 1
                       WHEN EXTRACT(MONTH FROM CURRENT_DATE) <= 8 THEN 2 ELSE 3 END) AS term_no
  FROM "School" s;

  CREATE TEMP TABLE mig_years ON COMMIT DROP AS
  SELECT DISTINCT school_id, yr FROM (
    SELECT school_id, yr FROM mig_term_rows
    UNION SELECT school_id, yr FROM mig_current
  ) y;

  INSERT INTO "AcademicYear" ("id", "schoolId", "year", "startDate", "endDate")
  SELECT pfuma_mig_year_id(school_id, yr), school_id, yr, make_date(yr, 1, 1), make_date(yr, 12, 31)
  FROM mig_years;

  INSERT INTO "AcademicTerm" ("id", "schoolId", "academicYearId", "termNumber", "name", "startDate", "endDate", "status", "closedAt")
  SELECT pfuma_mig_term_id(y.school_id, y.yr, t), y.school_id, pfuma_mig_year_id(y.school_id, y.yr), t,
         'Term ' || t || ' ' || y.yr,
         pfuma_mig_term_start(y.yr, t), pfuma_mig_term_end(y.yr, t),
         (CASE WHEN (y.yr, t) = (c.yr, c.term_no) THEN 'OPEN'
               WHEN (y.yr, t) < (c.yr, c.term_no) THEN 'CLOSED'
               ELSE 'PLANNED' END)::"TermStatus",
         CASE WHEN (y.yr, t) < (c.yr, c.term_no) THEN CURRENT_TIMESTAMP END
  FROM mig_years y
  JOIN mig_current c ON c.school_id = y.school_id
  CROSS JOIN generate_series(1, 3) AS t;

  -- 5. Classes ----------------------------------------------------------------
  UPDATE "SchoolClass" c
  SET "levelId"  = pfuma_mig_level_id(c."schoolId", pfuma_mig_level_order(c.grade)),
      "stream"   = coalesce(nullif(trim(c.section), ''), ''),
      "capacity" = s."maxClassSize"
  FROM "School" s
  WHERE s.id = c."schoolId";

  SELECT string_agg(names, '; ') INTO bad FROM (
    SELECT string_agg(name, ', ') AS names
    FROM "SchoolClass" GROUP BY "schoolId", "levelId", "stream" HAVING count(*) > 1
  ) d;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Part 1 data migration stopped: these classes have the same form and stream: %. Give each a different stream and redeploy.', bad;
  END IF;

  -- 6. Term and level links on existing rows -----------------------------------
  UPDATE "FeeStructure"
  SET "termId"  = pfuma_mig_term_id_for("schoolId", term, "createdAt"),
      "levelId" = CASE WHEN pfuma_mig_is_all_levels(grade) THEN NULL
                       ELSE pfuma_mig_level_id("schoolId", pfuma_mig_level_order(grade)) END;
  UPDATE "Charge"            SET "termId" = pfuma_mig_term_id_for("schoolId", term, "issuedAt");
  UPDATE "SubjectAssignment" SET "termId" = pfuma_mig_term_id_for("schoolId", term, "createdAt");
  UPDATE "Mark"              SET "termId" = pfuma_mig_term_id_for("schoolId", term, "enteredAt");
  UPDATE "TermResult"        SET "termId" = pfuma_mig_term_id_for("schoolId", term, "publishedAt");

  -- Two spellings of one term ("Term 2, 2026" / "Term 2 2026") must not collide.
  SELECT count(*) INTO n FROM (SELECT 1 FROM "SubjectAssignment" GROUP BY "subjectId", "classId", "termId" HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION 'Part 1 data migration stopped: % subject assignment(s) exist twice for the same class and term under different term spellings.', n; END IF;
  SELECT count(*) INTO n FROM (SELECT 1 FROM "Mark" GROUP BY "studentId", "subjectId", "termId" HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION 'Part 1 data migration stopped: % mark(s) exist twice for the same student, subject and term under different term spellings.', n; END IF;
  SELECT count(*) INTO n FROM (SELECT 1 FROM "TermResult" GROUP BY "studentId", "termId" HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION 'Part 1 data migration stopped: % term result(s) exist twice for the same student and term under different term spellings.', n; END IF;

  -- 7. Students ---------------------------------------------------------------
  UPDATE "Student" SET "status" = 'WITHDRAWN' WHERE "active" = false AND "status" = 'ACTIVE';
  UPDATE "Student" SET "fullName" = regexp_replace(trim("fullName"), '\s+', ' ', 'g') WHERE "fullName" ~ '(^\s|\s$|\s\s)';

  UPDATE "Student"
  SET "firstName" = CASE WHEN position(' ' IN trim("fullName")) > 0
                         THEN regexp_replace(trim("fullName"), '\s+\S+$', '')
                         ELSE trim("fullName") END,
      "surname"   = CASE WHEN position(' ' IN trim("fullName")) > 0
                         THEN substring(trim("fullName") FROM '(\S+)$')
                         ELSE '' END
  WHERE "firstName" IS NULL OR "surname" IS NULL;

  UPDATE "Student"
  SET "admissionDate" = CASE
        WHEN "enrollmentYear" IS NOT NULL AND "enrollmentYear" <> EXTRACT(YEAR FROM "createdAt")::INTEGER
          THEN make_date("enrollmentYear", 1, 1)
        ELSE "createdAt"::DATE END;

  UPDATE "Student" SET "admissionNumber" = "studentNumber" WHERE "studentNumber" IS NOT NULL;

  WITH used AS (
    SELECT "schoolId", substring("admissionNumber" FROM 4 FOR 4)::INTEGER AS yr,
           max(substring("admissionNumber" FROM 8 FOR 4)::INTEGER) AS max_seq
    FROM "Student" WHERE "admissionNumber" ~ '^STU\d{8}$'
    GROUP BY 1, 2
  ),
  numbered AS (
    SELECT s.id, s."schoolId", EXTRACT(YEAR FROM s."admissionDate")::INTEGER AS yr,
           row_number() OVER (PARTITION BY s."schoolId", EXTRACT(YEAR FROM s."admissionDate") ORDER BY s."createdAt", s.id) AS rn
    FROM "Student" s WHERE s."admissionNumber" IS NULL
  )
  UPDATE "Student" s
  SET "admissionNumber" = 'STU' || nb.yr || lpad((coalesce(u.max_seq, 0) + nb.rn)::TEXT, 4, '0')
  FROM numbered nb LEFT JOIN used u ON u."schoolId" = nb."schoolId" AND u.yr = nb.yr
  WHERE s.id = nb.id;

  SELECT string_agg("admissionNumber", ', ') INTO bad FROM "Student" WHERE length("admissionNumber") <> 11 AND "admissionNumber" ~ '^STU';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Part 1 data migration stopped: more than 9999 students admitted in one year: %', bad; END IF;

  SELECT string_agg(DISTINCT "birthCertificateNumber", ', ') INTO bad FROM (
    SELECT "birthCertificateNumber" FROM "Student" WHERE "birthCertificateNumber" IS NOT NULL
    GROUP BY "schoolId", "birthCertificateNumber" HAVING count(*) > 1
  ) d;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Part 1 data migration stopped: these birth certificate numbers are used by more than one student: %. Correct them and redeploy.', bad;
  END IF;

  UPDATE "Student"
  SET "currentClassId" = CASE WHEN "status" IN ('ACTIVE', 'SUSPENDED') THEN "classId" END;

  -- 8. Enrollments ------------------------------------------------------------
  -- 8a. The open term, from each student's current class.
  INSERT INTO "Enrollment" ("id", "schoolId", "studentId", "classId", "termId", "status", "startDate", "endDate")
  SELECT 'enr_' || md5(s.id || ':' || t.id), s."schoolId", s.id, s."classId", t.id,
         (CASE s."status" WHEN 'TRANSFERRED' THEN 'TRANSFERRED_OUT'
                          WHEN 'GRADUATED'   THEN 'GRADUATED'
                          WHEN 'WITHDRAWN'   THEN 'WITHDRAWN'
                          ELSE 'ACTIVE' END)::"EnrollmentStatus",
         greatest(t."startDate", s."admissionDate")::TIMESTAMP,
         CASE WHEN s."status" IN ('TRANSFERRED', 'GRADUATED', 'WITHDRAWN') THEN CURRENT_TIMESTAMP END
  FROM "Student" s
  JOIN "AcademicTerm" t ON t."schoolId" = s."schoolId" AND t."status" = 'OPEN'
  WHERE s."classId" IS NOT NULL;

  -- 8b. Other terms with marks or results: the class whose subject assignments
  -- best match the student's marked subjects (ties: their current class, then name).
  INSERT INTO "Enrollment" ("id", "schoolId", "studentId", "classId", "termId", "status", "startDate", "endDate")
  SELECT 'enr_' || md5(b.student_id || ':' || b.term_id), b.school_id, b.student_id, b.class_id, b.term_id,
         'ACTIVE', t."startDate"::TIMESTAMP,
         CASE WHEN t."status" = 'CLOSED' THEN t."endDate"::TIMESTAMP END
  FROM (
    SELECT DISTINCT ON (x.student_id, x.term_id) x.*
    FROM (
      SELECT m."schoolId" AS school_id, m."studentId" AS student_id, m."termId" AS term_id, sa."classId" AS class_id,
             count(*) AS hits, (sa."classId" = s."classId") AS is_current, c.name
      FROM "Mark" m
      JOIN "Student" s ON s.id = m."studentId"
      JOIN "SubjectAssignment" sa ON sa."subjectId" = m."subjectId" AND sa."termId" = m."termId" AND sa."schoolId" = m."schoolId"
      JOIN "SchoolClass" c ON c.id = sa."classId"
      GROUP BY m."schoolId", m."studentId", m."termId", sa."classId", s."classId", c.name
    ) x
    ORDER BY x.student_id, x.term_id, x.hits DESC, x.is_current DESC NULLS LAST, x.name
  ) b
  JOIN "AcademicTerm" t ON t.id = b.term_id
  WHERE NOT EXISTS (SELECT 1 FROM "Enrollment" e WHERE e."studentId" = b.student_id AND e."termId" = b.term_id);

  -- 8c. Remaining marks/results with no matching assignment: use the current class.
  INSERT INTO "Enrollment" ("id", "schoolId", "studentId", "classId", "termId", "status", "startDate", "endDate")
  SELECT 'enr_' || md5(r.student_id || ':' || r.term_id), r.school_id, r.student_id, s."classId", r.term_id,
         'ACTIVE', t."startDate"::TIMESTAMP,
         CASE WHEN t."status" = 'CLOSED' THEN t."endDate"::TIMESTAMP END
  FROM (
    SELECT DISTINCT "schoolId" AS school_id, "studentId" AS student_id, "termId" AS term_id FROM "Mark"
    UNION SELECT "schoolId", "studentId", "termId" FROM "TermResult"
  ) r
  JOIN "Student" s ON s.id = r.student_id
  JOIN "AcademicTerm" t ON t.id = r.term_id
  WHERE s."classId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "Enrollment" e WHERE e."studentId" = r.student_id AND e."termId" = r.term_id);

  -- 9. Guardians --------------------------------------------------------------
  CREATE TEMP TABLE mig_guardian_src ON COMMIT DROP AS
  SELECT s.id AS student_id, s."schoolId" AS school_id, s."createdAt" AS created_at,
         nullif(regexp_replace(trim(coalesce(s."parentName", '')), '\s+', ' ', 'g'), '') AS name,
         coalesce(pfuma_mig_phone(s."parentPhone"), nullif(trim(coalesce(s."parentPhone", '')), '')) AS phone,
         pfuma_mig_phone(s."parentPhone") IS NOT NULL AS phone_valid,
         s."guardianRelationship" AS rel,
         s."secondGuardianPhone" AS alt_phone,
         s.address
  FROM "Student" s
  WHERE coalesce(trim(s."parentName"), '') <> '' OR coalesce(trim(s."parentPhone"), '') <> '';

  ALTER TABLE mig_guardian_src ADD COLUMN guardian_id TEXT;
  UPDATE mig_guardian_src
  SET guardian_id = 'gd_' || md5(school_id || ':' || coalesce(phone, '') || ':' || lower(coalesce(name, '')));

  INSERT INTO "Guardian" ("id", "schoolId", "fullName", "phone", "altPhone", "address", "createdAt")
  SELECT DISTINCT ON (guardian_id)
         guardian_id, school_id, coalesce(name, 'Unknown guardian'), coalesce(phone, ''),
         (SELECT g2.alt_phone FROM mig_guardian_src g2 WHERE g2.guardian_id = g.guardian_id AND g2.alt_phone IS NOT NULL LIMIT 1),
         (SELECT g2.address   FROM mig_guardian_src g2 WHERE g2.guardian_id = g.guardian_id AND g2.address   IS NOT NULL LIMIT 1),
         created_at
  FROM mig_guardian_src g
  ORDER BY guardian_id, created_at;

  INSERT INTO "StudentGuardian" ("studentId", "guardianId", "relationship", "relationshipNote", "isPrimary", "isFeePayer", "canReceiveSms")
  SELECT student_id, guardian_id, pfuma_mig_relationship(rel),
         CASE WHEN pfuma_mig_relationship(rel) = 'OTHER' THEN rel END,
         true, true, phone_valid
  FROM mig_guardian_src;

  -- 10. Verify — abort rather than leave anything unlinked ---------------------
  SELECT count(*) INTO n FROM "SchoolClass" WHERE "levelId" IS NULL OR "stream" IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'Part 1 verification failed: % class(es) without a level', n; END IF;
  SELECT count(*) INTO n FROM "FeeStructure" WHERE "termId" IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'Part 1 verification failed: % fee structure(s) without a term', n; END IF;
  SELECT count(*) INTO n FROM "Charge" WHERE "termId" IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'Part 1 verification failed: % charge(s) without a term', n; END IF;
  SELECT count(*) INTO n FROM "SubjectAssignment" WHERE "termId" IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'Part 1 verification failed: % subject assignment(s) without a term', n; END IF;
  SELECT count(*) INTO n FROM "Mark" WHERE "termId" IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'Part 1 verification failed: % mark(s) without a term', n; END IF;
  SELECT count(*) INTO n FROM "TermResult" WHERE "termId" IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'Part 1 verification failed: % term result(s) without a term', n; END IF;
  SELECT count(*) INTO n FROM "Student" WHERE "admissionNumber" IS NULL OR "admissionDate" IS NULL OR "firstName" IS NULL OR "surname" IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'Part 1 verification failed: % student(s) missing admission details or names', n; END IF;
  SELECT count(*) INTO n FROM "School" s WHERE (SELECT count(*) FROM "AcademicTerm" t WHERE t."schoolId" = s.id AND t."status" = 'OPEN') <> 1;
  IF n > 0 THEN RAISE EXCEPTION 'Part 1 verification failed: % school(s) without exactly one open term', n; END IF;
  SELECT count(*) INTO n FROM "Student" s WHERE s."classId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "Enrollment" e JOIN "AcademicTerm" t ON t.id = e."termId" AND t."status" = 'OPEN' WHERE e."studentId" = s.id);
  IF n > 0 THEN RAISE EXCEPTION 'Part 1 verification failed: % placed student(s) have no enrollment in the open term', n; END IF;

  -- Informational only: things an admin may want to tidy up.
  SELECT count(*) INTO n FROM "Student" WHERE "classId" IS NULL AND "status" = 'ACTIVE';
  IF n > 0 THEN RAISE NOTICE 'Part 1: % active student(s) are not in a class; place them from Admin → Students.', n; END IF;
  SELECT count(*) INTO n FROM "Student" s WHERE NOT EXISTS (SELECT 1 FROM "StudentGuardian" sg WHERE sg."studentId" = s.id);
  IF n > 0 THEN RAISE NOTICE 'Part 1: % student(s) had no parent details, so have no guardian.', n; END IF;
  SELECT count(*) INTO n FROM "Guardian" WHERE "phone" <> '' AND "phone" !~ '^\+2637[1378]\d{7}$';
  IF n > 0 THEN RAISE NOTICE 'Part 1: % guardian phone number(s) are not valid Zimbabwean mobiles and were kept as entered.', n; END IF;
END
$mig$;

-- ─── Clean up helpers ───────────────────────────────────────────────────────

DROP FUNCTION pfuma_mig_term_id_for(TEXT, TEXT, TIMESTAMP);
DROP FUNCTION pfuma_mig_resolve_term(TEXT, TIMESTAMP);
DROP FUNCTION pfuma_mig_term_id(TEXT, INTEGER, INTEGER);
DROP FUNCTION pfuma_mig_year_id(TEXT, INTEGER);
DROP FUNCTION pfuma_mig_level_id(TEXT, INTEGER);
DROP FUNCTION pfuma_mig_term_start(INTEGER, INTEGER);
DROP FUNCTION pfuma_mig_term_end(INTEGER, INTEGER);
DROP FUNCTION pfuma_mig_parse_term(TEXT);
DROP FUNCTION pfuma_mig_is_all_levels(TEXT);
DROP FUNCTION pfuma_mig_level_order(TEXT);
DROP FUNCTION pfuma_mig_phone(TEXT);
DROP FUNCTION pfuma_mig_relationship(TEXT);
