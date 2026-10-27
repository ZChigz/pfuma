-- The class register can show a learner as In sick bay (filled in from the sick bay, like On exeat). A new enum value has to be in a
-- migration of its own, because it cannot be used in the transaction that adds it.
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'SICK_BAY';
