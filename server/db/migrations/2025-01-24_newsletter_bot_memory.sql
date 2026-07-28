-- Newsletter Bot Memory Tables
-- Run this migration to add persistent storage for AI bot personalities

-- Enums for bot names and moods
DO $$ BEGIN
  CREATE TYPE bot_name AS ENUM ('entertainer', 'analyst');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE summary_mood AS ENUM ('Focused', 'Fired Up', 'Deflated');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE team_mood AS ENUM ('Neutral', 'Confident', 'Suspicious', 'Irritated');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Bot memory - stores overall bot state and per-team sentiment
-- This is CRUCIAL for personality continuity across weeks
CREATE TABLE IF NOT EXISTS bot_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot bot_name NOT NULL,
  season INTEGER NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  summary_mood summary_mood DEFAULT 'Focused' NOT NULL,
  -- Per-team memory: { "Team Name": { trust: number, frustration: number, mood: string } }
  teams JSONB DEFAULT '{}' NOT NULL
);

CREATE INDEX IF NOT EXISTS bot_memory_bot_season_idx ON bot_memory(bot, season);

-- Forecast records - tracks prediction accuracy over the season
CREATE TABLE IF NOT EXISTS forecast_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season INTEGER NOT NULL,
  bot bot_name NOT NULL,
  wins INTEGER DEFAULT 0 NOT NULL,
  losses INTEGER DEFAULT 0 NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS forecast_records_season_bot_idx ON forecast_records(season, bot);

-- Pending picks - stores predictions to grade next week
CREATE TABLE IF NOT EXISTS pending_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season INTEGER NOT NULL,
  week INTEGER NOT NULL, -- The week these picks are FOR (next week)
  matchup_id VARCHAR(64) NOT NULL,
  team1 VARCHAR(255),
  team2 VARCHAR(255),
  entertainer_pick VARCHAR(255),
  analyst_pick VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS pending_picks_season_week_idx ON pending_picks(season, week);

-- Generated newsletters - stores the full newsletter content
CREATE TABLE IF NOT EXISTS newsletters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  league_name VARCHAR(255) NOT NULL,
  -- Full newsletter JSON structure
  content JSONB NOT NULL,
  -- Pre-rendered HTML for fast display
  html TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS newsletters_season_week_idx ON newsletters(season, week);

-- Add unique constraint to prevent duplicate newsletters per week
CREATE UNIQUE INDEX IF NOT EXISTS newsletters_season_week_unique ON newsletters(season, week);

-- Staged newsletter generation - tracks progress of Tuesday→Wednesday builds
DO $$ BEGIN
  CREATE TYPE newsletter_status AS ENUM ('pending', 'in_progress', 'completed', 'failed', 'published');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS newsletter_staged (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  status newsletter_status DEFAULT 'pending' NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  sections_completed TEXT[] DEFAULT '{}' NOT NULL,
  current_section VARCHAR(64),
  error TEXT,
  -- Generated content per section: { "Intro": { entertainer: "...", analyst: "..." }, ... }
  generated_content JSONB DEFAULT '{}' NOT NULL,
  -- Derived data snapshot (so we don't re-fetch)
  derived_data JSONB
);

CREATE INDEX IF NOT EXISTS newsletter_staged_season_week_idx ON newsletter_staged(season, week);
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_staged_season_week_unique ON newsletter_staged(season, week);

-- Relationship memory — cross-bot shared state (debate pushbacks, recurring themes, prediction lead)
CREATE TABLE IF NOT EXISTS relationship_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season INTEGER NOT NULL UNIQUE,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  prediction_records JSONB DEFAULT '{"entertainer":{"w":0,"l":0},"analyst":{"w":0,"l":0}}' NOT NULL,
  pushbacks JSONB DEFAULT '[]' NOT NULL,
  themes JSONB DEFAULT '{"entertainer_tendencies":[],"analyst_tendencies":[],"persistent_disagreements":[]}' NOT NULL,
  dynamic JSONB DEFAULT '{"entertainer_lead_in_predictions":0,"total_pushbacks":0,"last_pushback_week":null,"agreements_this_season":0}' NOT NULL
);
