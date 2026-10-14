-- One-off data wipe requested by the owner (2026-10-14) to start again with
-- clean data. Empties every table except users, their logins and the school
-- they belong to. Prisma runs each migration once per database, so this never
-- repeats on later deploys.
--
-- Kept: User, Account, Session, VerificationToken, School, _prisma_migrations.
DO $$
DECLARE
  tables text;
BEGIN
  SELECT string_agg(format('public.%I', tablename), ', ')
    INTO tables
    FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename NOT IN (
       'User', 'Account', 'Session', 'VerificationToken', 'School', '_prisma_migrations'
     );

  IF tables IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY';
  END IF;
END $$;
