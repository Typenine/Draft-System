import { neon } from '@neondatabase/serverless';

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaPromise: Promise<void> | null = null;

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super('DATABASE_URL is not configured. Attach a Postgres database in Vercel, then redeploy.');
  }
}

export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getSql(): ReturnType<typeof neon> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseNotConfiguredError();
  if (!sqlClient) sqlClient = neon(url);
  return sqlClient;
}

export async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS draft_settings (
          id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          league_name text NOT NULL,
          admin_code_hash text NOT NULL,
          rounds integer NOT NULL DEFAULT 4 CHECK (rounds > 0),
          clock_seconds integer NOT NULL DEFAULT 120 CHECK (clock_seconds > 0),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS draft_teams (
          id text PRIMARY KEY,
          name text NOT NULL UNIQUE,
          short_name text NOT NULL,
          primary_color text NOT NULL DEFAULT '#2563eb',
          secondary_color text NOT NULL DEFAULT '#0f172a',
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
          id text PRIMARY KEY,
          name text NOT NULL,
          status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','LIVE','PAUSED','COMPLETED')),
          rounds integer NOT NULL,
          clock_seconds integer NOT NULL,
          current_overall integer NOT NULL DEFAULT 1,
          deadline_ts timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          started_at timestamptz,
          completed_at timestamptz
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS draft_slots (
          draft_id text NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
          overall integer NOT NULL,
          round integer NOT NULL,
          pick_in_round integer NOT NULL,
          team_id text NOT NULL REFERENCES draft_teams(id),
          PRIMARY KEY (draft_id, overall)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS draft_picks (
          draft_id text NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
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
          draft_id text NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
          team_id text NOT NULL REFERENCES draft_teams(id),
          player_id text NOT NULL REFERENCES draft_players(id),
          rank integer NOT NULL,
          PRIMARY KEY (draft_id, team_id, player_id)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS draft_slots_team_idx ON draft_slots (draft_id, team_id)`;
      await sql`CREATE INDEX IF NOT EXISTS draft_picks_time_idx ON draft_picks (draft_id, made_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS draft_players_rank_idx ON draft_players (rank, name)`;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
