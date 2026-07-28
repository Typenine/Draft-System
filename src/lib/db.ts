import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { DEFAULT_EVENT_LOGO } from './branding';

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super('DATABASE_URL is not configured.');
  }
}

let query: NeonQueryFunction<false, false> | null = null;
let schemaPromise: Promise<void> | null = null;

export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getSql(): NeonQueryFunction<false, false> {
  if (!process.env.DATABASE_URL) throw new DatabaseNotConfiguredError();
  if (!query) query = neon(process.env.DATABASE_URL);
  return query;
}

export async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS draft_settings (
          id integer PRIMARY KEY,
          league_name text NOT NULL,
          admin_code_hash text NOT NULL,
          primary_color text NOT NULL DEFAULT '#2563eb',
          secondary_color text NOT NULL DEFAULT '#0f172a',
          logo_url text,
          rounds integer NOT NULL DEFAULT 28,
          clock_seconds integer NOT NULL DEFAULT 120,
          draft_format text NOT NULL DEFAULT 'linear',
          base_order jsonb NOT NULL DEFAULT '[]'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`ALTER TABLE draft_settings ADD COLUMN IF NOT EXISTS draft_format text NOT NULL DEFAULT 'linear'`;
      await sql`ALTER TABLE draft_settings ADD COLUMN IF NOT EXISTS base_order jsonb NOT NULL DEFAULT '[]'::jsonb`;
      await sql`UPDATE draft_settings SET logo_url = ${DEFAULT_EVENT_LOGO} WHERE logo_url IS NULL OR btrim(logo_url) = ''`;

      await sql`
        CREATE TABLE IF NOT EXISTS draft_teams (
          id text PRIMARY KEY,
          name text NOT NULL,
          short_name text NOT NULL,
          primary_color text NOT NULL,
          secondary_color text NOT NULL,
          logo_url text,
          login_code_hash text NOT NULL,
          sort_order integer NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS draft_players (
          id text PRIMARY KEY,
          name text NOT NULL,
          position text NOT NULL,
          pro_team text,
          college text,
          rank integer NOT NULL DEFAULT 9999
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS drafts (
          id uuid PRIMARY KEY,
          name text NOT NULL,
          status text NOT NULL DEFAULT 'NOT_STARTED',
          rounds integer NOT NULL,
          clock_seconds integer NOT NULL,
          current_overall integer NOT NULL DEFAULT 1,
          deadline_ts timestamptz,
          paused_remaining_seconds integer,
          pause_reason text,
          created_at timestamptz NOT NULL DEFAULT now(),
          started_at timestamptz,
          completed_at timestamptz
        )
      `;
      await sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS pause_reason text`;
      await sql`
        CREATE TABLE IF NOT EXISTS draft_slots (
          draft_id uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
          overall integer NOT NULL,
          round integer NOT NULL,
          pick_in_round integer NOT NULL,
          team_id text NOT NULL REFERENCES draft_teams(id),
          PRIMARY KEY (draft_id, overall)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS draft_picks (
          draft_id uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
          overall integer NOT NULL,
          round integer NOT NULL,
          team_id text NOT NULL REFERENCES draft_teams(id),
          player_id text NOT NULL REFERENCES draft_players(id),
          player_name text NOT NULL,
          player_position text NOT NULL,
          player_pro_team text,
          made_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (draft_id, overall),
          UNIQUE (draft_id, player_id)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS draft_queues (
          draft_id uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
          team_id text NOT NULL REFERENCES draft_teams(id),
          player_id text NOT NULL REFERENCES draft_players(id),
          rank integer NOT NULL,
          PRIMARY KEY (draft_id, team_id, player_id)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS draft_pending_picks (
          id uuid PRIMARY KEY,
          draft_id uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
          overall integer NOT NULL,
          team_id text NOT NULL REFERENCES draft_teams(id),
          player_id text NOT NULL REFERENCES draft_players(id),
          player_name text NOT NULL,
          player_position text NOT NULL,
          player_pro_team text,
          status text NOT NULL DEFAULT 'pending',
          submitted_at timestamptz NOT NULL DEFAULT now(),
          reviewed_at timestamptz
        )
      `;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS draft_one_pending_pick_idx ON draft_pending_picks (draft_id) WHERE status = 'pending'`;

      await sql`
        CREATE TABLE IF NOT EXISTS draft_trades (
          id uuid PRIMARY KEY,
          draft_id uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
          status text NOT NULL DEFAULT 'pending',
          proposed_by text NOT NULL,
          teams jsonb NOT NULL DEFAULT '[]'::jsonb,
          accepted_by jsonb NOT NULL DEFAULT '[]'::jsonb,
          notes text,
          counter_of text,
          animation_pending boolean NOT NULL DEFAULT false,
          resume_after_animation boolean NOT NULL DEFAULT false,
          proposed_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`ALTER TABLE draft_trades ADD COLUMN IF NOT EXISTS animation_pending boolean NOT NULL DEFAULT false`;
      await sql`ALTER TABLE draft_trades ADD COLUMN IF NOT EXISTS resume_after_animation boolean NOT NULL DEFAULT false`;
      await sql`
        CREATE TABLE IF NOT EXISTS draft_trade_assets (
          id uuid PRIMARY KEY,
          trade_id uuid NOT NULL REFERENCES draft_trades(id) ON DELETE CASCADE,
          from_team text NOT NULL,
          to_team text NOT NULL,
          asset_type text NOT NULL,
          player_id text,
          player_name text,
          player_pos text,
          player_nfl text,
          pick_overall integer,
          pick_year integer,
          pick_round integer,
          pick_original_team text
        )
      `;
      await sql`ALTER TABLE draft_trade_assets ADD COLUMN IF NOT EXISTS player_nfl text`;
      await sql`
        CREATE TABLE IF NOT EXISTS draft_roster_ownership (
          draft_id uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
          player_id text NOT NULL REFERENCES draft_players(id),
          owner_team_id text NOT NULL REFERENCES draft_teams(id),
          player_name text NOT NULL,
          player_position text NOT NULL,
          player_pro_team text,
          acquired_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (draft_id, player_id)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS draft_future_picks (
          id uuid PRIMARY KEY,
          draft_id uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
          pick_year integer NOT NULL,
          pick_round integer NOT NULL,
          original_team_id text NOT NULL REFERENCES draft_teams(id),
          owner_team_id text NOT NULL REFERENCES draft_teams(id),
          UNIQUE (draft_id, pick_year, pick_round, original_team_id)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS draft_team_boards (
          team_id text PRIMARY KEY REFERENCES draft_teams(id) ON DELETE CASCADE,
          data jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS draft_player_media (
          player_id text PRIMARY KEY REFERENCES draft_players(id) ON DELETE CASCADE,
          player_name text,
          image_url text,
          video_url text,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`
        INSERT INTO draft_roster_ownership
          (draft_id, player_id, owner_team_id, player_name, player_position, player_pro_team, acquired_at)
        SELECT draft_id, player_id, team_id, player_name, player_position, player_pro_team, made_at
        FROM draft_picks
        ON CONFLICT (draft_id, player_id) DO NOTHING
      `;

      await sql`CREATE INDEX IF NOT EXISTS draft_queue_rank_idx ON draft_queues (draft_id, team_id, rank)`;
      await sql`CREATE INDEX IF NOT EXISTS draft_pick_team_idx ON draft_picks (draft_id, team_id)`;
      await sql`CREATE INDEX IF NOT EXISTS draft_trade_status_idx ON draft_trades (draft_id, status, updated_at)`;
      await sql`CREATE INDEX IF NOT EXISTS draft_roster_owner_idx ON draft_roster_ownership (draft_id, owner_team_id)`;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}
