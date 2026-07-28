import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

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
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
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
          created_at timestamptz NOT NULL DEFAULT now(),
          started_at timestamptz,
          completed_at timestamptz
        )
      `;
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
      await sql`CREATE INDEX IF NOT EXISTS draft_queue_rank_idx ON draft_queues (draft_id, team_id, rank)`;
      await sql`CREATE INDEX IF NOT EXISTS draft_pick_team_idx ON draft_picks (draft_id, team_id)`;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}
