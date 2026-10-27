-- Library and textbook issue: rules the database keeps by itself.
--   * a book can be renewed once;
--   * a fine belongs to a loan that has been closed (returned, or lost / damaged beyond use);
--   * only one stocktake is open at a time;
--   * a lost or withdrawn copy is never lent or issued again.
ALTER TABLE "FacLoan"
  ADD CONSTRAINT "FacLoan_renewed_once" CHECK ("renewedCount" <= 1),
  ADD CONSTRAINT "FacLoan_fine_closed" CHECK ("fineCents" = 0 OR "returnedAt" IS NOT NULL);

ALTER TABLE "FacReservation"
  ADD CONSTRAINT "FacReservation_closed_once" CHECK (NOT ("fulfilledAt" IS NOT NULL AND "cancelledAt" IS NOT NULL));

ALTER TABLE "FacStocktake" ADD CONSTRAINT "FacStocktake_name" CHECK (char_length(btrim("name")) >= 2);

-- Only one stocktake is open at a time.
CREATE UNIQUE INDEX "FacStocktake_one_open" ON "FacStocktake"("schoolId") WHERE "closedAt" IS NULL;

-- A lost or damaged-beyond-use copy is never lent again: a loan cannot be opened on a copy that is not on the shelf or kept for the member.
CREATE OR REPLACE FUNCTION fac_loan_copy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st "FacCopyStatus";
BEGIN
  IF NEW."returnedAt" IS NULL THEN
    SELECT "status" INTO st FROM "FacBookCopy" WHERE "id" = NEW."copyId";
    IF st IN ('LOST', 'WITHDRAWN') THEN
      RAISE EXCEPTION 'A % copy cannot be lent', lower(st::text) USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FacLoan_copy" BEFORE INSERT ON "FacLoan" FOR EACH ROW EXECUTE FUNCTION fac_loan_copy_guard();
CREATE TRIGGER "guard_FacTextbookIssue_copy" BEFORE INSERT ON "FacTextbookIssue" FOR EACH ROW EXECUTE FUNCTION fac_loan_copy_guard();
