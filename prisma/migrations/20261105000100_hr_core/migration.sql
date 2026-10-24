-- CreateEnum
CREATE TYPE "HrEmployer" AS ENUM ('GOVERNMENT', 'SCHOOL');

-- CreateEnum
CREATE TYPE "EmployeeCategory" AS ENUM ('TEACHING', 'ADMINISTRATION', 'ANCILLARY', 'BOARDING', 'SECURITY', 'GROUNDS');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED');

-- CreateEnum
CREATE TYPE "EmployeeExitReason" AS ENUM ('RESIGNATION', 'END_OF_CONTRACT', 'RETIREMENT', 'DISMISSAL', 'DEATH');

-- CreateEnum
CREATE TYPE "ContractKind" AS ENUM ('PERMANENT', 'FIXED_TERM', 'TEMPORARY', 'CASUAL');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "VacancyStatus" AS ENUM ('OPEN', 'CLOSED', 'FILLED');

-- CreateEnum
CREATE TYPE "ApplicantStage" AS ENUM ('APPLIED', 'SHORTLISTED', 'INTERVIEWED', 'OFFERED', 'HIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StaffAttStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'ON_LEAVE', 'OFFICIAL_DUTY', 'HALF_DAY');

-- CreateEnum
CREATE TYPE "StaffAttMethod" AS ENUM ('OFFICE', 'SELF', 'TABLET');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RosterStatus" AS ENUM ('DRAFT', 'APPROVED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'DECLINED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HrPayMethod" AS ENUM ('BANK', 'ECOCASH', 'CASH');

-- CreateEnum
CREATE TYPE "PayBasis" AS ENUM ('MONTHLY', 'DAILY', 'HOURLY');

-- CreateEnum
CREATE TYPE "ComponentKind" AS ENUM ('ALLOWANCE', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "HrPayrollStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'RETURNED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'REPAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChangeGroup" AS ENUM ('DETAILS', 'BANK', 'NEXT_OF_KIN');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'HR_APPROVED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DisciplineOutcome" AS ENUM ('VERBAL_WARNING', 'WRITTEN_WARNING', 'FINAL_WARNING', 'SUSPENSION', 'DISMISSAL', 'NO_ACTION');

-- CreateEnum
CREATE TYPE "SensitiveKind" AS ENUM ('SALARY', 'PAYSLIP', 'BANK', 'NATIONAL_ID', 'MEDICAL', 'DISCIPLINE');

-- the enum.




-- DropIndex
DROP INDEX "PayrollRun_schoolId_period_key";

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "hrRunId" TEXT;

-- CreateTable
CREATE TABLE "HrSequence" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "HrSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSettings" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "lateAfter" TEXT NOT NULL DEFAULT '07:30',
    "signInFrom" TEXT NOT NULL DEFAULT '05:30',
    "signInUntil" TEXT NOT NULL DEFAULT '12:00',
    "officeRegister" BOOLEAN NOT NULL DEFAULT true,
    "selfSignIn" BOOLEAN NOT NULL DEFAULT false,
    "tabletSignIn" BOOLEAN NOT NULL DEFAULT false,
    "signOutRequired" BOOLEAN NOT NULL DEFAULT false,
    "wifiOnly" BOOLEAN NOT NULL DEFAULT false,
    "leaveDelegateUserId" TEXT,
    "payrollZigPerUsd" INTEGER,
    "netChangeFlagPct" INTEGER NOT NULL DEFAULT 10,
    "payeDueDay" INTEGER NOT NULL DEFAULT 10,
    "nssaDueDay" INTEGER NOT NULL DEFAULT 15,
    "zimdefDueDay" INTEGER NOT NULL DEFAULT 15,
    "absentAlertDays" INTEGER NOT NULL DEFAULT 3,
    "contractReminderDays" INTEGER[] DEFAULT ARRAY[60, 30]::INTEGER[],
    "workingWeekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT,
    "firstName" TEXT NOT NULL,
    "surname" TEXT NOT NULL,
    "gender" "Gender",
    "dateOfBirth" DATE,
    "nationalId" TEXT,
    "medicalNotes" TEXT,
    "nationality" TEXT,
    "maritalStatus" TEXT,
    "homeAddress" TEXT,
    "personalPhone" TEXT,
    "personalEmail" TEXT,
    "workPhone" TEXT,
    "photoKey" TEXT,
    "jobTitle" TEXT NOT NULL,
    "departmentId" TEXT,
    "category" "EmployeeCategory" NOT NULL DEFAULT 'ANCILLARY',
    "employer" "HrEmployer" NOT NULL DEFAULT 'SCHOOL',
    "ecNumber" TEXT,
    "postedOn" DATE,
    "startDate" DATE NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "lineManagerId" TEXT,
    "postId" TEXT,
    "leavingDate" DATE,
    "leavingReason" "EmployeeExitReason",
    "tabletPinHash" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeNextOfKin" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeNextOfKin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeQualification" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'QUALIFICATION',
    "title" TEXT NOT NULL,
    "institution" TEXT,
    "year" INTEGER,
    "documentKey" TEXT,
    "expiresOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reference" TEXT,
    "body" TEXT,
    "fileKey" TEXT,
    "expiresOn" DATE,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeHistory" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "effectiveDate" DATE NOT NULL,
    "changedById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeChangeRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "group" "ChangeGroup" NOT NULL,
    "changes" JSONB NOT NULL,
    "reason" TEXT,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "hrDecidedById" TEXT,
    "hrDecidedAt" TIMESTAMP(3),
    "ownerDecidedById" TEXT,
    "ownerDecidedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectionReason" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSensitiveView" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "kind" "SensitiveKind" NOT NULL,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrSensitiveView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffDisciplinary" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "incidentDate" DATE NOT NULL,
    "hearingDate" DATE,
    "panel" TEXT,
    "outcome" "DisciplineOutcome",
    "appeal" TEXT,
    "documentKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffDisciplinary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" TEXT,
    "category" "EmployeeCategory" NOT NULL DEFAULT 'ANCILLARY',
    "employer" "HrEmployer" NOT NULL DEFAULT 'SCHOOL',
    "count" INTEGER NOT NULL DEFAULT 1,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "monthlyCostCents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" "PostStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "headApprovedById" TEXT,
    "headApprovedAt" TIMESTAMP(3),
    "ownerApprovedById" TEXT,
    "ownerApprovedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectedById" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vacancy" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "requirements" TEXT,
    "closingDate" DATE NOT NULL,
    "status" "VacancyStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vacancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Applicant" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "cvKey" TEXT,
    "qualifications" TEXT,
    "notes" TEXT,
    "stage" "ApplicantStage" NOT NULL DEFAULT 'APPLIED',
    "rejectionReason" TEXT,
    "hiredEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Applicant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewScore" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "panelistId" TEXT NOT NULL,
    "criterion" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "recommendation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "ContractKind" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "probationEnd" DATE,
    "jobTitle" TEXT NOT NULL,
    "gradeId" TEXT,
    "terms" JSONB,
    "fileKey" TEXT,
    "signedFileKey" TEXT,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "previousContractId" TEXT,
    "terminatedOn" DATE,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeExit" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reason" "EmployeeExitReason" NOT NULL,
    "lastDay" DATE NOT NULL,
    "noticeServed" BOOLEAN NOT NULL DEFAULT false,
    "finalPay" JSONB,
    "clearance" JSONB,
    "certificateRef" TEXT,
    "processedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeExit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAttendance" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "StaffAttStatus" NOT NULL,
    "arrivalTime" TEXT,
    "departureTime" TEXT,
    "method" "StaffAttMethod" NOT NULL DEFAULT 'OFFICE',
    "note" TEXT,
    "markedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAttendanceChange" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "oldStatus" TEXT,
    "newStatus" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAttendanceChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "daysPerYear" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accruesMonthly" BOOLEAN NOT NULL DEFAULT false,
    "carryOverMax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fullPayDays" DOUBLE PRECISION,
    "halfPayDays" DOUBLE PRECISION,
    "certificateAfterDays" INTEGER,
    "requiresAttachment" BOOLEAN NOT NULL DEFAULT false,
    "deductsBalance" BOOLEAN NOT NULL DEFAULT true,
    "unpaid" BOOLEAN NOT NULL DEFAULT false,
    "calendarDays" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveBalance" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "carriedOver" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjusted" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveAdjustment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "adjustedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "startHalfDay" BOOLEAN NOT NULL DEFAULT false,
    "endHalfDay" BOOLEAN NOT NULL DEFAULT false,
    "days" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "attachmentKey" TEXT,
    "handoverNotes" TEXT,
    "coverEmployeeId" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "recordOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyType" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "wholeDay" BOOLEAN NOT NULL DEFAULT false,
    "eligibleCategories" "EmployeeCategory"[] DEFAULT ARRAY[]::"EmployeeCategory"[],
    "perDay" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DutyType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyRoster" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "RosterStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DutyRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyAssignment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "dutyTypeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "employeeId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DutyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutySwap" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "fromEmployeeId" TEXT NOT NULL,
    "toEmployeeId" TEXT NOT NULL,
    "status" "SwapStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DutySwap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayGrade" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "basicUsdCents" INTEGER NOT NULL DEFAULT 0,
    "basicZigCents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePay" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "gradeId" TEXT,
    "payBasis" "PayBasis" NOT NULL DEFAULT 'MONTHLY',
    "basicUsdCents" INTEGER NOT NULL DEFAULT 0,
    "basicZigCents" INTEGER NOT NULL DEFAULT 0,
    "splitUsdBps" INTEGER,
    "splitTotalUsdCents" INTEGER,
    "rateCents" INTEGER,
    "rateCurrency" "Currency",
    "paymentMethod" "HrPayMethod" NOT NULL DEFAULT 'BANK',
    "bankName" TEXT,
    "bankBranch" TEXT,
    "accountNumber" TEXT,
    "ecocashNumber" TEXT,
    "zimraTaxNo" TEXT,
    "nssaNo" TEXT,
    "medicalAidNo" TEXT,
    "pensionNo" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeePay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayComponent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ComponentKind" NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "variable" BOOLEAN NOT NULL DEFAULT false,
    "defaultAmountCents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePayComponent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "childStudentId" TEXT,
    "consentKey" TEXT,
    "consentAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeePayComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "principalCents" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "instalmentCents" INTEGER NOT NULL,
    "balanceCents" INTEGER NOT NULL,
    "startMonth" TEXT NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxTable" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "note" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxBand" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "fromCents" INTEGER NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatutoryRate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "aidsLevyBps" INTEGER NOT NULL,
    "nssaEmployeeBps" INTEGER NOT NULL,
    "nssaEmployerBps" INTEGER NOT NULL,
    "nssaCeilingUsdCents" INTEGER,
    "nssaCeilingZigCents" INTEGER,
    "nssaDeductibleBeforePaye" BOOLEAN NOT NULL DEFAULT false,
    "zimdefBps" INTEGER NOT NULL,
    "note" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatutoryRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPayrollRun" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" "HrPayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidById" TEXT,
    "paidAt" TIMESTAMP(3),
    "returnedById" TEXT,
    "returnComment" TEXT,
    "reopenedById" TEXT,
    "reopenReason" TEXT,
    "totals" JSONB,
    "financeRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrPayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPayrollVariable" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "units" DOUBLE PRECISION,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrPayrollVariable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPayrollLine" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "departmentId" TEXT,
    "earnings" JSONB NOT NULL,
    "deductions" JSONB NOT NULL,
    "grossCents" INTEGER NOT NULL,
    "taxableCents" INTEGER NOT NULL,
    "payeCents" INTEGER NOT NULL,
    "aidsLevyCents" INTEGER NOT NULL,
    "nssaEmployeeCents" INTEGER NOT NULL,
    "nssaEmployerCents" INTEGER NOT NULL,
    "zimdefCents" INTEGER NOT NULL,
    "netCents" INTEGER NOT NULL,
    "previousNetCents" INTEGER,
    "flags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrPayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "fileKey" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrSequence_schoolId_key_key" ON "HrSequence"("schoolId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "HrSettings_schoolId_key" ON "HrSettings"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_schoolId_status_idx" ON "Employee"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Employee_schoolId_employer_idx" ON "Employee"("schoolId", "employer");

-- CreateIndex
CREATE INDEX "Employee_schoolId_departmentId_idx" ON "Employee"("schoolId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_schoolId_employeeNo_key" ON "Employee"("schoolId", "employeeNo");

-- CreateIndex
CREATE INDEX "EmployeeNextOfKin_schoolId_employeeId_idx" ON "EmployeeNextOfKin"("schoolId", "employeeId");

-- CreateIndex
CREATE INDEX "EmployeeQualification_schoolId_employeeId_idx" ON "EmployeeQualification"("schoolId", "employeeId");

-- CreateIndex
CREATE INDEX "EmployeeDocument_schoolId_employeeId_idx" ON "EmployeeDocument"("schoolId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDocument_schoolId_reference_key" ON "EmployeeDocument"("schoolId", "reference");

-- CreateIndex
CREATE INDEX "EmployeeHistory_schoolId_employeeId_createdAt_idx" ON "EmployeeHistory"("schoolId", "employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "EmployeeChangeRequest_schoolId_status_idx" ON "EmployeeChangeRequest"("schoolId", "status");

-- CreateIndex
CREATE INDEX "EmployeeChangeRequest_employeeId_idx" ON "EmployeeChangeRequest"("employeeId");

-- CreateIndex
CREATE INDEX "HrSensitiveView_schoolId_employeeId_createdAt_idx" ON "HrSensitiveView"("schoolId", "employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "StaffDisciplinary_schoolId_employeeId_idx" ON "StaffDisciplinary"("schoolId", "employeeId");

-- CreateIndex
CREATE INDEX "Post_schoolId_status_idx" ON "Post"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Vacancy_schoolId_status_idx" ON "Vacancy"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Applicant_schoolId_vacancyId_stage_idx" ON "Applicant"("schoolId", "vacancyId", "stage");

-- CreateIndex
CREATE INDEX "InterviewScore_schoolId_applicantId_idx" ON "InterviewScore"("schoolId", "applicantId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewScore_applicantId_panelistId_criterion_key" ON "InterviewScore"("applicantId", "panelistId", "criterion");

-- CreateIndex
CREATE INDEX "Contract_schoolId_employeeId_idx" ON "Contract"("schoolId", "employeeId");

-- CreateIndex
CREATE INDEX "Contract_schoolId_status_endDate_idx" ON "Contract"("schoolId", "status", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeExit_employeeId_key" ON "EmployeeExit"("employeeId");

-- CreateIndex
CREATE INDEX "StaffAttendance_schoolId_date_idx" ON "StaffAttendance"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAttendance_employeeId_date_key" ON "StaffAttendance"("employeeId", "date");

-- CreateIndex
CREATE INDEX "StaffAttendanceChange_schoolId_employeeId_date_idx" ON "StaffAttendanceChange"("schoolId", "employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_schoolId_code_key" ON "LeaveType"("schoolId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalance_employeeId_leaveTypeId_year_key" ON "LeaveBalance"("employeeId", "leaveTypeId", "year");

-- CreateIndex
CREATE INDEX "LeaveAdjustment_schoolId_employeeId_year_idx" ON "LeaveAdjustment"("schoolId", "employeeId", "year");

-- CreateIndex
CREATE INDEX "LeaveRequest_schoolId_status_idx" ON "LeaveRequest"("schoolId", "status");

-- CreateIndex
CREATE INDEX "LeaveRequest_schoolId_employeeId_startDate_idx" ON "LeaveRequest"("schoolId", "employeeId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "DutyType_schoolId_name_key" ON "DutyType"("schoolId", "name");

-- CreateIndex
CREATE INDEX "DutyRoster_schoolId_startDate_idx" ON "DutyRoster"("schoolId", "startDate");

-- CreateIndex
CREATE INDEX "DutyAssignment_schoolId_employeeId_date_idx" ON "DutyAssignment"("schoolId", "employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DutyAssignment_rosterId_dutyTypeId_date_employeeId_key" ON "DutyAssignment"("rosterId", "dutyTypeId", "date", "employeeId");

-- CreateIndex
CREATE INDEX "DutySwap_schoolId_status_idx" ON "DutySwap"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayGrade_schoolId_code_key" ON "PayGrade"("schoolId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePay_employeeId_key" ON "EmployeePay"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayComponent_schoolId_code_key" ON "PayComponent"("schoolId", "code");

-- CreateIndex
CREATE INDEX "EmployeePayComponent_schoolId_employeeId_idx" ON "EmployeePayComponent"("schoolId", "employeeId");

-- CreateIndex
CREATE INDEX "Loan_schoolId_employeeId_status_idx" ON "Loan"("schoolId", "employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaxTable_schoolId_currency_effectiveFrom_key" ON "TaxTable"("schoolId", "currency", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TaxBand_tableId_fromCents_key" ON "TaxBand"("tableId", "fromCents");

-- CreateIndex
CREATE UNIQUE INDEX "StatutoryRate_schoolId_effectiveFrom_key" ON "StatutoryRate"("schoolId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "HrPayrollRun_schoolId_status_idx" ON "HrPayrollRun"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HrPayrollRun_schoolId_month_key" ON "HrPayrollRun"("schoolId", "month");

-- CreateIndex
CREATE INDEX "HrPayrollVariable_schoolId_runId_employeeId_idx" ON "HrPayrollVariable"("schoolId", "runId", "employeeId");

-- CreateIndex
CREATE INDEX "HrPayrollLine_schoolId_runId_idx" ON "HrPayrollLine"("schoolId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "HrPayrollLine_runId_employeeId_currency_key" ON "HrPayrollLine"("runId", "employeeId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_verificationCode_key" ON "Payslip"("verificationCode");

-- CreateIndex
CREATE INDEX "Payslip_schoolId_employeeId_idx" ON "Payslip"("schoolId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_runId_employeeId_key" ON "Payslip"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollRun_schoolId_period_idx" ON "PayrollRun"("schoolId", "period");


-- A live Finance hand-over per month; a cancelled one (the Owner reopened the HR run before anything was paid) does not count.
CREATE UNIQUE INDEX "PayrollRun_schoolId_period_live_key" ON "PayrollRun"("schoolId", "period") WHERE "status" <> 'CANCELLED';


-- ═════════════════════════════════════════════════════════════════════════════
-- HR & Staff core: foreign keys, permissions, row-level security, audit, same-school references and the rules the database keeps
-- by itself:
--   * staff records are never deleted; history, attendance changes, leave adjustments, sensitive-view logs and statutory settings
--     are only ever added to;
--   * government-paid employees never get pay set-up or a payroll line;
--   * a payroll run goes DRAFT -> SUBMITTED -> APPROVED -> PAID (or RETURNED / reopened by the Owner); the person who prepared it
--     cannot approve it or mark it paid; once submitted its lines and variables cannot change;
--   * nobody approves their own leave; a rejection needs a reason;
--   * a contract has dates that make sense; fixed-term and temporary contracts have an end date;
--   * payslips are released only when the run is paid.
-- (Existing staff users become employees in the next migration.)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Foreign keys that the Prisma schema keeps as plain ids ──────────────────
DO $$
DECLARE t text; spec text; tab text; col text; ref text;
BEGIN
  FOREACH t IN ARRAY ARRAY['HrSequence', 'HrSettings', 'Employee', 'EmployeeNextOfKin', 'EmployeeQualification', 'EmployeeDocument', 'EmployeeHistory',
    'EmployeeChangeRequest', 'HrSensitiveView', 'StaffDisciplinary', 'Post', 'Vacancy', 'Applicant', 'InterviewScore', 'Contract', 'EmployeeExit',
    'StaffAttendance', 'StaffAttendanceChange', 'LeaveType', 'LeaveBalance', 'LeaveAdjustment', 'LeaveRequest', 'DutyType', 'DutyRoster',
    'DutyAssignment', 'DutySwap', 'PayGrade', 'EmployeePay', 'PayComponent', 'EmployeePayComponent', 'Loan', 'TaxTable', 'TaxBand', 'StatutoryRate',
    'HrPayrollRun', 'HrPayrollVariable', 'HrPayrollLine', 'Payslip'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE', t, t || '_schoolId_fkey');
  END LOOP;
  -- column -> referenced table
  FOREACH spec IN ARRAY ARRAY[
    'Employee.userId:User', 'Employee.createdById:User', 'Employee.departmentId:Department', 'Employee.lineManagerId:Employee', 'Employee.postId:Post',
    'EmployeeNextOfKin.employeeId:Employee', 'EmployeeQualification.employeeId:Employee', 'EmployeeDocument.employeeId:Employee', 'EmployeeDocument.uploadedById:User',
    'EmployeeHistory.employeeId:Employee', 'EmployeeHistory.changedById:User',
    'EmployeeChangeRequest.employeeId:Employee', 'EmployeeChangeRequest.requestedById:User', 'EmployeeChangeRequest.hrDecidedById:User',
    'EmployeeChangeRequest.ownerDecidedById:User', 'EmployeeChangeRequest.rejectedById:User',
    'HrSensitiveView.employeeId:Employee', 'HrSensitiveView.viewerId:User', 'StaffDisciplinary.employeeId:Employee', 'StaffDisciplinary.recordedById:User',
    'Post.departmentId:Department', 'Post.requestedById:User', 'Post.headApprovedById:User', 'Post.ownerApprovedById:User', 'Post.approvedById:User', 'Post.rejectedById:User',
    'Vacancy.postId:Post', 'Vacancy.createdById:User', 'Applicant.vacancyId:Vacancy', 'Applicant.hiredEmployeeId:Employee',
    'InterviewScore.applicantId:Applicant', 'InterviewScore.panelistId:User',
    'Contract.employeeId:Employee', 'Contract.gradeId:PayGrade', 'Contract.previousContractId:Contract', 'Contract.createdById:User',
    'EmployeeExit.employeeId:Employee', 'EmployeeExit.processedById:User',
    'StaffAttendance.employeeId:Employee', 'StaffAttendance.markedById:User', 'StaffAttendanceChange.employeeId:Employee', 'StaffAttendanceChange.changedById:User',
    'LeaveBalance.employeeId:Employee', 'LeaveBalance.leaveTypeId:LeaveType', 'LeaveAdjustment.employeeId:Employee', 'LeaveAdjustment.leaveTypeId:LeaveType',
    'LeaveAdjustment.adjustedById:User', 'LeaveRequest.employeeId:Employee', 'LeaveRequest.leaveTypeId:LeaveType', 'LeaveRequest.coverEmployeeId:Employee',
    'LeaveRequest.requestedById:User', 'LeaveRequest.approvedById:User',
    'DutyRoster.createdById:User', 'DutyRoster.approvedById:User', 'DutyAssignment.rosterId:DutyRoster', 'DutyAssignment.dutyTypeId:DutyType',
    'DutyAssignment.employeeId:Employee', 'DutySwap.assignmentId:DutyAssignment', 'DutySwap.fromEmployeeId:Employee', 'DutySwap.toEmployeeId:Employee',
    'DutySwap.confirmedById:User',
    'EmployeePay.employeeId:Employee', 'EmployeePay.gradeId:PayGrade', 'EmployeePayComponent.employeeId:Employee', 'EmployeePayComponent.componentId:PayComponent',
    'EmployeePayComponent.childStudentId:Student', 'Loan.employeeId:Employee', 'Loan.createdById:User',
    'TaxTable.confirmedById:User', 'TaxTable.createdById:User', 'TaxBand.tableId:TaxTable', 'StatutoryRate.confirmedById:User', 'StatutoryRate.createdById:User',
    'HrPayrollRun.preparedById:User', 'HrPayrollRun.approvedById:User', 'HrPayrollRun.paidById:User', 'HrPayrollRun.returnedById:User', 'HrPayrollRun.reopenedById:User',
    'HrPayrollVariable.runId:HrPayrollRun', 'HrPayrollVariable.employeeId:Employee', 'HrPayrollVariable.createdById:User',
    'HrPayrollLine.runId:HrPayrollRun', 'HrPayrollLine.employeeId:Employee', 'Payslip.runId:HrPayrollRun', 'Payslip.employeeId:Employee'
  ] LOOP
    tab := split_part(split_part(spec, '.', 1), ':', 1);
    col := split_part(split_part(spec, '.', 2), ':', 1);
    ref := split_part(spec, ':', 2);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I("id") ON DELETE RESTRICT ON UPDATE CASCADE', tab, tab || '_' || col || '_fkey', col, ref);
  END LOOP;
END $$;

-- ── Permission keys ─────────────────────────────────────────────────────────
INSERT INTO "Permission" ("key", "module", "description") VALUES
  ('hr.directory.view',      'hr', 'See the staff directory (names, titles, departments, work phone)'),
  ('hr.employees.view',      'hr', 'See full staff records'),
  ('hr.employees.manage',    'hr', 'Add and change staff records'),
  ('hr.pay.view',            'hr', 'See salaries, bank details, ID numbers and medical notes'),
  ('hr.pay.manage',          'hr', 'Change pay set-up'),
  ('hr.posts.manage',        'hr', 'Ask for new posts'),
  ('hr.posts.approve',       'hr', 'Approve new posts'),
  ('hr.recruitment.manage',  'hr', 'Run vacancies and applicants'),
  ('hr.contracts.manage',    'hr', 'Manage contracts and end employment'),
  ('hr.attendance.mark',     'hr', 'Mark the staff register'),
  ('hr.attendance.view',     'hr', 'See staff attendance'),
  ('hr.attendance.correct',  'hr', 'Correct staff attendance after the day'),
  ('hr.attendance.self',     'hr', 'Sign myself in'),
  ('hr.leave.request',       'hr', 'Request my own leave'),
  ('hr.leave.approve',       'hr', 'Approve or reject leave'),
  ('hr.leave.view_all',      'hr', 'See every leave request and balance'),
  ('hr.leave.adjust',        'hr', 'Adjust leave balances'),
  ('hr.duties.manage',       'hr', 'Build the duty roster'),
  ('hr.duties.approve',      'hr', 'Approve and publish the duty roster'),
  ('hr.duties.view',         'hr', 'See the duty roster'),
  ('hr.payroll.prepare',     'hr', 'Prepare and submit payroll runs'),
  ('hr.payroll.approve',     'hr', 'Approve payroll runs'),
  ('hr.payroll.view',        'hr', 'See payroll runs'),
  ('hr.payroll.settings',    'hr', 'Change tax tables and statutory rates'),
  ('hr.documents.manage',    'hr', 'Generate letters and keep staff documents'),
  ('hr.discipline.manage',   'hr', 'Record staff disciplinary cases'),
  ('hr.discipline.view',     'hr', 'See staff disciplinary records'),
  ('hr.self.payslips',       'hr', 'See my own payslips'),
  ('hr.self.leave',          'hr', 'See my own leave'),
  ('hr.self.details',        'hr', 'See my own details and duties'),
  ('hr.reports.view',        'hr', 'See HR reports'),
  ('hr.staff.view',          'hr', 'View staff records'),
  ('hr.leave.view',          'hr', 'View leave')
ON CONFLICT ("key") DO NOTHING;

CREATE OR REPLACE FUNCTION hr_role_keys(role_key text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['hr.self.payslips', 'hr.self.leave', 'hr.self.details', 'hr.leave.request', 'hr.attendance.self'] || (CASE role_key
    WHEN 'HEAD' THEN ARRAY['hr.directory.view', 'hr.employees.view', 'hr.staff.view', 'hr.posts.approve', 'hr.leave.approve', 'hr.leave.view_all', 'hr.leave.view',
                           'hr.attendance.view', 'hr.duties.approve', 'hr.duties.view', 'hr.discipline.view', 'hr.reports.view']
    WHEN 'DEPUTY_HEAD' THEN ARRAY['hr.directory.view', 'hr.attendance.view', 'hr.attendance.mark', 'hr.duties.manage', 'hr.duties.view', 'hr.leave.approve', 'hr.leave.view']
    WHEN 'HR_OFFICER' THEN ARRAY['hr.directory.view', 'hr.employees.view', 'hr.employees.manage', 'hr.staff.view', 'hr.pay.view', 'hr.pay.manage', 'hr.posts.manage',
                                 'hr.recruitment.manage', 'hr.contracts.manage', 'hr.attendance.mark', 'hr.attendance.view', 'hr.attendance.correct',
                                 'hr.leave.view_all', 'hr.leave.view', 'hr.leave.adjust', 'hr.duties.view', 'hr.payroll.prepare', 'hr.payroll.view',
                                 'hr.payroll.settings', 'hr.documents.manage', 'hr.discipline.manage', 'hr.discipline.view', 'hr.reports.view']
    WHEN 'BURSAR' THEN ARRAY['hr.payroll.settings']
    WHEN 'HOD' THEN ARRAY['hr.directory.view', 'hr.duties.view']
    WHEN 'BOARDING_MASTER' THEN ARRAY['hr.duties.view']
    ELSE ARRAY[]::text[]
  END)
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
           ELSE ARRAY['system.dashboard.view', 'system.calendar.view'] || academics_role_keys(rd."key") || exams_role_keys(rd."key") || finance_role_keys(rd."key") || hr_role_keys(rd."key") END) AS p(k)
   WHERE rd."schoolId" = sid
  ON CONFLICT ("roleId", "permissionKey") DO NOTHING;
END;
$$;

-- Roles that already exist get the keys (RolePermission's updatedAt has no default).
INSERT INTO "RolePermission" ("id", "schoolId", "roleId", "permissionKey", "updatedAt")
SELECT gen_random_uuid()::text, rd."schoolId", rd."id", k, CURRENT_TIMESTAMP
  FROM "RoleDefinition" rd CROSS JOIN LATERAL unnest(hr_role_keys(rd."key")) AS k
ON CONFLICT ("roleId", "permissionKey") DO NOTHING;

-- ── Which module an audit entry belongs to ──────────────────────────────────
-- (the earlier definition, with the HR tables added)
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('audit_module(text)'::regprocedure) INTO def;
  def := replace(def, 'WHEN entity IN (''Asset'',', 'WHEN entity IN (''Employee'', ''EmployeeNextOfKin'', ''EmployeeQualification'', ''EmployeeDocument'', ''EmployeeHistory'', ''EmployeeChangeRequest'', ''HrSensitiveView'', ''StaffDisciplinary'', ''Post'', ''Vacancy'', ''Applicant'', ''InterviewScore'', ''Contract'', ''EmployeeExit'', ''StaffAttendance'', ''StaffAttendanceChange'', ''LeaveType'', ''LeaveBalance'', ''LeaveAdjustment'', ''LeaveRequest'', ''DutyType'', ''DutyRoster'', ''DutyAssignment'', ''DutySwap'', ''PayGrade'', ''EmployeePay'', ''PayComponent'', ''EmployeePayComponent'', ''Loan'', ''TaxTable'', ''TaxBand'', ''StatutoryRate'', ''HrPayrollRun'', ''HrPayrollVariable'', ''HrPayrollLine'', ''Payslip'', ''HrSettings'', ''HrSequence'') THEN ''hr''
    WHEN entity IN (''Asset'',');
  EXECUTE def;
END $$;

-- ── Row-level security and the row-change audit ─────────────────────────────
-- The columns that hold an ID number, medical notes, a PIN or bank details are left out of the row-change audit: the audit log is
-- readable by people who must not see them. (Who changed pay or bank details, and the before and after, is kept by the services in
-- EmployeeHistory, which is itself only visible to people who may see pay.)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['HrSequence', 'HrSettings', 'EmployeeNextOfKin', 'EmployeeQualification', 'EmployeeDocument', 'EmployeeHistory',
    'EmployeeChangeRequest', 'HrSensitiveView', 'StaffDisciplinary', 'Post', 'Vacancy', 'Applicant', 'InterviewScore', 'Contract', 'EmployeeExit',
    'StaffAttendance', 'StaffAttendanceChange', 'LeaveType', 'LeaveBalance', 'LeaveAdjustment', 'LeaveRequest', 'DutyType', 'DutyRoster',
    'DutyAssignment', 'DutySwap', 'PayGrade', 'PayComponent', 'EmployeePayComponent', 'Loan', 'TaxTable', 'TaxBand', 'StatutoryRate',
    'HrPayrollRun', 'HrPayrollVariable', 'HrPayrollLine', 'Payslip', 'Employee', 'EmployeePay'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY school_isolation ON %I USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"))', t);
    IF t NOT IN ('Employee', 'EmployeePay', 'HrSequence', 'HrSensitiveView', 'EmployeeChangeRequest') THEN
      EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', 'audit_' || t, t);
    END IF;
  END LOOP;
END $$;
CREATE TRIGGER "audit_Employee" AFTER INSERT OR UPDATE OR DELETE ON "Employee" FOR EACH ROW EXECUTE FUNCTION audit_row_change('nationalId', 'medicalNotes', 'tabletPinHash');
CREATE TRIGGER "audit_EmployeePay" AFTER INSERT OR UPDATE OR DELETE ON "EmployeePay"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('bankName', 'bankBranch', 'accountNumber', 'ecocashNumber', 'zimraTaxNo', 'nssaNo', 'medicalAidNo', 'pensionNo', 'basicUsdCents', 'basicZigCents', 'splitUsdBps', 'splitTotalUsdCents', 'rateCents');
CREATE TRIGGER "audit_EmployeeChangeRequest" AFTER INSERT OR UPDATE OR DELETE ON "EmployeeChangeRequest" FOR EACH ROW EXECUTE FUNCTION audit_row_change('changes');

-- ── Same-school references ──────────────────────────────────────────────────
DO $$
DECLARE r record; cols text; args text;
BEGIN
  FOR r IN SELECT split_part(x, '|', 1) AS t, split_part(x, '|', 2) AS refs FROM unnest(ARRAY[
    'Employee|userId:User,createdById:User,departmentId:Department,lineManagerId:Employee,postId:Post',
    'EmployeeNextOfKin|employeeId:Employee', 'EmployeeQualification|employeeId:Employee', 'EmployeeDocument|employeeId:Employee,uploadedById:User',
    'EmployeeHistory|employeeId:Employee,changedById:User',
    'EmployeeChangeRequest|employeeId:Employee,requestedById:User,hrDecidedById:User,ownerDecidedById:User,rejectedById:User',
    'HrSensitiveView|employeeId:Employee,viewerId:User', 'StaffDisciplinary|employeeId:Employee,recordedById:User',
    'Post|departmentId:Department,requestedById:User,headApprovedById:User,ownerApprovedById:User,approvedById:User,rejectedById:User',
    'Vacancy|postId:Post,createdById:User', 'Applicant|vacancyId:Vacancy,hiredEmployeeId:Employee', 'InterviewScore|applicantId:Applicant,panelistId:User',
    'Contract|employeeId:Employee,gradeId:PayGrade,previousContractId:Contract,createdById:User', 'EmployeeExit|employeeId:Employee,processedById:User',
    'StaffAttendance|employeeId:Employee,markedById:User', 'StaffAttendanceChange|employeeId:Employee,changedById:User',
    'LeaveBalance|employeeId:Employee,leaveTypeId:LeaveType', 'LeaveAdjustment|employeeId:Employee,leaveTypeId:LeaveType,adjustedById:User',
    'LeaveRequest|employeeId:Employee,leaveTypeId:LeaveType,coverEmployeeId:Employee,requestedById:User,approvedById:User',
    'DutyRoster|createdById:User,approvedById:User', 'DutyAssignment|rosterId:DutyRoster,dutyTypeId:DutyType,employeeId:Employee',
    'DutySwap|assignmentId:DutyAssignment,fromEmployeeId:Employee,toEmployeeId:Employee,confirmedById:User',
    'EmployeePay|employeeId:Employee,gradeId:PayGrade', 'EmployeePayComponent|employeeId:Employee,componentId:PayComponent,childStudentId:Student',
    'Loan|employeeId:Employee,createdById:User', 'TaxTable|confirmedById:User,createdById:User', 'TaxBand|tableId:TaxTable',
    'StatutoryRate|confirmedById:User,createdById:User',
    'HrPayrollRun|preparedById:User,approvedById:User,paidById:User,returnedById:User,reopenedById:User',
    'HrPayrollVariable|runId:HrPayrollRun,employeeId:Employee,createdById:User', 'HrPayrollLine|runId:HrPayrollRun,employeeId:Employee',
    'Payslip|runId:HrPayrollRun,employeeId:Employee'
  ]) AS x LOOP
    SELECT string_agg(quote_ident(split_part(c, ':', 1)), ', '), string_agg(quote_literal(c), ', ') INTO cols, args FROM unnest(string_to_array(r.refs, ',')) AS c;
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %s ON %I FOR EACH ROW EXECUTE FUNCTION check_same_school(%s)', 'same_school_' || r.t, cols, r.t, args);
  END LOOP;
END $$;

-- ── Checks ──────────────────────────────────────────────────────────────────
ALTER TABLE "Employee"
  ADD CONSTRAINT "Employee_name" CHECK (btrim("firstName") <> '' AND btrim("surname") <> '' AND btrim("jobTitle") <> ''),
  -- A person who has left keeps their record with a leaving date and a reason; a person who has not left has neither.
  ADD CONSTRAINT "Employee_leaver" CHECK (("status" IN ('RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED')) = ("leavingDate" IS NOT NULL AND "leavingReason" IS NOT NULL)),
  ADD CONSTRAINT "Employee_not_own_manager" CHECK ("lineManagerId" IS NULL OR "lineManagerId" <> "id");
CREATE UNIQUE INDEX "Employee_ec_unique" ON "Employee"("schoolId", "ecNumber") WHERE "ecNumber" IS NOT NULL;
ALTER TABLE "Post" ADD CONSTRAINT "Post_values" CHECK ("count" >= 1 AND "monthlyCostCents" >= 0),
  ADD CONSTRAINT "Post_approved_by_both" CHECK ("status" <> 'APPROVED' OR ("headApprovedById" IS NOT NULL AND "ownerApprovedById" IS NOT NULL AND "approvedById" IS NOT NULL)),
  ADD CONSTRAINT "Post_rejected_has_reason" CHECK ("status" <> 'REJECTED' OR ("rejectedById" IS NOT NULL AND btrim(coalesce("rejectionReason", '')) <> ''));
ALTER TABLE "InterviewScore" ADD CONSTRAINT "InterviewScore_score" CHECK ("score" BETWEEN 1 AND 5),
  ADD CONSTRAINT "InterviewScore_recommendation" CHECK ("recommendation" IS NULL OR "recommendation" IN ('HIRE', 'CONSIDER', 'DO_NOT_HIRE'));
ALTER TABLE "Applicant" ADD CONSTRAINT "Applicant_rejected_has_reason" CHECK ("stage" <> 'REJECTED' OR btrim(coalesce("rejectionReason", '')) <> ''),
  ADD CONSTRAINT "Applicant_hired_has_employee" CHECK (("stage" = 'HIRED') = ("hiredEmployeeId" IS NOT NULL));
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_dates" CHECK (("endDate" IS NULL OR "endDate" >= "startDate") AND ("probationEnd" IS NULL OR "probationEnd" >= "startDate")),
  ADD CONSTRAINT "Contract_end_required" CHECK ("kind" IN ('PERMANENT', 'CASUAL') OR "endDate" IS NOT NULL);
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_times" CHECK (("arrivalTime" IS NULL OR "arrivalTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND ("departureTime" IS NULL OR "departureTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'));
ALTER TABLE "StaffAttendanceChange" ADD CONSTRAINT "StaffAttendanceChange_reason" CHECK (char_length(btrim("reason")) >= 3);
ALTER TABLE "LeaveType" ADD CONSTRAINT "LeaveType_days" CHECK ("daysPerYear" >= 0 AND "carryOverMax" >= 0);
ALTER TABLE "LeaveAdjustment" ADD CONSTRAINT "LeaveAdjustment_reason" CHECK (char_length(btrim("reason")) >= 5 AND "days" <> 0);
ALTER TABLE "LeaveRequest"
  ADD CONSTRAINT "LeaveRequest_dates" CHECK ("endDate" >= "startDate" AND "days" > 0),
  ADD CONSTRAINT "LeaveRequest_decided_has_person" CHECK (("status" IN ('APPROVED', 'REJECTED')) = ("approvedById" IS NOT NULL AND "decidedAt" IS NOT NULL) OR "status" = 'CANCELLED'),
  ADD CONSTRAINT "LeaveRequest_rejected_has_reason" CHECK ("status" <> 'REJECTED' OR char_length(btrim(coalesce("decisionReason", ''))) >= 3);
ALTER TABLE "DutyRoster" ADD CONSTRAINT "DutyRoster_dates" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "DutyRoster_approved_has_person" CHECK ("status" = 'DRAFT' OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL)),
  ADD CONSTRAINT "DutyRoster_published" CHECK (("status" = 'PUBLISHED') = ("publishedAt" IS NOT NULL));
ALTER TABLE "DutySwap" ADD CONSTRAINT "DutySwap_people" CHECK ("fromEmployeeId" <> "toEmployeeId");
ALTER TABLE "PayGrade" ADD CONSTRAINT "PayGrade_amounts" CHECK ("basicUsdCents" >= 0 AND "basicZigCents" >= 0);
ALTER TABLE "EmployeePay" ADD CONSTRAINT "EmployeePay_amounts" CHECK ("basicUsdCents" >= 0 AND "basicZigCents" >= 0 AND coalesce("rateCents", 0) >= 0
    AND ("splitUsdBps" IS NULL OR ("splitUsdBps" BETWEEN 0 AND 10000 AND "splitTotalUsdCents" IS NOT NULL AND "splitTotalUsdCents" >= 0))
    AND (("rateCents" IS NULL) = ("rateCurrency" IS NULL)));
ALTER TABLE "EmployeePayComponent" ADD CONSTRAINT "EmployeePayComponent_amount" CHECK ("amountCents" >= 0 AND ("endsOn" IS NULL OR "endsOn" >= "startsOn")),
  ADD CONSTRAINT "EmployeePayComponent_consent" CHECK ("childStudentId" IS NULL OR ("consentKey" IS NOT NULL AND "consentAt" IS NOT NULL));
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_amounts" CHECK ("principalCents" > 0 AND "instalmentCents" > 0 AND "balanceCents" >= 0 AND "balanceCents" <= "principalCents"),
  ADD CONSTRAINT "Loan_repaid" CHECK (("status" = 'REPAID') = ("balanceCents" = 0) OR "status" = 'CANCELLED');
ALTER TABLE "TaxBand" ADD CONSTRAINT "TaxBand_values" CHECK ("fromCents" >= 0 AND "rateBps" BETWEEN 0 AND 10000);
ALTER TABLE "StatutoryRate" ADD CONSTRAINT "StatutoryRate_values" CHECK ("aidsLevyBps" BETWEEN 0 AND 10000 AND "nssaEmployeeBps" BETWEEN 0 AND 10000
    AND "nssaEmployerBps" BETWEEN 0 AND 10000 AND "zimdefBps" BETWEEN 0 AND 10000 AND coalesce("nssaCeilingUsdCents", 0) >= 0 AND coalesce("nssaCeilingZigCents", 0) >= 0);
ALTER TABLE "HrPayrollRun"
  ADD CONSTRAINT "HrPayrollRun_month" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- Three different people: the preparer cannot approve the run or mark it paid.
  ADD CONSTRAINT "HrPayrollRun_people" CHECK (("approvedById" IS NULL OR "approvedById" <> "preparedById") AND ("paidById" IS NULL OR "paidById" <> "preparedById")),
  ADD CONSTRAINT "HrPayrollRun_approved_has_person" CHECK ("status" NOT IN ('APPROVED', 'PAID') OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL)),
  ADD CONSTRAINT "HrPayrollRun_paid_has_person" CHECK (("status" = 'PAID') = ("paidById" IS NOT NULL AND "paidAt" IS NOT NULL)),
  ADD CONSTRAINT "HrPayrollRun_submitted" CHECK ("status" = 'DRAFT' OR "submittedAt" IS NOT NULL),
  ADD CONSTRAINT "HrPayrollRun_returned_has_comment" CHECK ("status" <> 'RETURNED' OR (char_length(btrim(coalesce("returnComment", ''))) >= 3 AND "returnedById" IS NOT NULL));
ALTER TABLE "HrPayrollVariable" ADD CONSTRAINT "HrPayrollVariable_adjustment_reason" CHECK ("kind" <> 'ADJUSTMENT' OR char_length(btrim(coalesce("reason", ''))) >= 5);
ALTER TABLE "HrPayrollLine" ADD CONSTRAINT "HrPayrollLine_amounts" CHECK ("grossCents" >= 0 AND "taxableCents" >= 0 AND "payeCents" >= 0 AND "aidsLevyCents" >= 0
    AND "nssaEmployeeCents" >= 0 AND "nssaEmployerCents" >= 0 AND "zimdefCents" >= 0);
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_code" CHECK (char_length("verificationCode") >= 8);

-- ── Nothing is deleted; history is only added to ────────────────────────────
CREATE OR REPLACE FUNCTION hr_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted. Staff records keep their history; end or cancel the record instead.', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;
CREATE OR REPLACE FUNCTION hr_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows can only be added, never changed or deleted. Fix a mistake with a new row.', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;
CREATE OR REPLACE FUNCTION hr_immutable_except() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - TG_ARGV) IS DISTINCT FROM (to_jsonb(OLD) - TG_ARGV) THEN
    RAISE EXCEPTION '% rows cannot be edited. Add a new one that takes effect later.', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Employee', 'EmployeeDocument', 'EmployeeExit', 'StaffDisciplinary', 'Contract', 'StaffAttendance', 'LeaveRequest', 'LeaveType',
    'DutyRoster', 'PayGrade', 'EmployeePay', 'Loan', 'HrPayrollRun', 'Payslip', 'Post', 'Applicant', 'Vacancy'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION hr_no_delete()', 'no_delete_' || t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['EmployeeHistory', 'HrSensitiveView', 'StaffAttendanceChange', 'LeaveAdjustment', 'TaxBand'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION hr_append_only()', 'append_only_' || t, t);
  END LOOP;
END $$;
-- Tax tables and rates are never edited (a change is a new row with a later effective date); only their confirmation is recorded.
CREATE TRIGGER "immutable_TaxTable" BEFORE UPDATE ON "TaxTable" FOR EACH ROW EXECUTE FUNCTION hr_immutable_except('confirmedById', 'confirmedAt', 'updatedAt');
CREATE TRIGGER "immutable_StatutoryRate" BEFORE UPDATE ON "StatutoryRate" FOR EACH ROW EXECUTE FUNCTION hr_immutable_except('confirmedById', 'confirmedAt', 'updatedAt');
CREATE TRIGGER "no_delete_TaxTable" BEFORE DELETE ON "TaxTable" FOR EACH ROW EXECUTE FUNCTION hr_no_delete();
CREATE TRIGGER "no_delete_StatutoryRate" BEFORE DELETE ON "StatutoryRate" FOR EACH ROW EXECUTE FUNCTION hr_no_delete();

-- ── Government-paid staff never reach payroll ───────────────────────────────
CREATE OR REPLACE FUNCTION hr_school_paid_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE emp "HrEmployer";
BEGIN
  SELECT "employer" INTO emp FROM "Employee" WHERE "id" = NEW."employeeId";
  IF emp IS DISTINCT FROM 'SCHOOL' THEN
    RAISE EXCEPTION 'Government-paid staff are paid by the state and never appear in the school payroll' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "school_paid_EmployeePay" BEFORE INSERT ON "EmployeePay" FOR EACH ROW EXECUTE FUNCTION hr_school_paid_only();
CREATE TRIGGER "school_paid_EmployeePayComponent" BEFORE INSERT ON "EmployeePayComponent" FOR EACH ROW EXECUTE FUNCTION hr_school_paid_only();
CREATE TRIGGER "school_paid_Loan" BEFORE INSERT ON "Loan" FOR EACH ROW EXECUTE FUNCTION hr_school_paid_only();
CREATE TRIGGER "school_paid_HrPayrollLine" BEFORE INSERT ON "HrPayrollLine" FOR EACH ROW EXECUTE FUNCTION hr_school_paid_only();
CREATE TRIGGER "school_paid_HrPayrollVariable" BEFORE INSERT ON "HrPayrollVariable" FOR EACH ROW EXECUTE FUNCTION hr_school_paid_only();

-- An employee who has pay set up cannot be turned into a government-paid one without first ending their pay set-up in payroll.
CREATE OR REPLACE FUNCTION hr_employer_change_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."employer" = 'GOVERNMENT' AND OLD."employer" <> 'GOVERNMENT'
     AND EXISTS (SELECT 1 FROM "HrPayrollLine" l JOIN "HrPayrollRun" r ON r."id" = l."runId" WHERE l."employeeId" = NEW."id" AND r."status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED')) THEN
    RAISE EXCEPTION 'This person is in a payroll run that has not been paid yet. Finish or return the run before changing who pays them.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "employer_change_Employee" BEFORE UPDATE OF "employer" ON "Employee" FOR EACH ROW EXECUTE FUNCTION hr_employer_change_guard();

-- ── Payroll: the run is locked once submitted; its lines are a snapshot ─────
CREATE OR REPLACE FUNCTION hr_run_open_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st "HrPayrollStatus"; rid text;
BEGIN
  rid := CASE WHEN TG_OP = 'DELETE' THEN OLD."runId" ELSE NEW."runId" END;
  SELECT "status" INTO st FROM "HrPayrollRun" WHERE "id" = rid;
  IF st NOT IN ('DRAFT', 'RETURNED') THEN
    RAISE EXCEPTION 'This payroll run is % and cannot be changed. Correct a mistake in next month''s run with an adjustment line, or ask the Owner to reopen it before it is paid.', lower(st::text) USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER "open_run_HrPayrollLine" BEFORE INSERT OR UPDATE OR DELETE ON "HrPayrollLine" FOR EACH ROW EXECUTE FUNCTION hr_run_open_guard();
CREATE TRIGGER "open_run_HrPayrollVariable" BEFORE INSERT OR UPDATE OR DELETE ON "HrPayrollVariable" FOR EACH ROW EXECUTE FUNCTION hr_run_open_guard();

CREATE OR REPLACE FUNCTION hr_run_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT ((OLD."status" = 'DRAFT'     AND NEW."status" = 'SUBMITTED')
         OR (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('APPROVED', 'RETURNED'))
         OR (OLD."status" = 'RETURNED'  AND NEW."status" IN ('DRAFT', 'SUBMITTED'))
         OR (OLD."status" = 'APPROVED'  AND NEW."status" IN ('PAID', 'DRAFT'))) THEN
      RAISE EXCEPTION 'A payroll run cannot go from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
    END IF;
    -- Reopening an approved run is the Owner's decision and is written down.
    IF OLD."status" = 'APPROVED' AND NEW."status" = 'DRAFT' AND (NEW."reopenedById" IS NULL OR char_length(btrim(coalesce(NEW."reopenReason", ''))) < 5) THEN
      RAISE EXCEPTION 'Reopening a payroll run needs the person and a reason' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- Nothing but the workflow columns changes once the run has left DRAFT/RETURNED.
  IF TG_OP = 'UPDATE' AND OLD."status" IN ('APPROVED', 'PAID') AND NEW."status" = OLD."status"
     AND (to_jsonb(NEW) - ARRAY['updatedAt', 'financeRunId', 'paidById', 'paidAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updatedAt', 'financeRunId', 'paidById', 'paidAt']) THEN
    RAISE EXCEPTION 'An approved payroll run cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "transition_HrPayrollRun" BEFORE UPDATE ON "HrPayrollRun" FOR EACH ROW EXECUTE FUNCTION hr_run_transition_guard();

-- A payslip is released only when its run is paid.
CREATE OR REPLACE FUNCTION hr_payslip_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st "HrPayrollStatus";
BEGIN
  IF NEW."releasedAt" IS NOT NULL THEN
    SELECT "status" INTO st FROM "HrPayrollRun" WHERE "id" = NEW."runId";
    IF st IS DISTINCT FROM 'PAID' THEN
      RAISE EXCEPTION 'Payslips are released only when the payroll run is paid' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_Payslip" BEFORE INSERT OR UPDATE ON "Payslip" FOR EACH ROW EXECUTE FUNCTION hr_payslip_guard();

-- ── Leave: nobody approves their own ────────────────────────────────────────
CREATE OR REPLACE FUNCTION hr_leave_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE own text;
BEGIN
  IF NEW."approvedById" IS NOT NULL AND NEW."status" IN ('APPROVED', 'REJECTED') THEN
    SELECT "userId" INTO own FROM "Employee" WHERE "id" = NEW."employeeId";
    IF own IS NOT NULL AND own = NEW."approvedById" THEN
      RAISE EXCEPTION 'Nobody approves their own leave. Ask the Head or another approver.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" IN ('APPROVED', 'REJECTED', 'CANCELLED') AND NEW."status" <> OLD."status" AND NOT (OLD."status" = 'APPROVED' AND NEW."status" = 'CANCELLED') THEN
    RAISE EXCEPTION 'A decided leave request cannot be decided again' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_LeaveRequest" BEFORE INSERT OR UPDATE ON "LeaveRequest" FOR EACH ROW EXECUTE FUNCTION hr_leave_guard();

-- ── Roster: assignments are added or removed only while the roster is a draft (a confirmed swap changes the person) ──
CREATE OR REPLACE FUNCTION hr_roster_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st "RosterStatus"; rid text;
BEGIN
  rid := CASE WHEN TG_OP = 'DELETE' THEN OLD."rosterId" ELSE NEW."rosterId" END;
  SELECT "status" INTO st FROM "DutyRoster" WHERE "id" = rid;
  IF st <> 'DRAFT' AND (TG_OP IN ('INSERT', 'DELETE') OR NEW."dutyTypeId" IS DISTINCT FROM OLD."dutyTypeId" OR NEW."date" IS DISTINCT FROM OLD."date") THEN
    RAISE EXCEPTION 'The roster is % and its duties cannot be rearranged. Use a swap.', lower(st::text) USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER "guard_DutyAssignment" BEFORE INSERT OR UPDATE OR DELETE ON "DutyAssignment" FOR EACH ROW EXECUTE FUNCTION hr_roster_guard();
