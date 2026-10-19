-- Part 5.3 / 5.4 / 5.5 — dated exchange rates, password reset tokens, asset transfers and income.

ALTER TYPE "AuditAction" ADD VALUE 'SET_EXCHANGE_RATE';
ALTER TYPE "AuditAction" ADD VALUE 'TRANSFER_ASSET';
ALTER TYPE "AuditAction" ADD VALUE 'RECORD_INCOME';
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_PASSWORD_RESET';
ALTER TYPE "AuditAction" ADD VALUE 'USE_PASSWORD_RESET';

-- ── 5.3 Exchange rates with effective dates ─────────────────────────────────
CREATE TYPE "RateSource" AS ENUM ('RBZ', 'SCHOOL', 'OTHER');
ALTER TABLE "ExchangeRate"
  ADD COLUMN "effectiveFrom" TIMESTAMP(3),
  ADD COLUMN "source" "RateSource" NOT NULL DEFAULT 'SCHOOL';
UPDATE "ExchangeRate" SET "effectiveFrom" = "createdAt";   -- existing rates applied from the moment they were set
ALTER TABLE "ExchangeRate" ALTER COLUMN "effectiveFrom" SET NOT NULL, ALTER COLUMN "effectiveFrom" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "ExchangeRate_schoolId_effectiveFrom_idx" ON "ExchangeRate"("schoolId", "effectiveFrom");

-- Rates are history: a correction is a new row.
CREATE TRIGGER "exchange_rate_no_change" BEFORE UPDATE OR DELETE ON "ExchangeRate"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- A payment points at the exact rate row it used.
ALTER TABLE "Payment" ADD COLUMN "exchangeRateId" TEXT;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_exchangeRateId_fkey"
  FOREIGN KEY ("exchangeRateId") REFERENCES "ExchangeRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "Payment" p
   SET "exchangeRateId" = (
     SELECT r."id" FROM "ExchangeRate" r
      WHERE r."schoolId" = p."schoolId" AND r."usdToZig" = p."exchangeRateUsed" AND r."effectiveFrom" <= p."recordedAt"
      ORDER BY r."effectiveFrom" DESC, r."createdAt" DESC LIMIT 1)
 WHERE p."exchangeRateUsed" IS NOT NULL;
DROP TRIGGER IF EXISTS "same_school_Payment" ON "Payment";
CREATE TRIGGER "same_school_Payment" BEFORE INSERT OR UPDATE OF "studentId", "recordedBy", "verifiedBy", "voidedBy", "exchangeRateId" ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('studentId:Student', 'recordedBy:User', 'verifiedBy:User', 'voidedBy:User', 'exchangeRateId:ExchangeRate');

-- ── 5.4 Auth.js tables out, password reset tokens in ────────────────────────
DROP TABLE "Account" CASCADE;
DROP TABLE "Session" CASCADE;
DROP TABLE "VerificationToken" CASCADE;

CREATE TABLE "PasswordResetToken" (
    "id"          TEXT NOT NULL,
    "schoolId"    TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "tokenHash"   TEXT NOT NULL,
    "expiresAt"   TIMESTAMP(3) NOT NULL,
    "usedAt"      TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_schoolId_idx" ON "PasswordResetToken"("schoolId");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "PasswordResetToken" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
CREATE TRIGGER "same_school_PasswordResetToken" BEFORE INSERT OR UPDATE OF "userId", "createdById" ON "PasswordResetToken"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('userId:User', 'createdById:User');

-- ── 5.5 Assets ──────────────────────────────────────────────────────────────
-- Tag numbers become unique per school; existing duplicates get a -2, -3 … suffix.
UPDATE "Asset" a
   SET "tagNumber" = a."tagNumber" || '-' || d.rn
  FROM (SELECT "id", row_number() OVER (PARTITION BY "schoolId", "tagNumber" ORDER BY "createdAt", "id") AS rn FROM "Asset") d
 WHERE a."id" = d."id" AND d.rn > 1;
CREATE UNIQUE INDEX "Asset_schoolId_tagNumber_key" ON "Asset"("schoolId", "tagNumber");

ALTER TABLE "Asset" ADD COLUMN "custodianId" TEXT;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- A custodian typed as free text that matches exactly one staff member becomes a link.
UPDATE "Asset" a SET "custodianId" = u."id"
  FROM (SELECT "schoolId", lower("fullName") AS n, min("id") AS id, count(*) AS c FROM "User" GROUP BY 1, 2) u
 WHERE u."schoolId" = a."schoolId" AND u.n = lower(a."custodian") AND u.c = 1;
DROP TRIGGER IF EXISTS "same_school_Asset" ON "Asset";
CREATE TRIGGER "same_school_Asset" BEFORE INSERT OR UPDATE OF "categoryId", "custodianId" ON "Asset"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('categoryId:AssetCategory', 'custodianId:User');

CREATE TABLE "AssetTransfer" (
    "id"                TEXT NOT NULL,
    "schoolId"          TEXT NOT NULL,
    "assetId"           TEXT NOT NULL,
    "fromLocation"      TEXT NOT NULL,
    "toLocation"        TEXT NOT NULL,
    "fromCustodianId"   TEXT,
    "toCustodianId"     TEXT,
    "fromCustodianName" TEXT,
    "toCustodianName"   TEXT,
    "transferDate"      TIMESTAMP(3) NOT NULL,
    "note"              TEXT,
    "recordedById"      TEXT NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetTransfer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AssetTransfer_schoolId_idx" ON "AssetTransfer"("schoolId");
CREATE INDEX "AssetTransfer_assetId_transferDate_idx" ON "AssetTransfer"("assetId", "transferDate");
ALTER TABLE "AssetTransfer" ADD CONSTRAINT "AssetTransfer_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssetTransfer" ADD CONSTRAINT "AssetTransfer_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssetTransfer" ADD CONSTRAINT "AssetTransfer_fromCustodianId_fkey" FOREIGN KEY ("fromCustodianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssetTransfer" ADD CONSTRAINT "AssetTransfer_toCustodianId_fkey" FOREIGN KEY ("toCustodianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssetTransfer" ADD CONSTRAINT "AssetTransfer_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssetTransfer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssetTransfer" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "AssetTransfer" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
CREATE TRIGGER "same_school_AssetTransfer" BEFORE INSERT OR UPDATE OF "assetId", "fromCustodianId", "toCustodianId", "recordedById" ON "AssetTransfer"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('assetId:Asset', 'fromCustodianId:User', 'toCustodianId:User', 'recordedById:User');
CREATE TRIGGER "asset_transfer_no_change" BEFORE UPDATE OR DELETE ON "AssetTransfer"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TYPE "IncomeSource" AS ENUM ('ASSET_DISPOSAL', 'OTHER');
CREATE TABLE "Income" (
    "id"              TEXT NOT NULL,
    "schoolId"        TEXT NOT NULL,
    "source"          "IncomeSource" NOT NULL,
    "amount"          DECIMAL(14,2) NOT NULL,
    "currency"        "Currency" NOT NULL,
    "receivedOn"      TIMESTAMP(3) NOT NULL,
    "description"     TEXT NOT NULL,
    "assetDisposalId" TEXT,
    "recordedById"    TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Income_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Income_amount_positive" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "Income_assetDisposalId_key" ON "Income"("assetDisposalId");
CREATE INDEX "Income_schoolId_idx" ON "Income"("schoolId");
CREATE INDEX "Income_schoolId_currency_idx" ON "Income"("schoolId", "currency");
ALTER TABLE "Income" ADD CONSTRAINT "Income_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Income" ADD CONSTRAINT "Income_assetDisposalId_fkey" FOREIGN KEY ("assetDisposalId") REFERENCES "AssetDisposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Income" ADD CONSTRAINT "Income_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Income" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Income" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Income" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
CREATE TRIGGER "same_school_Income" BEFORE INSERT OR UPDATE OF "assetDisposalId", "recordedById" ON "Income"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('assetDisposalId:AssetDisposal', 'recordedById:User');

-- Disposals recorded before this change that already have proceeds now show up as income.
INSERT INTO "Income" ("id", "schoolId", "source", "amount", "currency", "receivedOn", "description", "assetDisposalId", "recordedById")
SELECT gen_random_uuid()::text, d."schoolId", 'ASSET_DISPOSAL', d."proceeds", d."currency", d."disposalDate",
       'Disposal of ' || a."name" || ' (' || a."tagNumber" || ')', d."id", d."recordedBy"
  FROM "AssetDisposal" d JOIN "Asset" a ON a."id" = d."assetId"
 WHERE d."proceeds" > 0 AND d."currency" IS NOT NULL;
