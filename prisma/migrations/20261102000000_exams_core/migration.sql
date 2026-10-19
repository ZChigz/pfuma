-- CreateEnum
CREATE TYPE "MarkCode" AS ENUM ('AB', 'EX', 'NS', 'AB_EXCUSED');

-- CreateEnum
CREATE TYPE "CombineRule" AS ENUM ('AVERAGE', 'BEST_N', 'BY_MAX');

-- CreateEnum
CREATE TYPE "MarkSheetStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'VERIFIED', 'PUBLISHED', 'RETURNED', 'UNLOCKED');

-- CreateEnum
CREATE TYPE "SheetAction" AS ENUM ('SUBMIT', 'VERIFY', 'RETURN', 'UNLOCK', 'PUBLISH', 'UNPUBLISH');

-- CreateEnum
CREATE TYPE "CommentCategory" AS ENUM ('SUBJECT', 'CLASS_TEACHER', 'HEAD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SAVE_ASSESSMENT_TYPE';
ALTER TYPE "AuditAction" ADD VALUE 'SAVE_WEIGHTING_PLAN';
ALTER TYPE "AuditAction" ADD VALUE 'COPY_WEIGHTING_PLAN';
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_ASSESSMENT';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_ASSESSMENT';
ALTER TYPE "AuditAction" ADD VALUE 'COPY_ASSESSMENT';
ALTER TYPE "AuditAction" ADD VALUE 'SAVE_PROJECT';
ALTER TYPE "AuditAction" ADD VALUE 'COPY_PROJECT';
ALTER TYPE "AuditAction" ADD VALUE 'ENTER_MARKS';
ALTER TYPE "AuditAction" ADD VALUE 'IMPORT_MARKS';
ALTER TYPE "AuditAction" ADD VALUE 'CORRECT_MARK';
ALTER TYPE "AuditAction" ADD VALUE 'SUBMIT_MARK_SHEET';
ALTER TYPE "AuditAction" ADD VALUE 'VERIFY_MARK_SHEET';
ALTER TYPE "AuditAction" ADD VALUE 'RETURN_MARK_SHEET';
ALTER TYPE "AuditAction" ADD VALUE 'UNLOCK_MARK_SHEET';
ALTER TYPE "AuditAction" ADD VALUE 'CALCULATE_RESULTS';
ALTER TYPE "AuditAction" ADD VALUE 'PUBLISH_CLASS_RESULTS';
ALTER TYPE "AuditAction" ADD VALUE 'UNPUBLISH_CLASS_RESULTS';
ALTER TYPE "AuditAction" ADD VALUE 'SAVE_REPORT_COMMENT';
ALTER TYPE "AuditAction" ADD VALUE 'SAVE_EXAM_SETTINGS';
ALTER TYPE "AuditAction" ADD VALUE 'SET_EXAM_DEADLINES';
ALTER TYPE "AuditAction" ADD VALUE 'REMIND_MARK_SHEETS';
ALTER TYPE "AuditAction" ADD VALUE 'SET_DEPARTMENT_VERIFIER';
ALTER TYPE "AuditAction" ADD VALUE 'ADD_MARK_EVIDENCE';
ALTER TYPE "AuditAction" ADD VALUE 'SAVE_COMMENT_BANK';

-- AlterTable
ALTER TABLE "TermResult" ADD COLUMN     "aLevelPoints" INTEGER,
ADD COLUMN     "calculatedAt" TIMESTAMP(3),
ADD COLUMN     "classId" TEXT,
ADD COLUMN     "conductGrade" TEXT,
ADD COLUMN     "fivePassesEngMaths" BOOLEAN,
ADD COLUMN     "formPosition" INTEGER,
ADD COLUMN     "formSize" INTEGER,
ADD COLUMN     "incidentCount" INTEGER,
ADD COLUMN     "previousAverage" DECIMAL(7,2),
ADD COLUMN     "reportCardFileKey" TEXT,
ADD COLUMN     "schoolDays" INTEGER,
ADD COLUMN     "timesLate" INTEGER,
ADD COLUMN     "verificationCode" TEXT;

-- CreateTable
CREATE TABLE "AssessmentType" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isProject" BOOLEAN NOT NULL DEFAULT false,
    "commonExam" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeightingPlan" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "subjectId" TEXT,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeightingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeightingPlanItem" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "weight" DECIMAL(5,2) NOT NULL,
    "combineRule" "CombineRule" NOT NULL DEFAULT 'AVERAGE',
    "bestN" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeightingPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeightingPlanItemType" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeightingPlanItemType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTemplate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "startDate" DATE,
    "dueDate" DATE,
    "briefFileKey" TEXT,
    "briefFileName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "copiedFromId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectStage" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "maxMark" DECIMAL(8,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rubric" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rubric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RubricCriterion" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "rubricId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RubricCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RubricLevel" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "descriptor" TEXT,
    "marks" DECIMAL(8,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RubricLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "levelId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "date" DATE,
    "maxMark" DECIMAL(8,2) NOT NULL,
    "countsToTerm" BOOLEAN NOT NULL DEFAULT true,
    "copiedFromId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentTopic" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentMark" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "stageId" TEXT,
    "value" DECIMAL(8,2),
    "code" "MarkCode",
    "enteredById" TEXT NOT NULL,
    "clientChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentMark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RubricScore" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "markId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RubricScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarkEvidence" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "markId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT,
    "contentType" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarkEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentMarkChange" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "markId" TEXT NOT NULL,
    "sheetId" TEXT,
    "oldValue" DECIMAL(8,2),
    "oldCode" "MarkCode",
    "newValue" DECIMAL(8,2),
    "newCode" "MarkCode",
    "changedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentMarkChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarkSheet" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "status" "MarkSheetStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "firstSubmittedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "returnedComment" TEXT,
    "returnedById" TEXT,
    "returnedAt" TIMESTAMP(3),
    "unlockedById" TEXT,
    "unlockedAt" TIMESTAMP(3),
    "unlockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarkSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarkSheetEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "action" "SheetAction" NOT NULL,
    "fromStatus" "MarkSheetStatus" NOT NULL,
    "toStatus" "MarkSheetStatus" NOT NULL,
    "actorId" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarkSheetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetStudentComment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SheetStudentComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubjectResult" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "termMark" DECIMAL(7,2) NOT NULL,
    "roundedMark" INTEGER NOT NULL,
    "grade" TEXT,
    "points" INTEGER,
    "remark" TEXT,
    "classPosition" INTEGER,
    "classSize" INTEGER,
    "formPosition" INTEGER,
    "formSize" INTEGER,
    "teacherComment" TEXT,
    "teacherInitials" TEXT,
    "typeScores" JSONB,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubjectResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportComment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "classTeacherComment" TEXT,
    "classTeacherById" TEXT,
    "headRemark" TEXT,
    "headRemarkById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentBankItem" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "category" "CommentCategory" NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentBankItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSettings" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "englishSubjectId" TEXT,
    "mathsSubjectId" TEXT,
    "passesRequired" INTEGER NOT NULL DEFAULT 5,
    "outlierSd" DECIMAL(4,2) NOT NULL DEFAULT 3,
    "subjectCommentsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "showSubjectPositions" BOOLEAN NOT NULL DEFAULT true,
    "showClassPosition" BOOLEAN NOT NULL DEFAULT true,
    "showFormPosition" BOOLEAN NOT NULL DEFAULT true,
    "showTypeScores" BOOLEAN NOT NULL DEFAULT true,
    "showAttendance" BOOLEAN NOT NULL DEFAULT true,
    "showConduct" BOOLEAN NOT NULL DEFAULT false,
    "showPreviousAverage" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamDeadline" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "entryDue" DATE,
    "submitDue" DATE,
    "verifyDue" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamDeadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamDepartmentVerifier" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamDepartmentVerifier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentType_schoolId_idx" ON "AssessmentType"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentType_schoolId_name_key" ON "AssessmentType"("schoolId", "name");

-- CreateIndex
CREATE INDEX "WeightingPlan_schoolId_idx" ON "WeightingPlan"("schoolId");

-- CreateIndex
CREATE INDEX "WeightingPlan_termId_levelId_idx" ON "WeightingPlan"("termId", "levelId");

-- CreateIndex
CREATE INDEX "WeightingPlanItem_schoolId_idx" ON "WeightingPlanItem"("schoolId");

-- CreateIndex
CREATE INDEX "WeightingPlanItem_planId_idx" ON "WeightingPlanItem"("planId");

-- CreateIndex
CREATE INDEX "WeightingPlanItemType_schoolId_idx" ON "WeightingPlanItemType"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "WeightingPlanItemType_itemId_typeId_key" ON "WeightingPlanItemType"("itemId", "typeId");

-- CreateIndex
CREATE INDEX "ProjectTemplate_schoolId_idx" ON "ProjectTemplate"("schoolId");

-- CreateIndex
CREATE INDEX "ProjectTemplate_schoolId_subjectId_levelId_idx" ON "ProjectTemplate"("schoolId", "subjectId", "levelId");

-- CreateIndex
CREATE INDEX "ProjectStage_schoolId_idx" ON "ProjectStage"("schoolId");

-- CreateIndex
CREATE INDEX "ProjectStage_templateId_idx" ON "ProjectStage"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "Rubric_stageId_key" ON "Rubric"("stageId");

-- CreateIndex
CREATE INDEX "Rubric_schoolId_idx" ON "Rubric"("schoolId");

-- CreateIndex
CREATE INDEX "RubricCriterion_schoolId_idx" ON "RubricCriterion"("schoolId");

-- CreateIndex
CREATE INDEX "RubricCriterion_rubricId_idx" ON "RubricCriterion"("rubricId");

-- CreateIndex
CREATE INDEX "RubricLevel_schoolId_idx" ON "RubricLevel"("schoolId");

-- CreateIndex
CREATE INDEX "RubricLevel_criterionId_idx" ON "RubricLevel"("criterionId");

-- CreateIndex
CREATE INDEX "Assessment_schoolId_idx" ON "Assessment"("schoolId");

-- CreateIndex
CREATE INDEX "Assessment_termId_subjectId_levelId_idx" ON "Assessment"("termId", "subjectId", "levelId");

-- CreateIndex
CREATE INDEX "Assessment_assignmentId_idx" ON "Assessment"("assignmentId");

-- CreateIndex
CREATE INDEX "AssessmentTopic_schoolId_idx" ON "AssessmentTopic"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentTopic_assessmentId_topicId_key" ON "AssessmentTopic"("assessmentId", "topicId");

-- CreateIndex
CREATE INDEX "AssessmentMark_schoolId_idx" ON "AssessmentMark"("schoolId");

-- CreateIndex
CREATE INDEX "AssessmentMark_assessmentId_idx" ON "AssessmentMark"("assessmentId");

-- CreateIndex
CREATE INDEX "AssessmentMark_assignmentId_idx" ON "AssessmentMark"("assignmentId");

-- CreateIndex
CREATE INDEX "AssessmentMark_studentId_idx" ON "AssessmentMark"("studentId");

-- CreateIndex
CREATE INDEX "RubricScore_schoolId_idx" ON "RubricScore"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "RubricScore_markId_criterionId_key" ON "RubricScore"("markId", "criterionId");

-- CreateIndex
CREATE INDEX "MarkEvidence_schoolId_idx" ON "MarkEvidence"("schoolId");

-- CreateIndex
CREATE INDEX "MarkEvidence_markId_idx" ON "MarkEvidence"("markId");

-- CreateIndex
CREATE INDEX "AssessmentMarkChange_schoolId_idx" ON "AssessmentMarkChange"("schoolId");

-- CreateIndex
CREATE INDEX "AssessmentMarkChange_markId_idx" ON "AssessmentMarkChange"("markId");

-- CreateIndex
CREATE INDEX "AssessmentMarkChange_sheetId_idx" ON "AssessmentMarkChange"("sheetId");

-- CreateIndex
CREATE INDEX "MarkSheet_schoolId_idx" ON "MarkSheet"("schoolId");

-- CreateIndex
CREATE INDEX "MarkSheet_termId_status_idx" ON "MarkSheet"("termId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarkSheet_assignmentId_termId_key" ON "MarkSheet"("assignmentId", "termId");

-- CreateIndex
CREATE INDEX "MarkSheetEvent_schoolId_idx" ON "MarkSheetEvent"("schoolId");

-- CreateIndex
CREATE INDEX "MarkSheetEvent_sheetId_idx" ON "MarkSheetEvent"("sheetId");

-- CreateIndex
CREATE INDEX "SheetStudentComment_schoolId_idx" ON "SheetStudentComment"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "SheetStudentComment_sheetId_studentId_key" ON "SheetStudentComment"("sheetId", "studentId");

-- CreateIndex
CREATE INDEX "SubjectResult_schoolId_idx" ON "SubjectResult"("schoolId");

-- CreateIndex
CREATE INDEX "SubjectResult_termId_classId_idx" ON "SubjectResult"("termId", "classId");

-- CreateIndex
CREATE INDEX "SubjectResult_termId_levelId_subjectId_idx" ON "SubjectResult"("termId", "levelId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectResult_studentId_subjectId_termId_key" ON "SubjectResult"("studentId", "subjectId", "termId");

-- CreateIndex
CREATE INDEX "ReportComment_schoolId_idx" ON "ReportComment"("schoolId");

-- CreateIndex
CREATE INDEX "ReportComment_termId_classId_idx" ON "ReportComment"("termId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportComment_studentId_termId_key" ON "ReportComment"("studentId", "termId");

-- CreateIndex
CREATE INDEX "CommentBankItem_schoolId_category_idx" ON "CommentBankItem"("schoolId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "ExamSettings_schoolId_key" ON "ExamSettings"("schoolId");

-- CreateIndex
CREATE INDEX "ExamDeadline_schoolId_idx" ON "ExamDeadline"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamDeadline_termId_key" ON "ExamDeadline"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamDepartmentVerifier_departmentId_key" ON "ExamDepartmentVerifier"("departmentId");

-- CreateIndex
CREATE INDEX "ExamDepartmentVerifier_schoolId_idx" ON "ExamDepartmentVerifier"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "TermResult_verificationCode_key" ON "TermResult"("verificationCode");

-- AddForeignKey
ALTER TABLE "TermResult" ADD CONSTRAINT "TermResult_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentType" ADD CONSTRAINT "AssessmentType_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightingPlan" ADD CONSTRAINT "WeightingPlan_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightingPlan" ADD CONSTRAINT "WeightingPlan_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightingPlan" ADD CONSTRAINT "WeightingPlan_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightingPlan" ADD CONSTRAINT "WeightingPlan_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightingPlanItem" ADD CONSTRAINT "WeightingPlanItem_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightingPlanItem" ADD CONSTRAINT "WeightingPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WeightingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightingPlanItemType" ADD CONSTRAINT "WeightingPlanItemType_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightingPlanItemType" ADD CONSTRAINT "WeightingPlanItemType_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WeightingPlanItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightingPlanItemType" ADD CONSTRAINT "WeightingPlanItemType_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AssessmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTemplate" ADD CONSTRAINT "ProjectTemplate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTemplate" ADD CONSTRAINT "ProjectTemplate_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTemplate" ADD CONSTRAINT "ProjectTemplate_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProjectTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ProjectStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricCriterion" ADD CONSTRAINT "RubricCriterion_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricCriterion" ADD CONSTRAINT "RubricCriterion_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricLevel" ADD CONSTRAINT "RubricLevel_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricLevel" ADD CONSTRAINT "RubricLevel_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "RubricCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TeacherAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AssessmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTopic" ADD CONSTRAINT "AssessmentTopic_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTopic" ADD CONSTRAINT "AssessmentTopic_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTopic" ADD CONSTRAINT "AssessmentTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "SyllabusTopic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentMark" ADD CONSTRAINT "AssessmentMark_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentMark" ADD CONSTRAINT "AssessmentMark_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentMark" ADD CONSTRAINT "AssessmentMark_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TeacherAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentMark" ADD CONSTRAINT "AssessmentMark_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentMark" ADD CONSTRAINT "AssessmentMark_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ProjectStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricScore" ADD CONSTRAINT "RubricScore_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricScore" ADD CONSTRAINT "RubricScore_markId_fkey" FOREIGN KEY ("markId") REFERENCES "AssessmentMark"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricScore" ADD CONSTRAINT "RubricScore_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "RubricCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricScore" ADD CONSTRAINT "RubricScore_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "RubricLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkEvidence" ADD CONSTRAINT "MarkEvidence_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkEvidence" ADD CONSTRAINT "MarkEvidence_markId_fkey" FOREIGN KEY ("markId") REFERENCES "AssessmentMark"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentMarkChange" ADD CONSTRAINT "AssessmentMarkChange_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentMarkChange" ADD CONSTRAINT "AssessmentMarkChange_markId_fkey" FOREIGN KEY ("markId") REFERENCES "AssessmentMark"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentMarkChange" ADD CONSTRAINT "AssessmentMarkChange_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "MarkSheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkSheet" ADD CONSTRAINT "MarkSheet_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkSheet" ADD CONSTRAINT "MarkSheet_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TeacherAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkSheet" ADD CONSTRAINT "MarkSheet_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkSheetEvent" ADD CONSTRAINT "MarkSheetEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkSheetEvent" ADD CONSTRAINT "MarkSheetEvent_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "MarkSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetStudentComment" ADD CONSTRAINT "SheetStudentComment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetStudentComment" ADD CONSTRAINT "SheetStudentComment_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "MarkSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetStudentComment" ADD CONSTRAINT "SheetStudentComment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectResult" ADD CONSTRAINT "SubjectResult_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectResult" ADD CONSTRAINT "SubjectResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectResult" ADD CONSTRAINT "SubjectResult_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectResult" ADD CONSTRAINT "SubjectResult_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectResult" ADD CONSTRAINT "SubjectResult_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportComment" ADD CONSTRAINT "ReportComment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportComment" ADD CONSTRAINT "ReportComment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportComment" ADD CONSTRAINT "ReportComment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportComment" ADD CONSTRAINT "ReportComment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentBankItem" ADD CONSTRAINT "CommentBankItem_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSettings" ADD CONSTRAINT "ExamSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamDeadline" ADD CONSTRAINT "ExamDeadline_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamDeadline" ADD CONSTRAINT "ExamDeadline_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamDepartmentVerifier" ADD CONSTRAINT "ExamDepartmentVerifier_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamDepartmentVerifier" ADD CONSTRAINT "ExamDepartmentVerifier_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ═════════════════════════════════════════════════════════════════════════════
-- Examinations core: permissions, row-level security, audit, same-school references, closed-term lock,
-- and the rules the database keeps by itself (marks never deleted, mark history append-only, locked sheets,
-- fixed maximum marks, nobody verifies their own marks, published results frozen).
-- (Existing marks and results are moved in the next migration.)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Permission keys ─────────────────────────────────────────────────────────
INSERT INTO "Permission" ("key", "module", "description") VALUES
  ('exams.marks.view',            'exams', 'View mark entry and mark sheets'),
  ('exams.results.view',          'exams', 'View results'),
  ('exams.reports.view',          'exams', 'View report cards'),
  ('exams.grading.view',          'exams', 'View grade boundaries'),
  ('exams.setup.manage',          'exams', 'Set the assessment types, weighting plans and end-of-term exams'),
  ('exams.projects.manage',       'exams', 'Manage school-based project templates'),
  ('exams.assessments.create',    'exams', 'Create tests and assignments for own classes'),
  ('exams.marks.enter',           'exams', 'Enter marks for own classes'),
  ('exams.marks.submit',          'exams', 'Submit own mark sheets for verification'),
  ('exams.marks.verify',          'exams', 'Verify or return the mark sheets of own department'),
  ('exams.marks.unlock',          'exams', 'Unlock verified mark sheets, excuse absences'),
  ('exams.comments.subject',      'exams', 'Write subject comments for own classes'),
  ('exams.comments.class',         'exams', 'Write class teacher comments for own class'),
  ('exams.comments.head',         'exams', 'Write the Head''s remarks'),
  ('exams.results.publish',       'exams', 'Publish results and report cards'),
  ('exams.results.unpublish',     'exams', 'Unpublish results for a correction'),
  ('exams.reportcards.settings',  'exams', 'Change the report card settings'),
  ('exams.timetable.manage',      'exams', 'Schedule exam periods and papers'),
  ('exams.timetable.approve',     'exams', 'Approve the exam timetable'),
  ('exams.invigilation.manage',   'exams', 'Assign invigilators and seating'),
  ('exams.zimsec.manage',         'exams', 'Manage ZIMSEC and Cambridge entries'),
  ('exams.zimsec.approve',        'exams', 'Approve the entry list'),
  ('exams.zimsec.results_import', 'exams', 'Load released board results'),
  ('exams.analytics.view',        'exams', 'View examination analytics')
ON CONFLICT ("key") DO NOTHING;

-- ── What each role may do in this module (narrowed to own classes / own department in the code) ──
CREATE OR REPLACE FUNCTION exams_role_keys(role_key text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE role_key
    WHEN 'TEACHER' THEN ARRAY['exams.assessments.create', 'exams.marks.enter', 'exams.marks.submit', 'exams.comments.subject', 'exams.analytics.view']
    WHEN 'CLASS_TEACHER' THEN ARRAY['exams.comments.class', 'exams.results.view', 'exams.analytics.view']
    WHEN 'HOD' THEN ARRAY['exams.marks.verify', 'exams.marks.view', 'exams.results.view', 'exams.analytics.view']
    WHEN 'HEAD' THEN ARRAY['exams.marks.view', 'exams.setup.manage', 'exams.projects.manage', 'exams.marks.unlock', 'exams.results.view', 'exams.results.publish', 'exams.results.unpublish',
                           'exams.comments.head', 'exams.reportcards.settings', 'exams.zimsec.approve', 'exams.analytics.view']
    WHEN 'DEPUTY_HEAD' THEN ARRAY['exams.marks.view', 'exams.results.view', 'exams.timetable.approve', 'exams.analytics.view']
    WHEN 'EXAMS_OFFICER' THEN ARRAY['exams.marks.view', 'exams.results.view', 'exams.setup.manage', 'exams.projects.manage', 'exams.timetable.manage',
                                    'exams.invigilation.manage', 'exams.zimsec.manage', 'exams.zimsec.results_import', 'exams.analytics.view']
    ELSE ARRAY[]::text[]
  END
$$;

-- A school created from now on starts with them.
CREATE OR REPLACE FUNCTION seed_school_roles(sid text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "RoleDefinition" ("id", "schoolId", "key", "name", "description", "isSystem", "updatedAt")
  SELECT gen_random_uuid()::text, sid, v.k, v.n, v.d, true, CURRENT_TIMESTAMP
    FROM (VALUES
      ('OWNER',           'Owner',              'Owns the school. Full access to everything.'),
      ('HEAD',            'Head',               'The head of the school. Oversees teaching, staff and finance.'),
      ('DEPUTY_HEAD',     'Deputy Head',        'Supports the head and runs day-to-day discipline and timetabling.'),
      ('ADMINISTRATOR',   'Administrator',      'Runs the system for the school: users, settings, calendar and records.'),
      ('BURSAR',          'Bursar',             'Manages fees, payments, expenses and the school accounts.'),
      ('ACCOUNTS_CLERK',  'Accounts Clerk',     'Records payments and keeps the daily accounts under the bursar.'),
      ('HR_OFFICER',      'HR Officer',         'Looks after staff records, leave and payroll.'),
      ('HOD',             'Head of Department', 'Leads a subject department and its teachers.'),
      ('TEACHER',         'Teacher',            'Teaches classes and enters marks for their subjects.'),
      ('CLASS_TEACHER',   'Class Teacher',      'Looks after one class: register, remarks and report cards.'),
      ('EXAMS_OFFICER',   'Exams Officer',      'Runs internal and ZIMSEC examinations and their results.'),
      ('LIBRARIAN',       'Librarian',          'Runs the library: books, borrowing and fines.'),
      ('BOARDING_MASTER', 'Boarding Master',    'Looks after the boarding hostels and the boarders.')
    ) AS v(k, n, d)
  ON CONFLICT ("schoolId", "key") DO NOTHING;

  INSERT INTO "RolePermission" ("id", "schoolId", "roleId", "permissionKey")
  SELECT gen_random_uuid()::text, sid, rd."id", p.k
    FROM "RoleDefinition" rd
    CROSS JOIN LATERAL unnest(
      CASE WHEN rd."key" IN ('OWNER', 'ADMINISTRATOR')
           THEN ARRAY['*', 'system.dashboard.view', 'system.calendar.view']
           ELSE ARRAY['system.dashboard.view', 'system.calendar.view'] || academics_role_keys(rd."key") || exams_role_keys(rd."key") END) AS p(k)
   WHERE rd."schoolId" = sid
  ON CONFLICT ("roleId", "permissionKey") DO NOTHING;
END;
$$;

-- ── Which module an audit entry belongs to ──────────────────────────────────
CREATE OR REPLACE FUNCTION audit_module(entity text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN entity IN ('Student', 'Guardian', 'StudentGuardian', 'Enrolment', 'Enrollment', 'Absence', 'House', 'ClassMove',
                    'PromotionRun', 'Intake', 'Application', 'StudentDocument', 'DisciplineIncident', 'IncidentStudent',
                    'DisciplineAction', 'MedicalProfile', 'MedicationEntry', 'SickBayVisit', 'StudentExit', 'Alumnus') THEN 'students'
    WHEN entity IN ('SubjectAssignment', 'Subject', 'Timetable', 'AcademicsSettings', 'ClassTeacher', 'Department', 'SubjectLevel',
                    'SubjectChange', 'SubjectCombination', 'SubjectCombinationItem', 'SubjectCombinationClass', 'StudentSubject',
                    'TeachingGroup', 'TeachingGroupStudent', 'TeacherAssignment', 'AssignmentSet', 'BellSchedule', 'Period', 'Room',
                    'TimetableSlot', 'TeacherAvailability', 'CoverLesson', 'AttendanceRegister', 'AttendanceEntry', 'MessageOutbox',
                    'SyllabusTopic', 'SyllabusTemplate', 'SchemeOfWork', 'SchemeWeek', 'RecordOfWork', 'LessonPlan') THEN 'academics'
    WHEN entity IN ('Mark', 'TermResult', 'ReportCard', 'MarkChange',
                    'AssessmentType', 'WeightingPlan', 'WeightingPlanItem', 'WeightingPlanItemType', 'ProjectTemplate', 'ProjectStage',
                    'Rubric', 'RubricCriterion', 'RubricLevel', 'Assessment', 'AssessmentTopic', 'AssessmentMark', 'RubricScore',
                    'MarkEvidence', 'AssessmentMarkChange', 'MarkSheet', 'MarkSheetEvent', 'SheetStudentComment', 'SubjectResult',
                    'ReportComment', 'CommentBankItem', 'ExamSettings', 'ExamDeadline', 'ExamDepartmentVerifier',
                    'ExamPeriod', 'ExamPaper', 'ExamPaperRoom', 'Invigilation', 'ExamAttendance', 'ExamIncident',
                    'BoardSession', 'BoardSubjectCode', 'Candidate', 'CandidateEntry', 'BoardResult', 'BoardAmendment') THEN 'exams'
    WHEN entity IN ('Payment', 'Expense', 'ExpenseRequest', 'Charge', 'FeeStructure', 'Income', 'ExchangeRate') THEN 'finance'
    WHEN entity IN ('Asset', 'AssetTransfer', 'Book', 'BookCopy', 'Borrowing', 'LibraryMember') THEN 'facilities'
    ELSE 'system'
  END
$$;

-- ── Row-level security ──────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['AssessmentType', 'WeightingPlan', 'WeightingPlanItem', 'WeightingPlanItemType', 'ProjectTemplate', 'ProjectStage',
                           'Rubric', 'RubricCriterion', 'RubricLevel', 'Assessment', 'AssessmentTopic', 'AssessmentMark', 'RubricScore',
                           'MarkEvidence', 'AssessmentMarkChange', 'MarkSheet', 'MarkSheetEvent', 'SheetStudentComment', 'SubjectResult',
                           'ReportComment', 'CommentBankItem', 'ExamSettings', 'ExamDeadline', 'ExamDepartmentVerifier'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY school_isolation ON %I USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"))', t);
  END LOOP;
END $$;

-- ── Row-change audit ────────────────────────────────────────────────────────
-- Every change to these tables writes an AuditLog row (who, before, after) in the same transaction, in addition to the
-- business entries the services write. Not on SubjectResult (recalculated in bulk; the service logs the run) or on
-- the append-only tables, which are their own history.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['AssessmentType', 'WeightingPlan', 'WeightingPlanItem', 'WeightingPlanItemType', 'ProjectTemplate', 'ProjectStage',
                           'Rubric', 'RubricCriterion', 'RubricLevel', 'Assessment', 'AssessmentTopic', 'AssessmentMark', 'RubricScore',
                           'MarkEvidence', 'MarkSheet', 'SheetStudentComment', 'ReportComment', 'CommentBankItem', 'ExamSettings',
                           'ExamDeadline', 'ExamDepartmentVerifier'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', 'audit_' || t, t);
  END LOOP;
END $$;

-- ── Same-school references ──────────────────────────────────────────────────
CREATE TRIGGER "same_school_WeightingPlan" BEFORE INSERT OR UPDATE OF "termId", "levelId", "subjectId", "createdById" ON "WeightingPlan"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('termId:AcademicTerm', 'levelId:Level', 'subjectId:Subject', 'createdById:User');
CREATE TRIGGER "same_school_WeightingPlanItem" BEFORE INSERT OR UPDATE OF "planId" ON "WeightingPlanItem"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('planId:WeightingPlan');
CREATE TRIGGER "same_school_WeightingPlanItemType" BEFORE INSERT OR UPDATE OF "itemId", "typeId" ON "WeightingPlanItemType"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('itemId:WeightingPlanItem', 'typeId:AssessmentType');
CREATE TRIGGER "same_school_ProjectTemplate" BEFORE INSERT OR UPDATE OF "subjectId", "levelId", "copiedFromId", "createdById" ON "ProjectTemplate"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('subjectId:Subject', 'levelId:Level', 'copiedFromId:ProjectTemplate', 'createdById:User');
CREATE TRIGGER "same_school_ProjectStage" BEFORE INSERT OR UPDATE OF "templateId" ON "ProjectStage"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('templateId:ProjectTemplate');
CREATE TRIGGER "same_school_Rubric" BEFORE INSERT OR UPDATE OF "stageId" ON "Rubric"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('stageId:ProjectStage');
CREATE TRIGGER "same_school_RubricCriterion" BEFORE INSERT OR UPDATE OF "rubricId" ON "RubricCriterion"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('rubricId:Rubric');
CREATE TRIGGER "same_school_RubricLevel" BEFORE INSERT OR UPDATE OF "criterionId" ON "RubricLevel"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('criterionId:RubricCriterion');
CREATE TRIGGER "same_school_Assessment" BEFORE INSERT OR UPDATE OF "termId", "assignmentId", "levelId", "subjectId", "typeId", "projectId", "copiedFromId", "createdById" ON "Assessment"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('termId:AcademicTerm', 'assignmentId:TeacherAssignment', 'levelId:Level', 'subjectId:Subject', 'typeId:AssessmentType', 'projectId:ProjectTemplate', 'copiedFromId:Assessment', 'createdById:User');
CREATE TRIGGER "same_school_AssessmentTopic" BEFORE INSERT OR UPDATE OF "assessmentId", "topicId" ON "AssessmentTopic"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('assessmentId:Assessment', 'topicId:SyllabusTopic');
CREATE TRIGGER "same_school_AssessmentMark" BEFORE INSERT OR UPDATE OF "assessmentId", "assignmentId", "studentId", "stageId", "enteredById" ON "AssessmentMark"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('assessmentId:Assessment', 'assignmentId:TeacherAssignment', 'studentId:Student', 'stageId:ProjectStage', 'enteredById:User');
CREATE TRIGGER "same_school_RubricScore" BEFORE INSERT OR UPDATE OF "markId", "criterionId", "levelId" ON "RubricScore"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('markId:AssessmentMark', 'criterionId:RubricCriterion', 'levelId:RubricLevel');
CREATE TRIGGER "same_school_MarkEvidence" BEFORE INSERT OR UPDATE OF "markId", "uploadedById" ON "MarkEvidence"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('markId:AssessmentMark', 'uploadedById:User');
CREATE TRIGGER "same_school_AssessmentMarkChange" BEFORE INSERT OR UPDATE OF "markId", "sheetId", "changedById" ON "AssessmentMarkChange"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('markId:AssessmentMark', 'sheetId:MarkSheet', 'changedById:User');
CREATE TRIGGER "same_school_MarkSheet" BEFORE INSERT OR UPDATE OF "assignmentId", "termId", "submittedById", "verifiedById", "returnedById", "unlockedById" ON "MarkSheet"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('assignmentId:TeacherAssignment', 'termId:AcademicTerm', 'submittedById:User', 'verifiedById:User', 'returnedById:User', 'unlockedById:User');
CREATE TRIGGER "same_school_MarkSheetEvent" BEFORE INSERT OR UPDATE OF "sheetId", "actorId" ON "MarkSheetEvent"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('sheetId:MarkSheet', 'actorId:User');
CREATE TRIGGER "same_school_SheetStudentComment" BEFORE INSERT OR UPDATE OF "sheetId", "studentId" ON "SheetStudentComment"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('sheetId:MarkSheet', 'studentId:Student');
CREATE TRIGGER "same_school_SubjectResult" BEFORE INSERT OR UPDATE OF "studentId", "subjectId", "termId", "classId", "levelId", "assignmentId" ON "SubjectResult"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student', 'subjectId:Subject', 'termId:AcademicTerm', 'classId:SchoolClass', 'levelId:Level', 'assignmentId:TeacherAssignment');
CREATE TRIGGER "same_school_ReportComment" BEFORE INSERT OR UPDATE OF "studentId", "termId", "classId", "classTeacherById", "headRemarkById" ON "ReportComment"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student', 'termId:AcademicTerm', 'classId:SchoolClass', 'classTeacherById:User', 'headRemarkById:User');
CREATE TRIGGER "same_school_ExamDeadline" BEFORE INSERT OR UPDATE OF "termId" ON "ExamDeadline"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('termId:AcademicTerm');
CREATE TRIGGER "same_school_ExamDepartmentVerifier" BEFORE INSERT OR UPDATE OF "departmentId", "userId" ON "ExamDepartmentVerifier"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('departmentId:Department', 'userId:User');
CREATE TRIGGER "same_school_ExamSettings" BEFORE INSERT OR UPDATE OF "englishSubjectId", "mathsSubjectId" ON "ExamSettings"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('englishSubjectId:Subject', 'mathsSubjectId:Subject');
CREATE TRIGGER "same_school_TermResult_class" BEFORE INSERT OR UPDATE OF "classId" ON "TermResult"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('classId:SchoolClass');

-- ── A closed term is read-only ──────────────────────────────────────────────
-- Reuses academics_closed_term_guard(): the term a row belongs to must not be CLOSED (the Director can reopen it).
CREATE TRIGGER "closed_term_WeightingPlan" BEFORE INSERT OR UPDATE OR DELETE ON "WeightingPlan"  FOR EACH ROW EXECUTE FUNCTION academics_closed_term_guard();
CREATE TRIGGER "closed_term_Assessment"    BEFORE INSERT OR UPDATE OR DELETE ON "Assessment"     FOR EACH ROW EXECUTE FUNCTION academics_closed_term_guard();
CREATE TRIGGER "closed_term_MarkSheet"     BEFORE INSERT OR UPDATE OR DELETE ON "MarkSheet"      FOR EACH ROW EXECUTE FUNCTION academics_closed_term_guard();
CREATE TRIGGER "closed_term_SubjectResult" BEFORE INSERT OR UPDATE OR DELETE ON "SubjectResult"  FOR EACH ROW EXECUTE FUNCTION academics_closed_term_guard();
CREATE TRIGGER "closed_term_ReportComment" BEFORE INSERT OR UPDATE OR DELETE ON "ReportComment"  FOR EACH ROW EXECUTE FUNCTION academics_closed_term_guard();
CREATE TRIGGER "closed_term_ExamDeadline"  BEFORE INSERT OR UPDATE OR DELETE ON "ExamDeadline"   FOR EACH ROW EXECUTE FUNCTION academics_closed_term_guard();

-- ── Rules the database keeps by itself ──────────────────────────────────────
ALTER TABLE "WeightingPlanItem"
  ADD CONSTRAINT "WeightingPlanItem_weight" CHECK ("weight" > 0 AND "weight" <= 100),
  ADD CONSTRAINT "WeightingPlanItem_best_n" CHECK (("combineRule" = 'BEST_N') = ("bestN" IS NOT NULL) AND ("bestN" IS NULL OR "bestN" >= 1));
ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_max" CHECK ("maxMark" > 0);
ALTER TABLE "RubricLevel" ADD CONSTRAINT "RubricLevel_marks" CHECK ("marks" >= 0);
ALTER TABLE "ProjectTemplate" ADD CONSTRAINT "ProjectTemplate_dates" CHECK ("startDate" IS NULL OR "dueDate" IS NULL OR "dueDate" >= "startDate");
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_max" CHECK ("maxMark" > 0);
ALTER TABLE "AssessmentMark"
  ADD CONSTRAINT "AssessmentMark_value" CHECK ("value" IS NULL OR "value" >= 0),
  ADD CONSTRAINT "AssessmentMark_value_or_code" CHECK ("value" IS NULL OR "code" IS NULL);
ALTER TABLE "AssessmentMarkChange" ADD CONSTRAINT "AssessmentMarkChange_reason" CHECK (btrim("reason") <> '');
ALTER TABLE "MarkSheet"
  ADD CONSTRAINT "MarkSheet_returned_has_comment" CHECK ("status" <> 'RETURNED' OR ("returnedComment" IS NOT NULL AND btrim("returnedComment") <> '')),
  ADD CONSTRAINT "MarkSheet_unlocked_has_reason" CHECK ("status" <> 'UNLOCKED' OR ("unlockReason" IS NOT NULL AND btrim("unlockReason") <> '')),
  ADD CONSTRAINT "MarkSheet_submitted_has_person" CHECK ("status" NOT IN ('SUBMITTED', 'VERIFIED', 'PUBLISHED') OR ("submittedById" IS NOT NULL AND "submittedAt" IS NOT NULL)),
  ADD CONSTRAINT "MarkSheet_verified_has_person" CHECK ("status" NOT IN ('VERIFIED', 'PUBLISHED') OR ("verifiedById" IS NOT NULL AND "verifiedAt" IS NOT NULL));
ALTER TABLE "SheetStudentComment" ADD CONSTRAINT "SheetStudentComment_length" CHECK (char_length("text") BETWEEN 1 AND 300);
ALTER TABLE "CommentBankItem" ADD CONSTRAINT "CommentBankItem_length" CHECK (char_length("text") BETWEEN 1 AND 300);
ALTER TABLE "ReportComment"
  ADD CONSTRAINT "ReportComment_length" CHECK (char_length(coalesce("classTeacherComment", '')) <= 300 AND char_length(coalesce("headRemark", '')) <= 300);
ALTER TABLE "SubjectResult"
  ADD CONSTRAINT "SubjectResult_range" CHECK ("termMark" BETWEEN 0 AND 100 AND "roundedMark" BETWEEN 0 AND 100),
  ADD CONSTRAINT "SubjectResult_positions" CHECK (("classPosition" IS NULL OR "classPosition" >= 1) AND ("formPosition" IS NULL OR "formPosition" >= 1));
ALTER TABLE "ExamSettings"
  ADD CONSTRAINT "ExamSettings_passes" CHECK ("passesRequired" BETWEEN 1 AND 20),
  ADD CONSTRAINT "ExamSettings_sd" CHECK ("outlierSd" > 0);
ALTER TABLE "ExamDeadline"
  ADD CONSTRAINT "ExamDeadline_order" CHECK (("entryDue" IS NULL OR "submitDue" IS NULL OR "entryDue" <= "submitDue")
                                        AND ("submitDue" IS NULL OR "verifyDue" IS NULL OR "submitDue" <= "verifyDue"));
ALTER TABLE "TermResult"
  ADD CONSTRAINT "TermResult_positions_new" CHECK (("formPosition" IS NULL OR "formPosition" >= 1) AND ("aLevelPoints" IS NULL OR "aLevelPoints" >= 0));

-- One level plan, and one plan per subject, per term and level. One mark per student, assessment and stage.
CREATE UNIQUE INDEX "WeightingPlan_one_per_level" ON "WeightingPlan"("termId", "levelId") WHERE "subjectId" IS NULL;
CREATE UNIQUE INDEX "WeightingPlan_one_per_subject" ON "WeightingPlan"("termId", "levelId", "subjectId") WHERE "subjectId" IS NOT NULL;
CREATE UNIQUE INDEX "AssessmentMark_one_per_student" ON "AssessmentMark"("assessmentId", "studentId") WHERE "stageId" IS NULL;
CREATE UNIQUE INDEX "AssessmentMark_one_per_stage" ON "AssessmentMark"("assessmentId", "studentId", "stageId") WHERE "stageId" IS NOT NULL;
-- Publishing and the comment screens look results up by class and term.
CREATE INDEX "SubjectResult_published" ON "SubjectResult"("termId", "published");

-- ── Marks are never deleted; their history and the sheet history only grow ───
CREATE OR REPLACE FUNCTION exams_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;
CREATE OR REPLACE FUNCTION exams_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows can only be added, never changed or deleted', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "no_delete_AssessmentMark" BEFORE DELETE ON "AssessmentMark" FOR EACH ROW EXECUTE FUNCTION exams_no_delete();
CREATE TRIGGER "no_delete_MarkSheet" BEFORE DELETE ON "MarkSheet" FOR EACH ROW EXECUTE FUNCTION exams_no_delete();
CREATE TRIGGER "append_only_AssessmentMarkChange" BEFORE UPDATE OR DELETE ON "AssessmentMarkChange" FOR EACH ROW EXECUTE FUNCTION exams_append_only();
CREATE TRIGGER "append_only_MarkSheetEvent" BEFORE UPDATE OR DELETE ON "MarkSheetEvent" FOR EACH ROW EXECUTE FUNCTION exams_append_only();

-- ── A mark: within its maximum, in an open term, on a sheet that is open for marks ──
-- Sheets that are SUBMITTED, VERIFIED or PUBLISHED are locked. The only way to change a mark on one is the Head's correction
-- (excusing an absence), which sets app.marks_unlock for its own transaction.
CREATE OR REPLACE FUNCTION exams_mark_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  a_max   numeric;
  a_term  text;
  s_max   numeric;
  sheet   "MarkSheetStatus";
  tname   text;
BEGIN
  SELECT "maxMark", "termId" INTO a_max, a_term FROM "Assessment" WHERE "id" = NEW."assessmentId";
  IF NEW."stageId" IS NOT NULL THEN
    SELECT "maxMark" INTO s_max FROM "ProjectStage" WHERE "id" = NEW."stageId";
  END IF;
  IF NEW."value" IS NOT NULL AND NEW."value" > COALESCE(s_max, a_max) THEN
    RAISE EXCEPTION 'A mark cannot be above the maximum mark (%)', COALESCE(s_max, a_max) USING ERRCODE = 'check_violation';
  END IF;

  SELECT "name" INTO tname FROM "AcademicTerm" WHERE "id" = a_term AND "status" = 'CLOSED';
  IF tname IS NOT NULL THEN
    RAISE EXCEPTION '% is closed, so marks cannot be changed', tname USING ERRCODE = 'check_violation';
  END IF;

  -- Nothing about the mark changed (e.g. only its updatedAt): let it through.
  IF TG_OP = 'UPDATE' AND NEW."value" IS NOT DISTINCT FROM OLD."value" AND NEW."code" IS NOT DISTINCT FROM OLD."code" THEN
    RETURN NEW;
  END IF;

  SELECT "status" INTO sheet FROM "MarkSheet" WHERE "assignmentId" = NEW."assignmentId" AND "termId" = a_term;
  IF sheet IN ('SUBMITTED', 'VERIFIED', 'PUBLISHED') AND coalesce(current_setting('app.marks_unlock', true), '') <> '1' THEN
    RAISE EXCEPTION 'This mark sheet is locked (%). Only the Head can open it again.', sheet USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_AssessmentMark" BEFORE INSERT OR UPDATE ON "AssessmentMark" FOR EACH ROW EXECUTE FUNCTION exams_mark_guard();

-- The maximum mark is fixed once a mark (or a code) exists.
CREATE OR REPLACE FUNCTION exams_max_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."maxMark" IS DISTINCT FROM OLD."maxMark" THEN
    IF TG_TABLE_NAME = 'Assessment' AND EXISTS (
      SELECT 1 FROM "AssessmentMark" WHERE "assessmentId" = NEW."id" AND ("value" IS NOT NULL OR "code" IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'The maximum mark cannot change once marks exist. Copy the assessment and enter the marks again.' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_TABLE_NAME = 'ProjectStage' AND EXISTS (
      SELECT 1 FROM "AssessmentMark" WHERE "stageId" = NEW."id" AND ("value" IS NOT NULL OR "code" IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'The maximum mark of a stage cannot change once marks exist.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "max_fixed_Assessment" BEFORE UPDATE OF "maxMark" ON "Assessment" FOR EACH ROW EXECUTE FUNCTION exams_max_fixed();
CREATE TRIGGER "max_fixed_ProjectStage" BEFORE UPDATE OF "maxMark" ON "ProjectStage" FOR EACH ROW EXECUTE FUNCTION exams_max_fixed();

-- ── Nobody verifies their own marks, not even an administrator ──────────────
CREATE OR REPLACE FUNCTION exams_no_self_verify() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  teacher text;
  co      text;
BEGIN
  IF NEW."verifiedById" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."verifiedById" IS DISTINCT FROM OLD."verifiedById") THEN
    SELECT "teacherId", "coTeacherId" INTO teacher, co FROM "TeacherAssignment" WHERE "id" = NEW."assignmentId";
    IF NEW."verifiedById" IN (teacher, co) THEN
      RAISE EXCEPTION 'You cannot verify your own marks. They go to the alternate verifier.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."verifiedById" = NEW."submittedById" THEN
      RAISE EXCEPTION 'The person who submitted a mark sheet cannot verify it.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "no_self_verify_MarkSheet" BEFORE INSERT OR UPDATE OF "verifiedById" ON "MarkSheet" FOR EACH ROW EXECUTE FUNCTION exams_no_self_verify();

-- ── Published results are frozen: they change only through unpublish ────────
CREATE OR REPLACE FUNCTION exams_published_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."published" THEN RAISE EXCEPTION 'Published results cannot be deleted. Unpublish them first.' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."published" AND NEW."published" THEN
    RAISE EXCEPTION 'Published results cannot be changed. Unpublish the class first.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "frozen_SubjectResult" BEFORE UPDATE OR DELETE ON "SubjectResult" FOR EACH ROW EXECUTE FUNCTION exams_published_frozen();
