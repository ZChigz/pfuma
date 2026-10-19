-- CreateEnum
CREATE TYPE "ExamPeriodStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED');

-- CreateEnum
CREATE TYPE "ExamSession" AS ENUM ('MORNING', 'AFTERNOON');

-- CreateEnum
CREATE TYPE "ExamAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE');

-- CreateEnum
CREATE TYPE "ExamIncidentType" AS ENUM ('MALPRACTICE', 'ILLNESS', 'DISRUPTION', 'OTHER');

-- CreateEnum
CREATE TYPE "ExamBoard" AS ENUM ('ZIMSEC', 'CAMBRIDGE');

-- CreateEnum
CREATE TYPE "BoardSessionStatus" AS ENUM ('OPEN', 'APPROVED');

-- CreateEnum
CREATE TYPE "AmendmentKind" AS ENUM ('CANDIDATE_ADDED', 'CANDIDATE_REMOVED', 'SUBJECT_ADDED', 'SUBJECT_REMOVED', 'DETAILS_CHANGED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SAVE_EXAM_PERIOD';
ALTER TYPE "AuditAction" ADD VALUE 'SAVE_EXAM_PAPER';
ALTER TYPE "AuditAction" ADD VALUE 'SUBMIT_EXAM_TIMETABLE';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVE_EXAM_TIMETABLE';
ALTER TYPE "AuditAction" ADD VALUE 'RETURN_EXAM_TIMETABLE';
ALTER TYPE "AuditAction" ADD VALUE 'ASSIGN_INVIGILATOR';
ALTER TYPE "AuditAction" ADD VALUE 'MARK_EXAM_ATTENDANCE';
ALTER TYPE "AuditAction" ADD VALUE 'REPORT_EXAM_INCIDENT';
ALTER TYPE "AuditAction" ADD VALUE 'SAVE_BOARD_SESSION';
ALTER TYPE "AuditAction" ADD VALUE 'SAVE_CANDIDATE';
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_EXAM_FEES';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVE_ENTRY_LIST';
ALTER TYPE "AuditAction" ADD VALUE 'EXPORT_ENTRY_LIST';
ALTER TYPE "AuditAction" ADD VALUE 'IMPORT_CANDIDATE_NUMBERS';
ALTER TYPE "AuditAction" ADD VALUE 'IMPORT_BOARD_RESULTS';
ALTER TYPE "AuditAction" ADD VALUE 'RECORD_AMENDMENT';

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "examPaperId" TEXT;

-- CreateTable
CREATE TABLE "ExamPeriod" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "typeId" TEXT NOT NULL,
    "status" "ExamPeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPeriodLevel" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamPeriodLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPaper" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "paperNumber" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "session" "ExamSession" NOT NULL,
    "startTime" TEXT NOT NULL,
    "maxMark" DECIMAL(8,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPaperRoom" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "examCapacity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamPaperRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invigilation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invigilation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAttendance" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "roomId" TEXT,
    "status" "ExamAttendanceStatus" NOT NULL,
    "arrivalTime" TEXT,
    "markedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamIncident" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "roomId" TEXT,
    "studentId" TEXT,
    "type" "ExamIncidentType" NOT NULL,
    "description" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disciplineIncidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardSession" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "board" "ExamBoard" NOT NULL,
    "category" "LevelCategory" NOT NULL,
    "session" TEXT NOT NULL,
    "centreNumber" TEXT NOT NULL,
    "registrationOpens" DATE,
    "registrationCloses" DATE,
    "feePerSubject" DECIMAL(10,2) NOT NULL,
    "fixedFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "photoRequired" BOOLEAN NOT NULL DEFAULT true,
    "passGrades" TEXT[],
    "gradePoints" JSONB,
    "exportColumns" TEXT[],
    "exportLayout" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "status" "BoardSessionStatus" NOT NULL DEFAULT 'OPEN',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardSubjectCode" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardSubjectCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT,
    "fullName" TEXT,
    "gender" "Gender",
    "dateOfBirth" DATE,
    "idNumber" TEXT,
    "phone" TEXT,
    "certificateName" TEXT,
    "candidateNumber" TEXT,
    "nameChecked" BOOLEAN NOT NULL DEFAULT false,
    "feePaidManual" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardResult" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "candidateId" TEXT,
    "studentId" TEXT,
    "candidateNumber" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardAmendment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "candidateId" TEXT,
    "kind" "AmendmentKind" NOT NULL,
    "detail" TEXT NOT NULL,
    "madeById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamPeriod_schoolId_idx" ON "ExamPeriod"("schoolId");

-- CreateIndex
CREATE INDEX "ExamPeriod_termId_status_idx" ON "ExamPeriod"("termId", "status");

-- CreateIndex
CREATE INDEX "ExamPeriodLevel_schoolId_idx" ON "ExamPeriodLevel"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPeriodLevel_periodId_levelId_key" ON "ExamPeriodLevel"("periodId", "levelId");

-- CreateIndex
CREATE INDEX "ExamPaper_schoolId_idx" ON "ExamPaper"("schoolId");

-- CreateIndex
CREATE INDEX "ExamPaper_periodId_date_session_idx" ON "ExamPaper"("periodId", "date", "session");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaper_periodId_subjectId_levelId_paperNumber_key" ON "ExamPaper"("periodId", "subjectId", "levelId", "paperNumber");

-- CreateIndex
CREATE INDEX "ExamPaperRoom_schoolId_idx" ON "ExamPaperRoom"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaperRoom_paperId_roomId_key" ON "ExamPaperRoom"("paperId", "roomId");

-- CreateIndex
CREATE INDEX "Invigilation_schoolId_idx" ON "Invigilation"("schoolId");

-- CreateIndex
CREATE INDEX "Invigilation_userId_idx" ON "Invigilation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invigilation_paperId_roomId_userId_key" ON "Invigilation"("paperId", "roomId", "userId");

-- CreateIndex
CREATE INDEX "ExamAttendance_schoolId_idx" ON "ExamAttendance"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAttendance_paperId_studentId_key" ON "ExamAttendance"("paperId", "studentId");

-- CreateIndex
CREATE INDEX "ExamIncident_schoolId_idx" ON "ExamIncident"("schoolId");

-- CreateIndex
CREATE INDEX "ExamIncident_paperId_idx" ON "ExamIncident"("paperId");

-- CreateIndex
CREATE INDEX "BoardSession_schoolId_idx" ON "BoardSession"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardSession_schoolId_board_category_session_key" ON "BoardSession"("schoolId", "board", "category", "session");

-- CreateIndex
CREATE INDEX "BoardSubjectCode_schoolId_idx" ON "BoardSubjectCode"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardSubjectCode_sessionId_code_key" ON "BoardSubjectCode"("sessionId", "code");

-- CreateIndex
CREATE INDEX "Candidate_schoolId_idx" ON "Candidate"("schoolId");

-- CreateIndex
CREATE INDEX "Candidate_sessionId_idx" ON "Candidate"("sessionId");

-- CreateIndex
CREATE INDEX "Candidate_studentId_idx" ON "Candidate"("studentId");

-- CreateIndex
CREATE INDEX "CandidateEntry_schoolId_idx" ON "CandidateEntry"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateEntry_candidateId_codeId_key" ON "CandidateEntry"("candidateId", "codeId");

-- CreateIndex
CREATE INDEX "BoardResult_schoolId_idx" ON "BoardResult"("schoolId");

-- CreateIndex
CREATE INDEX "BoardResult_studentId_idx" ON "BoardResult"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardResult_sessionId_candidateNumber_codeId_key" ON "BoardResult"("sessionId", "candidateNumber", "codeId");

-- CreateIndex
CREATE INDEX "BoardAmendment_schoolId_idx" ON "BoardAmendment"("schoolId");

-- CreateIndex
CREATE INDEX "BoardAmendment_sessionId_idx" ON "BoardAmendment"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_examPaperId_key" ON "Assessment"("examPaperId");

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_examPaperId_fkey" FOREIGN KEY ("examPaperId") REFERENCES "ExamPaper"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPeriod" ADD CONSTRAINT "ExamPeriod_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPeriod" ADD CONSTRAINT "ExamPeriod_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPeriod" ADD CONSTRAINT "ExamPeriod_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AssessmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPeriodLevel" ADD CONSTRAINT "ExamPeriodLevel_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPeriodLevel" ADD CONSTRAINT "ExamPeriodLevel_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ExamPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPeriodLevel" ADD CONSTRAINT "ExamPeriodLevel_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ExamPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaper" ADD CONSTRAINT "ExamPaper_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaperRoom" ADD CONSTRAINT "ExamPaperRoom_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaperRoom" ADD CONSTRAINT "ExamPaperRoom_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPaperRoom" ADD CONSTRAINT "ExamPaperRoom_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invigilation" ADD CONSTRAINT "Invigilation_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invigilation" ADD CONSTRAINT "Invigilation_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invigilation" ADD CONSTRAINT "Invigilation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttendance" ADD CONSTRAINT "ExamAttendance_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttendance" ADD CONSTRAINT "ExamAttendance_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttendance" ADD CONSTRAINT "ExamAttendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamIncident" ADD CONSTRAINT "ExamIncident_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamIncident" ADD CONSTRAINT "ExamIncident_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamIncident" ADD CONSTRAINT "ExamIncident_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardSession" ADD CONSTRAINT "BoardSession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardSubjectCode" ADD CONSTRAINT "BoardSubjectCode_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardSubjectCode" ADD CONSTRAINT "BoardSubjectCode_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BoardSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardSubjectCode" ADD CONSTRAINT "BoardSubjectCode_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BoardSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateEntry" ADD CONSTRAINT "CandidateEntry_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateEntry" ADD CONSTRAINT "CandidateEntry_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateEntry" ADD CONSTRAINT "CandidateEntry_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "BoardSubjectCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardResult" ADD CONSTRAINT "BoardResult_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardResult" ADD CONSTRAINT "BoardResult_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BoardSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardResult" ADD CONSTRAINT "BoardResult_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardResult" ADD CONSTRAINT "BoardResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardResult" ADD CONSTRAINT "BoardResult_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "BoardSubjectCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardAmendment" ADD CONSTRAINT "BoardAmendment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardAmendment" ADD CONSTRAINT "BoardAmendment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BoardSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ═════════════════════════════════════════════════════════════════════════════
-- Examinations: exam timetable, invigilation, seating, and ZIMSEC / Cambridge registration and results.
-- Row-level security, audit, same-school references, closed-term lock and the rules the database keeps by itself.
-- (The permission keys were added with the core migration.)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Row-level security and row-change audit ─────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ExamPeriod', 'ExamPeriodLevel', 'ExamPaper', 'ExamPaperRoom', 'Invigilation', 'ExamAttendance', 'ExamIncident',
                           'BoardSession', 'BoardSubjectCode', 'Candidate', 'CandidateEntry', 'BoardResult', 'BoardAmendment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY school_isolation ON %I USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"))', t);
  END LOOP;
  -- Every change names who made it, in the same transaction. Candidate details (ID numbers) stay out of the log's values.
  FOREACH t IN ARRAY ARRAY['ExamPeriod', 'ExamPeriodLevel', 'ExamPaper', 'ExamPaperRoom', 'Invigilation', 'ExamAttendance', 'ExamIncident',
                           'BoardSession', 'BoardSubjectCode', 'CandidateEntry', 'BoardResult', 'BoardAmendment'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', 'audit_' || t, t);
  END LOOP;
END $$;
CREATE TRIGGER "audit_Candidate" AFTER INSERT OR UPDATE OR DELETE ON "Candidate" FOR EACH ROW EXECUTE FUNCTION audit_row_change('idNumber', 'phone');

-- ── Same-school references ──────────────────────────────────────────────────
CREATE TRIGGER "same_school_ExamPeriod" BEFORE INSERT OR UPDATE OF "termId", "typeId", "submittedById", "approvedById", "createdById" ON "ExamPeriod"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('termId:AcademicTerm', 'typeId:AssessmentType', 'submittedById:User', 'approvedById:User', 'createdById:User');
CREATE TRIGGER "same_school_ExamPeriodLevel" BEFORE INSERT OR UPDATE OF "periodId", "levelId" ON "ExamPeriodLevel"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('periodId:ExamPeriod', 'levelId:Level');
CREATE TRIGGER "same_school_ExamPaper" BEFORE INSERT OR UPDATE OF "periodId", "subjectId", "levelId" ON "ExamPaper"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('periodId:ExamPeriod', 'subjectId:Subject', 'levelId:Level');
CREATE TRIGGER "same_school_ExamPaperRoom" BEFORE INSERT OR UPDATE OF "paperId", "roomId" ON "ExamPaperRoom"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('paperId:ExamPaper', 'roomId:Room');
CREATE TRIGGER "same_school_Invigilation" BEFORE INSERT OR UPDATE OF "paperId", "roomId", "userId" ON "Invigilation"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('paperId:ExamPaper', 'roomId:Room', 'userId:User');
CREATE TRIGGER "same_school_ExamAttendance" BEFORE INSERT OR UPDATE OF "paperId", "studentId", "roomId", "markedById" ON "ExamAttendance"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('paperId:ExamPaper', 'studentId:Student', 'roomId:Room', 'markedById:User');
CREATE TRIGGER "same_school_ExamIncident" BEFORE INSERT OR UPDATE OF "paperId", "roomId", "studentId", "reportedById", "disciplineIncidentId" ON "ExamIncident"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('paperId:ExamPaper', 'roomId:Room', 'studentId:Student', 'reportedById:User', 'disciplineIncidentId:DisciplineIncident');
CREATE TRIGGER "same_school_BoardSession" BEFORE INSERT OR UPDATE OF "approvedById" ON "BoardSession"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('approvedById:User');
CREATE TRIGGER "same_school_BoardSubjectCode" BEFORE INSERT OR UPDATE OF "sessionId", "subjectId" ON "BoardSubjectCode"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('sessionId:BoardSession', 'subjectId:Subject');
CREATE TRIGGER "same_school_Candidate" BEFORE INSERT OR UPDATE OF "sessionId", "studentId", "createdById" ON "Candidate"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('sessionId:BoardSession', 'studentId:Student', 'createdById:User');
CREATE TRIGGER "same_school_CandidateEntry" BEFORE INSERT OR UPDATE OF "candidateId", "codeId" ON "CandidateEntry"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('candidateId:Candidate', 'codeId:BoardSubjectCode');
CREATE TRIGGER "same_school_BoardResult" BEFORE INSERT OR UPDATE OF "sessionId", "candidateId", "studentId", "codeId" ON "BoardResult"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('sessionId:BoardSession', 'candidateId:Candidate', 'studentId:Student', 'codeId:BoardSubjectCode');
CREATE TRIGGER "same_school_BoardAmendment" BEFORE INSERT OR UPDATE OF "sessionId", "candidateId", "madeById" ON "BoardAmendment"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('sessionId:BoardSession', 'candidateId:Candidate', 'madeById:User');

-- ── A closed term is read-only ──────────────────────────────────────────────
CREATE TRIGGER "closed_term_ExamPeriod" BEFORE INSERT OR UPDATE OR DELETE ON "ExamPeriod" FOR EACH ROW EXECUTE FUNCTION academics_closed_term_guard();

-- ── Rules the database keeps by itself ──────────────────────────────────────
ALTER TABLE "ExamPeriod"
  ADD CONSTRAINT "ExamPeriod_dates" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "ExamPeriod_approved_has_approver" CHECK ("status" <> 'APPROVED' OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL)),
  ADD CONSTRAINT "ExamPeriod_pending_has_submitter" CHECK ("status" = 'DRAFT' OR ("submittedById" IS NOT NULL AND "submittedAt" IS NOT NULL));
ALTER TABLE "ExamPaper"
  ADD CONSTRAINT "ExamPaper_duration" CHECK ("durationMinutes" BETWEEN 10 AND 480),
  ADD CONSTRAINT "ExamPaper_number" CHECK ("paperNumber" >= 1),
  ADD CONSTRAINT "ExamPaper_max" CHECK ("maxMark" > 0),
  ADD CONSTRAINT "ExamPaper_time_format" CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "ExamPaper_session_matches_time" CHECK (("session" = 'MORNING' AND "startTime" < '12:00') OR ("session" = 'AFTERNOON' AND "startTime" >= '12:00'));
ALTER TABLE "ExamPaperRoom" ADD CONSTRAINT "ExamPaperRoom_capacity" CHECK ("examCapacity" > 0);
ALTER TABLE "ExamAttendance"
  ADD CONSTRAINT "ExamAttendance_late_has_time" CHECK ("status" <> 'LATE' OR "arrivalTime" IS NOT NULL),
  ADD CONSTRAINT "ExamAttendance_time_format" CHECK ("arrivalTime" IS NULL OR "arrivalTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "ExamIncident" ADD CONSTRAINT "ExamIncident_description" CHECK (btrim("description") <> '');
ALTER TABLE "BoardSession"
  ADD CONSTRAINT "BoardSession_fees" CHECK ("feePerSubject" >= 0 AND "fixedFee" >= 0),
  ADD CONSTRAINT "BoardSession_registration_dates" CHECK ("registrationOpens" IS NULL OR "registrationCloses" IS NULL OR "registrationCloses" >= "registrationOpens"),
  ADD CONSTRAINT "BoardSession_centre" CHECK (btrim("centreNumber") <> ''),
  ADD CONSTRAINT "BoardSession_approved_has_approver" CHECK ("status" <> 'APPROVED' OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL));
ALTER TABLE "BoardSubjectCode" ADD CONSTRAINT "BoardSubjectCode_code" CHECK (btrim("code") <> '');
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_who" CHECK ("studentId" IS NOT NULL OR btrim(coalesce("fullName", '')) <> '');
ALTER TABLE "BoardResult" ADD CONSTRAINT "BoardResult_grade" CHECK (btrim("grade") <> '');

-- A student is a candidate once per session; a candidate number is used once per session.
CREATE UNIQUE INDEX "Candidate_one_per_student" ON "Candidate"("sessionId", "studentId") WHERE "studentId" IS NOT NULL;
CREATE UNIQUE INDEX "Candidate_number_once" ON "Candidate"("sessionId", "candidateNumber") WHERE "candidateNumber" IS NOT NULL;
CREATE UNIQUE INDEX "BoardSession_one_period" ON "BoardSession"("schoolId", "board", "category", lower("session"));

-- A paper is sat inside its exam period and only by a level that sits the period.
CREATE OR REPLACE FUNCTION exams_paper_in_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_start date; p_end date; p_status "ExamPeriodStatus";
BEGIN
  SELECT "startDate", "endDate", "status" INTO p_start, p_end, p_status FROM "ExamPeriod" WHERE "id" = NEW."periodId";
  IF NEW."date" < p_start OR NEW."date" > p_end THEN
    RAISE EXCEPTION 'A paper must be set on a day inside its exam period (% to %)', p_start, p_end USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "ExamPeriodLevel" WHERE "periodId" = NEW."periodId" AND "levelId" = NEW."levelId") THEN
    RAISE EXCEPTION 'This level does not sit this exam period' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "paper_in_period_ExamPaper" BEFORE INSERT OR UPDATE OF "date", "periodId", "levelId" ON "ExamPaper" FOR EACH ROW EXECUTE FUNCTION exams_paper_in_period();
