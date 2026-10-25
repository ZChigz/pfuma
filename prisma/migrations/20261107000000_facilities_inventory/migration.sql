-- AlterTable
ALTER TABLE "FacStockMovement" ADD COLUMN     "requestItemId" TEXT;

-- AlterTable
ALTER TABLE "FacStockCount" ADD COLUMN     "needsApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "submittedById" TEXT;

-- CreateTable
CREATE TABLE "FacWriteoffRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "qty" DOUBLE PRECISION NOT NULL,
    "writeoffReason" "FacWriteoffReason" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "FacApproval" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "movementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacWriteoffRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FacWriteoffRequest_schoolId_status_idx" ON "FacWriteoffRequest"("schoolId", "status");

-- CreateIndex
CREATE INDEX "FacWriteoffRequest_schoolId_storeId_idx" ON "FacWriteoffRequest"("schoolId", "storeId");

-- ═════════════════════════════════════════════════════════════════════════════
-- Inventory and stores: write-off requests (a write-off waits for the Head's approval before any stock moves), the line of the purchase
-- request a delivery fills in, and who submitted a stock count.
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE "FacWriteoffRequest" ADD CONSTRAINT "FacWriteoffRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacWriteoffRequest" ADD CONSTRAINT "FacWriteoffRequest_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "FacStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacWriteoffRequest" ADD CONSTRAINT "FacWriteoffRequest_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "FacStockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacWriteoffRequest" ADD CONSTRAINT "FacWriteoffRequest_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "FacStockLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacWriteoffRequest" ADD CONSTRAINT "FacWriteoffRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacWriteoffRequest" ADD CONSTRAINT "FacWriteoffRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacWriteoffRequest" ADD CONSTRAINT "FacWriteoffRequest_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "FacStockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacStockMovement" ADD CONSTRAINT "FacStockMovement_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "FinExpenseRequestItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacStockCount" ADD CONSTRAINT "FacStockCount_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FacWriteoffRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FacWriteoffRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "FacWriteoffRequest" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
CREATE TRIGGER "audit_FacWriteoffRequest" AFTER INSERT OR UPDATE OR DELETE ON "FacWriteoffRequest" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "no_delete_FacWriteoffRequest" BEFORE DELETE ON "FacWriteoffRequest" FOR EACH ROW EXECUTE FUNCTION fac_no_delete();
CREATE TRIGGER "same_school_FacWriteoffRequest" BEFORE INSERT OR UPDATE OF "storeId", "itemId", "lotId", "requestedById", "decidedById", "movementId" ON "FacWriteoffRequest"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('storeId:FacStore', 'itemId:FacStockItem', 'lotId:FacStockLot', 'requestedById:User', 'decidedById:User', 'movementId:FacStockMovement');
CREATE TRIGGER "same_school_FacStockMovement_request" BEFORE INSERT ON "FacStockMovement" FOR EACH ROW EXECUTE FUNCTION check_same_school('requestItemId:FinExpenseRequestItem');
CREATE TRIGGER "same_school_FacStockCount_submitter" BEFORE INSERT OR UPDATE OF "submittedById" ON "FacStockCount" FOR EACH ROW EXECUTE FUNCTION check_same_school('submittedById:User');

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('audit_module(text)'::regprocedure) INTO def;
  def := replace(def, 'WHEN entity IN (''FacSettings'',', 'WHEN entity IN (''FacWriteoffRequest'', ''FacSettings'',');
  EXECUTE def;
END $$;

-- Whoever asks for a write-off is never the person who approves it; a decision is written down.
ALTER TABLE "FacWriteoffRequest"
  ADD CONSTRAINT "FacWriteoffRequest_values" CHECK ("qty" > 0 AND char_length(btrim("reason")) >= 3),
  ADD CONSTRAINT "FacWriteoffRequest_decided" CHECK (("status" = 'PENDING') = ("decidedById" IS NULL AND "decidedAt" IS NULL)),
  ADD CONSTRAINT "FacWriteoffRequest_people" CHECK ("decidedById" IS NULL OR "decidedById" <> "requestedById"),
  ADD CONSTRAINT "FacWriteoffRequest_rejected" CHECK ("status" <> 'REJECTED' OR char_length(btrim(coalesce("decisionReason", ''))) >= 3),
  ADD CONSTRAINT "FacWriteoffRequest_approved" CHECK (("status" = 'APPROVED') = ("movementId" IS NOT NULL));

-- A count that needs approval is not posted by the person who submitted it.
ALTER TABLE "FacStockCount" ADD CONSTRAINT "FacStockCount_approver" CHECK ("approvedById" IS NULL OR "submittedById" IS NULL OR "approvedById" <> "submittedById");

