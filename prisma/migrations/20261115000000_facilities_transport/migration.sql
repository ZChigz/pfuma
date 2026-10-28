-- Transport rules the database holds whatever the code does:
--   * a trip cannot be recorded for a vehicle whose licence, insurance or fitness paper has run out (or has none), or whose route permit,
--     if it has one, has run out; nor for a driver whose driving licence is missing or out of date, or whose defensive driving certificate,
--     if they have one, is out of date. The newest paper of each kind is the one that counts;
--   * a vehicle or a driver is not booked twice for the same time;
--   * the person who asks for a booking does not approve it;
--   * a route never carries more learners than its vehicle has seats, and a learner's stops are stops of the learner's route.
CREATE OR REPLACE FUNCTION fac_transport_paper_problem(p_vehicle text, p_driver text, p_on date) RETURNS text LANGUAGE plpgsql AS $$
DECLARE kind text; latest date; plate text; who text;
BEGIN
  IF p_vehicle IS NOT NULL THEN
    SELECT "registration" INTO plate FROM "FacVehicle" WHERE "id" = p_vehicle;
    FOREACH kind IN ARRAY ARRAY['LICENCE', 'INSURANCE', 'FITNESS', 'ROUTE_PERMIT'] LOOP
      SELECT "expiry" INTO latest FROM "FacVehicleDocument" WHERE "vehicleId" = p_vehicle AND "type"::text = kind ORDER BY "expiry" DESC LIMIT 1;
      IF latest IS NULL AND kind <> 'ROUTE_PERMIT' THEN
        RETURN format('%s has no %s on record', plate, lower(replace(kind, '_', ' ')));
      ELSIF latest IS NOT NULL AND latest < p_on THEN
        RETURN format('%s: the %s ran out on %s', plate, lower(replace(kind, '_', ' ')), latest);
      END IF;
    END LOOP;
  END IF;
  IF p_driver IS NOT NULL THEN
    SELECT coalesce(e."firstName" || ' ' || e."surname", 'The driver') INTO who FROM "FacDriver" d LEFT JOIN "Employee" e ON e."id" = d."employeeId" WHERE d."id" = p_driver;
    FOREACH kind IN ARRAY ARRAY['DRIVING_LICENCE', 'DEFENSIVE_DRIVING'] LOOP
      SELECT "expiry" INTO latest FROM "FacDriverDocument" WHERE "driverId" = p_driver AND "type"::text = kind ORDER BY "expiry" DESC LIMIT 1;
      IF latest IS NULL AND kind = 'DRIVING_LICENCE' THEN
        RETURN format('%s has no driving licence on record', who);
      ELSIF latest IS NOT NULL AND latest < p_on THEN
        RETURN format('%s: the %s ran out on %s', who, lower(replace(kind, '_', ' ')), latest);
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION fac_trip_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE problem text;
BEGIN
  problem := fac_transport_paper_problem(NEW."vehicleId", NEW."driverId", NEW."date");
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'No trip can be recorded: %', problem USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."odometerStart" IS NOT NULL AND NEW."odometerEnd" IS NOT NULL AND NEW."odometerEnd" < NEW."odometerStart" THEN
    RAISE EXCEPTION 'The odometer at the end of the trip is less than at the start' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "guard_FacTrip" BEFORE INSERT ON "FacTrip" FOR EACH ROW EXECUTE FUNCTION fac_trip_guard();

CREATE OR REPLACE FUNCTION fac_booking_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE clash int;
BEGIN
  IF NEW."status" IN ('PENDING', 'APPROVED') AND NEW."cancelledAt" IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('fac-booking:' || NEW."vehicleId"));
    SELECT count(*) INTO clash FROM "FacVehicleBooking"
     WHERE "id" <> NEW."id" AND "status" IN ('PENDING', 'APPROVED') AND "cancelledAt" IS NULL AND "startAt" < NEW."endAt" AND "endAt" > NEW."startAt"
       AND ("vehicleId" = NEW."vehicleId" OR ("driverId" IS NOT NULL AND "driverId" = NEW."driverId"));
    IF clash > 0 THEN
      RAISE EXCEPTION 'That vehicle or driver is already booked for part of that time' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "guard_FacVehicleBooking" BEFORE INSERT OR UPDATE ON "FacVehicleBooking" FOR EACH ROW EXECUTE FUNCTION fac_booking_guard();
ALTER TABLE "FacVehicleBooking" ADD CONSTRAINT "FacVehicleBooking_approver" CHECK ("approvedById" IS NULL OR "approvedById" <> "requestedById");

CREATE OR REPLACE FUNCTION fac_student_route_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE seats int; taken int; stop_route text;
BEGIN
  SELECT "routeId" INTO stop_route FROM "FacStop" WHERE "id" = NEW."amStopId";
  IF stop_route IS DISTINCT FROM NEW."routeId" THEN RAISE EXCEPTION 'The morning stop is not a stop of this route' USING ERRCODE = 'check_violation'; END IF;
  SELECT "routeId" INTO stop_route FROM "FacStop" WHERE "id" = NEW."pmStopId";
  IF stop_route IS DISTINCT FROM NEW."routeId" THEN RAISE EXCEPTION 'The afternoon stop is not a stop of this route' USING ERRCODE = 'check_violation'; END IF;
  IF NEW."removedAt" IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('fac-route:' || NEW."routeId"));
    SELECT v."seats" INTO seats FROM "FacRoute" r JOIN "FacVehicle" v ON v."id" = r."vehicleId" WHERE r."id" = NEW."routeId";
    IF seats IS NOT NULL THEN
      SELECT count(*) INTO taken FROM "FacStudentRoute" WHERE "routeId" = NEW."routeId" AND "removedAt" IS NULL AND "id" <> NEW."id";
      IF taken + 1 > seats THEN RAISE EXCEPTION 'The vehicle on this route has % seats and all are taken', seats USING ERRCODE = 'check_violation'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "guard_FacStudentRoute" BEFORE INSERT OR UPDATE ON "FacStudentRoute" FOR EACH ROW EXECUTE FUNCTION fac_student_route_guard();
