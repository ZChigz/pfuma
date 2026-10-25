-- CreateEnum
CREATE TYPE "FacBedType" AS ENUM ('SINGLE', 'BUNK_TOP', 'BUNK_BOTTOM');

-- CreateEnum
CREATE TYPE "FacRollSession" AS ENUM ('MORNING', 'EVENING', 'LIGHTS_OUT');

-- CreateEnum
CREATE TYPE "FacRollStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXEAT', 'SICK_BAY', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "FacExeatType" AS ENUM ('WEEKEND', 'LONG', 'MEDICAL', 'EMERGENCY', 'SCHOOL_ACTIVITY');

-- CreateEnum
CREATE TYPE "FacExeatStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'SIGNED_OUT', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FacComplaint" AS ENUM ('HEADACHE', 'FEVER', 'STOMACH_PAIN', 'INJURY', 'MENSTRUAL', 'ASTHMA', 'OTHER');

-- CreateEnum
CREATE TYPE "FacVisitOutcome" AS ENUM ('BACK_TO_CLASS', 'REST_IN_SICK_BAY', 'SENT_TO_CLINIC', 'SENT_HOME');

-- CreateEnum
CREATE TYPE "FacWalletEntryType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'PURCHASE', 'REFUND');

-- CreateEnum
CREATE TYPE "FacWalletClose" AS ENUM ('REFUNDED', 'CARRIED_FORWARD');

-- CreateEnum
CREATE TYPE "FacSalePayment" AS ENUM ('CASH', 'WALLET');

-- CreateEnum
CREATE TYPE "FacCopyCondition" AS ENUM ('NEW', 'GOOD', 'WORN', 'DAMAGED');

-- CreateEnum
CREATE TYPE "FacCopyStatus" AS ENUM ('AVAILABLE', 'ON_LOAN', 'RESERVED', 'LOST', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "FacCopySource" AS ENUM ('BOUGHT', 'DONATED');

-- CreateEnum
CREATE TYPE "FacBookCategory" AS ENUM ('FICTION', 'REFERENCE', 'TEXTBOOK', 'PAST_PAPERS');

-- CreateEnum
CREATE TYPE "FacMemberType" AS ENUM ('LEARNER', 'STAFF');

-- CreateEnum
CREATE TYPE "FacStockCategory" AS ENUM ('UNIFORMS', 'STATIONERY', 'FOOD', 'CLEANING', 'MEDICAL', 'AGRICULTURE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "FacStockUnit" AS ENUM ('EACH', 'BOX', 'KG', 'LITRE');

-- CreateEnum
CREATE TYPE "FacMovementType" AS ENUM ('IN', 'ISSUE', 'SALE', 'TRANSFER', 'ADJUSTMENT', 'WRITEOFF');

-- CreateEnum
CREATE TYPE "FacWriteoffReason" AS ENUM ('EXPIRED', 'DAMAGED', 'STOLEN', 'OTHER');

-- CreateEnum
CREATE TYPE "FacCountStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FacAssetCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'POOR');

-- CreateEnum
CREATE TYPE "FacAssetStatus" AS ENUM ('IN_USE', 'IN_STORAGE', 'UNDER_REPAIR', 'LOST', 'DISPOSED');

-- CreateEnum
CREATE TYPE "FacDisposalMethod" AS ENUM ('SOLD', 'SCRAPPED', 'DONATED', 'STOLEN', 'LOST');

-- CreateEnum
CREATE TYPE "FacJobStatus" AS ENUM ('REPORTED', 'ASSIGNED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FacScanResult" AS ENUM ('FOUND', 'WRONG_PLACE');

-- CreateEnum
CREATE TYPE "FacVehicleOwner" AS ENUM ('SCHOOL', 'HIRED');

-- CreateEnum
CREATE TYPE "FacVehicleDocType" AS ENUM ('LICENCE', 'INSURANCE', 'FITNESS', 'ROUTE_PERMIT');

-- CreateEnum
CREATE TYPE "FacDriverDocType" AS ENUM ('DRIVING_LICENCE', 'DEFENSIVE_DRIVING');

-- CreateEnum
CREATE TYPE "FacTripLeg" AS ENUM ('MORNING', 'AFTERNOON', 'OTHER');

-- CreateEnum
CREATE TYPE "FacApproval" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FacLedgerPart" AS ENUM ('HOSTEL', 'LIBRARY', 'TRANSPORT', 'INVENTORY', 'TUCKSHOP');

-- CreateEnum
CREATE TYPE "FacLedgerStatus" AS ENUM ('OPEN', 'SETTLED', 'WAIVED');

-- CreateTable
CREATE TABLE "FacSettings" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "rollCallSessions" "FacRollSession"[] DEFAULT ARRAY['MORNING', 'EVENING', 'LIGHTS_OUT']::"FacRollSession"[],
    "exeatHeadAlertMinutes" INTEGER NOT NULL DEFAULT 120,
    "longExeatNights" INTEGER NOT NULL DEFAULT 3,
    "learnerMaxLoans" INTEGER NOT NULL DEFAULT 2,
    "learnerLoanDays" INTEGER NOT NULL DEFAULT 14,
    "staffMaxLoans" INTEGER NOT NULL DEFAULT 5,
    "staffLoanDays" INTEGER NOT NULL DEFAULT 30,
    "lateFinePerDayCents" INTEGER NOT NULL DEFAULT 0,
    "lateFineCurrency" "Currency" NOT NULL DEFAULT 'USD',
    "prorateTransport" BOOLEAN NOT NULL DEFAULT true,
    "adjustmentLimitUsdCents" INTEGER NOT NULL DEFAULT 0,
    "adjustmentLimitZigCents" INTEGER NOT NULL DEFAULT 0,
    "disposalOwnerLimitUsdCents" INTEGER NOT NULL DEFAULT 0,
    "disposalOwnerLimitZigCents" INTEGER NOT NULL DEFAULT 0,
    "walletLowBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "expiryWarningDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacSequence" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacLedgerEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "part" "FacLedgerPart" NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT,
    "description" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "FacLedgerStatus" NOT NULL DEFAULT 'OPEN',
    "chargeId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacHostel" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" "Gender" NOT NULL,
    "boardingMasterId" TEXT,
    "matronId" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacHostel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacRoom" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "floor" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacBed" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "bedType" "FacBedType" NOT NULL DEFAULT 'SINGLE',
    "lockerNumber" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacBed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacBedAllocation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE,
    "reason" TEXT,
    "allocatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacBedAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacRollCall" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "session" "FacRollSession" NOT NULL,
    "takenById" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacRollCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacRollCallEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "rollCallId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "FacRollStatus" NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "explainedBy" TEXT,
    "note" TEXT,
    "alertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacRollCallEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacInspection" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "inspectedById" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "notes" TEXT,
    "photoKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacInspectionItem" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "note" TEXT,
    "damageStudentId" TEXT,
    "damageCents" INTEGER,
    "damageCurrency" "Currency",
    "damageStatus" "FacApproval",
    "damageApprovedById" TEXT,
    "ledgerEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacInspectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacExeat" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" "FacExeatType" NOT NULL,
    "outAt" TIMESTAMP(3) NOT NULL,
    "dueBackAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "collectedBy" JSONB NOT NULL,
    "status" "FacExeatStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "signedOutAt" TIMESTAMP(3),
    "signedOutById" TEXT,
    "signedInAt" TIMESTAMP(3),
    "signedInById" TEXT,
    "overdueAlertedAt" TIMESTAMP(3),
    "headAlertedAt" TIMESTAMP(3),
    "calendarEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacExeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacVisitorLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "visitorName" TEXT NOT NULL,
    "idNumber" TEXT,
    "phone" TEXT,
    "guardianId" TEXT,
    "approvedById" TEXT,
    "calendarEventId" TEXT,
    "timeIn" TIMESTAMP(3) NOT NULL,
    "timeOut" TIMESTAMP(3),
    "loggedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacVisitorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacSickBayVisit" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL,
    "complaint" "FacComplaint" NOT NULL,
    "complaintNote" TEXT,
    "temperatureC" DOUBLE PRECISION,
    "observations" TEXT,
    "treatment" TEXT,
    "medication" JSONB NOT NULL DEFAULT '[]',
    "outcome" "FacVisitOutcome" NOT NULL,
    "guardianInformedAt" TIMESTAMP(3),
    "guardianInformedMethod" TEXT,
    "admittedAt" TIMESTAMP(3),
    "dischargedAt" TIMESTAMP(3),
    "referral" JSONB,
    "recordedById" TEXT NOT NULL,
    "legacyVisitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacSickBayVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacMedicationRound" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacMedicationRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacMedicationDose" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "medicationEntryId" TEXT,
    "medicine" TEXT NOT NULL,
    "dose" TEXT,
    "dueTime" TEXT NOT NULL,
    "givenAt" TIMESTAMP(3),
    "givenById" TEXT,
    "missed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacMedicationDose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacWallet" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "weeklyLimitCents" INTEGER,
    "lowBalanceCents" INTEGER,
    "closedAt" TIMESTAMP(3),
    "closeAction" "FacWalletClose",
    "closedById" TEXT,
    "consentKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacWalletEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "type" "FacWalletEntryType" NOT NULL,
    "paymentId" TEXT,
    "saleId" TEXT,
    "note" TEXT,
    "signatureKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacWalletEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacTuckShopSale" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "attendantId" TEXT NOT NULL,
    "studentId" TEXT,
    "walletId" TEXT,
    "payment" "FacSalePayment" NOT NULL,
    "currency" "Currency" NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cashUpId" TEXT,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacTuckShopSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacTuckShopSaleLine" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "unitCostCents" INTEGER NOT NULL DEFAULT 0,
    "movementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacTuckShopSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacTuckShopCashUp" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "attendantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "currency" "Currency" NOT NULL,
    "expectedCashCents" INTEGER NOT NULL,
    "countedCashCents" INTEGER NOT NULL,
    "note" TEXT,
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacTuckShopCashUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacBookTitle" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isbn" TEXT,
    "publisher" TEXT,
    "year" INTEGER,
    "edition" TEXT,
    "subject" TEXT,
    "level" TEXT,
    "category" "FacBookCategory" NOT NULL DEFAULT 'FICTION',
    "shelfLocation" TEXT,
    "coverKey" TEXT,
    "lendable" BOOLEAN NOT NULL DEFAULT true,
    "replacementCents" INTEGER,
    "currency" "Currency",
    "legacyBookId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacBookTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacBookCopy" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "accessionNo" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "condition" "FacCopyCondition" NOT NULL DEFAULT 'NEW',
    "status" "FacCopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "source" "FacCopySource" NOT NULL DEFAULT 'BOUGHT',
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "legacyCopyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacBookCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacLibraryMember" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "type" "FacMemberType" NOT NULL,
    "studentId" TEXT,
    "employeeId" TEXT,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "suspendedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacLibraryMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacLoan" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "copyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "outAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "renewedCount" INTEGER NOT NULL DEFAULT 0,
    "conditionOnReturn" "FacCopyCondition",
    "fineCents" INTEGER NOT NULL DEFAULT 0,
    "fineCurrency" "Currency",
    "chargeId" TEXT,
    "ledgerEntryId" TEXT,
    "waivedById" TEXT,
    "waiveReason" TEXT,
    "checkedOutById" TEXT NOT NULL,
    "returnedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacReservation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacTextbookSet" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "levelId" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacTextbookSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacTextbookIssue" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "copyId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "setId" TEXT,
    "yearId" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "conditionOut" "FacCopyCondition",
    "returnedAt" TIMESTAMP(3),
    "returnedById" TEXT,
    "conditionIn" "FacCopyCondition",
    "missingAt" TIMESTAMP(3),
    "chargeId" TEXT,
    "ledgerEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacTextbookIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacStocktake" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shelf" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacStocktake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacStocktakeScan" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "stocktakeId" TEXT NOT NULL,
    "copyId" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacStocktakeScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacRoute" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone" TEXT,
    "amTime" TEXT,
    "pmTime" TEXT,
    "vehicleId" TEXT,
    "driverId" TEXT,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacStop" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amPickupTime" TEXT,
    "pmDropTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacStudentRoute" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "amStopId" TEXT NOT NULL,
    "pmStopId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "removedAt" TIMESTAMP(3),
    "chargeId" TEXT,
    "ledgerEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacStudentRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacVehicle" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "registration" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT,
    "seats" INTEGER NOT NULL,
    "owner" "FacVehicleOwner" NOT NULL DEFAULT 'SCHOOL',
    "odometerKm" INTEGER NOT NULL DEFAULT 0,
    "assetId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacVehicleDocument" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "type" "FacVehicleDocType" NOT NULL,
    "number" TEXT,
    "expiry" DATE NOT NULL,
    "fileKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacVehicleDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacDriver" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "licenceClass" TEXT NOT NULL,
    "licenceNumber" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacDriver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacDriverDocument" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "type" "FacDriverDocType" NOT NULL,
    "number" TEXT,
    "expiry" DATE NOT NULL,
    "fileKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacDriverDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacTrip" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "routeId" TEXT,
    "bookingId" TEXT,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "leg" "FacTripLeg" NOT NULL DEFAULT 'MORNING',
    "odometerStart" INTEGER,
    "odometerEnd" INTEGER,
    "departedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacTripPassenger" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "tripId" TEXT,
    "bookingId" TEXT,
    "studentId" TEXT NOT NULL,
    "boardedAt" TIMESTAMP(3),
    "chargeId" TEXT,
    "ledgerEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacTripPassenger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacFuelLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "tripId" TEXT,
    "date" DATE NOT NULL,
    "litres" DOUBLE PRECISION NOT NULL,
    "costCents" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "receiptKey" TEXT,
    "odometerKm" INTEGER,
    "expenseId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacFuelLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacVehicleBooking" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT NOT NULL,
    "destination" TEXT,
    "perLearnerCents" INTEGER,
    "currency" "Currency",
    "status" "FacApproval" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacVehicleBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacStore" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storekeeperId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacStockItem" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "FacStockCategory" NOT NULL,
    "unit" "FacStockUnit" NOT NULL DEFAULT 'EACH',
    "size" TEXT,
    "gender" "Gender",
    "barcode" TEXT,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER,
    "priceCurrency" "Currency",
    "tracksExpiry" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacStockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacStockLot" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "expiry" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacStockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacStockMovement" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "lotId" TEXT,
    "type" "FacMovementType" NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "unitCostCents" INTEGER NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "purchaseRequestId" TEXT,
    "deliveryNote" TEXT,
    "photoKey" TEXT,
    "reason" TEXT,
    "writeoffReason" "FacWriteoffReason",
    "shortfallNote" TEXT,
    "transferGroupId" TEXT,
    "receiverName" TEXT,
    "receiverEmployeeId" TEXT,
    "department" TEXT,
    "signatureKey" TEXT,
    "studentId" TEXT,
    "chargeId" TEXT,
    "ledgerEntryId" TEXT,
    "countId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacStockCount" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" "FacCountStatus" NOT NULL DEFAULT 'OPEN',
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacStockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacStockCountLine" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "expectedQty" DOUBLE PRECISION NOT NULL,
    "countedQty" DOUBLE PRECISION,
    "movementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacStockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacAssetCategory" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "depreciationYears" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacAssetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacAsset" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "custodianId" TEXT,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "purchasedAt" DATE,
    "supplierId" TEXT,
    "requestId" TEXT,
    "expenseId" TEXT,
    "condition" "FacAssetCondition" NOT NULL DEFAULT 'GOOD',
    "status" "FacAssetStatus" NOT NULL DEFAULT 'IN_USE',
    "serial" TEXT,
    "warrantyEnd" DATE,
    "photoKey" TEXT,
    "notes" TEXT,
    "legacyAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacAssetTransfer" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "fromLocation" TEXT NOT NULL,
    "toLocation" TEXT NOT NULL,
    "fromCustodianId" TEXT,
    "toCustodianId" TEXT,
    "date" DATE NOT NULL,
    "recordedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacAssetTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacMaintenanceSchedule" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "everyMonths" INTEGER,
    "everyKm" INTEGER,
    "remindDaysBefore" INTEGER NOT NULL DEFAULT 14,
    "lastDoneAt" DATE,
    "lastDoneKm" INTEGER,
    "nextDueAt" DATE,
    "nextDueKm" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacMaintenanceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacMaintenanceJob" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "problem" TEXT NOT NULL,
    "photoKey" TEXT,
    "reportedById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "status" "FacJobStatus" NOT NULL DEFAULT 'REPORTED',
    "workDone" TEXT,
    "provider" TEXT,
    "costCents" INTEGER,
    "currency" "Currency",
    "expenseId" TEXT,
    "doneAt" TIMESTAMP(3),
    "nextServiceDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacMaintenanceJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacAssetDisposal" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "method" "FacDisposalMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "proceedsCents" INTEGER,
    "currency" "Currency",
    "headApprovedById" TEXT NOT NULL,
    "ownerApprovedById" TEXT,
    "incomeRef" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacAssetDisposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacVerificationRound" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacVerificationRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacVerificationScan" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "scannedLocation" TEXT NOT NULL,
    "result" "FacScanResult" NOT NULL,
    "scannedById" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacVerificationScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FacSettings_schoolId_key" ON "FacSettings"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "FacSequence_schoolId_key_key" ON "FacSequence"("schoolId", "key");

-- CreateIndex
CREATE INDEX "FacLedgerEntry_schoolId_part_status_idx" ON "FacLedgerEntry"("schoolId", "part", "status");

-- CreateIndex
CREATE INDEX "FacLedgerEntry_schoolId_studentId_idx" ON "FacLedgerEntry"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "FacHostel_schoolId_name_key" ON "FacHostel"("schoolId", "name");

-- CreateIndex
CREATE INDEX "FacRoom_schoolId_hostelId_idx" ON "FacRoom"("schoolId", "hostelId");

-- CreateIndex
CREATE UNIQUE INDEX "FacRoom_hostelId_name_key" ON "FacRoom"("hostelId", "name");

-- CreateIndex
CREATE INDEX "FacBed_schoolId_roomId_idx" ON "FacBed"("schoolId", "roomId");

-- CreateIndex
CREATE UNIQUE INDEX "FacBed_roomId_number_key" ON "FacBed"("roomId", "number");

-- CreateIndex
CREATE INDEX "FacBedAllocation_schoolId_studentId_idx" ON "FacBedAllocation"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "FacBedAllocation_schoolId_bedId_idx" ON "FacBedAllocation"("schoolId", "bedId");

-- CreateIndex
CREATE INDEX "FacBedAllocation_schoolId_termId_idx" ON "FacBedAllocation"("schoolId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "FacRollCall_schoolId_hostelId_date_session_key" ON "FacRollCall"("schoolId", "hostelId", "date", "session");

-- CreateIndex
CREATE UNIQUE INDEX "FacRollCall_schoolId_clientId_key" ON "FacRollCall"("schoolId", "clientId");

-- CreateIndex
CREATE INDEX "FacRollCallEntry_schoolId_studentId_idx" ON "FacRollCallEntry"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "FacRollCallEntry_rollCallId_studentId_key" ON "FacRollCallEntry"("rollCallId", "studentId");

-- CreateIndex
CREATE INDEX "FacInspection_schoolId_hostelId_date_idx" ON "FacInspection"("schoolId", "hostelId", "date");

-- CreateIndex
CREATE INDEX "FacInspectionItem_schoolId_inspectionId_idx" ON "FacInspectionItem"("schoolId", "inspectionId");

-- CreateIndex
CREATE INDEX "FacExeat_schoolId_studentId_idx" ON "FacExeat"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "FacExeat_schoolId_status_dueBackAt_idx" ON "FacExeat"("schoolId", "status", "dueBackAt");

-- CreateIndex
CREATE INDEX "FacVisitorLog_schoolId_studentId_idx" ON "FacVisitorLog"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "FacVisitorLog_schoolId_timeIn_idx" ON "FacVisitorLog"("schoolId", "timeIn");

-- CreateIndex
CREATE UNIQUE INDEX "FacSickBayVisit_legacyVisitId_key" ON "FacSickBayVisit"("legacyVisitId");

-- CreateIndex
CREATE INDEX "FacSickBayVisit_schoolId_studentId_idx" ON "FacSickBayVisit"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "FacSickBayVisit_schoolId_visitedAt_idx" ON "FacSickBayVisit"("schoolId", "visitedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FacMedicationRound_schoolId_date_key" ON "FacMedicationRound"("schoolId", "date");

-- CreateIndex
CREATE INDEX "FacMedicationDose_schoolId_roundId_idx" ON "FacMedicationDose"("schoolId", "roundId");

-- CreateIndex
CREATE INDEX "FacMedicationDose_schoolId_studentId_idx" ON "FacMedicationDose"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "FacWallet_schoolId_idx" ON "FacWallet"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "FacWallet_studentId_currency_key" ON "FacWallet"("studentId", "currency");

-- CreateIndex
CREATE INDEX "FacWalletEntry_schoolId_walletId_createdAt_idx" ON "FacWalletEntry"("schoolId", "walletId", "createdAt");

-- CreateIndex
CREATE INDEX "FacTuckShopSale_schoolId_soldAt_idx" ON "FacTuckShopSale"("schoolId", "soldAt");

-- CreateIndex
CREATE INDEX "FacTuckShopSale_schoolId_attendantId_soldAt_idx" ON "FacTuckShopSale"("schoolId", "attendantId", "soldAt");

-- CreateIndex
CREATE UNIQUE INDEX "FacTuckShopSale_schoolId_clientId_key" ON "FacTuckShopSale"("schoolId", "clientId");

-- CreateIndex
CREATE INDEX "FacTuckShopSaleLine_schoolId_saleId_idx" ON "FacTuckShopSaleLine"("schoolId", "saleId");

-- CreateIndex
CREATE UNIQUE INDEX "FacTuckShopCashUp_schoolId_attendantId_date_currency_key" ON "FacTuckShopCashUp"("schoolId", "attendantId", "date", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "FacBookTitle_legacyBookId_key" ON "FacBookTitle"("legacyBookId");

-- CreateIndex
CREATE INDEX "FacBookTitle_schoolId_idx" ON "FacBookTitle"("schoolId");

-- CreateIndex
CREATE INDEX "FacBookTitle_schoolId_isbn_idx" ON "FacBookTitle"("schoolId", "isbn");

-- CreateIndex
CREATE UNIQUE INDEX "FacBookCopy_legacyCopyId_key" ON "FacBookCopy"("legacyCopyId");

-- CreateIndex
CREATE INDEX "FacBookCopy_schoolId_titleId_idx" ON "FacBookCopy"("schoolId", "titleId");

-- CreateIndex
CREATE INDEX "FacBookCopy_schoolId_status_idx" ON "FacBookCopy"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FacBookCopy_schoolId_accessionNo_key" ON "FacBookCopy"("schoolId", "accessionNo");

-- CreateIndex
CREATE UNIQUE INDEX "FacBookCopy_schoolId_barcode_key" ON "FacBookCopy"("schoolId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "FacLibraryMember_studentId_key" ON "FacLibraryMember"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "FacLibraryMember_employeeId_key" ON "FacLibraryMember"("employeeId");

-- CreateIndex
CREATE INDEX "FacLibraryMember_schoolId_idx" ON "FacLibraryMember"("schoolId");

-- CreateIndex
CREATE INDEX "FacLoan_schoolId_copyId_idx" ON "FacLoan"("schoolId", "copyId");

-- CreateIndex
CREATE INDEX "FacLoan_schoolId_memberId_idx" ON "FacLoan"("schoolId", "memberId");

-- CreateIndex
CREATE INDEX "FacLoan_schoolId_returnedAt_dueAt_idx" ON "FacLoan"("schoolId", "returnedAt", "dueAt");

-- CreateIndex
CREATE INDEX "FacReservation_schoolId_titleId_idx" ON "FacReservation"("schoolId", "titleId");

-- CreateIndex
CREATE INDEX "FacReservation_schoolId_memberId_idx" ON "FacReservation"("schoolId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "FacTextbookSet_schoolId_name_key" ON "FacTextbookSet"("schoolId", "name");

-- CreateIndex
CREATE INDEX "FacTextbookIssue_schoolId_studentId_idx" ON "FacTextbookIssue"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "FacTextbookIssue_schoolId_copyId_idx" ON "FacTextbookIssue"("schoolId", "copyId");

-- CreateIndex
CREATE INDEX "FacStocktake_schoolId_idx" ON "FacStocktake"("schoolId");

-- CreateIndex
CREATE INDEX "FacStocktakeScan_schoolId_idx" ON "FacStocktakeScan"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "FacStocktakeScan_stocktakeId_copyId_key" ON "FacStocktakeScan"("stocktakeId", "copyId");

-- CreateIndex
CREATE UNIQUE INDEX "FacRoute_schoolId_name_key" ON "FacRoute"("schoolId", "name");

-- CreateIndex
CREATE INDEX "FacStop_schoolId_routeId_idx" ON "FacStop"("schoolId", "routeId");

-- CreateIndex
CREATE UNIQUE INDEX "FacStop_routeId_sequence_key" ON "FacStop"("routeId", "sequence");

-- CreateIndex
CREATE INDEX "FacStudentRoute_schoolId_routeId_idx" ON "FacStudentRoute"("schoolId", "routeId");

-- CreateIndex
CREATE UNIQUE INDEX "FacStudentRoute_studentId_termId_key" ON "FacStudentRoute"("studentId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "FacVehicle_schoolId_registration_key" ON "FacVehicle"("schoolId", "registration");

-- CreateIndex
CREATE INDEX "FacVehicleDocument_schoolId_vehicleId_idx" ON "FacVehicleDocument"("schoolId", "vehicleId");

-- CreateIndex
CREATE INDEX "FacVehicleDocument_schoolId_expiry_idx" ON "FacVehicleDocument"("schoolId", "expiry");

-- CreateIndex
CREATE UNIQUE INDEX "FacDriver_schoolId_employeeId_key" ON "FacDriver"("schoolId", "employeeId");

-- CreateIndex
CREATE INDEX "FacDriverDocument_schoolId_driverId_idx" ON "FacDriverDocument"("schoolId", "driverId");

-- CreateIndex
CREATE INDEX "FacDriverDocument_schoolId_expiry_idx" ON "FacDriverDocument"("schoolId", "expiry");

-- CreateIndex
CREATE INDEX "FacTrip_schoolId_vehicleId_date_idx" ON "FacTrip"("schoolId", "vehicleId", "date");

-- CreateIndex
CREATE INDEX "FacTrip_schoolId_routeId_date_idx" ON "FacTrip"("schoolId", "routeId", "date");

-- CreateIndex
CREATE INDEX "FacTripPassenger_schoolId_tripId_idx" ON "FacTripPassenger"("schoolId", "tripId");

-- CreateIndex
CREATE INDEX "FacTripPassenger_schoolId_bookingId_idx" ON "FacTripPassenger"("schoolId", "bookingId");

-- CreateIndex
CREATE INDEX "FacFuelLog_schoolId_vehicleId_date_idx" ON "FacFuelLog"("schoolId", "vehicleId", "date");

-- CreateIndex
CREATE INDEX "FacVehicleBooking_schoolId_vehicleId_startAt_idx" ON "FacVehicleBooking"("schoolId", "vehicleId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "FacStore_schoolId_name_key" ON "FacStore"("schoolId", "name");

-- CreateIndex
CREATE INDEX "FacStockItem_schoolId_category_idx" ON "FacStockItem"("schoolId", "category");

-- CreateIndex
CREATE INDEX "FacStockItem_schoolId_barcode_idx" ON "FacStockItem"("schoolId", "barcode");

-- CreateIndex
CREATE INDEX "FacStockLot_schoolId_itemId_storeId_idx" ON "FacStockLot"("schoolId", "itemId", "storeId");

-- CreateIndex
CREATE INDEX "FacStockLot_schoolId_expiry_idx" ON "FacStockLot"("schoolId", "expiry");

-- CreateIndex
CREATE INDEX "FacStockMovement_schoolId_itemId_storeId_idx" ON "FacStockMovement"("schoolId", "itemId", "storeId");

-- CreateIndex
CREATE INDEX "FacStockMovement_schoolId_type_createdAt_idx" ON "FacStockMovement"("schoolId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "FacStockMovement_schoolId_purchaseRequestId_idx" ON "FacStockMovement"("schoolId", "purchaseRequestId");

-- CreateIndex
CREATE INDEX "FacStockCount_schoolId_storeId_idx" ON "FacStockCount"("schoolId", "storeId");

-- CreateIndex
CREATE INDEX "FacStockCountLine_schoolId_countId_idx" ON "FacStockCountLine"("schoolId", "countId");

-- CreateIndex
CREATE UNIQUE INDEX "FacStockCountLine_countId_itemId_lotId_key" ON "FacStockCountLine"("countId", "itemId", "lotId");

-- CreateIndex
CREATE UNIQUE INDEX "FacAssetCategory_schoolId_name_key" ON "FacAssetCategory"("schoolId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FacAsset_legacyAssetId_key" ON "FacAsset"("legacyAssetId");

-- CreateIndex
CREATE INDEX "FacAsset_schoolId_status_idx" ON "FacAsset"("schoolId", "status");

-- CreateIndex
CREATE INDEX "FacAsset_schoolId_location_idx" ON "FacAsset"("schoolId", "location");

-- CreateIndex
CREATE INDEX "FacAsset_schoolId_custodianId_idx" ON "FacAsset"("schoolId", "custodianId");

-- CreateIndex
CREATE UNIQUE INDEX "FacAsset_schoolId_tag_key" ON "FacAsset"("schoolId", "tag");

-- CreateIndex
CREATE INDEX "FacAssetTransfer_schoolId_assetId_idx" ON "FacAssetTransfer"("schoolId", "assetId");

-- CreateIndex
CREATE INDEX "FacMaintenanceSchedule_schoolId_assetId_idx" ON "FacMaintenanceSchedule"("schoolId", "assetId");

-- CreateIndex
CREATE INDEX "FacMaintenanceSchedule_schoolId_nextDueAt_idx" ON "FacMaintenanceSchedule"("schoolId", "nextDueAt");

-- CreateIndex
CREATE INDEX "FacMaintenanceJob_schoolId_assetId_idx" ON "FacMaintenanceJob"("schoolId", "assetId");

-- CreateIndex
CREATE INDEX "FacMaintenanceJob_schoolId_status_idx" ON "FacMaintenanceJob"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FacAssetDisposal_assetId_key" ON "FacAssetDisposal"("assetId");

-- CreateIndex
CREATE INDEX "FacVerificationRound_schoolId_idx" ON "FacVerificationRound"("schoolId");

-- CreateIndex
CREATE INDEX "FacVerificationScan_schoolId_idx" ON "FacVerificationScan"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "FacVerificationScan_roundId_assetId_key" ON "FacVerificationScan"("roundId", "assetId");


-- ═════════════════════════════════════════════════════════════════════════════
-- Facilities & Operations core: foreign keys, permission keys, row-level security, audit, same-school references and the rules the
-- database keeps by itself:
--   * nothing is deleted (a record leaves by being issued, written off, disposed of, returned or ended, never by DELETE);
--   * stock movements and wallet entries are only ever added to; stock and wallets can never go below zero;
--   * every receipt into stores links to a purchase request or carries a reason; a write-off carries a reason and an approver;
--   * a waived library fine carries a reason; an asset is disposed of once; a bed, a copy and a textbook copy are held by one
--     person at a time;
--   * money is stored as whole cents and never negative where a negative makes no sense.
-- Which part a school has is a SchoolModule row (module 'facilities.hostel' ... 'facilities.assets'); no row means on.
-- (Existing assets, books and sick bay visits are copied across by the migration of the part that takes them over.)
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Foreign keys that the Prisma schema keeps as plain ids ──────────────────
DO $$
DECLARE t text; spec text; tab text; col text; ref text;
BEGIN
  FOREACH t IN ARRAY ARRAY['FacSettings', 'FacSequence', 'FacLedgerEntry', 'FacHostel', 'FacRoom', 'FacBed', 'FacBedAllocation', 'FacRollCall', 'FacRollCallEntry', 'FacInspection', 'FacInspectionItem', 'FacExeat', 'FacVisitorLog', 'FacSickBayVisit', 'FacMedicationRound', 'FacMedicationDose', 'FacWallet', 'FacWalletEntry', 'FacTuckShopSale', 'FacTuckShopSaleLine', 'FacTuckShopCashUp', 'FacBookTitle', 'FacBookCopy', 'FacLibraryMember', 'FacLoan', 'FacReservation', 'FacTextbookSet', 'FacTextbookIssue', 'FacStocktake', 'FacStocktakeScan', 'FacRoute', 'FacStop', 'FacStudentRoute', 'FacVehicle', 'FacVehicleDocument', 'FacDriver', 'FacDriverDocument', 'FacTrip', 'FacTripPassenger', 'FacFuelLog', 'FacVehicleBooking', 'FacStore', 'FacStockItem', 'FacStockLot', 'FacStockMovement', 'FacStockCount', 'FacStockCountLine', 'FacAssetCategory', 'FacAsset', 'FacAssetTransfer', 'FacMaintenanceSchedule', 'FacMaintenanceJob', 'FacAssetDisposal', 'FacVerificationRound', 'FacVerificationScan'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE', t, t || '_schoolId_fkey');
  END LOOP;
  FOREACH spec IN ARRAY ARRAY['FacHostel.boardingMasterId:User', 'FacHostel.matronId:User', 'FacRoom.hostelId:FacHostel', 'FacBed.roomId:FacRoom', 'FacBedAllocation.studentId:Student', 'FacBedAllocation.bedId:FacBed', 'FacBedAllocation.termId:AcademicTerm', 'FacBedAllocation.allocatedById:User', 'FacRollCall.hostelId:FacHostel', 'FacRollCall.takenById:User', 'FacRollCallEntry.rollCallId:FacRollCall', 'FacRollCallEntry.studentId:Student', 'FacInspection.hostelId:FacHostel', 'FacInspection.roomId:FacRoom', 'FacInspection.inspectedById:User', 'FacInspectionItem.inspectionId:FacInspection', 'FacInspectionItem.damageStudentId:Student', 'FacInspectionItem.damageApprovedById:User', 'FacInspectionItem.ledgerEntryId:FacLedgerEntry', 'FacExeat.studentId:Student', 'FacExeat.requestedById:User', 'FacExeat.approvedById:User', 'FacExeat.signedOutById:User', 'FacExeat.signedInById:User', 'FacExeat.calendarEventId:CalendarEvent', 'FacVisitorLog.studentId:Student', 'FacVisitorLog.guardianId:Guardian', 'FacVisitorLog.approvedById:User', 'FacVisitorLog.calendarEventId:CalendarEvent', 'FacVisitorLog.loggedById:User', 'FacSickBayVisit.studentId:Student', 'FacSickBayVisit.recordedById:User', 'FacMedicationRound.createdById:User', 'FacMedicationDose.roundId:FacMedicationRound', 'FacMedicationDose.studentId:Student', 'FacMedicationDose.medicationEntryId:MedicationEntry', 'FacMedicationDose.givenById:User', 'FacWallet.studentId:Student', 'FacWallet.closedById:User', 'FacWalletEntry.walletId:FacWallet', 'FacWalletEntry.paymentId:FinPayment', 'FacWalletEntry.saleId:FacTuckShopSale', 'FacWalletEntry.createdById:User', 'FacTuckShopSale.attendantId:User', 'FacTuckShopSale.studentId:Student', 'FacTuckShopSale.walletId:FacWallet', 'FacTuckShopSale.cashUpId:FacTuckShopCashUp', 'FacTuckShopSaleLine.saleId:FacTuckShopSale', 'FacTuckShopSaleLine.stockItemId:FacStockItem', 'FacTuckShopSaleLine.movementId:FacStockMovement', 'FacTuckShopCashUp.attendantId:User', 'FacTuckShopCashUp.confirmedById:User', 'FacBookCopy.titleId:FacBookTitle', 'FacLibraryMember.studentId:Student', 'FacLibraryMember.employeeId:Employee', 'FacLoan.copyId:FacBookCopy', 'FacLoan.memberId:FacLibraryMember', 'FacLoan.chargeId:FinCharge', 'FacLoan.ledgerEntryId:FacLedgerEntry', 'FacLoan.waivedById:User', 'FacLoan.checkedOutById:User', 'FacLoan.returnedToId:User', 'FacReservation.titleId:FacBookTitle', 'FacReservation.memberId:FacLibraryMember', 'FacTextbookSet.levelId:Level', 'FacTextbookIssue.copyId:FacBookCopy', 'FacTextbookIssue.studentId:Student', 'FacTextbookIssue.setId:FacTextbookSet', 'FacTextbookIssue.yearId:AcademicYear', 'FacTextbookIssue.issuedById:User', 'FacTextbookIssue.returnedById:User', 'FacTextbookIssue.chargeId:FinCharge', 'FacTextbookIssue.ledgerEntryId:FacLedgerEntry', 'FacStocktake.createdById:User', 'FacStocktakeScan.stocktakeId:FacStocktake', 'FacStocktakeScan.copyId:FacBookCopy', 'FacRoute.vehicleId:FacVehicle', 'FacRoute.driverId:FacDriver', 'FacStop.routeId:FacRoute', 'FacStudentRoute.studentId:Student', 'FacStudentRoute.routeId:FacRoute', 'FacStudentRoute.amStopId:FacStop', 'FacStudentRoute.pmStopId:FacStop', 'FacStudentRoute.termId:AcademicTerm', 'FacStudentRoute.chargeId:FinCharge', 'FacStudentRoute.ledgerEntryId:FacLedgerEntry', 'FacVehicle.assetId:FacAsset', 'FacVehicleDocument.vehicleId:FacVehicle', 'FacDriver.employeeId:Employee', 'FacDriverDocument.driverId:FacDriver', 'FacTrip.routeId:FacRoute', 'FacTrip.bookingId:FacVehicleBooking', 'FacTrip.vehicleId:FacVehicle', 'FacTrip.driverId:FacDriver', 'FacTrip.recordedById:User', 'FacTripPassenger.tripId:FacTrip', 'FacTripPassenger.bookingId:FacVehicleBooking', 'FacTripPassenger.studentId:Student', 'FacTripPassenger.chargeId:FinCharge', 'FacTripPassenger.ledgerEntryId:FacLedgerEntry', 'FacFuelLog.vehicleId:FacVehicle', 'FacFuelLog.tripId:FacTrip', 'FacFuelLog.expenseId:FinExpense', 'FacFuelLog.recordedById:User', 'FacVehicleBooking.vehicleId:FacVehicle', 'FacVehicleBooking.driverId:FacDriver', 'FacVehicleBooking.requestedById:User', 'FacVehicleBooking.approvedById:User', 'FacStore.storekeeperId:User', 'FacStockLot.itemId:FacStockItem', 'FacStockLot.storeId:FacStore', 'FacStockMovement.itemId:FacStockItem', 'FacStockMovement.storeId:FacStore', 'FacStockMovement.lotId:FacStockLot', 'FacStockMovement.purchaseRequestId:FinExpenseRequest', 'FacStockMovement.receiverEmployeeId:Employee', 'FacStockMovement.studentId:Student', 'FacStockMovement.chargeId:FinCharge', 'FacStockMovement.ledgerEntryId:FacLedgerEntry', 'FacStockMovement.countId:FacStockCount', 'FacStockMovement.approvedById:User', 'FacStockMovement.createdById:User', 'FacStockCount.storeId:FacStore', 'FacStockCount.createdById:User', 'FacStockCount.approvedById:User', 'FacStockCountLine.countId:FacStockCount', 'FacStockCountLine.itemId:FacStockItem', 'FacStockCountLine.lotId:FacStockLot', 'FacStockCountLine.movementId:FacStockMovement', 'FacAsset.categoryId:FacAssetCategory', 'FacAsset.custodianId:Employee', 'FacAsset.supplierId:Supplier', 'FacAsset.requestId:FinExpenseRequest', 'FacAsset.expenseId:FinExpense', 'FacAssetTransfer.assetId:FacAsset', 'FacAssetTransfer.fromCustodianId:Employee', 'FacAssetTransfer.toCustodianId:Employee', 'FacAssetTransfer.recordedById:User', 'FacAssetTransfer.confirmedById:User', 'FacMaintenanceSchedule.assetId:FacAsset', 'FacMaintenanceJob.assetId:FacAsset', 'FacMaintenanceJob.scheduleId:FacMaintenanceSchedule', 'FacMaintenanceJob.reportedById:User', 'FacMaintenanceJob.assignedToId:User', 'FacMaintenanceJob.expenseId:FinExpense', 'FacAssetDisposal.assetId:FacAsset', 'FacAssetDisposal.headApprovedById:User', 'FacAssetDisposal.ownerApprovedById:User', 'FacAssetDisposal.recordedById:User', 'FacVerificationRound.createdById:User', 'FacVerificationScan.roundId:FacVerificationRound', 'FacVerificationScan.assetId:FacAsset', 'FacVerificationScan.scannedById:User', 'FacLedgerEntry.studentId:Student', 'FacLedgerEntry.termId:AcademicTerm', 'FacLedgerEntry.chargeId:FinCharge', 'FacLedgerEntry.createdById:User'] LOOP
    tab := split_part(split_part(spec, '.', 1), ':', 1);
    col := split_part(split_part(spec, '.', 2), ':', 1);
    ref := split_part(spec, ':', 2);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I("id") ON DELETE RESTRICT ON UPDATE CASCADE', tab, tab || '_' || col || '_fkey', col, ref);
  END LOOP;
END $$;

-- ── Permission keys ─────────────────────────────────────────────────────────
-- Owner and Administrator hold them through '*'. Scoped roles (boarding master, matron, librarian, storekeeper, transport officer)
-- are given keys in System, Roles; nothing here grants them to anyone else.
INSERT INTO "Permission" ("key", "module", "description") VALUES
  -- The three "view" keys the sidebar used before the parts existed were never rows in this table, so no role could be given them.
  ('facilities.assets.view',        'facilities', 'See the asset register'),
  ('facilities.library.view',       'facilities', 'See the library catalogue and loans'),
  ('facilities.inventory.view',     'facilities', 'See stores and stock'),
  ('facilities.hostel.view',        'facilities', 'See the hostels, rooms, beds and roll calls'),
  ('facilities.hostel.manage',      'facilities', 'Set up hostels, rooms and beds'),
  ('facilities.hostel.allocate',    'facilities', 'Give learners beds and move them'),
  ('facilities.hostel.rollcall',    'facilities', 'Take the hostel roll call'),
  ('facilities.hostel.inspect',     'facilities', 'Inspect rooms'),
  ('facilities.exeats.request',     'facilities', 'Record exeat requests'),
  ('facilities.exeats.approve',     'facilities', 'Approve long and emergency exeats'),
  ('facilities.exeats.signout',     'facilities', 'Sign learners out and in at the gate or hostel office'),
  ('facilities.visitors.log',       'facilities', 'Keep the visitor log'),
  ('facilities.sickbay.record',     'facilities', 'Record sick bay visits and medication'),
  ('facilities.sickbay.view',       'facilities', 'See sick bay visit details'),
  ('facilities.wallets.manage',     'facilities', 'Take pocket money deposits and handle wallets'),
  ('facilities.wallets.view',       'facilities', 'See pocket money wallets'),
  ('facilities.tuckshop.sell',      'facilities', 'Sell at the tuck shop'),
  ('facilities.tuckshop.cashup',    'facilities', 'Cash up the tuck shop'),
  ('facilities.library.manage',     'facilities', 'Run the catalogue, members and library settings'),
  ('facilities.library.desk',       'facilities', 'Lend and take back books at the desk'),
  ('facilities.library.waive',      'facilities', 'Waive library fines'),
  ('facilities.textbooks.issue',    'facilities', 'Issue and collect textbooks'),
  ('facilities.transport.manage',   'facilities', 'Manage routes, vehicles, drivers and bookings'),
  ('facilities.transport.trips',    'facilities', 'Record daily trips and fuel'),
  ('facilities.transport.assign',   'facilities', 'Put learners on a route'),
  ('facilities.inventory.manage',   'facilities', 'Set up stores and stock items'),
  ('facilities.inventory.receive',  'facilities', 'Receive goods into stores'),
  ('facilities.inventory.issue',    'facilities', 'Issue, sell and transfer stock'),
  ('facilities.inventory.count',    'facilities', 'Count stock'),
  ('facilities.inventory.writeoff', 'facilities', 'Approve stock write-offs and count adjustments'),
  ('facilities.assets.manage',      'facilities', 'Keep the asset register'),
  ('facilities.assets.maintain',    'facilities', 'Assign and record maintenance'),
  ('facilities.assets.dispose',     'facilities', 'Approve the disposal of assets'),
  ('facilities.assets.verify',      'facilities', 'Run the annual asset verification')
ON CONFLICT ("key") DO NOTHING;

-- ── Which module an audit entry belongs to ──────────────────────────────────
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('audit_module(text)'::regprocedure) INTO def;
  def := replace(def, 'WHEN entity IN (''Asset'',', 'WHEN entity IN (''FacSettings'', ''FacSequence'', ''FacLedgerEntry'', ''FacHostel'', ''FacRoom'', ''FacBed'', ''FacBedAllocation'', ''FacRollCall'', ''FacRollCallEntry'', ''FacInspection'', ''FacInspectionItem'', ''FacExeat'', ''FacVisitorLog'', ''FacSickBayVisit'', ''FacMedicationRound'', ''FacMedicationDose'', ''FacWallet'', ''FacWalletEntry'', ''FacTuckShopSale'', ''FacTuckShopSaleLine'', ''FacTuckShopCashUp'', ''FacBookTitle'', ''FacBookCopy'', ''FacLibraryMember'', ''FacLoan'', ''FacReservation'', ''FacTextbookSet'', ''FacTextbookIssue'', ''FacStocktake'', ''FacStocktakeScan'', ''FacRoute'', ''FacStop'', ''FacStudentRoute'', ''FacVehicle'', ''FacVehicleDocument'', ''FacDriver'', ''FacDriverDocument'', ''FacTrip'', ''FacTripPassenger'', ''FacFuelLog'', ''FacVehicleBooking'', ''FacStore'', ''FacStockItem'', ''FacStockLot'', ''FacStockMovement'', ''FacStockCount'', ''FacStockCountLine'', ''FacAssetCategory'', ''FacAsset'', ''FacAssetTransfer'', ''FacMaintenanceSchedule'', ''FacMaintenanceJob'', ''FacAssetDisposal'', ''FacVerificationRound'', ''FacVerificationScan'') THEN ''facilities''
    WHEN entity IN (''Asset'',');
  EXECUTE def;
END $$;

-- ── Row-level security and the row-change audit ─────────────────────────────
-- Medical details, collectors' ID numbers and visitors' ID numbers are left out of the row-change audit: the audit log is readable
-- by people who must not see them. (The services keep who did what in the part's own records.)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['FacSettings', 'FacSequence', 'FacLedgerEntry', 'FacHostel', 'FacRoom', 'FacBed', 'FacBedAllocation', 'FacRollCall', 'FacRollCallEntry', 'FacInspection', 'FacInspectionItem', 'FacExeat', 'FacVisitorLog', 'FacSickBayVisit', 'FacMedicationRound', 'FacMedicationDose', 'FacWallet', 'FacWalletEntry', 'FacTuckShopSale', 'FacTuckShopSaleLine', 'FacTuckShopCashUp', 'FacBookTitle', 'FacBookCopy', 'FacLibraryMember', 'FacLoan', 'FacReservation', 'FacTextbookSet', 'FacTextbookIssue', 'FacStocktake', 'FacStocktakeScan', 'FacRoute', 'FacStop', 'FacStudentRoute', 'FacVehicle', 'FacVehicleDocument', 'FacDriver', 'FacDriverDocument', 'FacTrip', 'FacTripPassenger', 'FacFuelLog', 'FacVehicleBooking', 'FacStore', 'FacStockItem', 'FacStockLot', 'FacStockMovement', 'FacStockCount', 'FacStockCountLine', 'FacAssetCategory', 'FacAsset', 'FacAssetTransfer', 'FacMaintenanceSchedule', 'FacMaintenanceJob', 'FacAssetDisposal', 'FacVerificationRound', 'FacVerificationScan'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY school_isolation ON %I USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"))', t);
    IF t NOT IN ('FacSickBayVisit', 'FacMedicationDose', 'FacExeat', 'FacVisitorLog', 'FacSequence') THEN
      EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', 'audit_' || t, t);
    END IF;
  END LOOP;
END $$;
CREATE TRIGGER "audit_FacSickBayVisit" AFTER INSERT OR UPDATE OR DELETE ON "FacSickBayVisit"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('complaintNote', 'temperatureC', 'observations', 'treatment', 'medication', 'referral');
CREATE TRIGGER "audit_FacMedicationDose" AFTER INSERT OR UPDATE OR DELETE ON "FacMedicationDose"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('medicine', 'dose', 'note');
CREATE TRIGGER "audit_FacExeat" AFTER INSERT OR UPDATE OR DELETE ON "FacExeat" FOR EACH ROW EXECUTE FUNCTION audit_row_change('collectedBy');
CREATE TRIGGER "audit_FacVisitorLog" AFTER INSERT OR UPDATE OR DELETE ON "FacVisitorLog" FOR EACH ROW EXECUTE FUNCTION audit_row_change('idNumber', 'phone');

-- ── Same-school references ──────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT split_part(split_part(s, '.', 1), ':', 1) AS t,
           string_agg(quote_ident(split_part(split_part(s, '.', 2), ':', 1)), ', ') AS cols,
           string_agg(quote_literal(split_part(split_part(s, '.', 2), ':', 1) || ':' || split_part(s, ':', 2)), ', ') AS args
      FROM unnest(ARRAY['FacHostel.boardingMasterId:User', 'FacHostel.matronId:User', 'FacRoom.hostelId:FacHostel', 'FacBed.roomId:FacRoom', 'FacBedAllocation.studentId:Student', 'FacBedAllocation.bedId:FacBed', 'FacBedAllocation.termId:AcademicTerm', 'FacBedAllocation.allocatedById:User', 'FacRollCall.hostelId:FacHostel', 'FacRollCall.takenById:User', 'FacRollCallEntry.rollCallId:FacRollCall', 'FacRollCallEntry.studentId:Student', 'FacInspection.hostelId:FacHostel', 'FacInspection.roomId:FacRoom', 'FacInspection.inspectedById:User', 'FacInspectionItem.inspectionId:FacInspection', 'FacInspectionItem.damageStudentId:Student', 'FacInspectionItem.damageApprovedById:User', 'FacInspectionItem.ledgerEntryId:FacLedgerEntry', 'FacExeat.studentId:Student', 'FacExeat.requestedById:User', 'FacExeat.approvedById:User', 'FacExeat.signedOutById:User', 'FacExeat.signedInById:User', 'FacExeat.calendarEventId:CalendarEvent', 'FacVisitorLog.studentId:Student', 'FacVisitorLog.guardianId:Guardian', 'FacVisitorLog.approvedById:User', 'FacVisitorLog.calendarEventId:CalendarEvent', 'FacVisitorLog.loggedById:User', 'FacSickBayVisit.studentId:Student', 'FacSickBayVisit.recordedById:User', 'FacMedicationRound.createdById:User', 'FacMedicationDose.roundId:FacMedicationRound', 'FacMedicationDose.studentId:Student', 'FacMedicationDose.medicationEntryId:MedicationEntry', 'FacMedicationDose.givenById:User', 'FacWallet.studentId:Student', 'FacWallet.closedById:User', 'FacWalletEntry.walletId:FacWallet', 'FacWalletEntry.paymentId:FinPayment', 'FacWalletEntry.saleId:FacTuckShopSale', 'FacWalletEntry.createdById:User', 'FacTuckShopSale.attendantId:User', 'FacTuckShopSale.studentId:Student', 'FacTuckShopSale.walletId:FacWallet', 'FacTuckShopSale.cashUpId:FacTuckShopCashUp', 'FacTuckShopSaleLine.saleId:FacTuckShopSale', 'FacTuckShopSaleLine.stockItemId:FacStockItem', 'FacTuckShopSaleLine.movementId:FacStockMovement', 'FacTuckShopCashUp.attendantId:User', 'FacTuckShopCashUp.confirmedById:User', 'FacBookCopy.titleId:FacBookTitle', 'FacLibraryMember.studentId:Student', 'FacLibraryMember.employeeId:Employee', 'FacLoan.copyId:FacBookCopy', 'FacLoan.memberId:FacLibraryMember', 'FacLoan.chargeId:FinCharge', 'FacLoan.ledgerEntryId:FacLedgerEntry', 'FacLoan.waivedById:User', 'FacLoan.checkedOutById:User', 'FacLoan.returnedToId:User', 'FacReservation.titleId:FacBookTitle', 'FacReservation.memberId:FacLibraryMember', 'FacTextbookSet.levelId:Level', 'FacTextbookIssue.copyId:FacBookCopy', 'FacTextbookIssue.studentId:Student', 'FacTextbookIssue.setId:FacTextbookSet', 'FacTextbookIssue.yearId:AcademicYear', 'FacTextbookIssue.issuedById:User', 'FacTextbookIssue.returnedById:User', 'FacTextbookIssue.chargeId:FinCharge', 'FacTextbookIssue.ledgerEntryId:FacLedgerEntry', 'FacStocktake.createdById:User', 'FacStocktakeScan.stocktakeId:FacStocktake', 'FacStocktakeScan.copyId:FacBookCopy', 'FacRoute.vehicleId:FacVehicle', 'FacRoute.driverId:FacDriver', 'FacStop.routeId:FacRoute', 'FacStudentRoute.studentId:Student', 'FacStudentRoute.routeId:FacRoute', 'FacStudentRoute.amStopId:FacStop', 'FacStudentRoute.pmStopId:FacStop', 'FacStudentRoute.termId:AcademicTerm', 'FacStudentRoute.chargeId:FinCharge', 'FacStudentRoute.ledgerEntryId:FacLedgerEntry', 'FacVehicle.assetId:FacAsset', 'FacVehicleDocument.vehicleId:FacVehicle', 'FacDriver.employeeId:Employee', 'FacDriverDocument.driverId:FacDriver', 'FacTrip.routeId:FacRoute', 'FacTrip.bookingId:FacVehicleBooking', 'FacTrip.vehicleId:FacVehicle', 'FacTrip.driverId:FacDriver', 'FacTrip.recordedById:User', 'FacTripPassenger.tripId:FacTrip', 'FacTripPassenger.bookingId:FacVehicleBooking', 'FacTripPassenger.studentId:Student', 'FacTripPassenger.chargeId:FinCharge', 'FacTripPassenger.ledgerEntryId:FacLedgerEntry', 'FacFuelLog.vehicleId:FacVehicle', 'FacFuelLog.tripId:FacTrip', 'FacFuelLog.expenseId:FinExpense', 'FacFuelLog.recordedById:User', 'FacVehicleBooking.vehicleId:FacVehicle', 'FacVehicleBooking.driverId:FacDriver', 'FacVehicleBooking.requestedById:User', 'FacVehicleBooking.approvedById:User', 'FacStore.storekeeperId:User', 'FacStockLot.itemId:FacStockItem', 'FacStockLot.storeId:FacStore', 'FacStockMovement.itemId:FacStockItem', 'FacStockMovement.storeId:FacStore', 'FacStockMovement.lotId:FacStockLot', 'FacStockMovement.purchaseRequestId:FinExpenseRequest', 'FacStockMovement.receiverEmployeeId:Employee', 'FacStockMovement.studentId:Student', 'FacStockMovement.chargeId:FinCharge', 'FacStockMovement.ledgerEntryId:FacLedgerEntry', 'FacStockMovement.countId:FacStockCount', 'FacStockMovement.approvedById:User', 'FacStockMovement.createdById:User', 'FacStockCount.storeId:FacStore', 'FacStockCount.createdById:User', 'FacStockCount.approvedById:User', 'FacStockCountLine.countId:FacStockCount', 'FacStockCountLine.itemId:FacStockItem', 'FacStockCountLine.lotId:FacStockLot', 'FacStockCountLine.movementId:FacStockMovement', 'FacAsset.categoryId:FacAssetCategory', 'FacAsset.custodianId:Employee', 'FacAsset.supplierId:Supplier', 'FacAsset.requestId:FinExpenseRequest', 'FacAsset.expenseId:FinExpense', 'FacAssetTransfer.assetId:FacAsset', 'FacAssetTransfer.fromCustodianId:Employee', 'FacAssetTransfer.toCustodianId:Employee', 'FacAssetTransfer.recordedById:User', 'FacAssetTransfer.confirmedById:User', 'FacMaintenanceSchedule.assetId:FacAsset', 'FacMaintenanceJob.assetId:FacAsset', 'FacMaintenanceJob.scheduleId:FacMaintenanceSchedule', 'FacMaintenanceJob.reportedById:User', 'FacMaintenanceJob.assignedToId:User', 'FacMaintenanceJob.expenseId:FinExpense', 'FacAssetDisposal.assetId:FacAsset', 'FacAssetDisposal.headApprovedById:User', 'FacAssetDisposal.ownerApprovedById:User', 'FacAssetDisposal.recordedById:User', 'FacVerificationRound.createdById:User', 'FacVerificationScan.roundId:FacVerificationRound', 'FacVerificationScan.assetId:FacAsset', 'FacVerificationScan.scannedById:User', 'FacLedgerEntry.studentId:Student', 'FacLedgerEntry.termId:AcademicTerm', 'FacLedgerEntry.chargeId:FinCharge', 'FacLedgerEntry.createdById:User']) AS s
     GROUP BY 1
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %s ON %I FOR EACH ROW EXECUTE FUNCTION check_same_school(%s)', 'same_school_' || r.t, r.cols, r.t, r.args);
  END LOOP;
END $$;

-- ── Nothing is deleted; ledgers are only added to ───────────────────────────
CREATE OR REPLACE FUNCTION fac_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted. Items leave by issue, write-off, return or disposal, each with a reason.', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;
CREATE OR REPLACE FUNCTION fac_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows can only be added, never changed or deleted. Fix a mistake with a new row that reverses it.', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;
DO $$
DECLARE t text;
BEGIN
  -- A scan on a stocktake can be taken back (scanned by mistake); everything else stays.
  FOREACH t IN ARRAY ARRAY['FacSettings', 'FacSequence', 'FacLedgerEntry', 'FacHostel', 'FacRoom', 'FacBed', 'FacBedAllocation', 'FacRollCall', 'FacRollCallEntry', 'FacInspection', 'FacInspectionItem', 'FacExeat', 'FacVisitorLog', 'FacSickBayVisit', 'FacMedicationRound', 'FacMedicationDose', 'FacWallet', 'FacWalletEntry', 'FacTuckShopSale', 'FacTuckShopSaleLine', 'FacTuckShopCashUp', 'FacBookTitle', 'FacBookCopy', 'FacLibraryMember', 'FacLoan', 'FacReservation', 'FacTextbookSet', 'FacTextbookIssue', 'FacStocktake', 'FacRoute', 'FacStop', 'FacStudentRoute', 'FacVehicle', 'FacVehicleDocument', 'FacDriver', 'FacDriverDocument', 'FacTrip', 'FacTripPassenger', 'FacFuelLog', 'FacVehicleBooking', 'FacStore', 'FacStockItem', 'FacStockLot', 'FacStockMovement', 'FacStockCount', 'FacStockCountLine', 'FacAssetCategory', 'FacAsset', 'FacAssetTransfer', 'FacMaintenanceSchedule', 'FacMaintenanceJob', 'FacAssetDisposal', 'FacVerificationRound', 'FacVerificationScan'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fac_no_delete()', 'no_delete_' || t, t);
  END LOOP;
END $$;
CREATE TRIGGER "append_only_FacStockMovement" BEFORE UPDATE ON "FacStockMovement" FOR EACH ROW EXECUTE FUNCTION fac_append_only();
CREATE TRIGGER "append_only_FacWalletEntry" BEFORE UPDATE ON "FacWalletEntry" FOR EACH ROW EXECUTE FUNCTION fac_append_only();

-- ── Whole cents, sensible numbers ───────────────────────────────────────────
ALTER TABLE "FacSettings"
  ADD CONSTRAINT "FacSettings_values" CHECK ("exeatHeadAlertMinutes" >= 0 AND "longExeatNights" >= 0 AND "learnerMaxLoans" >= 0 AND "learnerLoanDays" >= 1
    AND "staffMaxLoans" >= 0 AND "staffLoanDays" >= 1 AND "lateFinePerDayCents" >= 0 AND "adjustmentLimitUsdCents" >= 0 AND "adjustmentLimitZigCents" >= 0
    AND "disposalOwnerLimitUsdCents" >= 0 AND "disposalOwnerLimitZigCents" >= 0 AND "walletLowBalanceCents" >= 0 AND "expiryWarningDays" >= 0);
ALTER TABLE "FacLedgerEntry" ADD CONSTRAINT "FacLedgerEntry_amount" CHECK ("amountCents" > 0),
  ADD CONSTRAINT "FacLedgerEntry_settled" CHECK (("status" = 'OPEN') = ("settledAt" IS NULL));
ALTER TABLE "FacHostel" ADD CONSTRAINT "FacHostel_values" CHECK ("capacity" >= 0 AND btrim("name") <> '');
ALTER TABLE "FacRoom" ADD CONSTRAINT "FacRoom_values" CHECK ("capacity" >= 0 AND btrim("name") <> '');
ALTER TABLE "FacBed" ADD CONSTRAINT "FacBed_values" CHECK (btrim("number") <> '');
ALTER TABLE "FacBedAllocation" ADD CONSTRAINT "FacBedAllocation_dates" CHECK ("toDate" IS NULL OR "toDate" >= "fromDate");
-- One bed per learner and one learner per bed at any time (a move closes the old allocation and opens a new one).
CREATE UNIQUE INDEX "FacBedAllocation_student_open" ON "FacBedAllocation"("studentId") WHERE "toDate" IS NULL;
CREATE UNIQUE INDEX "FacBedAllocation_bed_open" ON "FacBedAllocation"("bedId") WHERE "toDate" IS NULL;
ALTER TABLE "FacInspection" ADD CONSTRAINT "FacInspection_score" CHECK ("score" BETWEEN 0 AND 100);
ALTER TABLE "FacInspectionItem" ADD CONSTRAINT "FacInspectionItem_values" CHECK ("score" BETWEEN 0 AND 5 AND coalesce("damageCents", 0) >= 0 AND (("damageCents" IS NULL) = ("damageCurrency" IS NULL))
    AND ("damageCents" IS NULL OR "damageStudentId" IS NOT NULL));
ALTER TABLE "FacExeat"
  ADD CONSTRAINT "FacExeat_times" CHECK ("dueBackAt" > "outAt" AND ("signedInAt" IS NULL OR "signedOutAt" IS NOT NULL) AND ("signedInAt" IS NULL OR "signedInAt" >= "signedOutAt")),
  ADD CONSTRAINT "FacExeat_reason" CHECK (char_length(btrim("reason")) >= 3),
  ADD CONSTRAINT "FacExeat_status" CHECK (("status" NOT IN ('APPROVED', 'SIGNED_OUT', 'RETURNED') OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL))
    AND ("status" <> 'SIGNED_OUT' OR "signedOutAt" IS NOT NULL) AND ("status" <> 'RETURNED' OR "signedInAt" IS NOT NULL)
    AND ("status" <> 'REJECTED' OR char_length(btrim(coalesce("rejectedReason", ''))) >= 3));
ALTER TABLE "FacVisitorLog" ADD CONSTRAINT "FacVisitorLog_who" CHECK (btrim("visitorName") <> '' AND ("timeOut" IS NULL OR "timeOut" >= "timeIn")
    AND ("guardianId" IS NOT NULL OR "approvedById" IS NOT NULL));
ALTER TABLE "FacSickBayVisit" ADD CONSTRAINT "FacSickBayVisit_values" CHECK (("temperatureC" IS NULL OR "temperatureC" BETWEEN 25 AND 45)
    AND ("dischargedAt" IS NULL OR "admittedAt" IS NOT NULL) AND ("dischargedAt" IS NULL OR "dischargedAt" >= "admittedAt"));
ALTER TABLE "FacWallet" ADD CONSTRAINT "FacWallet_values" CHECK (coalesce("weeklyLimitCents", 0) >= 0 AND coalesce("lowBalanceCents", 0) >= 0
    AND (("closedAt" IS NULL) = ("closeAction" IS NULL)));
ALTER TABLE "FacWalletEntry" ADD CONSTRAINT "FacWalletEntry_sign" CHECK ("amountCents" <> 0
    AND (("type" = 'DEPOSIT' AND "amountCents" > 0) OR ("type" IN ('WITHDRAWAL', 'PURCHASE', 'REFUND') AND "amountCents" < 0))
    AND ("type" <> 'PURCHASE' OR "saleId" IS NOT NULL)
    AND ("type" <> 'DEPOSIT' OR "paymentId" IS NOT NULL OR char_length(btrim(coalesce("note", ''))) >= 3));
ALTER TABLE "FacTuckShopSale" ADD CONSTRAINT "FacTuckShopSale_values" CHECK ("totalCents" >= 0 AND "costCents" >= 0
    AND ("payment" <> 'WALLET' OR ("walletId" IS NOT NULL AND "studentId" IS NOT NULL)));
ALTER TABLE "FacTuckShopSaleLine" ADD CONSTRAINT "FacTuckShopSaleLine_values" CHECK ("qty" > 0 AND "unitPriceCents" >= 0 AND "unitCostCents" >= 0);
ALTER TABLE "FacTuckShopCashUp" ADD CONSTRAINT "FacTuckShopCashUp_values" CHECK ("expectedCashCents" >= 0 AND "countedCashCents" >= 0);
ALTER TABLE "FacBookTitle" ADD CONSTRAINT "FacBookTitle_values" CHECK (btrim("title") <> '' AND coalesce("replacementCents", 0) >= 0 AND (("replacementCents" IS NULL) = ("currency" IS NULL)));
ALTER TABLE "FacBookCopy" ADD CONSTRAINT "FacBookCopy_values" CHECK ("costCents" >= 0 AND btrim("accessionNo") <> '' AND btrim("barcode") <> '');
ALTER TABLE "FacLibraryMember" ADD CONSTRAINT "FacLibraryMember_who" CHECK (("studentId" IS NOT NULL) <> ("employeeId" IS NOT NULL)
    AND (("type" = 'LEARNER') = ("studentId" IS NOT NULL)) AND (NOT "suspended" OR char_length(btrim(coalesce("suspendedReason", ''))) >= 3));
ALTER TABLE "FacLoan"
  ADD CONSTRAINT "FacLoan_dates" CHECK ("dueAt" > "outAt" AND ("returnedAt" IS NULL OR "returnedAt" >= "outAt") AND "renewedCount" >= 0 AND "fineCents" >= 0),
  ADD CONSTRAINT "FacLoan_fine_currency" CHECK (("fineCents" = 0) OR ("fineCurrency" IS NOT NULL)),
  -- A waived fine carries a reason and the person who waived it.
  ADD CONSTRAINT "FacLoan_waive" CHECK ("waivedById" IS NULL OR (char_length(btrim(coalesce("waiveReason", ''))) >= 3));
-- A copy is on one loan at a time.
CREATE UNIQUE INDEX "FacLoan_copy_open" ON "FacLoan"("copyId") WHERE "returnedAt" IS NULL;
CREATE UNIQUE INDEX "FacReservation_open" ON "FacReservation"("titleId", "memberId") WHERE "fulfilledAt" IS NULL AND "cancelledAt" IS NULL;
-- A textbook copy is held by one learner at a time.
CREATE UNIQUE INDEX "FacTextbookIssue_copy_open" ON "FacTextbookIssue"("copyId") WHERE "returnedAt" IS NULL;
ALTER TABLE "FacTextbookIssue" ADD CONSTRAINT "FacTextbookIssue_values" CHECK (("returnedAt" IS NULL OR "returnedAt" >= "issuedAt") AND ("missingAt" IS NULL OR "returnedAt" IS NULL));
ALTER TABLE "FacRoute" ADD CONSTRAINT "FacRoute_values" CHECK ("feeCents" >= 0 AND btrim("name") <> '');
ALTER TABLE "FacStop" ADD CONSTRAINT "FacStop_values" CHECK ("sequence" >= 1 AND btrim("name") <> '');
ALTER TABLE "FacVehicle" ADD CONSTRAINT "FacVehicle_values" CHECK ("seats" > 0 AND "odometerKm" >= 0 AND btrim("registration") <> '');
ALTER TABLE "FacDriver" ADD CONSTRAINT "FacDriver_values" CHECK (btrim("licenceClass") <> '');
ALTER TABLE "FacTrip" ADD CONSTRAINT "FacTrip_values" CHECK (("routeId" IS NOT NULL OR "bookingId" IS NOT NULL) AND coalesce("odometerStart", 0) >= 0
    AND ("odometerEnd" IS NULL OR "odometerStart" IS NULL OR "odometerEnd" >= "odometerStart") AND ("arrivedAt" IS NULL OR "departedAt" IS NULL OR "arrivedAt" >= "departedAt"));
ALTER TABLE "FacTripPassenger" ADD CONSTRAINT "FacTripPassenger_where" CHECK (("tripId" IS NOT NULL) OR ("bookingId" IS NOT NULL));
ALTER TABLE "FacFuelLog" ADD CONSTRAINT "FacFuelLog_values" CHECK ("litres" > 0 AND "costCents" >= 0 AND coalesce("odometerKm", 0) >= 0);
ALTER TABLE "FacVehicleBooking" ADD CONSTRAINT "FacVehicleBooking_values" CHECK ("endAt" > "startAt" AND coalesce("perLearnerCents", 0) >= 0 AND (("perLearnerCents" IS NULL) = ("currency" IS NULL)));
ALTER TABLE "FacStockItem" ADD CONSTRAINT "FacStockItem_values" CHECK (btrim("name") <> '' AND "reorderLevel" >= 0 AND coalesce("priceCents", 0) >= 0 AND (("priceCents" IS NULL) = ("priceCurrency" IS NULL)));
ALTER TABLE "FacStockCount" ADD CONSTRAINT "FacStockCount_approved" CHECK ("status" <> 'APPROVED' OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL));
ALTER TABLE "FacStockCountLine" ADD CONSTRAINT "FacStockCountLine_values" CHECK ("expectedQty" >= 0 AND coalesce("countedQty", 0) >= 0);
ALTER TABLE "FacAssetCategory" ADD CONSTRAINT "FacAssetCategory_values" CHECK (coalesce("depreciationYears", 1) >= 1);
ALTER TABLE "FacAsset" ADD CONSTRAINT "FacAsset_values" CHECK ("costCents" >= 0 AND btrim("name") <> '' AND btrim("tag") <> '' AND btrim("location") <> '');
ALTER TABLE "FacMaintenanceSchedule" ADD CONSTRAINT "FacMaintenanceSchedule_values" CHECK (("everyMonths" IS NOT NULL OR "everyKm" IS NOT NULL) AND coalesce("everyMonths", 1) >= 1 AND coalesce("everyKm", 1) >= 1 AND "remindDaysBefore" >= 0);
ALTER TABLE "FacMaintenanceJob" ADD CONSTRAINT "FacMaintenanceJob_values" CHECK (coalesce("costCents", 0) >= 0 AND (("costCents" IS NULL) = ("currency" IS NULL))
    AND ("status" <> 'DONE' OR ("doneAt" IS NOT NULL AND char_length(btrim(coalesce("workDone", ''))) >= 3)) AND btrim("problem") <> '');
ALTER TABLE "FacAssetDisposal" ADD CONSTRAINT "FacAssetDisposal_values" CHECK (char_length(btrim("reason")) >= 3 AND coalesce("proceedsCents", 0) >= 0 AND (("proceedsCents" IS NULL) = ("currency" IS NULL))
    AND ("ownerApprovedById" IS NULL OR "ownerApprovedById" <> "headApprovedById"));

-- ── Stock: movements make sense and stock never goes below zero ─────────────
ALTER TABLE "FacStockMovement"
  ADD CONSTRAINT "FacStockMovement_values" CHECK ("qty" <> 0 AND "unitCostCents" >= 0
    AND ("type" <> 'IN' OR "qty" > 0)
    AND ("type" NOT IN ('ISSUE', 'SALE', 'WRITEOFF') OR "qty" < 0)),
  -- Every receipt links to a purchase request, or says why there is none (donation, opening stock).
  ADD CONSTRAINT "FacStockMovement_receipt" CHECK ("type" <> 'IN' OR "purchaseRequestId" IS NOT NULL OR char_length(btrim(coalesce("reason", ''))) >= 3),
  ADD CONSTRAINT "FacStockMovement_transfer" CHECK ("type" <> 'TRANSFER' OR "transferGroupId" IS NOT NULL),
  ADD CONSTRAINT "FacStockMovement_adjustment" CHECK ("type" <> 'ADJUSTMENT' OR char_length(btrim(coalesce("reason", ''))) >= 3),
  -- A write-off needs a reason and the Head's approval; it cannot be recorded without them.
  ADD CONSTRAINT "FacStockMovement_writeoff" CHECK ("type" <> 'WRITEOFF' OR ("writeoffReason" IS NOT NULL AND char_length(btrim(coalesce("reason", ''))) >= 3
    AND "approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL)),
  ADD CONSTRAINT "FacStockMovement_sale_issue" CHECK ("type" NOT IN ('ISSUE') OR "receiverName" IS NOT NULL OR "receiverEmployeeId" IS NOT NULL OR "department" IS NOT NULL);

CREATE OR REPLACE FUNCTION fac_stock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE on_hand double precision;
BEGIN
  IF NEW."qty" < 0 THEN
    -- Two people taking the last of an item at the same moment must not both succeed.
    PERFORM pg_advisory_xact_lock(hashtext('fac-stock:' || NEW."storeId" || ':' || NEW."itemId"));
    SELECT coalesce(sum("qty"), 0) INTO on_hand FROM "FacStockMovement" WHERE "itemId" = NEW."itemId" AND "storeId" = NEW."storeId";
    IF on_hand + NEW."qty" < -0.0000001 THEN
      RAISE EXCEPTION 'Not enough stock: % on hand, % asked for', on_hand, -NEW."qty" USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."lotId" IS NOT NULL THEN
      SELECT coalesce(sum("qty"), 0) INTO on_hand FROM "FacStockMovement" WHERE "lotId" = NEW."lotId";
      IF on_hand + NEW."qty" < -0.0000001 THEN
        RAISE EXCEPTION 'Not enough stock in that batch: % on hand, % asked for', on_hand, -NEW."qty" USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FacStockMovement" BEFORE INSERT ON "FacStockMovement" FOR EACH ROW EXECUTE FUNCTION fac_stock_guard();

-- ── Wallets: one currency per wallet, and a wallet is never overdrawn ───────
CREATE OR REPLACE FUNCTION fac_wallet_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w_currency "Currency"; balance bigint;
BEGIN
  SELECT "currency" INTO w_currency FROM "FacWallet" WHERE "id" = NEW."walletId";
  IF w_currency IS DISTINCT FROM NEW."currency" THEN
    RAISE EXCEPTION 'USD and ZiG are never mixed: this wallet holds %', w_currency USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."amountCents" < 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('fac-wallet:' || NEW."walletId"));
    SELECT coalesce(sum("amountCents"), 0) INTO balance FROM "FacWalletEntry" WHERE "walletId" = NEW."walletId";
    IF balance + NEW."amountCents" < 0 THEN
      RAISE EXCEPTION 'Not enough pocket money: balance is %, asked for %', balance, -NEW."amountCents" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FacWalletEntry" BEFORE INSERT ON "FacWalletEntry" FOR EACH ROW EXECUTE FUNCTION fac_wallet_guard();
