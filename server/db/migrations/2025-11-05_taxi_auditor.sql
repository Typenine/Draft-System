-- Taxi Auditor schema migration
-- Create enums (if missing)
DO $$ BEGIN
  CREATE TYPE acq_via AS ENUM ('free_agent','waiver','trade','draft','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE taxi_run_type AS ENUM ('wed_warn','thu_warn','sun_am_warn','sun_pm_official','admin_rerun');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- tenures
CREATE TABLE IF NOT EXISTS public.tenures (
  team_id        text        NOT NULL,
  player_id      text        NOT NULL,
  acquired_at    timestamptz NOT NULL,
  acquired_via   acq_via     NOT NULL,
  active_seen    integer     NOT NULL DEFAULT 0,
  last_active_at timestamptz NULL,
  CONSTRAINT tenures_pk PRIMARY KEY (team_id, player_id)
);

-- txn_cache (kept small; prune >120d in app)
CREATE TABLE IF NOT EXISTS public.txn_cache (
  week      integer      NOT NULL,
  team_id   text         NOT NULL,
  player_id text         NOT NULL,
  type      text         NOT NULL,
  direction text         NOT NULL,
  ts        timestamptz  NOT NULL
);
CREATE INDEX IF NOT EXISTS txn_cache_week_team_idx ON public.txn_cache (week, team_id);

-- taxi_snapshots (hourly cron writes only at ET windows)
CREATE TABLE IF NOT EXISTS public.taxi_snapshots (
  season     integer        NOT NULL,
  week       integer        NOT NULL,
  run_type   taxi_run_type  NOT NULL,
  run_ts     timestamptz    NOT NULL,
  team_id    text           NOT NULL,
  taxi_ids   text[]         NOT NULL,
  compliant  integer        NOT NULL DEFAULT 1,  -- 1=true, 0=false
  violations jsonb          NOT NULL,
  degraded   integer        NOT NULL DEFAULT 0,  -- 1=true, 0=false
  CONSTRAINT taxi_snapshots_pk PRIMARY KEY (season, week, run_type, team_id)
);
CREATE INDEX IF NOT EXISTS taxi_snapshots_team_idx ON public.taxi_snapshots (team_id);
