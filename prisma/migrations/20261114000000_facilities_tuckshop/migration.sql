-- Tuck shop and pocket money rules the database holds whatever the code does:
--   * pocket money is held in trust: a payment into a fund of kind TRUST can never be used against a fee (no allocation to a charge);
--   * only a boarder has a wallet, and a closed wallet takes no more entries;
--   * a purchase from a wallet belongs to a sale on that wallet for exactly that amount, and cannot take a week's spending over the wallet's limit;
--   * a sale paid from a wallet names the wallet and the learner, a cash sale names neither wallet;
--   * the person who counts the cash is not the person who confirms the cash-up.
CREATE OR REPLACE FUNCTION fac_no_fee_from_trust() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k "FundKind";
BEGIN
  SELECT f."kind" INTO k FROM "FinPayment" p JOIN "Fund" f ON f."id" = p."fundId" WHERE p."id" = NEW."paymentId";
  IF k = 'TRUST' THEN
    RAISE EXCEPTION 'Pocket money is held in trust and is never used against a fee' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "aa_guard_trust_allocation" BEFORE INSERT ON "FinPaymentAllocation" FOR EACH ROW EXECUTE FUNCTION fac_no_fee_from_trust();

CREATE OR REPLACE FUNCTION fac_wallet_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "BoardingType";
BEGIN
  SELECT "boarding" INTO b FROM "Student" WHERE "id" = NEW."studentId";
  IF b IS DISTINCT FROM 'BOARDER' THEN
    RAISE EXCEPTION 'Only a boarder has a pocket money wallet' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "guard_FacWallet" BEFORE INSERT ON "FacWallet" FOR EACH ROW EXECUTE FUNCTION fac_wallet_owner_guard();

CREATE OR REPLACE FUNCTION fac_wallet_entry_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w RECORD; s RECORD; spent bigint; week_start timestamp;
BEGIN
  SELECT "closedAt", "weeklyLimitCents" INTO w FROM "FacWallet" WHERE "id" = NEW."walletId";
  IF w."closedAt" IS NOT NULL AND NEW."type" <> 'REFUND' THEN
    RAISE EXCEPTION 'This wallet is closed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."type" = 'PURCHASE' THEN
    SELECT "walletId", "totalCents", "payment" INTO s FROM "FacTuckShopSale" WHERE "id" = NEW."saleId";
    IF s."walletId" IS DISTINCT FROM NEW."walletId" OR s."payment" <> 'WALLET' OR s."totalCents" <> -NEW."amountCents" THEN
      RAISE EXCEPTION 'A purchase must match a tuck shop sale paid from this wallet' USING ERRCODE = 'check_violation';
    END IF;
    IF w."weeklyLimitCents" IS NOT NULL THEN
      week_start := date_trunc('week', (now() AT TIME ZONE 'Africa/Harare'));
      SELECT coalesce(-sum("amountCents"), 0) INTO spent FROM "FacWalletEntry"
       WHERE "walletId" = NEW."walletId" AND "type" = 'PURCHASE' AND ("createdAt" AT TIME ZONE 'Africa/Harare') >= week_start;
      IF spent - NEW."amountCents" > w."weeklyLimitCents" THEN
        RAISE EXCEPTION 'This is over the weekly spending limit (% of % spent)', spent, w."weeklyLimitCents" USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "rules_FacWalletEntry" BEFORE INSERT ON "FacWalletEntry" FOR EACH ROW EXECUTE FUNCTION fac_wallet_entry_rules();

ALTER TABLE "FacTuckShopSale" ADD CONSTRAINT "FacTuckShopSale_payer" CHECK (("payment" = 'WALLET' AND "walletId" IS NOT NULL AND "studentId" IS NOT NULL) OR ("payment" = 'CASH' AND "walletId" IS NULL));
ALTER TABLE "FacTuckShopCashUp" ADD CONSTRAINT "FacTuckShopCashUp_confirmer" CHECK ("confirmedById" IS NULL OR "confirmedById" <> "attendantId");
ALTER TABLE "FacTuckShopCashUp" ADD CONSTRAINT "FacTuckShopCashUp_difference" CHECK ("countedCashCents" = "expectedCashCents" OR char_length(btrim(coalesce("note", ''))) >= 3);
