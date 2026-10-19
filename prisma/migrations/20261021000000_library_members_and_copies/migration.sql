-- Part 5.1 / 5.2 — students can borrow books; copy counts come from BookCopy.

ALTER TYPE "CopyStatus" ADD VALUE 'DAMAGED';
ALTER TYPE "CopyStatus" ADD VALUE 'WITHDRAWN';
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_LIBRARY_MEMBER';
ALTER TYPE "AuditAction" ADD VALUE 'SUSPEND_LIBRARY_MEMBER';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_BOOK_COPY';
ALTER TYPE "AuditAction" ADD VALUE 'SETTLE_LIBRARY_FINE';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_LIBRARY_SETTINGS';

CREATE TYPE "MemberType" AS ENUM ('STAFF', 'STUDENT');

-- 5.1 LibraryMember: a staff user OR a student, never both, never neither.
ALTER TABLE "LibraryMember"
  ALTER COLUMN "userId" DROP NOT NULL,
  ADD COLUMN "studentId"  TEXT,
  ADD COLUMN "memberType" "MemberType" NOT NULL DEFAULT 'STAFF';
CREATE UNIQUE INDEX "LibraryMember_studentId_key" ON "LibraryMember"("studentId");
ALTER TABLE "LibraryMember" ADD CONSTRAINT "LibraryMember_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LibraryMember" ADD CONSTRAINT "LibraryMember_exactly_one_person"
  CHECK (("userId" IS NOT NULL) <> ("studentId" IS NOT NULL));
ALTER TABLE "LibraryMember" ADD CONSTRAINT "LibraryMember_type_matches"
  CHECK (("memberType" = 'STAFF' AND "userId" IS NOT NULL) OR ("memberType" = 'STUDENT' AND "studentId" IS NOT NULL));

-- A member's user / student must belong to the same school.
DROP TRIGGER IF EXISTS "same_school_LibraryMember" ON "LibraryMember";
CREATE TRIGGER "same_school_LibraryMember" BEFORE INSERT OR UPDATE OF "userId", "studentId" ON "LibraryMember"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('userId:User', 'studentId:Student');

-- Every current student gets a library membership; new students get one on admission.
INSERT INTO "LibraryMember" ("id", "schoolId", "studentId", "memberType")
SELECT gen_random_uuid()::text, s."schoolId", s."id", 'STUDENT'
  FROM "Student" s
 WHERE s."status" = 'ACTIVE';

-- 5.1 School settings: fine limit and loan limits per kind of member.
ALTER TABLE "School"
  ADD COLUMN "libraryFineLimit" DECIMAL(14,2) NOT NULL DEFAULT 5,
  ADD COLUMN "studentLoanLimit" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "staffLoanLimit"   INTEGER NOT NULL DEFAULT 5;

-- 5.2 Copy counts are counted from BookCopy; the stored number is dropped.
ALTER TABLE "Book" DROP COLUMN "totalCopies";
ALTER TABLE "Book"
  ADD COLUMN "replacementCost"     DECIMAL(14,2),
  ADD COLUMN "replacementCurrency" "Currency" NOT NULL DEFAULT 'USD';
