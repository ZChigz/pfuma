-- Security hardening — step 3 of 3: row-level security + row-change audit
--
-- 1. ROW-LEVEL SECURITY (second layer behind lib/scoped-db.ts)
--    The app sets "app.school_id" per transaction. Once set, a connection can
--    only see and write rows of that school, even if application code forgets a
--    schoolId filter. FORCE makes the policy apply to the table owner too.
--    When "app.school_id" is NOT set (login lookup, migrations, seed scripts)
--    the policy lets the row through, so existing unscoped code keeps working.
--    To make the database strict, change app_school_ok() to
--    "SELECT app_school_id() IS NOT NULL AND row_school = app_school_id()"
--    once every query goes through getScopedDb or a trusted bypass.
--
-- 2. ROW-CHANGE AUDIT
--    A trigger writes an AuditLog row (action DATA_CREATE/UPDATE/DELETE with
--    before/after JSON, secrets removed) for every insert/update/delete on
--    Student, Guardian, Enrollment, Charge, Payment, Expense, Mark and User,
--    in the same transaction as the change. The actor comes from
--    "app.user_id", set by getScopedDb; writes made without an actor
--    (migrations, seed) are not logged. AuditLog rows cannot be changed or
--    deleted afterwards.
--
-- 3. SAME-SCHOOL REFERENCES (end of file)
--    A trigger refuses a foreign key that points into another school.

CREATE OR REPLACE FUNCTION app_school_id() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.school_id', true), '') $$;

CREATE OR REPLACE FUNCTION app_school_ok(row_school text) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT app_school_id() IS NULL OR row_school = app_school_id() $$;

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "User" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "SchoolClass" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SchoolClass" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "SchoolClass" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "Level" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Level" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Level" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "AcademicYear" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcademicYear" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "AcademicYear" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "AcademicTerm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcademicTerm" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "AcademicTerm" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "Enrollment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Enrollment" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Enrollment" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "Student" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Student" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Student" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "Guardian" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Guardian" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Guardian" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "FeeStructure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeeStructure" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "FeeStructure" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "Charge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Charge" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Charge" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Payment" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Expense" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Expense" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "ExpenseRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "ExpenseRequest" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "AuditLog" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "Subject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subject" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Subject" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "SubjectAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SubjectAssignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "SubjectAssignment" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "Mark" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Mark" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Mark" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "TermResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TermResult" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "TermResult" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "GradeBoundary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GradeBoundary" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "GradeBoundary" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "AssetCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssetCategory" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "AssetCategory" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "Asset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Asset" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Asset" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "AssetMaintenance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssetMaintenance" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "AssetMaintenance" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "AssetDisposal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssetDisposal" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "AssetDisposal" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "Book" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Book" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Book" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "BookCopy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BookCopy" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "BookCopy" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "LibraryMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LibraryMember" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "LibraryMember" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "Borrowing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Borrowing" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Borrowing" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "ExchangeRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExchangeRate" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "ExchangeRate" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "PortalAccessLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PortalAccessLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "PortalAccessLog" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));

-- Tables without their own schoolId follow their parent row (which is itself filtered).
ALTER TABLE "StudentGuardian" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentGuardian" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "StudentGuardian"
  USING (EXISTS (SELECT 1 FROM "Student" s WHERE s."id" = "studentId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Student" s WHERE s."id" = "studentId"));
ALTER TABLE "ExpenseRequestItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseRequestItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "ExpenseRequestItem"
  USING (EXISTS (SELECT 1 FROM "ExpenseRequest" r WHERE r."id" = "requestId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "ExpenseRequest" r WHERE r."id" = "requestId"));

-- Row-change audit trigger
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor  text := nullif(current_setting('app.user_id', true), '');
  secret text[] := ARRAY['passwordHash', 'portalPinHash', 'portalTokenHash', 'portalToken'];
  old_j  jsonb;
  new_j  jsonb;
  act    "AuditAction";
BEGIN
  IF actor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    new_j := to_jsonb(NEW) - secret;
    act := 'DATA_CREATE';
  ELSIF TG_OP = 'UPDATE' THEN
    old_j := to_jsonb(OLD) - secret;
    new_j := to_jsonb(NEW) - secret;
    -- A password or token change only touches secret columns: still worth a row.
    IF old_j = new_j AND to_jsonb(OLD) = to_jsonb(NEW) THEN
      RETURN NEW;
    END IF;
    act := 'DATA_UPDATE';
  ELSE
    old_j := to_jsonb(OLD) - secret;
    act := 'DATA_DELETE';
  END IF;

  INSERT INTO "AuditLog" ("id", "schoolId", "actorId", "action", "entityType", "entityId", "detail", "before", "after", "createdAt")
  VALUES (
    gen_random_uuid()::text,
    COALESCE(new_j, old_j) ->> 'schoolId',
    actor,
    act,
    TG_TABLE_NAME,
    COALESCE(new_j, old_j) ->> 'id',
    TG_OP || ' ' || TG_TABLE_NAME,
    old_j,
    new_j,
    CURRENT_TIMESTAMP
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER "audit_Student" AFTER INSERT OR UPDATE OR DELETE ON "Student"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "audit_Guardian" AFTER INSERT OR UPDATE OR DELETE ON "Guardian"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "audit_Enrollment" AFTER INSERT OR UPDATE OR DELETE ON "Enrollment"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "audit_Charge" AFTER INSERT OR UPDATE OR DELETE ON "Charge"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "audit_Payment" AFTER INSERT OR UPDATE OR DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "audit_Expense" AFTER INSERT OR UPDATE OR DELETE ON "Expense"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "audit_Mark" AFTER INSERT OR UPDATE OR DELETE ON "Mark"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "audit_User" AFTER INSERT OR UPDATE OR DELETE ON "User"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- Audit rows are append-only.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog rows cannot be changed or deleted';
END;
$$;
CREATE TRIGGER "audit_log_no_change" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- 3. SAME-SCHOOL REFERENCES
--    A row may only point at rows of its own school (a payment for another
--    school's student, an asset in another school's category …). Foreign keys
--    cannot express this, so a trigger checks every school-owned foreign key
--    on insert and on updates that touch it. The lookup runs with the
--    row-level-security setting cleared, otherwise the other school's row would
--    simply be invisible and the check would pass.
CREATE OR REPLACE FUNCTION check_same_school() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  spec       text;
  col        text;
  ref        text;
  fk         text;
  ref_school text;
  row_school text := to_jsonb(NEW) ->> 'schoolId';
  saved      text := current_setting('app.school_id', true);
BEGIN
  PERFORM set_config('app.school_id', '', true);
  FOREACH spec IN ARRAY TG_ARGV LOOP
    col := split_part(spec, ':', 1);
    ref := split_part(spec, ':', 2);
    fk  := to_jsonb(NEW) ->> col;
    CONTINUE WHEN fk IS NULL;
    EXECUTE format('SELECT "schoolId" FROM %I WHERE "id" = $1', ref) INTO ref_school USING fk;
    IF FOUND AND ref_school IS DISTINCT FROM row_school THEN
      PERFORM set_config('app.school_id', coalesce(saved, ''), true);
      RAISE EXCEPTION 'Cross-school reference: %.% points to a row of another school', TG_TABLE_NAME, col
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  PERFORM set_config('app.school_id', coalesce(saved, ''), true);
  RETURN NEW;
END;
$$;

CREATE TRIGGER "same_school_SchoolClass" BEFORE INSERT OR UPDATE OF "levelId", "classTeacherId" ON "SchoolClass"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('levelId:Level', 'classTeacherId:User');
CREATE TRIGGER "same_school_AcademicTerm" BEFORE INSERT OR UPDATE OF "academicYearId", "closedById" ON "AcademicTerm"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('academicYearId:AcademicYear', 'closedById:User');
CREATE TRIGGER "same_school_Enrollment" BEFORE INSERT OR UPDATE OF "studentId", "classId", "termId" ON "Enrollment"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student', 'classId:SchoolClass', 'termId:AcademicTerm');
CREATE TRIGGER "same_school_Student" BEFORE INSERT OR UPDATE OF "currentClassId" ON "Student"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('currentClassId:SchoolClass');
CREATE TRIGGER "same_school_FeeStructure" BEFORE INSERT OR UPDATE OF "levelId", "termId" ON "FeeStructure"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('levelId:Level', 'termId:AcademicTerm');
CREATE TRIGGER "same_school_Charge" BEFORE INSERT OR UPDATE OF "studentId", "termId" ON "Charge"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student', 'termId:AcademicTerm');
CREATE TRIGGER "same_school_Payment" BEFORE INSERT OR UPDATE OF "studentId", "recordedBy", "verifiedBy", "voidedBy" ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student', 'recordedBy:User', 'verifiedBy:User', 'voidedBy:User');
CREATE TRIGGER "same_school_Expense" BEFORE INSERT OR UPDATE OF "expenseRequestId", "recordedBy", "voidedBy" ON "Expense"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('expenseRequestId:ExpenseRequest', 'recordedBy:User', 'voidedBy:User');
CREATE TRIGGER "same_school_ExpenseRequest" BEFORE INSERT OR UPDATE OF "requestedById", "approvedById", "rejectedById", "disbursedById" ON "ExpenseRequest"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('requestedById:User', 'approvedById:User', 'rejectedById:User', 'disbursedById:User');
CREATE TRIGGER "same_school_AuditLog" BEFORE INSERT OR UPDATE OF "actorId" ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('actorId:User');
CREATE TRIGGER "same_school_PortalAccessLog" BEFORE INSERT OR UPDATE OF "studentId" ON "PortalAccessLog"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student');
CREATE TRIGGER "same_school_SubjectAssignment" BEFORE INSERT OR UPDATE OF "teacherId", "subjectId", "classId", "termId", "marksVerifiedById" ON "SubjectAssignment"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('teacherId:User', 'subjectId:Subject', 'classId:SchoolClass', 'termId:AcademicTerm', 'marksVerifiedById:User');
CREATE TRIGGER "same_school_Mark" BEFORE INSERT OR UPDATE OF "studentId", "subjectId", "enteredBy", "termId" ON "Mark"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student', 'subjectId:Subject', 'enteredBy:User', 'termId:AcademicTerm');
CREATE TRIGGER "same_school_TermResult" BEFORE INSERT OR UPDATE OF "studentId", "termId" ON "TermResult"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student', 'termId:AcademicTerm');
CREATE TRIGGER "same_school_Asset" BEFORE INSERT OR UPDATE OF "categoryId" ON "Asset"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('categoryId:AssetCategory');
CREATE TRIGGER "same_school_AssetMaintenance" BEFORE INSERT OR UPDATE OF "assetId", "recordedBy" ON "AssetMaintenance"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('assetId:Asset', 'recordedBy:User');
CREATE TRIGGER "same_school_AssetDisposal" BEFORE INSERT OR UPDATE OF "assetId", "recordedBy" ON "AssetDisposal"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('assetId:Asset', 'recordedBy:User');
CREATE TRIGGER "same_school_BookCopy" BEFORE INSERT OR UPDATE OF "bookId" ON "BookCopy"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('bookId:Book');
CREATE TRIGGER "same_school_LibraryMember" BEFORE INSERT OR UPDATE OF "userId" ON "LibraryMember"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('userId:User');
CREATE TRIGGER "same_school_Borrowing" BEFORE INSERT OR UPDATE OF "copyId", "memberId" ON "Borrowing"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('copyId:BookCopy', 'memberId:LibraryMember');
CREATE TRIGGER "same_school_ExchangeRate" BEFORE INSERT OR UPDATE OF "setBy" ON "ExchangeRate"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('setBy:User');

-- StudentGuardian has no schoolId of its own: the student and the guardian must belong to one school.
CREATE OR REPLACE FUNCTION check_student_guardian_school() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s text;
  g text;
  saved text := current_setting('app.school_id', true);
BEGIN
  PERFORM set_config('app.school_id', '', true);
  SELECT "schoolId" INTO s FROM "Student" WHERE "id" = NEW."studentId";
  SELECT "schoolId" INTO g FROM "Guardian" WHERE "id" = NEW."guardianId";
  PERFORM set_config('app.school_id', coalesce(saved, ''), true);
  IF s IS DISTINCT FROM g THEN
    RAISE EXCEPTION 'Cross-school reference: StudentGuardian links a student and a guardian of different schools'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "same_school_StudentGuardian" BEFORE INSERT OR UPDATE ON "StudentGuardian"
  FOR EACH ROW EXECUTE FUNCTION check_student_guardian_school();
