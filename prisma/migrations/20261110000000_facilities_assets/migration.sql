-- AlterTable
ALTER TABLE "FacAsset" ADD COLUMN     "requestItemId" TEXT;

-- CreateTable
CREATE TABLE "FacDisposalRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "method" "FacDisposalMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "proceedsCents" INTEGER,
    "currency" "Currency",
    "valueCents" INTEGER NOT NULL,
    "valueCurrency" "Currency" NOT NULL,
    "needsOwner" BOOLEAN NOT NULL DEFAULT false,
    "status" "FacApproval" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "headApprovedById" TEXT,
    "headApprovedAt" TIMESTAMP(3),
    "ownerApprovedById" TEXT,
    "ownerApprovedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "disposalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacDisposalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FacDisposalRequest_schoolId_status_idx" ON "FacDisposalRequest"("schoolId", "status");

-- CreateIndex
CREATE INDEX "FacDisposalRequest_schoolId_assetId_idx" ON "FacDisposalRequest"("schoolId", "assetId");

-- ═════════════════════════════════════════════════════════════════════════════
-- Assets and maintenance: disposal requests, the purchase-request line an asset was bought on, and the rules the database keeps itself:
--   * an asset is disposed of once, with the Head's approval; above the school's value limit the Owner approves too (a different person);
--   * a disposed asset is never changed again, and an asset only becomes Disposed through a disposal;
--   * whoever asks for a disposal is not the person who approves it.
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE "FacDisposalRequest" ADD CONSTRAINT "FacDisposalRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacDisposalRequest" ADD CONSTRAINT "FacDisposalRequest_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FacAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacDisposalRequest" ADD CONSTRAINT "FacDisposalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacDisposalRequest" ADD CONSTRAINT "FacDisposalRequest_headApprovedById_fkey" FOREIGN KEY ("headApprovedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacDisposalRequest" ADD CONSTRAINT "FacDisposalRequest_ownerApprovedById_fkey" FOREIGN KEY ("ownerApprovedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacDisposalRequest" ADD CONSTRAINT "FacDisposalRequest_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacDisposalRequest" ADD CONSTRAINT "FacDisposalRequest_disposalId_fkey" FOREIGN KEY ("disposalId") REFERENCES "FacAssetDisposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacAsset" ADD CONSTRAINT "FacAsset_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "FinExpenseRequestItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FacDisposalRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FacDisposalRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "FacDisposalRequest" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
CREATE TRIGGER "audit_FacDisposalRequest" AFTER INSERT OR UPDATE OR DELETE ON "FacDisposalRequest" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "no_delete_FacDisposalRequest" BEFORE DELETE ON "FacDisposalRequest" FOR EACH ROW EXECUTE FUNCTION fac_no_delete();
CREATE TRIGGER "same_school_FacDisposalRequest" BEFORE INSERT OR UPDATE OF "assetId", "requestedById", "headApprovedById", "ownerApprovedById", "rejectedById", "disposalId" ON "FacDisposalRequest"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('assetId:FacAsset', 'requestedById:User', 'headApprovedById:User', 'ownerApprovedById:User', 'rejectedById:User', 'disposalId:FacAssetDisposal');
CREATE TRIGGER "same_school_FacAsset_request" BEFORE INSERT ON "FacAsset" FOR EACH ROW EXECUTE FUNCTION check_same_school('requestItemId:FinExpenseRequestItem');

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('audit_module(text)'::regprocedure) INTO def;
  def := replace(def, 'WHEN entity IN (''FacWriteoffRequest'',', 'WHEN entity IN (''FacDisposalRequest'', ''FacWriteoffRequest'',');
  EXECUTE def;
END $$;

-- One request waiting per asset.
CREATE UNIQUE INDEX "FacDisposalRequest_one_pending" ON "FacDisposalRequest"("assetId") WHERE "status" = 'PENDING';

ALTER TABLE "FacDisposalRequest"
  ADD CONSTRAINT "FacDisposalRequest_values" CHECK (char_length(btrim("reason")) >= 3 AND "valueCents" >= 0 AND coalesce("proceedsCents", 0) >= 0 AND (("proceedsCents" IS NULL) = ("currency" IS NULL))),
  ADD CONSTRAINT "FacDisposalRequest_people" CHECK (("headApprovedById" IS NULL OR "headApprovedById" <> "requestedById")
    AND ("ownerApprovedById" IS NULL OR ("ownerApprovedById" <> "requestedById" AND "ownerApprovedById" IS DISTINCT FROM "headApprovedById"))),
  ADD CONSTRAINT "FacDisposalRequest_rejected" CHECK ("status" <> 'REJECTED' OR ("rejectedById" IS NOT NULL AND char_length(btrim(coalesce("rejectionReason", ''))) >= 3)),
  ADD CONSTRAINT "FacDisposalRequest_approved" CHECK (("status" = 'APPROVED') = ("disposalId" IS NOT NULL)
    AND ("status" <> 'APPROVED' OR ("headApprovedById" IS NOT NULL AND (NOT "needsOwner" OR "ownerApprovedById" IS NOT NULL))));

ALTER TABLE "FacAssetTransfer" ADD CONSTRAINT "FacAssetTransfer_moves" CHECK ("fromLocation" <> "toLocation" OR "fromCustodianId" IS DISTINCT FROM "toCustodianId");

-- A disposal above the school's limit has the Owner's approval too. The limit is the school's own setting; with no setting every asset that
-- cost something needs it. USD and ZiG are each compared with their own limit.
CREATE OR REPLACE FUNCTION fac_disposal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cost int; cur "Currency"; lim int;
BEGIN
  SELECT "costCents", "currency" INTO cost, cur FROM "FacAsset" WHERE "id" = NEW."assetId";
  SELECT CASE cur WHEN 'USD' THEN "disposalOwnerLimitUsdCents" ELSE "disposalOwnerLimitZigCents" END INTO lim FROM "FacSettings" WHERE "schoolId" = NEW."schoolId";
  lim := coalesce(lim, 0);
  IF cost > lim AND NEW."ownerApprovedById" IS NULL THEN
    RAISE EXCEPTION 'This asset cost more than the limit the school set (% cents), so the Owner must approve its disposal too', lim USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FacAssetDisposal" BEFORE INSERT ON "FacAssetDisposal" FOR EACH ROW EXECUTE FUNCTION fac_disposal_guard();

CREATE OR REPLACE FUNCTION fac_asset_disposed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'DISPOSED' THEN
    RAISE EXCEPTION 'A disposed asset cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'DISPOSED' AND NOT EXISTS (SELECT 1 FROM "FacAssetDisposal" WHERE "assetId" = NEW."id") THEN
    RAISE EXCEPTION 'An asset becomes disposed only through an approved disposal' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FacAsset_disposed" BEFORE UPDATE ON "FacAsset" FOR EACH ROW EXECUTE FUNCTION fac_asset_disposed_guard();

-- A transfer is confirmed once, by the new custodian.
CREATE OR REPLACE FUNCTION fac_transfer_confirm_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."confirmedAt" IS NOT NULL AND (NEW."confirmedAt" IS DISTINCT FROM OLD."confirmedAt" OR NEW."confirmedById" IS DISTINCT FROM OLD."confirmedById") THEN
    RAISE EXCEPTION 'This transfer was already confirmed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FacAssetTransfer_confirm" BEFORE UPDATE ON "FacAssetTransfer" FOR EACH ROW EXECUTE FUNCTION fac_transfer_confirm_guard();
