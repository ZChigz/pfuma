-- Student Information module — step 1 of 3 (expand).
--
-- New columns on Student, Guardian, StudentGuardian, Enrollment and School; the statuses Expelled and
-- Deceased; new tables House, ClassMove, PromotionRun, Intake, Application, StudentDocument,
-- DisciplineIncident, IncidentStudent, DisciplineAction, MedicalProfile, MedicationEntry, SickBayVisit,
-- StudentExit and Alumnus; the students.* permission keys; and, for every new table, row-level security,
-- row-change audit (private columns hidden), same-school checks and the rules the database enforces itself.
-- Nothing is dropped. The next migration moves existing rows; the one after adds the unique guardian phone.

-- CreateEnum
CREATE TYPE "BoardingType" AS ENUM ('DAY', 'BOARDER');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('NEW_FORM_1', 'NEW_LOWER_6', 'TRANSFER_IN', 'RETURNING');

-- CreateEnum
CREATE TYPE "OrphanStatus" AS ENUM ('NONE', 'SINGLE', 'DOUBLE');

-- CreateEnum
CREATE TYPE "ClassMoveReason" AS ENUM ('WRONG_CLASS_AT_ADMISSION', 'SUBJECT_COMBINATION', 'BEHAVIOUR', 'PARENT_REQUEST', 'BALANCING_CLASS_SIZES', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PromotionRunStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('APPLIED', 'SHORTLISTED', 'TESTED', 'OFFERED', 'ACCEPTED', 'ENROLLED', 'WAITLISTED', 'REJECTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('BIRTH_CERTIFICATE', 'GUARDIAN_ID', 'GRADE7_RESULTS_SLIP', 'OLEVEL_RESULTS_SLIP', 'PREVIOUS_SCHOOL_REPORT', 'TRANSFER_LETTER_RECEIVED', 'MEDICAL_REPORT', 'PHOTO_CONSENT', 'OTHER', 'LETTER_ADMISSION', 'LETTER_PROOF_OF_ENROLMENT', 'LETTER_TRANSFER', 'LETTER_TESTIMONIAL', 'LETTER_LEAVING_CERTIFICATE', 'LETTER_OFFER');

-- CreateEnum
CREATE TYPE "IncidentLocation" AS ENUM ('CLASSROOM', 'DORMITORY', 'SPORTS_FIELD', 'DINING_HALL', 'OFF_CAMPUS', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentCategory" AS ENUM ('LATE_COMING', 'ABSENT_WITHOUT_LEAVE', 'UNIFORM', 'HOMEWORK', 'DISRESPECT', 'BULLYING', 'FIGHTING', 'THEFT', 'VANDALISM', 'SUBSTANCE_USE', 'PHONE_USE', 'ABSCONDING', 'EXAM_DISHONESTY', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('MINOR', 'MODERATE', 'SERIOUS');

-- CreateEnum
CREATE TYPE "DisciplineActionType" AS ENUM ('VERBAL_WARNING', 'WRITTEN_WARNING', 'DETENTION', 'MANUAL_WORK', 'COUNSELLING_REFERRAL', 'GUARDIAN_CALLED_IN', 'SUSPENSION', 'EXPULSION_RECOMMENDED');

-- CreateEnum
CREATE TYPE "DisciplineActionStatus" AS ENUM ('RECORDED', 'PENDING', 'APPROVED', 'REJECTED', 'ENDED');

-- CreateEnum
CREATE TYPE "MedicationKeeper" AS ENUM ('STUDENT', 'MATRON', 'OFFICE');

-- CreateEnum
CREATE TYPE "SickBayOutcome" AS ENUM ('RETURNED_TO_CLASS', 'SENT_HOME', 'SENT_TO_CLINIC');

-- CreateEnum
CREATE TYPE "ExitReason" AS ENUM ('TRANSFER', 'COMPLETED_O_LEVEL', 'COMPLETED_A_LEVEL', 'WITHDRAWN_BY_GUARDIAN', 'RELOCATED_ABROAD', 'EXPELLED', 'DECEASED', 'OTHER');

-- CreateEnum
CREATE TYPE "ExitState" AS ENUM ('STARTED', 'APPROVED', 'COMPLETED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StudentStatus" ADD VALUE 'EXPELLED';
ALTER TYPE "StudentStatus" ADD VALUE 'DECEASED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SUSPEND_STUDENT';
ALTER TYPE "AuditAction" ADD VALUE 'END_SUSPENSION';
ALTER TYPE "AuditAction" ADD VALUE 'REQUEST_CLASS_MOVE';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVE_CLASS_MOVE';
ALTER TYPE "AuditAction" ADD VALUE 'REJECT_CLASS_MOVE';
ALTER TYPE "AuditAction" ADD VALUE 'ASSIGN_HOUSE';
ALTER TYPE "AuditAction" ADD VALUE 'EXPORT_STUDENTS';
ALTER TYPE "AuditAction" ADD VALUE 'PRINT_STUDENT';
ALTER TYPE "AuditAction" ADD VALUE 'IMPORT_STUDENTS';
ALTER TYPE "AuditAction" ADD VALUE 'REJOIN_STUDENT';
ALTER TYPE "AuditAction" ADD VALUE 'MEDICAL_VIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_MEDICAL';
ALTER TYPE "AuditAction" ADD VALUE 'UPLOAD_DOCUMENT';
ALTER TYPE "AuditAction" ADD VALUE 'VIEW_DOCUMENT';
ALTER TYPE "AuditAction" ADD VALUE 'GENERATE_LETTER';
ALTER TYPE "AuditAction" ADD VALUE 'RECORD_INCIDENT';
ALTER TYPE "AuditAction" ADD VALUE 'DECIDE_INCIDENT_ACTION';
ALTER TYPE "AuditAction" ADD VALUE 'RECORD_GUARDIAN_MEETING';
ALTER TYPE "AuditAction" ADD VALUE 'START_LEAVING';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVE_LEAVING';
ALTER TYPE "AuditAction" ADD VALUE 'COMPLETE_LEAVING';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_ALUMNUS';
ALTER TYPE "AuditAction" ADD VALUE 'EXPORT_ALUMNI';
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_INTAKE';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_INTAKE';
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_APPLICATION';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_APPLICATION';
ALTER TYPE "AuditAction" ADD VALUE 'MOVE_APPLICATION';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVE_OFFER';
ALTER TYPE "AuditAction" ADD VALUE 'ENROL_APPLICANT';
ALTER TYPE "AuditAction" ADD VALUE 'SAVE_PROMOTION_DRAFT';
ALTER TYPE "AuditAction" ADD VALUE 'CONFIRM_PROMOTION';
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_HOUSE';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_HOUSE';

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "letterNextNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "requiredDocumentTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "reason" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "boarding" "BoardingType" NOT NULL DEFAULT 'DAY',
ADD COLUMN     "entryResults" JSONB,
ADD COLUMN     "entryType" "EntryType",
ADD COLUMN     "homeLanguage" TEXT,
ADD COLUMN     "houseId" TEXT,
ADD COLUMN     "isBeam" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "orphanStatus" "OrphanStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "preferredName" TEXT,
ADD COLUMN     "religion" TEXT,
ADD COLUMN     "specialNeeds" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "specialNeedsNote" TEXT,
ADD COLUMN     "sponsorName" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Guardian" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "StudentGuardian" ADD COLUMN     "canCollect" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "custodyNote" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "House" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '#6B7280',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "House_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassMove" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromClassId" TEXT,
    "toClassId" TEXT NOT NULL,
    "termId" TEXT,
    "effectiveDate" DATE NOT NULL,
    "reason" "ClassMoveReason" NOT NULL,
    "reasonNote" TEXT,
    "status" "ApprovalState" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassMove_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionRun" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fromYearId" TEXT NOT NULL,
    "toYearId" TEXT NOT NULL,
    "status" "PromotionRunStatus" NOT NULL DEFAULT 'DRAFT',
    "lines" JSONB NOT NULL,
    "summary" JSONB,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intake" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "places" INTEGER NOT NULL,
    "applicationOpens" DATE,
    "applicationCloses" DATE,
    "testDate" DATE,
    "reportingDate" DATE,
    "requirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applicationFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "feeCurrency" "Currency" NOT NULL DEFAULT 'USD',
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Intake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "surname" TEXT NOT NULL,
    "gender" "Gender" NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "birthCertificateNumber" TEXT,
    "previousSchool" TEXT,
    "boarding" "BoardingType" NOT NULL DEFAULT 'DAY',
    "guardianName" TEXT NOT NULL,
    "guardianRelationship" "GuardianRelationship" NOT NULL DEFAULT 'GUARDIAN',
    "guardianPhone" TEXT NOT NULL,
    "guardianPhone2" TEXT,
    "guardianEmail" TEXT,
    "address" TEXT,
    "entryResults" JSONB,
    "testScore" DECIMAL(6,2),
    "interviewNotes" TEXT,
    "stage" "ApplicationStage" NOT NULL DEFAULT 'APPLIED',
    "stageHistory" JSONB NOT NULL DEFAULT '[]',
    "targetClassId" TEXT,
    "offerApprovedById" TEXT,
    "offerApprovedAt" TIMESTAMP(3),
    "offerReference" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "depositPaid" BOOLEAN,
    "studentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentDocument" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT,
    "applicationId" TEXT,
    "type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "fileKey" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "date" DATE,
    "expiryDate" DATE,
    "notes" TEXT,
    "generated" BOOLEAN NOT NULL DEFAULT false,
    "referenceNo" TEXT,
    "snapshot" JSONB,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisciplineIncident" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "location" "IncidentLocation" NOT NULL,
    "category" "IncidentCategory" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "witnesses" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisciplineIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentStudent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisciplineAction" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" "DisciplineActionType" NOT NULL,
    "status" "DisciplineActionStatus" NOT NULL DEFAULT 'RECORDED',
    "startDate" DATE,
    "endDate" DATE,
    "notes" TEXT,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decision" TEXT,
    "decisionDate" DATE,
    "authorityRef" TEXT,
    "meetingDate" DATE,
    "meetingAttendees" TEXT,
    "meetingOutcome" TEXT,
    "meetingLetterKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisciplineAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalProfile" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "allergies" JSONB NOT NULL DEFAULT '[]',
    "hasSevereAllergy" BOOLEAN NOT NULL DEFAULT false,
    "bloodGroup" TEXT,
    "medicalAidProvider" TEXT,
    "medicalAidNumber" TEXT,
    "medicalAidMainMember" TEXT,
    "doctorName" TEXT,
    "doctorPhone" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "emergencyRelationship" TEXT,
    "specialNeedsType" TEXT,
    "supportNeeded" TEXT,
    "consentEmergencyTreatment" BOOLEAN,
    "consentDate" DATE,
    "consentFormKey" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dose" TEXT,
    "whenGiven" TEXT,
    "keptBy" "MedicationKeeper" NOT NULL DEFAULT 'STUDENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SickBayVisit" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL,
    "complaint" TEXT NOT NULL,
    "treatment" TEXT,
    "outcome" "SickBayOutcome" NOT NULL,
    "guardianInformed" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SickBayVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentExit" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "reason" "ExitReason" NOT NULL,
    "reasonNote" TEXT,
    "state" "ExitState" NOT NULL DEFAULT 'STARTED',
    "lastDay" DATE NOT NULL,
    "destinationSchool" TEXT,
    "destinationDistrict" TEXT,
    "clearance" JSONB NOT NULL DEFAULT '[]',
    "overrideReason" TEXT,
    "startedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultingStatus" "StudentStatus",
    "lastClassId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentExit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alumnus" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "yearLeft" INTEGER NOT NULL,
    "lastClass" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "destination" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alumnus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "House_schoolId_idx" ON "House"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "House_schoolId_name_key" ON "House"("schoolId", "name");

-- CreateIndex
CREATE INDEX "ClassMove_schoolId_status_idx" ON "ClassMove"("schoolId", "status");

-- CreateIndex
CREATE INDEX "ClassMove_studentId_idx" ON "ClassMove"("studentId");

-- CreateIndex
CREATE INDEX "PromotionRun_schoolId_status_idx" ON "PromotionRun"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Intake_schoolId_idx" ON "Intake"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Intake_schoolId_name_key" ON "Intake"("schoolId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Application_studentId_key" ON "Application"("studentId");

-- CreateIndex
CREATE INDEX "Application_schoolId_intakeId_stage_idx" ON "Application"("schoolId", "intakeId", "stage");

-- CreateIndex
CREATE INDEX "StudentDocument_schoolId_studentId_idx" ON "StudentDocument"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentDocument_schoolId_referenceNo_key" ON "StudentDocument"("schoolId", "referenceNo");

-- CreateIndex
CREATE INDEX "DisciplineIncident_schoolId_occurredAt_idx" ON "DisciplineIncident"("schoolId", "occurredAt");

-- CreateIndex
CREATE INDEX "IncidentStudent_schoolId_studentId_idx" ON "IncidentStudent"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentStudent_incidentId_studentId_key" ON "IncidentStudent"("incidentId", "studentId");

-- CreateIndex
CREATE INDEX "DisciplineAction_schoolId_studentId_idx" ON "DisciplineAction"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "DisciplineAction_schoolId_type_status_idx" ON "DisciplineAction"("schoolId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalProfile_studentId_key" ON "MedicalProfile"("studentId");

-- CreateIndex
CREATE INDEX "MedicalProfile_schoolId_idx" ON "MedicalProfile"("schoolId");

-- CreateIndex
CREATE INDEX "MedicationEntry_schoolId_profileId_idx" ON "MedicationEntry"("schoolId", "profileId");

-- CreateIndex
CREATE INDEX "SickBayVisit_schoolId_studentId_idx" ON "SickBayVisit"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "StudentExit_schoolId_studentId_idx" ON "StudentExit"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "StudentExit_schoolId_state_idx" ON "StudentExit"("schoolId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Alumnus_studentId_key" ON "Alumnus"("studentId");

-- CreateIndex
CREATE INDEX "Alumnus_schoolId_yearLeft_idx" ON "Alumnus"("schoolId", "yearLeft");

-- CreateIndex
CREATE INDEX "Student_schoolId_status_idx" ON "Student"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Student_schoolId_houseId_idx" ON "Student"("schoolId", "houseId");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "House"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "House" ADD CONSTRAINT "House_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassMove" ADD CONSTRAINT "ClassMove_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassMove" ADD CONSTRAINT "ClassMove_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassMove" ADD CONSTRAINT "ClassMove_fromClassId_fkey" FOREIGN KEY ("fromClassId") REFERENCES "SchoolClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassMove" ADD CONSTRAINT "ClassMove_toClassId_fkey" FOREIGN KEY ("toClassId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRun" ADD CONSTRAINT "PromotionRun_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRun" ADD CONSTRAINT "PromotionRun_fromYearId_fkey" FOREIGN KEY ("fromYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRun" ADD CONSTRAINT "PromotionRun_toYearId_fkey" FOREIGN KEY ("toYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intake" ADD CONSTRAINT "Intake_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intake" ADD CONSTRAINT "Intake_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplineIncident" ADD CONSTRAINT "DisciplineIncident_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentStudent" ADD CONSTRAINT "IncidentStudent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentStudent" ADD CONSTRAINT "IncidentStudent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "DisciplineIncident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentStudent" ADD CONSTRAINT "IncidentStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplineAction" ADD CONSTRAINT "DisciplineAction_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplineAction" ADD CONSTRAINT "DisciplineAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "DisciplineIncident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplineAction" ADD CONSTRAINT "DisciplineAction_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalProfile" ADD CONSTRAINT "MedicalProfile_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalProfile" ADD CONSTRAINT "MedicalProfile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationEntry" ADD CONSTRAINT "MedicationEntry_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationEntry" ADD CONSTRAINT "MedicationEntry_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MedicalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SickBayVisit" ADD CONSTRAINT "SickBayVisit_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SickBayVisit" ADD CONSTRAINT "SickBayVisit_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentExit" ADD CONSTRAINT "StudentExit_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentExit" ADD CONSTRAINT "StudentExit_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alumnus" ADD CONSTRAINT "Alumnus_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alumnus" ADD CONSTRAINT "Alumnus_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═════════════════════════════════════════════════════════════════════════════
-- Student Information module: permissions, row-level security, audit, same-school
-- references and the rules the database can enforce by itself.
-- (The data is moved in the next migration, and the guardian phone uniqueness is
--  added in the one after, once duplicate guardians have been merged.)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Permission keys ─────────────────────────────────────────────────────────
-- Only Owner and Administrator ("*") hold them for now; a role is given them in System, Roles.
INSERT INTO "Permission" ("key", "module", "description") VALUES
  ('students.list.view',          'students', 'View students'),
  ('students.attendance.view',    'students', 'View attendance'),
  ('students.promotions.view',    'students', 'View promotions'),
  ('students.profiles.view',      'students', 'See student profiles'),
  ('students.profiles.create',    'students', 'Add students'),
  ('students.profiles.edit',      'students', 'Change student details, move classes'),
  ('students.profiles.export',    'students', 'Export student lists'),
  ('students.profiles.import',    'students', 'Import students from a file'),
  ('students.guardians.view',     'students', 'See guardians'),
  ('students.guardians.edit',     'students', 'Add, link and change guardians'),
  ('students.guardians.view_ids', 'students', 'See guardian ID numbers'),
  ('students.admissions.view',    'students', 'See admissions'),
  ('students.admissions.manage',  'students', 'Manage intakes and applicants'),
  ('students.admissions.approve', 'students', 'Approve offers'),
  ('students.enrolment.view',     'students', 'See class history'),
  ('students.enrolment.manage',   'students', 'Move students between classes'),
  ('students.enrolment.approve',  'students', 'Approve class moves after the term has started'),
  ('students.promotion.manage',   'students', 'Prepare the year-end promotion'),
  ('students.promotion.approve',  'students', 'Approve the year-end promotion'),
  ('students.documents.view',     'students', 'See student documents'),
  ('students.documents.upload',   'students', 'Upload student documents'),
  ('students.documents.generate', 'students', 'Generate letters and certificates'),
  ('students.discipline.view',    'students', 'See discipline records'),
  ('students.discipline.create',  'students', 'Record incidents'),
  ('students.discipline.approve', 'students', 'Approve suspensions, decide on expulsions'),
  ('students.medical.view',       'students', 'See medical details'),
  ('students.medical.edit',       'students', 'Change medical details'),
  ('students.medical.export',     'students', 'Include medical details in exports'),
  ('students.leavers.manage',     'students', 'Start the leaving process'),
  ('students.leavers.approve',    'students', 'Approve leavings'),
  ('students.alumni.view',        'students', 'See alumni'),
  ('students.alumni.export',      'students', 'Export alumni contact lists')
ON CONFLICT ("key") DO NOTHING;

-- ── Which module an audit entry belongs to ──────────────────────────────────
CREATE OR REPLACE FUNCTION audit_module(entity text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN entity IN ('Student', 'Guardian', 'StudentGuardian', 'Enrolment', 'Enrollment', 'Absence', 'House', 'ClassMove',
                    'PromotionRun', 'Intake', 'Application', 'StudentDocument', 'DisciplineIncident', 'IncidentStudent',
                    'DisciplineAction', 'MedicalProfile', 'MedicationEntry', 'SickBayVisit', 'StudentExit', 'Alumnus') THEN 'students'
    WHEN entity IN ('SubjectAssignment', 'Subject', 'Timetable') THEN 'academics'
    WHEN entity IN ('Mark', 'TermResult', 'ReportCard', 'MarkChange') THEN 'exams'
    WHEN entity IN ('Payment', 'Expense', 'ExpenseRequest', 'Charge', 'FeeStructure', 'Income', 'ExchangeRate') THEN 'finance'
    WHEN entity IN ('Asset', 'AssetTransfer', 'Book', 'BookCopy', 'Borrowing', 'LibraryMember') THEN 'facilities'
    ELSE 'system'
  END
$$;

-- ── Row-change audit that can hide private columns ──────────────────────────
-- Same as before, but the names given to the trigger (CREATE TRIGGER ... audit_row_change('col', ...))
-- are columns whose VALUES never reach the audit log: medical, discipline and ID details are visible
-- to people who may see the audit log but not those records. The log still says that they changed.
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor  text := nullif(current_setting('app.user_id', true), '');
  secret text[] := ARRAY['passwordHash', 'portalPinHash', 'portalTokenHash', 'portalToken'];
  hidden text[] := TG_ARGV;
  col    text;
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

  IF hidden IS NOT NULL THEN
    FOREACH col IN ARRAY hidden LOOP
      IF new_j IS NOT NULL AND new_j ? col AND new_j -> col <> 'null'::jsonb THEN
        new_j := jsonb_set(new_j, ARRAY[col], CASE WHEN old_j IS NOT NULL AND old_j -> col IS DISTINCT FROM new_j -> col THEN '"[hidden, changed]"'::jsonb ELSE '"[hidden]"'::jsonb END);
      END IF;
      IF old_j IS NOT NULL AND old_j ? col AND old_j -> col <> 'null'::jsonb THEN
        old_j := jsonb_set(old_j, ARRAY[col], '"[hidden]"'::jsonb);
      END IF;
    END LOOP;
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

DROP TRIGGER "audit_Student" ON "Student";
CREATE TRIGGER "audit_Student" AFTER INSERT OR UPDATE OR DELETE ON "Student"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('birthCertificateNumber', 'specialNeedsNote', 'medicalNotes');
DROP TRIGGER "audit_Guardian" ON "Guardian";
CREATE TRIGGER "audit_Guardian" AFTER INSERT OR UPDATE OR DELETE ON "Guardian"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('nationalId');

-- ── Row-level security and row-change audit for the new tables ──────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['House', 'ClassMove', 'PromotionRun', 'Intake', 'Application', 'StudentDocument', 'DisciplineIncident',
                           'IncidentStudent', 'DisciplineAction', 'MedicalProfile', 'MedicationEntry', 'SickBayVisit', 'StudentExit', 'Alumnus'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY school_isolation ON %I USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"))', t);
  END LOOP;
END $$;

CREATE TRIGGER "audit_House"        AFTER INSERT OR UPDATE OR DELETE ON "House"        FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "audit_ClassMove"    AFTER INSERT OR UPDATE OR DELETE ON "ClassMove"    FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "audit_PromotionRun" AFTER INSERT OR UPDATE OR DELETE ON "PromotionRun" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "audit_Intake"       AFTER INSERT OR UPDATE OR DELETE ON "Intake"       FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "audit_Application"  AFTER INSERT OR UPDATE OR DELETE ON "Application"  FOR EACH ROW EXECUTE FUNCTION audit_row_change('birthCertificateNumber', 'interviewNotes');
CREATE TRIGGER "audit_StudentDocument" AFTER INSERT OR UPDATE OR DELETE ON "StudentDocument" FOR EACH ROW EXECUTE FUNCTION audit_row_change('fileKey');
CREATE TRIGGER "audit_DisciplineIncident" AFTER INSERT OR UPDATE OR DELETE ON "DisciplineIncident" FOR EACH ROW EXECUTE FUNCTION audit_row_change('description', 'witnesses');
CREATE TRIGGER "audit_IncidentStudent" AFTER INSERT OR UPDATE OR DELETE ON "IncidentStudent" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "audit_DisciplineAction" AFTER INSERT OR UPDATE OR DELETE ON "DisciplineAction" FOR EACH ROW EXECUTE FUNCTION audit_row_change('notes', 'decision', 'authorityRef', 'meetingAttendees', 'meetingOutcome', 'meetingLetterKey');
CREATE TRIGGER "audit_MedicalProfile" AFTER INSERT OR UPDATE OR DELETE ON "MedicalProfile" FOR EACH ROW EXECUTE FUNCTION audit_row_change(
  'conditions', 'allergies', 'bloodGroup', 'medicalAidProvider', 'medicalAidNumber', 'medicalAidMainMember', 'doctorName', 'doctorPhone',
  'emergencyName', 'emergencyPhone', 'emergencyRelationship', 'specialNeedsType', 'supportNeeded', 'consentFormKey', 'notes');
CREATE TRIGGER "audit_MedicationEntry" AFTER INSERT OR UPDATE OR DELETE ON "MedicationEntry" FOR EACH ROW EXECUTE FUNCTION audit_row_change('name', 'dose', 'whenGiven');
CREATE TRIGGER "audit_SickBayVisit" AFTER INSERT OR UPDATE OR DELETE ON "SickBayVisit" FOR EACH ROW EXECUTE FUNCTION audit_row_change('complaint', 'treatment');
CREATE TRIGGER "audit_StudentExit"  AFTER INSERT OR UPDATE OR DELETE ON "StudentExit"  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "audit_Alumnus"      AFTER INSERT OR UPDATE OR DELETE ON "Alumnus"      FOR EACH ROW EXECUTE FUNCTION audit_row_change('phone', 'email');

-- ── Same-school references ──────────────────────────────────────────────────
DROP TRIGGER "same_school_Student" ON "Student";
CREATE TRIGGER "same_school_Student" BEFORE INSERT OR UPDATE OF "currentClassId", "houseId" ON "Student"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('currentClassId:SchoolClass', 'houseId:House');
CREATE TRIGGER "same_school_ClassMove" BEFORE INSERT OR UPDATE OF "studentId", "fromClassId", "toClassId", "termId", "requestedById", "approvedById" ON "ClassMove"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student', 'fromClassId:SchoolClass', 'toClassId:SchoolClass', 'termId:AcademicTerm', 'requestedById:User', 'approvedById:User');
CREATE TRIGGER "same_school_PromotionRun" BEFORE INSERT OR UPDATE OF "fromYearId", "toYearId", "createdById", "approvedById" ON "PromotionRun"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('fromYearId:AcademicYear', 'toYearId:AcademicYear', 'createdById:User', 'approvedById:User');
CREATE TRIGGER "same_school_Intake" BEFORE INSERT OR UPDATE OF "levelId" ON "Intake"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('levelId:Level');
CREATE TRIGGER "same_school_Application" BEFORE INSERT OR UPDATE OF "intakeId", "studentId", "targetClassId", "offerApprovedById" ON "Application"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('intakeId:Intake', 'studentId:Student', 'targetClassId:SchoolClass', 'offerApprovedById:User');
CREATE TRIGGER "same_school_StudentDocument" BEFORE INSERT OR UPDATE OF "studentId", "applicationId", "uploadedById" ON "StudentDocument"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student', 'applicationId:Application', 'uploadedById:User');
CREATE TRIGGER "same_school_DisciplineIncident" BEFORE INSERT OR UPDATE OF "recordedById" ON "DisciplineIncident"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('recordedById:User');
CREATE TRIGGER "same_school_IncidentStudent" BEFORE INSERT OR UPDATE OF "incidentId", "studentId" ON "IncidentStudent"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('incidentId:DisciplineIncident', 'studentId:Student');
CREATE TRIGGER "same_school_DisciplineAction" BEFORE INSERT OR UPDATE OF "incidentId", "studentId", "requestedById", "approvedById" ON "DisciplineAction"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('incidentId:DisciplineIncident', 'studentId:Student', 'requestedById:User', 'approvedById:User');
CREATE TRIGGER "same_school_MedicalProfile" BEFORE INSERT OR UPDATE OF "studentId" ON "MedicalProfile"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student');
CREATE TRIGGER "same_school_MedicationEntry" BEFORE INSERT OR UPDATE OF "profileId" ON "MedicationEntry"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('profileId:MedicalProfile');
CREATE TRIGGER "same_school_SickBayVisit" BEFORE INSERT OR UPDATE OF "studentId", "recordedById" ON "SickBayVisit"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student', 'recordedById:User');
CREATE TRIGGER "same_school_StudentExit" BEFORE INSERT OR UPDATE OF "studentId", "startedById", "approvedById", "lastClassId" ON "StudentExit"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student', 'startedById:User', 'approvedById:User', 'lastClassId:SchoolClass');
CREATE TRIGGER "same_school_Alumnus" BEFORE INSERT OR UPDATE OF "studentId" ON "Alumnus"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student');

-- ── Rules the database keeps by itself ──────────────────────────────────────
ALTER TABLE "Intake"
  ADD CONSTRAINT "Intake_places_positive" CHECK ("places" > 0),
  ADD CONSTRAINT "Intake_fee_not_negative" CHECK ("applicationFee" >= 0),
  ADD CONSTRAINT "Intake_dates_in_order" CHECK ("applicationOpens" IS NULL OR "applicationCloses" IS NULL OR "applicationCloses" >= "applicationOpens");
ALTER TABLE "Application"
  ADD CONSTRAINT "Application_testScore_range" CHECK ("testScore" IS NULL OR ("testScore" >= 0 AND "testScore" <= 100)),
  ADD CONSTRAINT "Application_history_is_list" CHECK (jsonb_typeof("stageHistory") = 'array');
ALTER TABLE "ClassMove"
  ADD CONSTRAINT "ClassMove_changes_class" CHECK ("fromClassId" IS DISTINCT FROM "toClassId");
ALTER TABLE "PromotionRun"
  ADD CONSTRAINT "PromotionRun_lines_is_list" CHECK (jsonb_typeof("lines") = 'array'),
  ADD CONSTRAINT "PromotionRun_years_differ" CHECK ("fromYearId" <> "toYearId"),
  ADD CONSTRAINT "PromotionRun_confirmed_is_approved" CHECK ("status" <> 'CONFIRMED' OR ("approvedById" IS NOT NULL AND "confirmedAt" IS NOT NULL));
ALTER TABLE "DisciplineAction"
  ADD CONSTRAINT "DisciplineAction_suspension_has_dates" CHECK ("type" <> 'SUSPENSION' OR ("startDate" IS NOT NULL AND "endDate" IS NOT NULL AND "endDate" >= "startDate")),
  ADD CONSTRAINT "DisciplineAction_approved_has_approver" CHECK ("status" NOT IN ('APPROVED', 'REJECTED') OR "approvedById" IS NOT NULL);
ALTER TABLE "StudentExit"
  ADD CONSTRAINT "StudentExit_clearance_is_list" CHECK (jsonb_typeof("clearance") = 'array'),
  ADD CONSTRAINT "StudentExit_approved_has_approver" CHECK ("state" IN ('STARTED', 'CANCELLED') OR "approvedById" IS NOT NULL),
  ADD CONSTRAINT "StudentExit_completed_has_status" CHECK ("state" <> 'COMPLETED' OR ("completedAt" IS NOT NULL AND "resultingStatus" IS NOT NULL));
ALTER TABLE "StudentDocument"
  ADD CONSTRAINT "StudentDocument_has_owner" CHECK ("studentId" IS NOT NULL OR "applicationId" IS NOT NULL),
  ADD CONSTRAINT "StudentDocument_generated_has_reference" CHECK (NOT "generated" OR "referenceNo" IS NOT NULL),
  ADD CONSTRAINT "StudentDocument_size_limit" CHECK ("sizeBytes" IS NULL OR ("sizeBytes" > 0 AND "sizeBytes" <= 5242880));
ALTER TABLE "MedicalProfile"
  ADD CONSTRAINT "MedicalProfile_lists" CHECK (jsonb_typeof("conditions") = 'array' AND jsonb_typeof("allergies") = 'array'),
  ADD CONSTRAINT "MedicalProfile_blood_group" CHECK ("bloodGroup" IS NULL OR "bloodGroup" IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'));
ALTER TABLE "Alumnus"
  ADD CONSTRAINT "Alumnus_year_plausible" CHECK ("yearLeft" BETWEEN 1950 AND 2200);

-- One open leaving, one waiting class move and one draft promotion at a time; a year is promoted once;
-- a student has at most one suspension waiting for or under way.
CREATE UNIQUE INDEX "StudentExit_one_open_per_student" ON "StudentExit"("studentId") WHERE "state" IN ('STARTED', 'APPROVED');
CREATE UNIQUE INDEX "ClassMove_one_pending_per_student" ON "ClassMove"("studentId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "PromotionRun_one_draft_per_year" ON "PromotionRun"("schoolId", "fromYearId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "PromotionRun_one_confirmed_per_year" ON "PromotionRun"("schoolId", "fromYearId") WHERE "status" = 'CONFIRMED';
CREATE UNIQUE INDEX "DisciplineAction_one_open_suspension" ON "DisciplineAction"("studentId") WHERE "type" = 'SUSPENSION' AND "status" IN ('PENDING', 'APPROVED');

-- Students are never deleted: they change status and the history stays.
CREATE OR REPLACE FUNCTION student_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Students are never deleted. Change the status instead (the history stays).';
END;
$$;
CREATE TRIGGER "student_no_delete" BEFORE DELETE ON "Student" FOR EACH ROW EXECUTE FUNCTION student_no_delete();
