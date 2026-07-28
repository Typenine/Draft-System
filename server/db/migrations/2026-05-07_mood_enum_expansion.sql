-- Add 'Chaotic' and 'Vindicated' to the summary_mood enum.
-- PostgreSQL requires each value to be added separately.
DO $$ BEGIN
  ALTER TYPE summary_mood ADD VALUE IF NOT EXISTS 'Chaotic';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE summary_mood ADD VALUE IF NOT EXISTS 'Vindicated';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
