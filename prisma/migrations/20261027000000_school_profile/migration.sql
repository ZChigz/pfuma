-- Settings, tab 1 (School profile): more school types, authority, boarding, intake,
-- exam boards, EMIS number, district, physical and postal address, website, head teacher.
-- Every column is nullable or defaulted. The next migration fills the new address columns
-- from the old ones and tidies stored phone numbers; the old columns are kept.

ALTER TYPE "SchoolType" ADD VALUE 'COUNCIL';
ALTER TYPE "SchoolType" ADD VALUE 'MISSION_CHURCH';
ALTER TYPE "SchoolType" ADD VALUE 'TRUST';

CREATE TYPE "SchoolBoarding" AS ENUM ('DAY', 'BOARDING', 'DAY_AND_BOARDING');
CREATE TYPE "SchoolGender" AS ENUM ('BOYS', 'GIRLS', 'CO_ED');

ALTER TABLE "School"
  ADD COLUMN "responsibleAuthority" TEXT,
  ADD COLUMN "boarding"             "SchoolBoarding" NOT NULL DEFAULT 'DAY',
  ADD COLUMN "studentGender"        "SchoolGender" NOT NULL DEFAULT 'CO_ED',
  ADD COLUMN "offersCambridge"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emisNumber"           TEXT,
  ADD COLUMN "district"             TEXT,
  ADD COLUMN "physicalAddress"      TEXT,
  ADD COLUMN "postalAddress"        TEXT,
  ADD COLUMN "website"              TEXT,
  ADD COLUMN "headName"             TEXT,
  ADD COLUMN "headSignatureUrl"     TEXT;
