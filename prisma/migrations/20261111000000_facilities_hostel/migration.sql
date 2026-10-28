-- AlterTable
ALTER TABLE "FacInspectionItem" ADD COLUMN     "damageChargeId" TEXT;

-- ═════════════════════════════════════════════════════════════════════════════
-- Hostel: the rules the database keeps itself.
--   * only a boarder can be given a bed, and only in a hostel for their gender, in a room and a bed that are in use;
--   * a roll call entry for a learner on exeat, in the sick bay or suspended is filled in by the system and locked, and only those are locked;
--   * a damage charge from an inspection is approved by a named person before anything is charged.
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE "FacInspectionItem" ADD CONSTRAINT "FacInspectionItem_damageChargeId_fkey" FOREIGN KEY ("damageChargeId") REFERENCES "FinCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "same_school_FacInspectionItem_charge" BEFORE INSERT OR UPDATE OF "damageChargeId" ON "FacInspectionItem" FOR EACH ROW EXECUTE FUNCTION check_same_school('damageChargeId:FinCharge');

ALTER TABLE "FacRollCallEntry" ADD CONSTRAINT "FacRollCallEntry_locked" CHECK (("status" IN ('EXEAT', 'SICK_BAY', 'SUSPENDED')) = "locked");
ALTER TABLE "FacInspectionItem" ADD CONSTRAINT "FacInspectionItem_damage_decided" CHECK ("damageStatus" IS NULL OR "damageStatus" = 'PENDING' OR "damageApprovedById" IS NOT NULL);

CREATE OR REPLACE FUNCTION fac_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_boarding "BoardingType"; v_sgender "Gender"; v_hgender "Gender"; v_bed boolean; v_room boolean; v_host boolean;
BEGIN
  SELECT s."boarding", s."gender" INTO v_boarding, v_sgender FROM "Student" s WHERE s."id" = NEW."studentId";
  IF v_boarding IS DISTINCT FROM 'BOARDER' THEN
    RAISE EXCEPTION 'Only a boarder can be given a bed. Change the learner to a boarder first; the boarding charge is added from that date.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT b."active", r."active", h."active", h."gender" INTO v_bed, v_room, v_host, v_hgender
    FROM "FacBed" b JOIN "FacRoom" r ON r."id" = b."roomId" JOIN "FacHostel" h ON h."id" = r."hostelId" WHERE b."id" = NEW."bedId";
  IF NOT (coalesce(v_bed, false) AND coalesce(v_room, false) AND coalesce(v_host, false)) THEN
    RAISE EXCEPTION 'That bed, room or hostel is not in use' USING ERRCODE = 'check_violation';
  END IF;
  IF v_sgender IS NOT NULL AND v_hgender IS DISTINCT FROM v_sgender THEN
    RAISE EXCEPTION 'This hostel is for %', CASE v_hgender WHEN 'M' THEN 'boys' ELSE 'girls' END USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FacBedAllocation" BEFORE INSERT ON "FacBedAllocation" FOR EACH ROW EXECUTE FUNCTION fac_allocation_guard();
