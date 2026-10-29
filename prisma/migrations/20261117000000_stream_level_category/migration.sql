-- Streams belong to O Level (Form 1-4, e.g. North, South, East) or A Level (Form 5-6, e.g.
-- Sciences, Commercials, Arts). Existing streams start as O Level; the backfill moves the ones
-- only A Level classes use.
ALTER TABLE "Stream" ADD COLUMN "category" "LevelCategory" NOT NULL DEFAULT 'O_LEVEL';
