import { getDb } from './client';
import { randomUUID } from 'crypto';
import { users, suggestions, taxiSquadMembers, taxiSquadEvents, teamPins, taxiObservations, userDocs, tenures, txnCache, taxiSnapshots, tradeBlockEvents } from './schema';
import { eq, and, isNull, desc, lt, sql, ne } from 'drizzle-orm';

export type Role = 'admin' | 'user';

export async function createUser(params: { email: string; displayName?: string; role?: Role }) {
  const db = getDb();
  const [row] = await db
    .insert(users)
    .values({ email: params.email, displayName: params.displayName, role: (params.role || 'user') as 'admin' | 'user' })
    .returning();
  return row;
}

// --- Suggestion title (for ballots)
export async function ensureSuggestionTitleColumn() {
  try {
    const db = getDb();
    await db.execute(sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS title varchar(255)`);
  } catch {}
}

export async function setSuggestionTitle(id: string, title: string | null) {
  try {
    await ensureSuggestionTitleColumn();
    const db = getDb();
    await db.execute(sql`UPDATE suggestions SET title = ${title} WHERE id = ${id}::uuid`);
    return true;
  } catch {
    return false;
  }
}

export async function getSuggestionTitlesMap(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    await ensureSuggestionTitleColumn();
    const db = getDb();
    const res = await db.execute(sql`SELECT id::text AS id, title FROM suggestions WHERE title IS NOT NULL`);
    const rawRows = (res as unknown as { rows?: Array<{ id: string; title: string | null }> }).rows || [];
    for (const r of rawRows) {
      const id = typeof r.id === 'string' ? r.id : '';
      const t = typeof r.title === 'string' ? r.title : '';
      if (id && t) out[id] = t;
    }
  } catch {}
  return out;
}

export async function getSuggestionBallotAddedAtMap(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    await ensureSuggestionBallotNotifyColumns();
    const db = getDb();
    const res = await db.execute(sql`SELECT id::text AS id, ballot_eligible_at FROM suggestions WHERE ballot_eligible_at IS NOT NULL`);
    const rawRows = (res as unknown as { rows?: Array<{ id: string; ballot_eligible_at: Date | string | null }> }).rows || [];
    for (const r of rawRows) {
      const id = typeof r.id === 'string' ? r.id : '';
      const ts = r.ballot_eligible_at;
      if (id && ts) {
        out[id] = new Date(ts).toISOString();
      }
    }
  } catch {}
  return out;
}

// =====================
// Draft Travel (Flights / Arrivals)
// =====================

export async function ensureDraftTravelTable() {
  const db = getDb();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_travel (
      id uuid PRIMARY KEY,
      trip varchar(16) NOT NULL,
      entry_type varchar(16) NOT NULL,
      person varchar(255) NOT NULL,
      team varchar(255),
      airline varchar(64),
      flight_no varchar(32),
      airport varchar(32),
      dt timestamp NULL,
      seats integer,
      can_pickup integer NOT NULL DEFAULT 0,
      can_dropoff integer NOT NULL DEFAULT 0,
      notes text,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_draft_travel_trip_dt ON draft_travel(trip, dt, created_at)`);
}

export type DraftTravelEntry = {
  id: string;
  trip: string;
  entryType: 'arrival' | 'departure';
  person: string;
  team?: string | null;
  airline?: string | null;
  flightNo?: string | null;
  airport?: string | null;
  dt?: string | null; // ISO string or null
  seats?: number | null;
  canPickup?: boolean;
  canDropoff?: boolean;
  notes?: string | null;
  createdAt: string; // ISO
};

export async function addDraftTravelEntry(params: {
  trip: string;
  entryType: 'arrival' | 'departure';
  person: string;
  team?: string | null;
  airline?: string | null;
  flightNo?: string | null;
  airport?: string | null;
  dt?: Date | null;
  seats?: number | null;
  canPickup?: boolean;
  canDropoff?: boolean;
  notes?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await ensureDraftTravelTable();
    const db = getDb();
    const id = randomUUID();
    const trip = String(params.trip || '').trim();
    const et = String(params.entryType || '').toLowerCase() === 'departure' ? 'departure' : 'arrival';
    const person = String(params.person || '').trim();
    if (!trip || !person) return { ok: false, error: 'missing_fields' };
    const team = params.team ? String(params.team).trim() : null;
    const airline = params.airline ? String(params.airline).trim() : null;
    const flightNo = params.flightNo ? String(params.flightNo).trim() : null;
    const airport = params.airport ? String(params.airport).trim() : null;
    const dt = params.dt ? new Date(params.dt) : null;
    const seats = params.seats == null ? null : (Number(params.seats) | 0);
    const canPickup = params.canPickup ? 1 : 0;
    const canDropoff = params.canDropoff ? 1 : 0;
    const notes = params.notes ? String(params.notes) : null;
    await db.execute(sql`
      INSERT INTO draft_travel (id, trip, entry_type, person, team, airline, flight_no, airport, dt, seats, can_pickup, can_dropoff, notes)
      VALUES (${id}::uuid, ${trip}, ${et}, ${person}, ${team}, ${airline}, ${flightNo}, ${airport}, ${dt}, ${seats}, ${canPickup}, ${canDropoff}, ${notes})
    `);
    return { ok: true, id } as const;
  } catch (e) {
    return { ok: false, error: String(e || 'unknown') } as const;
  }
}

export async function listDraftTravelEntries(trip: string): Promise<DraftTravelEntry[]> {
  await ensureDraftTravelTable();
  const db = getDb();
  const res = await db.execute(sql`
    SELECT
      id::text AS id,
      trip,
      entry_type AS entry_type,
      person,
      team,
      airline,
      flight_no,
      airport,
      dt,
      seats,
      can_pickup,
      can_dropoff,
      notes,
      created_at
    FROM draft_travel
    WHERE trip = ${trip}
    ORDER BY dt ASC NULLS LAST, created_at ASC
  `);
  type Row = {
    id: string;
    trip: string;
    entry_type: string;
    person: string;
    team: string | null;
    airline: string | null;
    flight_no: string | null;
    airport: string | null;
    dt: Date | null;
    seats: number | null;
    can_pickup: number;
    can_dropoff: number;
    notes: string | null;
    created_at: Date;
  };
  const rows = (res as unknown as { rows?: Row[] }).rows || [];
  return rows.map((r) => ({
    id: String(r.id),
    trip: String(r.trip),
    entryType: r.entry_type === 'departure' ? 'departure' : 'arrival',
    person: String(r.person),
    team: r.team || null,
    airline: r.airline || null,
    flightNo: r.flight_no || null,
    airport: r.airport || null,
    dt: r.dt ? new Date(r.dt).toISOString() : null,
    seats: r.seats == null ? null : Number(r.seats),
    canPickup: r.can_pickup === 1,
    canDropoff: r.can_dropoff === 1,
    notes: r.notes || null,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

// =====================
// Draft Brain (DB layer)
// =====================
type DraftStatus = 'NOT_STARTED' | 'LIVE' | 'PAUSED' | 'COMPLETED';

export type DraftOverview = {
  id: string;
  year: number;
  rounds: number;
  clockSeconds: number;
  status: DraftStatus;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  curOverall: number;
  onClockTeam?: string | null;
  clockStartedAt?: string | null;
  deadlineTs?: string | null;
  pausedRemainingSecs?: number | null;
  roundEndPause?: boolean | null;
  pauseReason?: 'manual' | 'pick_animation' | 'round_end' | 'trade_animation' | 'pending_pick' | null;
  eventName?: string | null;
  eventLogoUrl?: string | null;
  eventColor1?: string | null;
  eventColor2?: string | null;
  pendingTradeAnimation?: { tradeId?: string | null; startedAt?: string | null; teams: string[]; assets: TradeAsset[]; resumeAfterAnimation?: boolean; triggerPickAnimation?: boolean; newClockTeam?: string | null } | null;
  recentPicks: Array<{ overall: number; round: number; team: string; playerId: string; playerName?: string | null; playerPos?: string | null; playerNfl?: string | null; madeAt: string }>;
  allPicks: Array<{ overall: number; round: number; team: string; playerId: string; playerName?: string | null; playerPos?: string | null; playerNfl?: string | null; madeAt: string }>;
  upcoming: Array<{ overall: number; round: number; team: string }>;
  allSlots: Array<{ overall: number; round: number; team: string }>;
};

export type CommitPickResult =
  | { ok: true; completed: boolean }
  | { ok: false; error: 'stale_request' | 'player_taken' | 'wrong_team' | 'wrong_state' | 'no_slot' };

let _tablesEnsured = false;

export async function ensureDraftTables() {
  if (_tablesEnsured) return;
  const db = getDb();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS drafts (
      id uuid PRIMARY KEY,
      year integer NOT NULL,
      rounds integer NOT NULL,
      clock_seconds integer NOT NULL DEFAULT 60,
      status varchar(24) NOT NULL DEFAULT 'NOT_STARTED',
      created_at timestamp NOT NULL DEFAULT now(),
      started_at timestamp NULL,
      completed_at timestamp NULL,
      cur_overall integer NOT NULL DEFAULT 1,
      clock_started_at timestamp NULL,
      deadline_ts timestamp NULL,
      paused_remaining_secs integer NULL,
      round_end_pause boolean NOT NULL DEFAULT false,
      event_name varchar(255),
      event_logo_url text,
      event_color_1 varchar(16),
      event_color_2 varchar(16),
      pending_trade_animation jsonb NULL,
      pause_reason varchar(32) NULL
    )
  `);
  // Migration: add paused_remaining_secs if missing
  await db.execute(sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS paused_remaining_secs integer NULL`).catch(() => {});
  // Migration: add round_end_pause flag
  await db.execute(sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS round_end_pause boolean NOT NULL DEFAULT false`).catch(() => {});
  // Migration: add event branding columns
  await db.execute(sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS event_name varchar(255)`).catch(() => {});
  await db.execute(sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS event_logo_url text`).catch(() => {});
  await db.execute(sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS event_color_1 varchar(16)`).catch(() => {});
  await db.execute(sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS event_color_2 varchar(16)`).catch(() => {});
  // Migration: add explicit pause_reason column (enum values: 'manual' | 'pick_animation' | 'round_end' | 'trade_animation')
  // NULL means LIVE (not paused) or legacy rows without a recorded reason.
  await db.execute(sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS pause_reason varchar(32) NULL`).catch(() => {});
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_slots (
      draft_id uuid NOT NULL,
      overall integer NOT NULL,
      round integer NOT NULL,
      pick_in_round integer NOT NULL,
      team varchar(255) NOT NULL,
      PRIMARY KEY (draft_id, overall)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_picks (
      id uuid PRIMARY KEY,
      draft_id uuid NOT NULL,
      overall integer NOT NULL,
      round integer NOT NULL,
      team varchar(255) NOT NULL,
      player_id varchar(64) NOT NULL,
      player_name varchar(255),
      player_pos varchar(16),
      player_nfl varchar(64),
      made_by varchar(255) NOT NULL,
      made_at timestamp NOT NULL DEFAULT now()
    )
  `);
  // Add columns if they don't exist (migration)
  await db.execute(sql`ALTER TABLE draft_picks ADD COLUMN IF NOT EXISTS player_pos varchar(16)`).catch(() => {});
  await db.execute(sql`ALTER TABLE draft_picks ADD COLUMN IF NOT EXISTS player_nfl varchar(64)`).catch(() => {});
  await db.execute(sql`ALTER TABLE draft_picks ALTER COLUMN player_nfl TYPE varchar(64)`).catch(() => {}); // Ignore if already exists
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_queues (
      draft_id uuid NOT NULL,
      team varchar(255) NOT NULL,
      rank integer NOT NULL,
      player_id varchar(64) NOT NULL,
      player_name varchar(255),
      player_pos varchar(16),
      player_nfl varchar(64),
      created_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (draft_id, team, rank)
    )
  `);
  // Add columns if they don't exist (migration for existing tables)
  await db.execute(sql`ALTER TABLE draft_queues ADD COLUMN IF NOT EXISTS player_name varchar(255)`).catch(() => {});
  await db.execute(sql`ALTER TABLE draft_queues ADD COLUMN IF NOT EXISTS player_pos varchar(16)`).catch(() => {});
  await db.execute(sql`ALTER TABLE draft_queues ADD COLUMN IF NOT EXISTS player_nfl varchar(64)`).catch(() => {});
  await db.execute(sql`ALTER TABLE draft_queues ALTER COLUMN player_nfl TYPE varchar(64)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_draft_picks_draft ON draft_picks(draft_id)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_draft_picks_player ON draft_picks(player_id)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_draft_slots_team ON draft_slots(draft_id, team)`).catch(() => {});
  await db.execute(sql`ALTER TABLE draft_slots ADD COLUMN IF NOT EXISTS original_team varchar(255)`).catch(() => {});
  await db.execute(sql`UPDATE draft_slots SET original_team = team WHERE original_team IS NULL`).catch(() => {});
  // Player videos table (player_id → video_url + image_url, global across drafts)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS player_videos (
      player_id varchar(64) NOT NULL PRIMARY KEY,
      video_url text DEFAULT '',
      image_url text,
      player_name varchar(255),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  // Backfill for pre-existing tables that lack image_url or still have NOT NULL on video_url
  await db.execute(sql`ALTER TABLE player_videos ADD COLUMN IF NOT EXISTS image_url text`).catch(() => {});
  await db.execute(sql`ALTER TABLE player_videos ALTER COLUMN video_url DROP NOT NULL`).catch(() => {});
  // Pending picks (user-submitted, awaiting admin approval)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_pending_picks (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      draft_id uuid NOT NULL,
      overall integer NOT NULL,
      team varchar(128) NOT NULL,
      player_id varchar(64) NOT NULL,
      player_name varchar(255),
      player_pos varchar(16),
      player_nfl varchar(16),
      submitted_at timestamp NOT NULL DEFAULT now(),
      status varchar(16) NOT NULL DEFAULT 'pending'
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pending_picks_draft ON draft_pending_picks(draft_id, status)`).catch(() => {});
  await db.execute(sql`ALTER TABLE draft_pending_picks ALTER COLUMN player_nfl TYPE varchar(255)`).catch(() => {});
  // Trade system tables
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_roster_snapshots (
      draft_id uuid NOT NULL,
      team varchar(255) NOT NULL,
      player_id varchar(64) NOT NULL,
      player_name varchar(255),
      player_pos varchar(16),
      player_nfl varchar(64),
      acquired_via varchar(16) NOT NULL DEFAULT 'sleeper',
      PRIMARY KEY (draft_id, team, player_id)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_future_picks (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      draft_id uuid NOT NULL,
      owner_team varchar(255) NOT NULL,
      original_team varchar(255) NOT NULL,
      year integer NOT NULL,
      round integer NOT NULL
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_draft_future_picks ON draft_future_picks(draft_id, owner_team)`).catch(() => {});
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_trades (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      draft_id uuid NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'pending',
      proposed_by varchar(255) NOT NULL,
      teams jsonb NOT NULL,
      accepted_by jsonb NOT NULL DEFAULT '[]',
      counter_of uuid NULL,
      notes text NULL,
      proposed_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_draft_trades ON draft_trades(draft_id, status)`).catch(() => {});
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_trade_assets (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      trade_id uuid NOT NULL,
      from_team varchar(255) NOT NULL,
      to_team varchar(255) NOT NULL,
      asset_type varchar(16) NOT NULL,
      player_id varchar(64) NULL,
      player_name varchar(255) NULL,
      player_pos varchar(8) NULL,
      pick_overall integer NULL,
      pick_year integer NULL,
      pick_round integer NULL,
      pick_original_team varchar(255) NULL
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_draft_trade_assets ON draft_trade_assets(trade_id)`).catch(() => {});
  // Pick videos: per-draft, per-pick video urls (used by overlay)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_pick_videos (
      draft_id uuid NOT NULL,
      overall integer NOT NULL,
      video_url text NOT NULL,
      player_name varchar(255),
      PRIMARY KEY (draft_id, overall)
    )
  `).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_draft_pick_videos_draft ON draft_pick_videos(draft_id)`).catch(() => {});
  // Workspace defaults (branding + default player pool) — survives draft deletion
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_workspace (
      id varchar(32) PRIMARY KEY,
      event_name varchar(255),
      event_logo_url text,
      event_color_1 varchar(16),
      event_color_2 varchar(16),
      default_player_pool_id uuid NULL
    )
  `).catch(() => {});
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_player_pools (
      id uuid PRIMARY KEY,
      label varchar(255) NOT NULL DEFAULT 'Saved pool',
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `).catch(() => {});
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_player_pool_rows (
      pool_id uuid NOT NULL,
      player_id varchar(64) NOT NULL,
      name varchar(255) NOT NULL,
      pos varchar(16) NOT NULL,
      nfl varchar(255),
      rank integer,
      meta jsonb,
      PRIMARY KEY (pool_id, player_id)
    )
  `).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_draft_player_pool_rows_pool ON draft_player_pool_rows(pool_id)`).catch(() => {});
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_branding_templates (
      id uuid PRIMARY KEY,
      label varchar(255) NOT NULL,
      event_name varchar(255),
      event_logo_url text,
      event_color_1 varchar(16),
      event_color_2 varchar(16),
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `).catch(() => {});
  await db.execute(sql`INSERT INTO draft_workspace (id) VALUES ('default') ON CONFLICT (id) DO NOTHING`).catch(() => {});
  // Migrations for existing tables (idempotent, errors silenced)
  await db.execute(sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS pending_trade_animation jsonb NULL`).catch(() => {});
  await db.execute(sql`ALTER TABLE draft_roster_snapshots ALTER COLUMN player_nfl TYPE varchar(64)`).catch(() => {});
  // Uniqueness constraints that prevent duplicate picks and concurrent race conditions
  await ensureDraftPickConstraints();
  _tablesEnsured = true;
}

// ── Draft pick uniqueness constraints (idempotent migration) ──────────────────
// Called from ensureDraftTables so constraints are always present before picks.
async function ensureDraftPickConstraints(): Promise<void> {
  const db = getDb();
  // Detect and report duplicate picks before removing them.
  // Silently deleting data can mask real bugs; we log conflicts so they are visible.
  const dupOverall = await db.execute(sql`
    SELECT a.draft_id::text, a.overall, COUNT(1) AS cnt
    FROM draft_picks a
    GROUP BY a.draft_id, a.overall
    HAVING COUNT(1) > 1
  `).catch(() => null);
  const dupOverallRows = (dupOverall as unknown as { rows?: Array<{ draft_id: string; overall: number; cnt: number }> })?.rows || [];
  if (dupOverallRows.length > 0) {
    console.error('[ensureDraftPickConstraints] DUPLICATE SLOTS DETECTED (will keep lowest UUID):', JSON.stringify(dupOverallRows));
  }
  const dupPlayer = await db.execute(sql`
    SELECT a.draft_id::text, a.player_id, COUNT(1) AS cnt
    FROM draft_picks a
    GROUP BY a.draft_id, a.player_id
    HAVING COUNT(1) > 1
  `).catch(() => null);
  const dupPlayerRows = (dupPlayer as unknown as { rows?: Array<{ draft_id: string; player_id: string; cnt: number }> })?.rows || [];
  if (dupPlayerRows.length > 0) {
    console.error('[ensureDraftPickConstraints] DUPLICATE PLAYERS DETECTED (will keep lowest UUID):', JSON.stringify(dupPlayerRows));
  }
  // Remove duplicate picks, keeping the lexicographically-lowest UUID (consistent tiebreak).
  // These deletes are no-ops if the table is clean.
  await db.execute(sql`
    DELETE FROM draft_picks a
    USING draft_picks b
    WHERE a.draft_id = b.draft_id
      AND a.overall = b.overall
      AND a.id::text > b.id::text
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM draft_picks a
    USING draft_picks b
    WHERE a.draft_id = b.draft_id
      AND a.player_id = b.player_id
      AND a.id::text > b.id::text
  `).catch(() => {});
  // One committed pick per slot in a draft.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_draft_picks_draft_overall
    ON draft_picks(draft_id, overall)
  `).catch(() => {});
  // One committed pick per player in a draft.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_draft_picks_draft_player
    ON draft_picks(draft_id, player_id)
  `).catch(() => {});
  // Only one PENDING pick per slot in a draft. The partial index only covers
  // rows where status = 'pending', so approved/rejected rows are unaffected.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_picks_draft_overall
    ON draft_pending_picks(draft_id, overall)
    WHERE status = 'pending'
  `).catch(() => {});
}

// ── commitPick — the single authoritative path for committing a draft pick ────
//
// Uses a single atomic CTE so that the slot check, player-taken check, INSERT,
// and cursor advancement all happen inside one PostgreSQL statement. The
// unique constraints on draft_picks(draft_id, overall) and
// draft_picks(draft_id, player_id) serve as the ultimate concurrency guard:
// if two requests race past the WHERE conditions, ON CONFLICT DO NOTHING
// lets only one INSERT land and the other gets stale_request / player_taken.
//
// All successful picks—commissioner-approved, admin force-pick, forced auto-pick,
// and custom-pool fallback—must go through this function so that cursor
// advancement, round-end pausing, and draft completion are always consistent.
export async function commitPick(params: {
  draftId: string;
  team: string;
  playerId: string;
  playerName?: string | null;
  playerPos?: string | null;
  playerNfl?: string | null;
  madeBy: string;
  expectedOverall?: number | null;
}): Promise<CommitPickResult> {
  await ensureDraftTables();
  const db = getDb();
  const pickId = randomUUID();
  const expectedOverall = params.expectedOverall ?? null;
  const playerNfl =
    params.playerNfl != null && String(params.playerNfl).length > 255
      ? String(params.playerNfl).slice(0, 255)
      : (params.playerNfl ?? null);

  try {
    const result = await db.execute(sql`
      WITH
        draft_state AS (
          SELECT
            d.status,
            d.cur_overall,
            d.clock_seconds,
            s.team      AS slot_team,
            s.overall   AS slot_overall,
            s.round     AS slot_round,
            EXISTS(
              SELECT 1 FROM draft_picks dp
              WHERE dp.draft_id = d.id AND dp.player_id = ${params.playerId}
            ) AS player_taken
          FROM drafts d
          JOIN draft_slots s
            ON s.draft_id = d.id AND s.overall = d.cur_overall
          WHERE d.id = ${params.draftId}::uuid
          LIMIT 1
        ),
        inserted_pick AS (
          INSERT INTO draft_picks
            (id, draft_id, overall, round, team,
             player_id, player_name, player_pos, player_nfl, made_by)
          SELECT
            ${pickId}::uuid,
            ${params.draftId}::uuid,
            ds.slot_overall,
            ds.slot_round,
            ds.slot_team,
            ${params.playerId},
            ${params.playerName ?? null},
            ${params.playerPos ?? null},
            ${playerNfl},
            ${params.madeBy}
          FROM draft_state ds
          WHERE ds.status = 'LIVE'
            AND ds.slot_team = ${params.team}
            AND NOT ds.player_taken
            AND (
              ${expectedOverall}::int IS NULL
              OR ds.cur_overall = ${expectedOverall}::int
            )
          ON CONFLICT DO NOTHING
          RETURNING overall, round
        ),
        next_slot AS (
          SELECT s.overall AS next_overall, s.round AS next_round
          FROM draft_slots s
          WHERE s.draft_id = ${params.draftId}::uuid
            AND s.overall > (SELECT slot_overall FROM draft_state LIMIT 1)
            AND NOT EXISTS (
              SELECT 1 FROM draft_picks dp
              WHERE dp.draft_id = s.draft_id AND dp.overall = s.overall
            )
          ORDER BY s.overall ASC
          LIMIT 1
        ),
        updated_draft AS (
          UPDATE drafts
          SET
            cur_overall = COALESCE(
              (SELECT next_overall FROM next_slot),
              (SELECT overall   FROM inserted_pick)
            ),
            status = CASE
              WHEN NOT EXISTS (SELECT 1 FROM next_slot)
                THEN 'COMPLETED'
              WHEN (SELECT next_round FROM next_slot)
                 > (SELECT round FROM inserted_pick)
                THEN 'PAUSED'
              ELSE 'LIVE'
            END,
            pause_reason = CASE
              WHEN NOT EXISTS (SELECT 1 FROM next_slot)     THEN NULL
              WHEN (SELECT next_round FROM next_slot)
                 > (SELECT round FROM inserted_pick)        THEN 'round_end'
              ELSE NULL
            END,
            round_end_pause = (
              EXISTS (SELECT 1 FROM next_slot)
              AND (SELECT next_round FROM next_slot)
                > (SELECT round FROM inserted_pick)
            ),
            paused_remaining_secs = CASE
              WHEN EXISTS (SELECT 1 FROM next_slot)
               AND (SELECT next_round FROM next_slot)
                 > (SELECT round FROM inserted_pick)
                THEN (SELECT clock_seconds FROM draft_state)
              ELSE NULL
            END,
            clock_started_at = CASE
              WHEN NOT EXISTS (SELECT 1 FROM next_slot)   THEN NULL
              WHEN (SELECT next_round FROM next_slot)
                 > (SELECT round FROM inserted_pick)      THEN NULL
              ELSE now()
            END,
            deadline_ts = CASE
              WHEN NOT EXISTS (SELECT 1 FROM next_slot)   THEN NULL
              WHEN (SELECT next_round FROM next_slot)
                 > (SELECT round FROM inserted_pick)      THEN NULL
              ELSE now() + (interval '1 second'
                           * (SELECT clock_seconds FROM draft_state))
            END,
            completed_at = CASE
              WHEN NOT EXISTS (SELECT 1 FROM next_slot) THEN now()
              ELSE NULL
            END
          WHERE id = ${params.draftId}::uuid
            AND EXISTS (SELECT 1 FROM inserted_pick)
          RETURNING id
        )
      SELECT
        (SELECT status       FROM draft_state)  AS initial_status,
        (SELECT slot_team    FROM draft_state)  AS slot_team,
        (SELECT player_taken FROM draft_state)  AS player_taken,
        (SELECT cur_overall  FROM draft_state)  AS draft_overall,
        EXISTS (SELECT 1 FROM inserted_pick)    AS pick_inserted,
        NOT EXISTS (SELECT 1 FROM next_slot)    AS draft_completed
    `);

    type CommitRow = {
      initial_status: string | null;
      slot_team: string | null;
      player_taken: boolean | number | string | null;
      draft_overall: number | string | null;
      pick_inserted: boolean | number | string | null;
      draft_completed: boolean | number | string | null;
    };
    const row = (result as unknown as { rows?: CommitRow[] }).rows?.[0];
    if (!row) return { ok: false, error: 'no_slot' };

    const toBool = (v: boolean | number | string | null | undefined): boolean =>
      v === true || v === 1 || (v as unknown) === 't' || (v as unknown) === 'true';

    if (!toBool(row.pick_inserted)) {
      if (!row.initial_status) return { ok: false, error: 'no_slot' };
      if (row.initial_status !== 'LIVE') return { ok: false, error: 'wrong_state' };
      if (
        expectedOverall !== null &&
        Number(row.draft_overall) !== expectedOverall
      ) return { ok: false, error: 'stale_request' };
      if (row.slot_team !== params.team) return { ok: false, error: 'wrong_team' };
      if (toBool(row.player_taken)) return { ok: false, error: 'player_taken' };
      // Conditions were met but INSERT was silenced by ON CONFLICT — a concurrent
      // request committed first. Post-check to give the caller the right code.
      const postCheck = await db.execute(sql`
        SELECT 1 FROM draft_picks
        WHERE draft_id = ${params.draftId}::uuid AND player_id = ${params.playerId}
        LIMIT 1
      `).catch(() => null);
      if (postCheck && (postCheck as unknown as { rows?: unknown[] }).rows?.length) {
        return { ok: false, error: 'player_taken' };
      }
      return { ok: false, error: 'stale_request' };
    }

    return { ok: true, completed: toBool(row.draft_completed) };
  } catch (err: unknown) {
    // Catch unique-constraint violations that slip past ON CONFLICT DO NOTHING
    // (e.g., a PostgreSQL constraint defined with a different name).
    const errStr = String(err);
    if (
      errStr.includes('23505') ||
      errStr.includes('unique constraint') ||
      errStr.includes('duplicate key')
    ) {
      const postCheck = await db.execute(sql`
        SELECT 1 FROM draft_picks
        WHERE draft_id = ${params.draftId}::uuid AND player_id = ${params.playerId}
        LIMIT 1
      `).catch(() => null);
      if (postCheck && (postCheck as unknown as { rows?: unknown[] }).rows?.length) {
        return { ok: false, error: 'player_taken' };
      }
      return { ok: false, error: 'stale_request' };
    }
    throw err;
  }
}

// Optional per-draft custom player pool (alternative to Sleeper dataset)
export async function ensureDraftPlayersTable() {
  const db = getDb();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_players (
      draft_id uuid NOT NULL,
      player_id varchar(64) NOT NULL,
      name varchar(255) NOT NULL,
      pos varchar(16) NOT NULL,
      nfl varchar(255),
      rank integer,
      meta jsonb,
      PRIMARY KEY (draft_id, player_id)
    )
  `);
  // Backfill safety for older tables
  await db.execute(sql`ALTER TABLE draft_players ADD COLUMN IF NOT EXISTS rank integer`).catch(() => {});
  await db.execute(sql`ALTER TABLE draft_players ALTER COLUMN nfl TYPE varchar(255)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_draft_players_draft ON draft_players(draft_id)`).catch(() => {});
}

export type DraftPlayerRow = { player_id: string; name: string; pos: string; nfl: string | null; rank: number | null; meta: unknown | null };

export async function setDraftPlayers(
  draftId: string,
  players: Array<{ id: string; name: string; pos: string; nfl?: string | null; rank?: number | null; meta?: unknown }>
) {
  await ensureDraftPlayersTable();
  const db = getDb();
  await db.execute(sql`DELETE FROM draft_players WHERE draft_id = ${draftId}::uuid`);
  for (const p of players) {
    const id = String(p.id || '').trim();
    const name = String(p.name || '').trim();
    const pos = String(p.pos || '').trim().toUpperCase();
    if (!id || !name || !pos) continue;
    const nfl = (p.nfl ? String(p.nfl).trim() : null) as string | null;
    const rank = p.rank == null ? null : Number(p.rank);
    await db.execute(sql`
      INSERT INTO draft_players (draft_id, player_id, name, pos, nfl, rank, meta)
      VALUES (${draftId}::uuid, ${id}, ${name}, ${pos}, ${nfl}, ${rank}, ${p.meta ?? null})
      ON CONFLICT (draft_id, player_id) DO UPDATE SET name = EXCLUDED.name, pos = EXCLUDED.pos, nfl = EXCLUDED.nfl, rank = EXCLUDED.rank, meta = EXCLUDED.meta
    `);
  }
  return true as const;
}

export async function clearDraftPlayers(draftId: string) {
  await ensureDraftPlayersTable();
  const db = getDb();
  await db.execute(sql`DELETE FROM draft_players WHERE draft_id = ${draftId}::uuid`);
  return true as const;
}

// ── Draft workspace (branding + saved pools; not tied to a single draft row) ──

export type DraftWorkspaceRow = {
  eventName: string | null;
  eventLogoUrl: string | null;
  eventColor1: string | null;
  eventColor2: string | null;
  defaultPlayerPoolId: string | null;
};

export async function saveDraftWorkspaceBranding(branding: {
  eventName?: string | null;
  eventLogoUrl?: string | null;
  eventColor1?: string | null;
  eventColor2?: string | null;
}): Promise<void> {
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`
    INSERT INTO draft_workspace (id, event_name, event_logo_url, event_color_1, event_color_2)
    VALUES (
      'default',
      ${branding.eventName ?? null},
      ${branding.eventLogoUrl ?? null},
      ${branding.eventColor1 ?? null},
      ${branding.eventColor2 ?? null}
    )
    ON CONFLICT (id) DO UPDATE SET
      event_name = EXCLUDED.event_name,
      event_logo_url = EXCLUDED.event_logo_url,
      event_color_1 = EXCLUDED.event_color_1,
      event_color_2 = EXCLUDED.event_color_2
  `);
}

export async function getDraftWorkspace(): Promise<DraftWorkspaceRow | null> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(sql`
    SELECT event_name, event_logo_url, event_color_1, event_color_2, default_player_pool_id
    FROM draft_workspace WHERE id = 'default' LIMIT 1
  `);
  const row = (res as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0];
  if (!row) return null;
  return {
    eventName: (row.event_name as string) || null,
    eventLogoUrl: (row.event_logo_url as string) || null,
    eventColor1: (row.event_color_1 as string) || null,
    eventColor2: (row.event_color_2 as string) || null,
    defaultPlayerPoolId: row.default_player_pool_id ? String(row.default_player_pool_id) : null,
  };
}

// ── Draft branding templates (named, reusable presets) ────────────────────

export type DraftBrandingTemplate = {
  id: string;
  label: string;
  eventName: string | null;
  eventLogoUrl: string | null;
  eventColor1: string | null;
  eventColor2: string | null;
  updatedAt: string;
};

export async function listBrandingTemplates(): Promise<DraftBrandingTemplate[]> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(sql`
    SELECT id::text AS id, label, event_name, event_logo_url, event_color_1, event_color_2, updated_at
    FROM draft_branding_templates ORDER BY updated_at DESC
  `);
  const rows = (res as unknown as { rows?: Array<Record<string, unknown>> }).rows || [];
  return rows.map((r) => ({
    id: String(r.id),
    label: String(r.label),
    eventName: (r.event_name as string) ?? null,
    eventLogoUrl: (r.event_logo_url as string) ?? null,
    eventColor1: (r.event_color_1 as string) ?? null,
    eventColor2: (r.event_color_2 as string) ?? null,
    updatedAt: String(r.updated_at),
  }));
}

export async function saveBrandingTemplate(params: {
  id?: string | null;
  label: string;
  eventName?: string | null;
  eventLogoUrl?: string | null;
  eventColor1?: string | null;
  eventColor2?: string | null;
}): Promise<string> {
  await ensureDraftTables();
  const db = getDb();
  const id = params.id || randomUUID();
  await db.execute(sql`
    INSERT INTO draft_branding_templates (id, label, event_name, event_logo_url, event_color_1, event_color_2, updated_at)
    VALUES (
      ${id}::uuid, ${params.label}, ${params.eventName ?? null}, ${params.eventLogoUrl ?? null},
      ${params.eventColor1 ?? null}, ${params.eventColor2 ?? null}, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label,
      event_name = EXCLUDED.event_name,
      event_logo_url = EXCLUDED.event_logo_url,
      event_color_1 = EXCLUDED.event_color_1,
      event_color_2 = EXCLUDED.event_color_2,
      updated_at = now()
  `);
  return id;
}

export async function deleteBrandingTemplate(id: string): Promise<void> {
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`DELETE FROM draft_branding_templates WHERE id = ${id}::uuid`);
}

export async function setDraftWorkspaceDefaultPool(poolId: string | null): Promise<void> {
  await ensureDraftTables();
  const db = getDb();
  if (poolId) {
    await db.execute(sql`UPDATE draft_workspace SET default_player_pool_id = ${poolId}::uuid WHERE id = 'default'`);
  } else {
    await db.execute(sql`UPDATE draft_workspace SET default_player_pool_id = NULL WHERE id = 'default'`);
  }
}

export type DraftPlayerPoolSummary = { id: string; label: string; playerCount: number; updatedAt: string };

export async function listPlayerPools(): Promise<DraftPlayerPoolSummary[]> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(sql`
    SELECT p.id, p.label, p.updated_at, COUNT(r.player_id)::int AS c
    FROM draft_player_pools p
    LEFT JOIN draft_player_pool_rows r ON r.pool_id = p.id
    GROUP BY p.id, p.label, p.updated_at
    ORDER BY p.updated_at DESC
  `);
  type R = { id: string; label: string; updated_at: Date | string; c: number | string };
  const rows = (res as unknown as { rows?: R[] }).rows || [];
  return rows.map((r) => ({
    id: String(r.id),
    label: r.label,
    playerCount: typeof r.c === 'number' ? r.c : Number(r.c || 0),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  }));
}

export async function createPlayerPool(label: string): Promise<string> {
  await ensureDraftTables();
  const db = getDb();
  const id = randomUUID();
  await db.execute(sql`INSERT INTO draft_player_pools (id, label) VALUES (${id}::uuid, ${label})`);
  return id;
}

export async function replacePlayerPoolRows(
  poolId: string,
  players: Array<{ id: string; name: string; pos: string; nfl?: string | null; rank?: number | null; meta?: unknown }>
): Promise<void> {
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`DELETE FROM draft_player_pool_rows WHERE pool_id = ${poolId}::uuid`);
  for (const p of players) {
    const pid = String(p.id || '').trim();
    const name = String(p.name || '').trim();
    const pos = String(p.pos || '').trim().toUpperCase();
    if (!pid || !name || !pos) continue;
    const nfl = (p.nfl ? String(p.nfl).trim() : null) as string | null;
    const rank = p.rank == null ? null : Number(p.rank);
    await db.execute(sql`
      INSERT INTO draft_player_pool_rows (pool_id, player_id, name, pos, nfl, rank, meta)
      VALUES (${poolId}::uuid, ${pid}, ${name}, ${pos}, ${nfl}, ${rank}, ${p.meta ?? null})
      ON CONFLICT (pool_id, player_id) DO UPDATE SET
        name = EXCLUDED.name, pos = EXCLUDED.pos, nfl = EXCLUDED.nfl, rank = EXCLUDED.rank, meta = EXCLUDED.meta
    `);
  }
  await db.execute(sql`UPDATE draft_player_pools SET updated_at = now() WHERE id = ${poolId}::uuid`);
}

export async function deletePlayerPool(poolId: string): Promise<void> {
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`DELETE FROM draft_player_pool_rows WHERE pool_id = ${poolId}::uuid`);
  await db.execute(sql`DELETE FROM draft_player_pools WHERE id = ${poolId}::uuid`);
  await db.execute(sql`
    UPDATE draft_workspace SET default_player_pool_id = NULL
    WHERE id = 'default' AND default_player_pool_id = ${poolId}::uuid
  `);
}

export async function getPlayerPoolRows(poolId: string): Promise<DraftPlayerRow[]> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(sql`
    SELECT player_id, name, pos, nfl, rank, meta FROM draft_player_pool_rows WHERE pool_id = ${poolId}::uuid
  `);
  const rows = (res as unknown as { rows?: DraftPlayerRow[] }).rows || [];
  return rows;
}

export async function copyPlayerPoolToDraft(poolId: string, draftId: string): Promise<void> {
  const rows = await getPlayerPoolRows(poolId);
  await setDraftPlayers(
    draftId,
    rows.map((r) => ({
      id: r.player_id,
      name: r.name,
      pos: r.pos,
      nfl: r.nfl,
      rank: r.rank,
      meta: r.meta,
    }))
  );
}

export async function seedDraftFromWorkspace(draftId: string): Promise<void> {
  const w = await getDraftWorkspace();
  if (!w) return;
  await updateDraftBranding(draftId, {
    eventName: w.eventName,
    eventLogoUrl: w.eventLogoUrl,
    eventColor1: w.eventColor1,
    eventColor2: w.eventColor2,
  });
  if (w.defaultPlayerPoolId) {
    await copyPlayerPoolToDraft(w.defaultPlayerPoolId, draftId);
  }
}

export async function getDraftPlayers(draftId: string): Promise<DraftPlayerRow[]> {
  await ensureDraftPlayersTable();
  const db = getDb();
  const res = await db.execute(sql`SELECT player_id, name, pos, nfl, rank, meta FROM draft_players WHERE draft_id = ${draftId}::uuid`);
  const rows = (res as unknown as { rows?: Array<DraftPlayerRow> }).rows || [];
  return rows;
}

export async function countDraftPlayers(draftId: string): Promise<number> {
  await ensureDraftPlayersTable();
  const db = getDb();
  const res = await db.execute(sql`SELECT COUNT(1)::int AS c FROM draft_players WHERE draft_id = ${draftId}::uuid`);
  const row = (res as unknown as { rows?: Array<{ c: number | string }> }).rows?.[0];
  if (!row) return 0;
  const c = typeof row.c === 'number' ? row.c : Number(row.c || 0);
  return c | 0;
}

export async function resetDraftTrades(draftId: string) {
  const db = getDb();
  // 1. Restore all current-draft pick slots to original owners (undo traded picks)
  await db.execute(sql`UPDATE draft_slots SET team = original_team WHERE draft_id = ${draftId}::uuid AND original_team IS NOT NULL`);
  // 2. Delete all trade records and assets
  await db.execute(sql`DELETE FROM draft_trade_assets WHERE trade_id IN (SELECT id FROM draft_trades WHERE draft_id = ${draftId}::uuid)`);
  await db.execute(sql`DELETE FROM draft_trades WHERE draft_id = ${draftId}::uuid`);
  // 3. Clear roster snapshots so next get_assets re-snapshots from Sleeper (original owners)
  await db.execute(sql`DELETE FROM draft_roster_snapshots WHERE draft_id = ${draftId}::uuid`);
  // 4. Clear future picks (traded future picks are removed; re-snapshotted from source on next access)
  await db.execute(sql`DELETE FROM draft_future_picks WHERE draft_id = ${draftId}::uuid`);
  // 5. Clear any pending trade animation
  await db.execute(sql`UPDATE drafts SET pending_trade_animation = NULL WHERE id = ${draftId}::uuid`);
  return { ok: true };
}

export async function resetDraft(draftId: string) {
  const db = getDb();
  // Clear all picks, queues, and trade data but KEEP draft structure (slots remain)
  await db.execute(sql`DELETE FROM draft_picks WHERE draft_id = ${draftId}::uuid`);
  await db.execute(sql`DELETE FROM draft_queues WHERE draft_id = ${draftId}::uuid`);
  await db.execute(sql`DELETE FROM draft_pending_picks WHERE draft_id = ${draftId}::uuid`);
  // Clear trade system data
  await db.execute(sql`DELETE FROM draft_trade_assets WHERE trade_id IN (SELECT id FROM draft_trades WHERE draft_id = ${draftId}::uuid)`);
  await db.execute(sql`DELETE FROM draft_trades WHERE draft_id = ${draftId}::uuid`);
  await db.execute(sql`DELETE FROM draft_roster_snapshots WHERE draft_id = ${draftId}::uuid`);
  await db.execute(sql`DELETE FROM draft_future_picks WHERE draft_id = ${draftId}::uuid`);
  // Restore all draft slots to their original owners (undo any traded picks)
  await db.execute(sql`UPDATE draft_slots SET team = original_team WHERE draft_id = ${draftId}::uuid AND original_team IS NOT NULL`);
  // Reset draft to NOT_STARTED. Set cur_overall to the lowest slot in the draft
  // (rather than hardcoding 1, in case the first slot has an unexpected overall number).
  await db.execute(sql`
    UPDATE drafts
    SET status = 'NOT_STARTED',
        pause_reason = NULL,
        cur_overall = COALESCE(
          (SELECT MIN(overall) FROM draft_slots WHERE draft_id = ${draftId}::uuid), 1
        ),
        clock_started_at = NULL,
        deadline_ts = NULL,
        started_at = NULL,
        completed_at = NULL,
        pending_trade_animation = NULL,
        paused_remaining_secs = NULL,
        round_end_pause = false
    WHERE id = ${draftId}::uuid
  `);
  return { ok: true };
}

export async function deleteDraft(draftId: string) {
  const db = getDb();
  await ensureDraftTables();
  // Keep event branding and custom player pool in workspace so the next draft can reuse them
  try {
    const snap = await db.execute(sql`
      SELECT event_name, event_logo_url, event_color_1, event_color_2
      FROM drafts WHERE id = ${draftId}::uuid LIMIT 1
    `);
    const row = (snap as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0];
    if (row) {
      await saveDraftWorkspaceBranding({
        eventName: (row.event_name as string) || null,
        eventLogoUrl: (row.event_logo_url as string) || null,
        eventColor1: (row.event_color_1 as string) || null,
        eventColor2: (row.event_color_2 as string) || null,
      });
    }
  } catch (e) {
    console.error('deleteDraft: workspace branding snapshot', e);
  }
  try {
    await ensureDraftPlayersTable();
    if ((await countDraftPlayers(draftId)) > 0) {
      const dRows = await getDraftPlayers(draftId);
      const w = await getDraftWorkspace();
      let poolId = w?.defaultPlayerPoolId || null;
      if (!poolId) {
        poolId = await createPlayerPool('Player pool');
        await setDraftWorkspaceDefaultPool(poolId);
      }
      await replacePlayerPoolRows(
        poolId,
        dRows.map((r) => ({
          id: r.player_id,
          name: r.name,
          pos: r.pos,
          nfl: r.nfl,
          rank: r.rank,
          meta: r.meta,
        }))
      );
    }
  } catch (e) {
    console.error('deleteDraft: player pool snapshot', e);
  }
  await db.execute(sql`DELETE FROM draft_picks WHERE draft_id = ${draftId}::uuid`);
  await db.execute(sql`DELETE FROM draft_queues WHERE draft_id = ${draftId}::uuid`);
  await db.execute(sql`DELETE FROM draft_pending_picks WHERE draft_id = ${draftId}::uuid`);
  await db.execute(sql`DELETE FROM draft_trade_assets WHERE trade_id IN (SELECT id FROM draft_trades WHERE draft_id = ${draftId}::uuid)`).catch(() => {});
  await db.execute(sql`DELETE FROM draft_trades WHERE draft_id = ${draftId}::uuid`).catch(() => {});
  await db.execute(sql`DELETE FROM draft_roster_snapshots WHERE draft_id = ${draftId}::uuid`).catch(() => {});
  await db.execute(sql`DELETE FROM draft_future_picks WHERE draft_id = ${draftId}::uuid`).catch(() => {});
  await db.execute(sql`DELETE FROM draft_pick_videos WHERE draft_id = ${draftId}::uuid`).catch(() => {});
  await db.execute(sql`DELETE FROM draft_slots WHERE draft_id = ${draftId}::uuid`);
  await db.execute(sql`DELETE FROM draft_players WHERE draft_id = ${draftId}::uuid`);
  await db.execute(sql`DELETE FROM drafts WHERE id = ${draftId}::uuid`);
  return { ok: true };
}

// skipPick — Commissioner control. Skips the slot currently on the clock and
// advances to the next real unpicked slot. A skipped slot is left permanently
// vacant in draft_picks (may be backfilled only via force_pick).
//
// Rules:
//  • Draft must be LIVE or PAUSED (NOT_STARTED and COMPLETED are rejected).
//  • A pending pick awaiting admin approval blocks the skip — approve or
//    reject it first so the approval state is never left dangling.
//  • The next slot is found by searching draft_slots for the first overall >
//    cur_overall that has no committed pick (skipping previously-skipped slots
//    that may have been force-picked since, as well as traded slots).
//  • At a round boundary the draft pauses (round_end_pause = true) so the
//    "Next Round" animation plays before the clock starts.
//  • If the skipped slot was the last available slot the draft completes.
export async function skipPick(draftId: string): Promise<{
  ok: boolean;
  newOverall?: number;
  completed?: boolean;
  error?: string;
}> {
  await ensureDraftTables();
  const db = getDb();

  // Read current draft state and current slot's round.
  const stateRes = await db.execute(sql`
    SELECT d.status, d.cur_overall, d.clock_seconds, s.round AS cur_round
    FROM drafts d
    JOIN draft_slots s ON s.draft_id = d.id AND s.overall = d.cur_overall
    WHERE d.id = ${draftId}::uuid
    LIMIT 1
  `);
  type StateRow = { status: string; cur_overall: number | string; clock_seconds: number | string; cur_round: number | string };
  const state = (stateRes as unknown as { rows?: StateRow[] }).rows?.[0];
  if (!state) return { ok: false, error: 'no_draft' };
  if (state.status !== 'LIVE' && state.status !== 'PAUSED') {
    return { ok: false, error: 'invalid_state' };
  }
  const curOverall = Number(state.cur_overall);
  const curRound = Number(state.cur_round);
  const secs = Number(state.clock_seconds || 60);

  // Block skip while a pending pick is awaiting approval.
  const pending = await getPendingPick(draftId);
  if (pending) return { ok: false, error: 'pending_pick_exists' };

  // Find the next unpicked slot AFTER the current slot.
  const nextRes = await db.execute(sql`
    SELECT s.overall, s.round
    FROM draft_slots s
    WHERE s.draft_id = ${draftId}::uuid
      AND s.overall > ${curOverall}
      AND NOT EXISTS (
        SELECT 1 FROM draft_picks dp
        WHERE dp.draft_id = s.draft_id AND dp.overall = s.overall
      )
    ORDER BY s.overall ASC
    LIMIT 1
  `);
  const next = (nextRes as unknown as { rows?: Array<{ overall: number | string; round: number | string }> }).rows?.[0];

  if (!next) {
    // Skipped slot was the final slot — complete the draft.
    await db.execute(sql`
      UPDATE drafts
      SET status = 'COMPLETED',
          pause_reason = NULL,
          completed_at = now(),
          clock_started_at = NULL,
          deadline_ts = NULL,
          paused_remaining_secs = NULL,
          round_end_pause = false
      WHERE id = ${draftId}::uuid
    `);
    return { ok: true, completed: true };
  }

  const nextOverall = Number(next.overall);
  const nextRound = Number(next.round);
  const isRoundBoundary = nextRound > curRound;

  if (isRoundBoundary) {
    // Pause at round boundary so the round-change animation can play.
    await db.execute(sql`
      UPDATE drafts
      SET status = 'PAUSED',
          pause_reason = 'round_end',
          cur_overall = ${nextOverall},
          clock_started_at = NULL,
          deadline_ts = NULL,
          paused_remaining_secs = ${secs},
          round_end_pause = true
      WHERE id = ${draftId}::uuid
    `);
  } else {
    // Advance within the same round — start the clock immediately.
    await db.execute(sql`
      UPDATE drafts
      SET status = 'LIVE',
          pause_reason = NULL,
          cur_overall = ${nextOverall},
          clock_started_at = now(),
          deadline_ts = now() + (interval '1 second' * ${secs}),
          paused_remaining_secs = NULL,
          round_end_pause = false
      WHERE id = ${draftId}::uuid
    `);
  }

  return { ok: true, newOverall: nextOverall, completed: false };
}

export async function updateDraftSlot(draftId: string, overall: number, team: string) {
  const db = getDb();
  // Check if pick has already been made for this slot
  const pickCheck = await db.execute(sql`SELECT 1 FROM draft_picks WHERE draft_id = ${draftId}::uuid AND overall = ${overall} LIMIT 1`);
  const hasPick = (pickCheck as unknown as { rows?: Array<Record<string, unknown>> }).rows?.length || 0;
  if (hasPick > 0) return { ok: false as const, error: 'slot_has_pick' };
  
  // Update the slot
  await db.execute(sql`UPDATE draft_slots SET team = ${team} WHERE draft_id = ${draftId}::uuid AND overall = ${overall}`);
  return { ok: true as const };
}

export async function createDraftWithOrder(params: { 
  year: number; 
  rounds: number; 
  teams: string[]; // Round 1 order (legacy, used if roundOrders not provided)
  roundOrders?: Record<number, string[]>; // Per-round team orders (round number -> team names in order)
  clockSeconds?: number; 
  id?: string 
}) {
  const id = params.id || randomUUID();
  const rounds = Math.max(1, params.rounds | 0);
  const baseTeams = (params.teams || []).filter(Boolean);
  if (baseTeams.length === 0) throw new Error('teams required');
  const clockSeconds = Math.max(10, Math.min(24 * 60 * 60, (params.clockSeconds || 60) | 0));
  const db = getDb();
  await ensureDraftTables();
  await db.execute(sql`
    INSERT INTO drafts (id, year, rounds, clock_seconds, status, created_at, cur_overall)
    VALUES (${id}::uuid, ${params.year}, ${rounds}, ${clockSeconds}, 'NOT_STARTED', now(), 1)
    ON CONFLICT (id) DO NOTHING
  `);
  let overall = 1;
  for (let r = 1; r <= rounds; r++) {
    // Use per-round order if provided, otherwise use base teams (linear, no snake)
    const order = params.roundOrders?.[r] || baseTeams;
    for (let i = 0; i < order.length; i++) {
      const pickInRound = i + 1;
      const team = order[i];
      await db.execute(sql`
        INSERT INTO draft_slots (draft_id, overall, round, pick_in_round, team, original_team)
        VALUES (${id}::uuid, ${overall}, ${r}, ${pickInRound}, ${team}, ${team})
        ON CONFLICT (draft_id, overall) DO NOTHING
      `);
      overall += 1;
    }
  }
  return { id };
}

export async function getActiveOrLatestDraftId(): Promise<string | null> {
  await ensureDraftTables();
  const db = getDb();
  const a = await db.execute(sql`SELECT id::text AS id FROM drafts WHERE status IN ('LIVE','PAUSED') ORDER BY created_at DESC LIMIT 1`);
  const ar = (a as unknown as { rows?: Array<{ id: string }> }).rows || [];
  if (ar.length > 0) return ar[0].id;
  const b = await db.execute(sql`SELECT id::text AS id FROM drafts ORDER BY created_at DESC LIMIT 1`);
  const br = (b as unknown as { rows?: Array<{ id: string }> }).rows || [];
  return br[0]?.id || null;
}

/** Return round-1 draft slots in pick order [{slot, team}] from draft_slots table. */
export async function getDraftRound1Slots(draftId: string): Promise<Array<{ slot: number; team: string }>> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(
    sql`SELECT overall, team FROM draft_slots WHERE draft_id = ${draftId}::uuid AND round = 1 ORDER BY overall ASC`
  );
  const rows = (res as unknown as { rows?: Array<{ overall: number; team: string }> }).rows || [];
  return rows.map((r, i) => ({ slot: i + 1, team: r.team }));
}

/** Return round-2 draft slots in pick order [{slot, team}] from draft_slots table. */
export async function getDraftRound2Slots(draftId: string): Promise<Array<{ slot: number; team: string }>> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(
    sql`SELECT overall, team FROM draft_slots WHERE draft_id = ${draftId}::uuid AND round = 2 ORDER BY overall ASC`
  );
  const rows = (res as unknown as { rows?: Array<{ overall: number; team: string }> }).rows || [];
  return rows.map((r, i) => ({ slot: i + 1, team: r.team }));
}

/** Full slot details for pick-ownership lookups: overall pick number, round, pick-in-round, current owner, original owner. */
export async function getDraftSlotsDetailed(draftId: string): Promise<Array<{
  overall: number; round: number; pickInRound: number; team: string; originalTeam: string;
}>> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(
    sql`SELECT overall, round, pick_in_round, team, original_team FROM draft_slots WHERE draft_id = ${draftId}::uuid ORDER BY overall ASC`
  );
  const rows = (res as unknown as { rows?: Array<{ overall: number; round: number; pick_in_round: number; team: string; original_team: string }> }).rows || [];
  return rows.map(r => ({
    overall: r.overall,
    round: r.round,
    pickInRound: r.pick_in_round,
    team: r.team,
    originalTeam: r.original_team ?? r.team,
  }));
}

/** All accepted pick-trade assets for this draft in chronological order, for tracing pick ownership chains. */
export async function getDraftPickTradeHistory(draftId: string): Promise<Array<{
  fromTeam: string; toTeam: string; pickYear: number | null; pickRound: number | null; pickOriginalTeam: string | null; pickOverall: number | null;
}>> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(sql`
    SELECT dta.from_team, dta.to_team, dta.pick_year, dta.pick_round, dta.pick_original_team, dta.pick_overall
    FROM draft_trade_assets dta
    JOIN draft_trades dt ON dt.id = dta.trade_id
    WHERE dt.draft_id = ${draftId}::uuid
      AND dt.status = 'accepted'
      AND dta.asset_type = 'pick'
    ORDER BY dt.updated_at ASC
  `);
  const rows = (res as unknown as { rows?: Array<{ from_team: string; to_team: string; pick_year: number | null; pick_round: number | null; pick_original_team: string | null; pick_overall: number | null }> }).rows || [];
  return rows.map(r => ({
    fromTeam: r.from_team,
    toTeam: r.to_team,
    pickYear: r.pick_year,
    pickRound: r.pick_round,
    pickOriginalTeam: r.pick_original_team,
    pickOverall: r.pick_overall,
  }));
}

export async function getDraftOverview(draftId: string): Promise<DraftOverview | null> {
  await ensureDraftTables();
  const db = getDb();
  const headRes = await db.execute(sql`SELECT id::text AS id, year, rounds, clock_seconds, status, created_at, started_at, completed_at, cur_overall, clock_started_at, deadline_ts, paused_remaining_secs, round_end_pause, pause_reason, event_name, event_logo_url, event_color_1, event_color_2, pending_trade_animation FROM drafts WHERE id = ${draftId}::uuid LIMIT 1`);
  const head = (headRes as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0];
  if (!head) return null;
  const curOverall = Number(head.cur_overall || 1);
  const slotRes = await db.execute(sql`SELECT team, round FROM draft_slots WHERE draft_id = ${draftId}::uuid AND overall = ${curOverall} LIMIT 1`);
  const slot = (slotRes as unknown as { rows?: Array<{ team: string; round: number }> }).rows?.[0] || null;
  const picksRes = await db.execute(sql`SELECT overall, round, team, player_id, player_name, player_pos, player_nfl, made_at FROM draft_picks WHERE draft_id = ${draftId}::uuid ORDER BY overall ASC`);
  const picksRows = (picksRes as unknown as { rows?: Array<{ overall: number; round: number; team: string; player_id: string; player_name?: string; player_pos?: string; player_nfl?: string; made_at: Date }> }).rows || [];
  const mapPick = (p: typeof picksRows[number]) => ({ overall: p.overall, round: p.round, team: p.team, playerId: p.player_id, playerName: p.player_name || null, playerPos: p.player_pos || null, playerNfl: p.player_nfl || null, madeAt: new Date(p.made_at).toISOString() });
  const allPicks = picksRows.map(mapPick);
  const recentPicks = picksRows.slice(-10).map(mapPick);
  const upRes = await db.execute(sql`SELECT overall, round, team FROM draft_slots WHERE draft_id = ${draftId}::uuid AND overall >= ${curOverall} ORDER BY overall ASC LIMIT 10`);
  const upcoming = (upRes as unknown as { rows?: Array<{ overall: number; round: number; team: string }> }).rows || [];
  // Fetch ALL slots for full grid display (needed for team logos in all rounds)
  const allSlotsRes = await db.execute(sql`SELECT overall, round, team FROM draft_slots WHERE draft_id = ${draftId}::uuid ORDER BY overall ASC`);
  const allSlots = (allSlotsRes as unknown as { rows?: Array<{ overall: number; round: number; team: string }> }).rows || [];
  return {
    id: String(head.id),
    year: Number(head.year),
    rounds: Number(head.rounds),
    clockSeconds: Number(head.clock_seconds),
    status: head.status as DraftStatus,
    createdAt: new Date(head.created_at as string).toISOString(),
    startedAt: head.started_at ? new Date(head.started_at as string).toISOString() : null,
    completedAt: head.completed_at ? new Date(head.completed_at as string).toISOString() : null,
    curOverall,
    onClockTeam: slot?.team || null,
    clockStartedAt: head.clock_started_at ? new Date(head.clock_started_at as string).toISOString() : null,
    deadlineTs: head.deadline_ts ? new Date(head.deadline_ts as string).toISOString() : null,
    pausedRemainingSecs: head.paused_remaining_secs != null ? Number(head.paused_remaining_secs) : null,
    roundEndPause: Boolean(head.round_end_pause),
    pauseReason: (head.pause_reason as DraftOverview['pauseReason']) ?? null,
    eventName: (head.event_name as string | null) ?? null,
    eventLogoUrl: (head.event_logo_url as string | null) ?? null,
    eventColor1: (head.event_color_1 as string | null) ?? null,
    eventColor2: (head.event_color_2 as string | null) ?? null,
    pendingTradeAnimation: (head.pending_trade_animation as { teams: string[]; assets: TradeAsset[] } | null) ?? null,
    recentPicks,
    allPicks,
    upcoming,
    allSlots,
  } as DraftOverview;
}

// ── Draft Order ───────────────────────────────────────────────────────────
export async function setDraftOrder(draftId: string, teams: string[]): Promise<void> {
  await ensureDraftTables();
  const db = getDb();
  const n = teams.length;
  if (n === 0) return;

  // Get current status and all slots
  const statusRes = await db.execute(sql`SELECT status FROM drafts WHERE id = ${draftId}::uuid LIMIT 1`);
  const status = ((statusRes as unknown as { rows?: Array<{ status: string }> }).rows?.[0]?.status) || 'NOT_STARTED';
  const slotsRes = await db.execute(sql`SELECT overall, round FROM draft_slots WHERE draft_id = ${draftId}::uuid ORDER BY overall ASC`);
  const slots = (slotsRes as unknown as { rows?: Array<{ overall: number; round: number }> }).rows || [];

  for (const slot of slots) {
    const overall = Number(slot.overall);
    const round = Number(slot.round);
    const pickInRound = ((overall - 1) % n) + 1; // 1-indexed within round
    const isEvenRound = round % 2 === 0;
    const teamIdx = isEvenRound ? (n - pickInRound) : (pickInRound - 1);
    const newTeam = teams[Math.max(0, Math.min(n - 1, teamIdx))];
    if (status === 'NOT_STARTED') {
      // Pre-draft: update both current owner and original
      await db.execute(sql`UPDATE draft_slots SET team = ${newTeam}, original_team = ${newTeam} WHERE draft_id = ${draftId}::uuid AND overall = ${overall}`);
    } else {
      // Mid-draft: only update original_team (affects future resets, not live picks)
      await db.execute(sql`UPDATE draft_slots SET original_team = ${newTeam} WHERE draft_id = ${draftId}::uuid AND overall = ${overall}`);
    }
  }
}

// ── Draft Slot Assignment (per-slot, any team, any round) ─────────────────
export async function setDraftSlots(
  draftId: string,
  slots: Array<{ overall: number; team: string }>,
  setAsDefault = false
): Promise<void> {
  await ensureDraftTables();
  const db = getDb();
  if (slots.length === 0) return;
  for (const slot of slots) {
    const overall = Number(slot.overall);
    const team = String(slot.team);
    if (setAsDefault) {
      // Update live owner AND reset default
      await db.execute(sql`UPDATE draft_slots SET team = ${team}, original_team = ${team} WHERE draft_id = ${draftId}::uuid AND overall = ${overall}`);
    } else {
      // Update live owner only — no effect on reset
      await db.execute(sql`UPDATE draft_slots SET team = ${team} WHERE draft_id = ${draftId}::uuid AND overall = ${overall}`);
    }
  }
}

// ── Player Videos ─────────────────────────────────────────────────────────
export async function updateDraftBranding(draftId: string, branding: {
  eventName?: string | null;
  eventLogoUrl?: string | null;
  eventColor1?: string | null;
  eventColor2?: string | null;
}): Promise<void> {
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`
    UPDATE drafts
    SET event_name = ${branding.eventName ?? null},
        event_logo_url = ${branding.eventLogoUrl ?? null},
        event_color_1 = ${branding.eventColor1 ?? null},
        event_color_2 = ${branding.eventColor2 ?? null}
    WHERE id = ${draftId}::uuid
  `);
  await saveDraftWorkspaceBranding(branding);
}

export async function getPlayerVideos(): Promise<Array<{ playerId: string; videoUrl: string | null; imageUrl: string | null; playerName: string | null }>> {
  await ensureDraftTables();
  const db = getDb();
  try {
    const res = await db.execute(sql`SELECT player_id, video_url, image_url, player_name FROM player_videos ORDER BY player_id`);
    const rows = (res as unknown as { rows?: Array<{ player_id: string; video_url: string | null; image_url: string | null; player_name: string | null }> }).rows || [];
    return rows.map(r => ({ playerId: r.player_id, videoUrl: r.video_url || null, imageUrl: r.image_url || null, playerName: r.player_name || null }));
  } catch {
    // Fallback: image_url column may not yet exist on old DB instances
    const res = await db.execute(sql`SELECT player_id, video_url, player_name FROM player_videos ORDER BY player_id`);
    const rows = (res as unknown as { rows?: Array<{ player_id: string; video_url: string | null; player_name: string | null }> }).rows || [];
    return rows.map(r => ({ playerId: r.player_id, videoUrl: r.video_url || null, imageUrl: null, playerName: r.player_name || null }));
  }
}

function assertNoDataUrl(value: string, fieldLabel: string): void {
  if (value.trimStart().toLowerCase().startsWith('data:')) {
    throw new Error(`${fieldLabel}: data: URLs are not allowed. Host media externally and store a normal URL/path.`);
  }
}

export async function getPlayerMediaSummaries(): Promise<Array<{ playerId: string; playerName: string | null; hasImage: boolean; hasVideo: boolean; videoUrl: string | null }>> {
  await ensureDraftTables();
  const db = getDb();
  try {
    const res = await db.execute(sql`
      SELECT
        player_id,
        player_name,
        (image_url IS NOT NULL AND image_url <> '' AND image_url NOT LIKE 'data:%') AS has_image,
        (video_url IS NOT NULL AND video_url <> '' AND video_url NOT LIKE 'data:%') AS has_video,
        CASE WHEN video_url IS NOT NULL AND video_url NOT LIKE 'data:%' THEN video_url ELSE NULL END AS safe_video_url
      FROM player_videos
      ORDER BY player_id
    `);
    type SummaryRow = { player_id: string; player_name: string | null; has_image: boolean | number | string; has_video: boolean | number | string; safe_video_url: string | null };
    const rows = (res as unknown as { rows?: SummaryRow[] }).rows || [];
    return rows.map(r => ({
      playerId: r.player_id,
      playerName: r.player_name || null,
      hasImage: r.has_image === true || r.has_image === 1 || r.has_image === 't' || r.has_image === 'true',
      hasVideo: r.has_video === true || r.has_video === 1 || r.has_video === 't' || r.has_video === 'true',
      videoUrl: typeof r.safe_video_url === 'string' && r.safe_video_url ? r.safe_video_url : null,
    }));
  } catch {
    // Fallback: image_url column may not yet exist on old DB instances
    const res = await db.execute(sql`
      SELECT
        player_id,
        player_name,
        (video_url IS NOT NULL AND video_url <> '' AND video_url NOT LIKE 'data:%') AS has_video,
        CASE WHEN video_url IS NOT NULL AND video_url NOT LIKE 'data:%' THEN video_url ELSE NULL END AS safe_video_url
      FROM player_videos
      ORDER BY player_id
    `);
    type FallbackRow = { player_id: string; player_name: string | null; has_video: boolean | number | string; safe_video_url: string | null };
    const rows = (res as unknown as { rows?: FallbackRow[] }).rows || [];
    return rows.map(r => ({
      playerId: r.player_id,
      playerName: r.player_name || null,
      hasImage: false,
      hasVideo: r.has_video === true || r.has_video === 1 || r.has_video === 't' || r.has_video === 'true',
      videoUrl: typeof r.safe_video_url === 'string' && r.safe_video_url ? r.safe_video_url : null,
    }));
  }
}

export async function getPlayerMediaById(playerId: string): Promise<{ playerId: string; videoUrl: string | null; imageUrl: string | null; playerName: string | null } | null> {
  await ensureDraftTables();
  const db = getDb();
  try {
    const res = await db.execute(sql`SELECT player_id, video_url, image_url, player_name FROM player_videos WHERE player_id = ${playerId} LIMIT 1`);
    const row = (res as unknown as { rows?: Array<{ player_id: string; video_url: string | null; image_url: string | null; player_name: string | null }> }).rows?.[0];
    if (!row) return null;
    return { playerId: row.player_id, videoUrl: row.video_url || null, imageUrl: row.image_url || null, playerName: row.player_name || null };
  } catch {
    // Fallback: image_url column may not yet exist on old DB instances
    const res = await db.execute(sql`SELECT player_id, video_url, player_name FROM player_videos WHERE player_id = ${playerId} LIMIT 1`);
    const row = (res as unknown as { rows?: Array<{ player_id: string; video_url: string | null; player_name: string | null }> }).rows?.[0];
    if (!row) return null;
    return { playerId: row.player_id, videoUrl: row.video_url || null, imageUrl: null, playerName: row.player_name || null };
  }
}

export async function setPlayerVideo(playerId: string, videoUrl: string, playerName?: string | null): Promise<void> {
  assertNoDataUrl(videoUrl, 'videoUrl');
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`
    INSERT INTO player_videos (player_id, video_url, player_name, updated_at)
    VALUES (${playerId}, ${videoUrl}, ${playerName ?? null}, now())
    ON CONFLICT (player_id) DO UPDATE SET video_url = ${videoUrl}, player_name = COALESCE(${playerName ?? null}, player_videos.player_name), updated_at = now()
  `);
}

export async function setPlayerImage(playerId: string, imageUrl: string, playerName?: string | null): Promise<void> {
  assertNoDataUrl(imageUrl, 'imageUrl');
  await ensureDraftTables(); // ensures image_url column exists via ALTER TABLE IF NOT EXISTS
  const db = getDb();
  await db.execute(sql`
    INSERT INTO player_videos (player_id, video_url, image_url, player_name, updated_at)
    VALUES (${playerId}, '', ${imageUrl}, ${playerName ?? null}, now())
    ON CONFLICT (player_id) DO UPDATE SET image_url = ${imageUrl}, player_name = COALESCE(${playerName ?? null}, player_videos.player_name), updated_at = now()
  `);
}

export async function deletePlayerVideo(playerId: string): Promise<void> {
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`DELETE FROM player_videos WHERE player_id = ${playerId}`);
}

// ── Draft Pending Picks ─────────────────────────────────────────────────────
//
// submitPendingPick is idempotent: if a pending pick for this slot already
// exists it returns the existing row rather than replacing it. This prevents
// a second browser tab or a simultaneous expiry-check from overwriting the
// first team selection. The partial unique index
// uq_pending_picks_draft_overall enforces the one-pending-per-slot invariant
// at the database level.
//
// Returns { id, created: true }  when a new row was inserted.
// Returns { id, created: false } when a matching pending row already existed.
// Returns null when the request is rejected (wrong state, wrong team, stale slot).
export async function submitPendingPick(draftId: string, data: {
  overall: number; team: string; playerId: string;
  playerName?: string | null; playerPos?: string | null; playerNfl?: string | null;
}): Promise<{ id: string; created: boolean } | null> {
  await ensureDraftTables();
  const db = getDb();
  const nfl = data.playerNfl != null && String(data.playerNfl).length > 255
    ? String(data.playerNfl).slice(0, 255)
    : (data.playerNfl ?? null);

  // Verify the draft cursor, team ownership, and draft state before inserting.
  const stateRes = await db.execute(sql`
    SELECT d.status, d.cur_overall, d.round_end_pause, s.team AS slot_team
    FROM drafts d
    JOIN draft_slots s ON s.draft_id = d.id AND s.overall = d.cur_overall
    WHERE d.id = ${draftId}::uuid
    LIMIT 1
  `);
  type StateRow = {
    status: string;
    cur_overall: number | string;
    round_end_pause: boolean | number | string;
    slot_team: string;
  };
  const state = (stateRes as unknown as { rows?: StateRow[] }).rows?.[0];
  if (!state) return null;
  if (state.status === 'COMPLETED') return null;
  const toBool = (v: boolean | number | string | null | undefined): boolean =>
    v === true || v === 1 || (v as unknown) === 't' || (v as unknown) === 'true';
  if (toBool(state.round_end_pause)) return null;
  if (Number(state.cur_overall) !== data.overall) return null;
  if (state.slot_team !== data.team) return null;

  // Atomic insert. The partial unique index on (draft_id, overall) WHERE
  // status = 'pending' prevents two concurrent requests from each inserting
  // a pending pick for the same slot.
  const insertRes = await db.execute(sql`
    INSERT INTO draft_pending_picks
      (draft_id, overall, team, player_id, player_name, player_pos, player_nfl, status)
    VALUES (
      ${draftId}::uuid, ${data.overall}, ${data.team}, ${data.playerId},
      ${data.playerName ?? null}, ${data.playerPos ?? null}, ${nfl}, 'pending'
    )
    ON CONFLICT DO NOTHING
    RETURNING id::text AS id
  `);
  type InsertRow = { id: string };
  const inserted = (insertRes as unknown as { rows?: InsertRow[] }).rows?.[0];
  if (inserted) return { id: inserted.id, created: true };

  // A pending pick for this slot already exists — return it (idempotent).
  const existingRes = await db.execute(sql`
    SELECT id::text AS id
    FROM draft_pending_picks
    WHERE draft_id = ${draftId}::uuid
      AND overall  = ${data.overall}
      AND status   = 'pending'
    LIMIT 1
  `);
  const existing = (existingRes as unknown as { rows?: InsertRow[] }).rows?.[0];
  if (existing) return { id: existing.id, created: false };
  return null;
}

export async function getPendingPick(draftId: string): Promise<{
  id: string; overall: number; team: string; playerId: string;
  playerName: string | null; playerPos: string | null; playerNfl: string | null; submittedAt: string;
} | null> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(sql`SELECT id::text, overall, team, player_id, player_name, player_pos, player_nfl, submitted_at FROM draft_pending_picks WHERE draft_id = ${draftId}::uuid AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1`);
  const row = (res as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0];
  if (!row) return null;
  return {
    id: String(row.id), overall: Number(row.overall), team: String(row.team),
    playerId: String(row.player_id), playerName: row.player_name as string | null,
    playerPos: row.player_pos as string | null, playerNfl: row.player_nfl as string | null,
    submittedAt: new Date(row.submitted_at as string).toISOString(),
  };
}

export async function resolvePendingPick(pendingId: string, status: 'approved' | 'rejected'): Promise<void> {
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`UPDATE draft_pending_picks SET status = ${status} WHERE id = ${pendingId}::uuid`);
}

export async function startDraft(draftId: string): Promise<{ ok: boolean; error?: string }> {
  await ensureDraftTables();
  const db = getDb();

  // Confirm the draft exists and is in NOT_STARTED state.
  const draftRow = await db.execute(sql`
    SELECT status, clock_seconds FROM drafts WHERE id = ${draftId}::uuid LIMIT 1
  `);
  const draft = (draftRow as unknown as { rows?: Array<{ status: string; clock_seconds: number }> }).rows?.[0];
  if (!draft) return { ok: false, error: 'no_draft' };
  if (draft.status !== 'NOT_STARTED') return { ok: false, error: 'already_started' };

  // Confirm slots exist and at least one team is assigned.
  const slotsRes = await db.execute(sql`
    SELECT COUNT(1)::int AS c, COUNT(DISTINCT team)::int AS teams
    FROM draft_slots WHERE draft_id = ${draftId}::uuid
  `);
  const sr = (slotsRes as unknown as { rows?: Array<{ c: number | string; teams: number | string }> }).rows?.[0];
  const slotCount = sr ? (typeof sr.c === 'number' ? sr.c : Number(sr.c || 0)) : 0;
  const teamCount = sr ? (typeof sr.teams === 'number' ? sr.teams : Number(sr.teams || 0)) : 0;
  if (slotCount === 0) return { ok: false, error: 'no_slots' };
  if (teamCount === 0) return { ok: false, error: 'no_teams' };

  // Find the first unpicked slot.
  const firstRes = await db.execute(sql`
    SELECT s.overall
    FROM draft_slots s
    WHERE s.draft_id = ${draftId}::uuid
      AND NOT EXISTS (SELECT 1 FROM draft_picks p WHERE p.draft_id = s.draft_id AND p.overall = s.overall)
    ORDER BY s.overall ASC LIMIT 1
  `);
  const firstRow = (firstRes as unknown as { rows?: Array<{ overall: number }> }).rows?.[0];
  const first = firstRow ? Number(firstRow.overall) : 1;
  const secs = draft.clock_seconds || 60;

  // Atomically start this draft ONLY if no other draft is LIVE/PAUSED.
  // Doing the guard and the UPDATE in a single statement prevents a race where
  // two simultaneous start requests both pass the prior SELECT checks.
  const startRes = await db.execute(sql`
    UPDATE drafts
    SET status = 'LIVE',
        pause_reason = NULL,
        started_at = COALESCE(started_at, now()),
        cur_overall = ${first},
        clock_started_at = now(),
        deadline_ts = now() + (interval '1 second' * ${secs}),
        paused_remaining_secs = NULL,
        round_end_pause = false,
        completed_at = NULL
    WHERE id = ${draftId}::uuid
      AND status = 'NOT_STARTED'
      AND NOT EXISTS (
        SELECT 1 FROM drafts d2
        WHERE d2.status IN ('LIVE', 'PAUSED') AND d2.id <> ${draftId}::uuid
      )
    RETURNING id
  `);
  if (!(startRes as unknown as { rows?: unknown[] }).rows?.length) {
    // Re-check why the update was rejected.
    const recheckRes = await db.execute(sql`
      SELECT status FROM drafts WHERE id = ${draftId}::uuid LIMIT 1
    `);
    const recheckRow = (recheckRes as unknown as { rows?: Array<{ status: string }> }).rows?.[0];
    if (!recheckRow || recheckRow.status !== 'NOT_STARTED') {
      return { ok: false, error: 'already_started' };
    }
    return { ok: false, error: 'another_draft_active' };
  }
  return { ok: true };
}

export async function getDraftPickedPlayerIds(draftId: string): Promise<string[]> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(sql`SELECT player_id FROM draft_picks WHERE draft_id = ${draftId}::uuid`);
  const rows = (res as unknown as { rows?: Array<{ player_id: string }> }).rows || [];
  return rows.map((r) => r.player_id).filter(Boolean);
}

// pause_reason values (stored in the drafts.pause_reason column):
//   'manual'          — commissioner pressed Pause
//   'pick_animation'  — admin approved a pick; waiting for client anim_clock_start
//   'round_end'       — end of round; waiting for commissioner to start next round
//   'trade_animation' — trade accepted; animation playing before clock resumes
//   'pending_pick'    — team submitted a pick; waiting for admin approval
// NULL means the draft is not paused (LIVE / NOT_STARTED / COMPLETED).

/**
 * Pause the draft specifically for a pick animation: saves the FULL configured clock
 * time so the next team gets a fresh clock when resumeAfterAnimation is called.
 * Only transitions from LIVE (idempotent if already animation-paused).
 */
export async function pauseDraftForAnimation(draftId: string) {
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`
    UPDATE drafts
    SET status = 'PAUSED',
        pause_reason = 'pick_animation',
        paused_remaining_secs = clock_seconds,
        clock_started_at = NULL,
        deadline_ts = NULL
    WHERE id = ${draftId}::uuid
      AND status IN ('LIVE', 'PAUSED')
      AND (pause_reason IS NULL OR pause_reason = 'pick_animation')
  `);
  return true;
}

/**
 * Idempotent resume after a pick animation: only starts the clock if the draft is
 * currently paused specifically for an animation (pause_reason = 'pick_animation').
 * Safe to call from multiple clients simultaneously — the second call is a no-op.
 *
 * Also called by checkStaleAnimationPause() as the server-side fallback.
 */
export async function resumeAfterAnimation(draftId: string): Promise<boolean> {
  await ensureDraftTables();
  const db = getDb();
  const r = await db.execute(sql`
    SELECT clock_seconds, paused_remaining_secs
    FROM drafts
    WHERE id = ${draftId}::uuid
      AND status = 'PAUSED'
      AND pause_reason = 'pick_animation'
    LIMIT 1
  `);
  const row = (r as unknown as { rows?: Array<{ clock_seconds: number; paused_remaining_secs: number | null }> }).rows?.[0];
  if (!row) return false; // Not in animation-pause — manual, round-end, trade, etc. — no-op
  const secs = (row.paused_remaining_secs != null && row.paused_remaining_secs > 0)
    ? row.paused_remaining_secs
    : (row.clock_seconds || 60);
  await db.execute(sql`
    UPDATE drafts
    SET status = 'LIVE',
        pause_reason = NULL,
        clock_started_at = now(),
        deadline_ts = now() + (interval '1 second' * ${secs}),
        paused_remaining_secs = NULL
    WHERE id = ${draftId}::uuid
      AND status = 'PAUSED'
      AND pause_reason = 'pick_animation'
  `);
  return true;
}

/**
 * Server-side fallback for stale animation pauses. Called on every GET /api/draft
 * when the draft is PAUSED with pause_reason = 'pick_animation'. If the animation
 * pause has been held longer than MAX_ANIMATION_PAUSE_SECS (45 s), the clock is
 * started automatically without waiting for a client anim_clock_start call.
 *
 * This protects against:
 *  - Overlay tab closed before anim_clock_start fired
 *  - Network failure eating the anim_clock_start request
 *  - Race where all tabs reload simultaneously during animation
 */
const MAX_ANIMATION_PAUSE_SECS = 45;

export async function checkStaleAnimationPause(draftId: string): Promise<boolean> {
  await ensureDraftTables();
  const db = getDb();
  // Auto-resume if the most recent pick's made_at is older than MAX_ANIMATION_PAUSE_SECS.
  // `interval '1 second' * N` is used so the JS constant becomes a parameterized
  // integer value in the drizzle sql tag, rather than being interpolated into a
  // string literal (which the sql tag cannot safely do).
  const r = await db.execute(sql`
    SELECT d.id
    FROM drafts d
    WHERE d.id = ${draftId}::uuid
      AND d.status = 'PAUSED'
      AND d.pause_reason = 'pick_animation'
      AND (
        SELECT p.made_at FROM draft_picks p
        WHERE p.draft_id = d.id
        ORDER BY p.made_at DESC
        LIMIT 1
      ) < now() - (interval '1 second' * ${MAX_ANIMATION_PAUSE_SECS})
    LIMIT 1
  `);
  if (!(r as unknown as { rows?: unknown[] }).rows?.length) return false;
  return resumeAfterAnimation(draftId);
}

export async function pauseDraft(draftId: string) {
  await ensureDraftTables();
  const db = getDb();
  // Only pause if currently LIVE — prevents corrupting paused_remaining_secs on double-pause.
  await db.execute(sql`
    UPDATE drafts
    SET status = 'PAUSED',
        pause_reason = 'pending_pick',
        paused_remaining_secs = GREATEST(0, EXTRACT(EPOCH FROM (deadline_ts - now()))::integer),
        clock_started_at = NULL,
        deadline_ts = NULL
    WHERE id = ${draftId}::uuid AND status = 'LIVE'
  `);
  return true;
}

/**
 * Pause the draft clock while a trade approval animation plays. Uses pause_reason
 * 'trade_animation' (distinct from 'pending_pick', which the v149 pick-submission
 * workflow reserves for an actual row in draft_pending_picks). Only transitions
 * from LIVE — if the draft was already PAUSED (e.g. manually) this is a no-op, so
 * the original pause_reason is preserved and the clock will not auto-resume once
 * the trade animation finishes (see finishTradeAnimationV149).
 */
export async function pauseDraftForTradeAnimation(draftId: string) {
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`
    UPDATE drafts
    SET status = 'PAUSED',
        pause_reason = 'trade_animation',
        paused_remaining_secs = GREATEST(0, EXTRACT(EPOCH FROM (deadline_ts - now()))::integer),
        clock_started_at = NULL,
        deadline_ts = NULL
    WHERE id = ${draftId}::uuid AND status = 'LIVE'
  `);
  return true;
}

export async function pauseDraftManual(draftId: string) {
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`
    UPDATE drafts
    SET status = 'PAUSED',
        pause_reason = 'manual',
        paused_remaining_secs = GREATEST(0, EXTRACT(EPOCH FROM (deadline_ts - now()))::integer),
        clock_started_at = NULL,
        deadline_ts = NULL
    WHERE id = ${draftId}::uuid AND status = 'LIVE'
  `);
  return true;
}

export async function resumeDraft(draftId: string) {
  await ensureDraftTables();
  const db = getDb();
  // Use saved remaining secs from pause; fall back to full clock if missing.
  // Only resume if currently PAUSED — prevents accidentally restarting a COMPLETED draft.
  const r = await db.execute(sql`SELECT clock_seconds, paused_remaining_secs FROM drafts WHERE id = ${draftId}::uuid LIMIT 1`);
  const row = (r as unknown as { rows?: Array<{ clock_seconds: number; paused_remaining_secs: number | null }> }).rows?.[0];
  const secs = (row?.paused_remaining_secs != null && row.paused_remaining_secs > 0)
    ? row.paused_remaining_secs
    : (row?.clock_seconds || 60);
  await db.execute(sql`
    UPDATE drafts
    SET status = 'LIVE',
        pause_reason = NULL,
        clock_started_at = now(),
        deadline_ts = now() + (interval '1 second' * ${secs}),
        paused_remaining_secs = NULL,
        round_end_pause = false
    WHERE id = ${draftId}::uuid AND status = 'PAUSED'
  `);
  return true;
}

export async function resetPickClock(draftId: string): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    UPDATE drafts
    SET clock_started_at = now(),
        deadline_ts = now() + (interval '1 second' * clock_seconds),
        paused_remaining_secs = NULL
    WHERE id = ${draftId}::uuid AND status = 'LIVE'
  `);
}

export async function setClockSeconds(draftId: string, seconds: number) {
  const db = getDb();
  const s = Math.max(10, Math.min(24 * 60 * 60, seconds | 0));
  // When paused, also update paused_remaining_secs so the new time takes effect immediately on resume
  await db.execute(sql`
    UPDATE drafts
    SET clock_seconds = ${s},
        paused_remaining_secs = CASE WHEN status = 'PAUSED' THEN ${s} ELSE paused_remaining_secs END
    WHERE id = ${draftId}::uuid
  `);
  return true;
}

// makePick delegates to commitPick — the single authoritative commit path.
export async function makePick(params: {
  draftId: string; team: string; playerId: string;
  playerName?: string | null; playerPos?: string | null; playerNfl?: string | null;
  madeBy: string;
}) {
  return commitPick({
    draftId: params.draftId,
    team: params.team,
    playerId: params.playerId,
    playerName: params.playerName ?? null,
    playerPos: params.playerPos ?? null,
    playerNfl: params.playerNfl ?? null,
    madeBy: params.madeBy,
  });
}

// forcePick delegates to commitPick. Accepts an optional expectedOverall so
// the approve_pick path can verify the pending pick still matches the cursor.
export async function forcePick(params: {
  draftId: string; playerId: string; playerName?: string | null;
  playerPos?: string | null; playerNfl?: string | null;
  team?: string | null; madeBy: string;
  expectedOverall?: number | null;
}) {
  await ensureDraftTables();
  const db = getDb();
  let team = params.team || null;
  let curOverall: number | null = params.expectedOverall ?? null;
  if (!team) {
    const curRes = await db.execute(sql`
      SELECT d.cur_overall, s.team
      FROM drafts d
      JOIN draft_slots s ON s.draft_id = d.id AND s.overall = d.cur_overall
      WHERE d.id = ${params.draftId}::uuid LIMIT 1
    `);
    const cur = (curRes as unknown as { rows?: Array<{ cur_overall: number; team: string }> }).rows?.[0];
    if (!cur) return { ok: false as const, error: 'no_team' as const };
    team = cur.team;
    curOverall = curOverall ?? Number(cur.cur_overall);
  }
  return commitPick({
    draftId: params.draftId,
    team,
    playerId: params.playerId,
    playerName: params.playerName ?? null,
    playerPos: params.playerPos ?? null,
    playerNfl: params.playerNfl ?? null,
    madeBy: params.madeBy,
    expectedOverall: curOverall,
  });
}

// undoLastPick — reverses all consequences of the last committed pick.
//
// A single atomic CTE handles:
//   • Deleting the pick from draft_picks
//   • Removing any pending pick at that slot or later (stale after undo)
//   • Removing the drafted player from draft_roster_snapshots when the row was
//     added by this draft (acquired_via = 'drafted')
//   • Updating the draft cursor back to that slot and pausing with a fresh clock
//
// Queue restoration is intentionally omitted — there is no reliable record of
// the player's prior queue position. The commissioner may re-add the player to
// the team's queue manually if needed.
//
// Note on the roster snapshot: only rows with acquired_via = 'drafted' are
// removed. If the player pre-existed on the Sleeper snapshot (acquired_via =
// 'sleeper') that row is not affected — it was there before the draft started.
export async function undoLastPick(draftId: string): Promise<{ ok: boolean; error?: string; overall?: number }> {
  await ensureDraftTables();
  const db = getDb();

  const result = await db.execute(sql`
    WITH
      last_pick AS (
        SELECT id, overall, round, team, player_id
        FROM draft_picks
        WHERE draft_id = ${draftId}::uuid
        ORDER BY overall DESC
        LIMIT 1
      ),
      del_pick AS (
        DELETE FROM draft_picks
        WHERE id = (SELECT id FROM last_pick)
        RETURNING overall, team, player_id
      ),
      del_pending AS (
        DELETE FROM draft_pending_picks
        WHERE draft_id = ${draftId}::uuid
          AND status = 'pending'
          AND overall >= (SELECT overall FROM del_pick)
        RETURNING id
      ),
      del_snapshot AS (
        DELETE FROM draft_roster_snapshots
        WHERE draft_id = ${draftId}::uuid
          AND team      = (SELECT team FROM del_pick)
          AND player_id = (SELECT player_id FROM del_pick)
          AND acquired_via = 'drafted'
        RETURNING player_id
      ),
      upd_draft AS (
        UPDATE drafts
        SET status              = 'PAUSED',
            pause_reason        = 'manual',
            cur_overall         = (SELECT overall FROM del_pick),
            clock_started_at    = NULL,
            deadline_ts         = NULL,
            completed_at        = NULL,
            paused_remaining_secs = clock_seconds,
            round_end_pause     = false,
            pending_trade_animation = NULL
        WHERE id = ${draftId}::uuid
          AND EXISTS (SELECT 1 FROM del_pick)
        RETURNING id
      )
    SELECT
      (SELECT overall    FROM del_pick) AS overall,
      (SELECT team       FROM del_pick) AS team,
      (SELECT player_id  FROM del_pick) AS player_id,
      EXISTS(SELECT 1 FROM upd_draft)   AS updated
  `);

  type UndoRow = {
    overall: number | string | null;
    team: string | null;
    player_id: string | null;
    updated: boolean | number | string | null;
  };
  const row = (result as unknown as { rows?: UndoRow[] }).rows?.[0];
  const toBool = (v: boolean | number | string | null | undefined): boolean =>
    v === true || v === 1 || (v as unknown) === 't' || (v as unknown) === 'true';

  if (!row || !row.overall || !toBool(row.updated)) return { ok: false, error: 'no_picks' };
  return { ok: true, overall: Number(row.overall) };
}

export type QueuePlayer = { id: string; name: string; pos: string; nfl: string };

export async function getTeamQueue(draftId: string, team: string): Promise<QueuePlayer[]> {
  await ensureDraftTables();
  const db = getDb();
  const q = await db.execute(sql`SELECT player_id, player_name, player_pos, player_nfl FROM draft_queues WHERE draft_id = ${draftId}::uuid AND team = ${team} ORDER BY rank ASC`);
  const rows = (q as unknown as { rows?: Array<{ player_id: string; player_name?: string; player_pos?: string; player_nfl?: string }> }).rows || [];
  return rows.map((r) => ({ id: r.player_id, name: r.player_name || r.player_id, pos: r.player_pos || '', nfl: r.player_nfl || '' }));
}

export async function removePlayerFromQueue(draftId: string, team: string, playerId: string): Promise<void> {
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`DELETE FROM draft_queues WHERE draft_id = ${draftId}::uuid AND team = ${team} AND player_id = ${playerId}`);
}

export async function setTeamQueue(draftId: string, team: string, players: Array<{ id: string; name?: string; pos?: string; nfl?: string }>) {
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`DELETE FROM draft_queues WHERE draft_id = ${draftId}::uuid AND team = ${team}`);
  let i = 1;
  for (const p of players) {
    await db.execute(sql`INSERT INTO draft_queues (draft_id, team, rank, player_id, player_name, player_pos, player_nfl) VALUES (${draftId}::uuid, ${team}, ${i}, ${p.id}, ${p.name || null}, ${p.pos || null}, ${p.nfl || null})`);
    i += 1;
  }
  return true;
}

// checkAndAutoPick — concurrency-safe auto-pick on clock expiry.
//
// Multiple simultaneous GET requests (admin panel, overlay, team rooms) all call
// this function. Safety guarantees:
//   • The pending-pick partial unique index ensures only ONE pending row can
//     exist per (draft_id, overall), so concurrent submitPendingPick calls are
//     idempotent — the second call returns the existing row rather than creating
//     a duplicate.
//   • commitPick (force=true path) uses ON CONFLICT DO NOTHING on draft_picks so
//     only one forced pick lands even if two requests race.
//   • Both paths re-verify the draft cursor and team ownership immediately before
//     writing, so a stale request from a previous tick silently does nothing.
//
// If force=true: bypass approval and commit the pick immediately via commitPick.
// If force=false (clock expired): submit a pending pick for admin approval.
export async function checkAndAutoPick(draftId: string, force = false): Promise<{ picked: boolean; playerId?: string; playerName?: string; error?: string }> {
  await ensureDraftTables();
  const db = getDb();

  // Read draft state including deadline and current slot team.
  const draftRes = await db.execute(sql`
    SELECT d.status, d.deadline_ts, d.cur_overall, s.team
    FROM drafts d
    JOIN draft_slots s ON s.draft_id = d.id AND s.overall = d.cur_overall
    WHERE d.id = ${draftId}::uuid
    LIMIT 1
  `);
  const draft = (draftRes as unknown as { rows?: Array<{ status: string; deadline_ts: string | null; cur_overall: number; team: string }> }).rows?.[0];
  if (!draft) return { picked: false, error: 'no_draft' };
  if (draft.status !== 'LIVE') return { picked: false, error: 'draft_not_live' };

  if (!force) {
    if (!draft.deadline_ts) return { picked: false };
    const deadline = new Date(draft.deadline_ts).getTime();
    if (Date.now() < deadline) return { picked: false };
  }

  const team = draft.team;
  const curOverall = Number(draft.cur_overall);

  // Snapshot taken players.
  const takenRes = await db.execute(sql`SELECT player_id FROM draft_picks WHERE draft_id = ${draftId}::uuid`);
  const taken = new Set(((takenRes as unknown as { rows?: Array<{ player_id: string }> }).rows || []).map(r => r.player_id));

  // A pending pick already waiting for admin approval — do not interfere.
  const existingPending = await getPendingPick(draftId);
  if (existingPending) return { picked: false };

  // ── Try queue first ──────────────────────────────────────────────────────
  const queueRes = await db.execute(sql`
    SELECT player_id, player_name, player_pos, player_nfl
    FROM draft_queues
    WHERE draft_id = ${draftId}::uuid AND team = ${team}
    ORDER BY rank ASC
  `);
  const queue = (queueRes as unknown as { rows?: Array<{ player_id: string; player_name?: string; player_pos?: string; player_nfl?: string }> }).rows || [];

  for (const qp of queue) {
    if (taken.has(qp.player_id)) continue;
    if (force) {
      // Admin-forced: commit immediately via the authoritative commitPick.
      const pickRes = await commitPick({
        draftId, team,
        playerId: qp.player_id,
        playerName: qp.player_name || null,
        playerPos: qp.player_pos || null,
        playerNfl: qp.player_nfl || null,
        madeBy: 'auto',
        expectedOverall: curOverall,
      });
      if (pickRes.ok) {
        await db.execute(sql`DELETE FROM draft_queues WHERE draft_id = ${draftId}::uuid AND team = ${team} AND player_id = ${qp.player_id}`);
        return { picked: true, playerId: qp.player_id, playerName: qp.player_name || undefined };
      }
      // commitPick failed (concurrent commit raced us) — stop, don't try more.
      return { picked: false, error: 'stale_request' };
    } else {
      // Clock expired — submit as pending pick so admin can approve.
      // submitPendingPick is idempotent: if a concurrent request already
      // created the pending pick it returns { created: false } and we stop.
      const pending = await submitPendingPick(draftId, {
        overall: curOverall,
        team,
        playerId: qp.player_id,
        playerName: qp.player_name || null,
        playerPos: qp.player_pos || null,
        playerNfl: qp.player_nfl || null,
      });
      if (pending) {
        if (pending.created) await pauseDraft(draftId);
        return { picked: true, playerId: qp.player_id, playerName: qp.player_name || undefined };
      }
      // State changed between our reads and the submit — abort this tick.
      return { picked: false };
    }
  }

  // ── Try custom player pool (sorted by rank) ──────────────────────────────
  await ensureDraftPlayersTable();
  const customRes = await db.execute(sql`
    SELECT player_id, name, pos, nfl FROM draft_players
    WHERE draft_id = ${draftId}::uuid
    ORDER BY COALESCE(rank, 999999) ASC, name ASC
  `);
  const customPlayers = (customRes as unknown as { rows?: Array<{ player_id: string; name: string; pos?: string | null; nfl?: string | null }> }).rows || [];

  for (const p of customPlayers) {
    if (taken.has(p.player_id)) continue;
    if (force) {
      const pickRes = await commitPick({
        draftId, team,
        playerId: p.player_id,
        playerName: p.name,
        playerPos: p.pos || null,
        playerNfl: p.nfl || null,
        madeBy: 'auto',
        expectedOverall: curOverall,
      });
      if (pickRes.ok) return { picked: true, playerId: p.player_id, playerName: p.name };
      return { picked: false, error: 'stale_request' };
    } else {
      // Custom pool + clock expired: submit as pending for admin approval.
      const pending = await submitPendingPick(draftId, {
        overall: curOverall,
        team,
        playerId: p.player_id,
        playerName: p.name,
        playerPos: p.pos || null,
        playerNfl: p.nfl || null,
      });
      if (pending) {
        if (pending.created) await pauseDraft(draftId);
        return { picked: true, playerId: p.player_id, playerName: p.name };
      }
      return { picked: false };
    }
  }

  // ── No player available — advance the clock to the next slot (skip) ──────
  const clkRes = await db.execute(sql`SELECT clock_seconds FROM drafts WHERE id = ${draftId}::uuid LIMIT 1`);
  const secs = (clkRes as unknown as { rows?: Array<{ clock_seconds: number }> }).rows?.[0]?.clock_seconds || 60;
  const nextRes = await db.execute(sql`
    SELECT s.overall FROM draft_slots s
    WHERE s.draft_id = ${draftId}::uuid AND s.overall > ${curOverall}
      AND NOT EXISTS (SELECT 1 FROM draft_picks p WHERE p.draft_id = s.draft_id AND p.overall = s.overall)
    ORDER BY s.overall ASC LIMIT 1
  `);
  const next = (nextRes as unknown as { rows?: Array<{ overall: number }> }).rows?.[0]?.overall as number | undefined;
  if (typeof next === 'number') {
    await db.execute(sql`UPDATE drafts SET cur_overall = ${next}, clock_started_at = now(), deadline_ts = now() + (interval '1 second' * ${secs}) WHERE id = ${draftId}::uuid`);
  } else {
    await db.execute(sql`UPDATE drafts SET status = 'COMPLETED', completed_at = now() WHERE id = ${draftId}::uuid`);
  }
  return { picked: false, error: 'no_available_player' };
}

// =====================
// Pick Videos
// =====================
export async function getPickVideos(draftId: string): Promise<Array<{ overall: number; videoUrl: string; playerName: string | null }>> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(sql`SELECT overall, video_url, player_name FROM draft_pick_videos WHERE draft_id = ${draftId}::uuid ORDER BY overall ASC`);
  const rows = (res as unknown as { rows?: Array<{ overall: number; video_url: string; player_name: string | null }> }).rows || [];
  return rows.map(r => ({ overall: Number(r.overall), videoUrl: r.video_url, playerName: r.player_name || null }));
}

export async function setPickVideo(draftId: string, overall: number, videoUrl: string, playerName?: string | null): Promise<void> {
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`
    INSERT INTO draft_pick_videos (draft_id, overall, video_url, player_name)
    VALUES (${draftId}::uuid, ${overall}, ${videoUrl}, ${playerName || null})
    ON CONFLICT (draft_id, overall) DO UPDATE SET video_url = EXCLUDED.video_url, player_name = EXCLUDED.player_name
  `);
}

export async function deletePickVideo(draftId: string, overall: number): Promise<void> {
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`DELETE FROM draft_pick_videos WHERE draft_id = ${draftId}::uuid AND overall = ${overall}`);
}

export async function prunePriorSeasonsKeepOfficial(currentSeason: number) {
  const db = getDb();
  try {
    // Delete any snapshot for seasons before currentSeason that is not sun_pm_official
    await db
      .delete(taxiSnapshots)
      .where(and(lt(taxiSnapshots.season, currentSeason), ne(taxiSnapshots.runType, 'sun_pm_official')));
    return { ok: true } as const;
  } catch (err) {
    return { ok: false, error: String(err || 'unknown') } as const;
  }
}

export async function listAllUserDocs() {
  const db = getDb();
  const rows = await db.select().from(userDocs);
  return rows;
}

export async function getUserByEmail(email: string) {
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row || null;
}

export async function createSuggestion(params: { userId?: string | null; text: string; category?: string | null; createdAt?: Date }) {
  await ensureSuggestionDisplayNumberColumn();
  const db = getDb();
  // Create suggestion with atomically assigned display_number in a single statement
  // Note: This CTE approach is atomic within Postgres. The entire INSERT statement
  // executes atomically, so MAX(display_number) is evaluated and used within the
  // same transaction. This prevents duplicate display numbers under normal conditions.
  // For extreme concurrency, consider using a Postgres SEQUENCE instead.
  const res = await db.execute(sql`
    WITH next_num AS (
      SELECT COALESCE(MAX(display_number), 0) + 1 AS num
      FROM suggestions
    )
    INSERT INTO suggestions (id, user_id, text, category, status, created_at, display_number)
    VALUES (
      gen_random_uuid(),
      ${params.userId || null}::uuid,
      ${params.text},
      ${params.category || null},
      'open',
      ${params.createdAt ? params.createdAt.toISOString() : sql`now()`},
      (SELECT num FROM next_num)
    )
    RETURNING *
  `);
  const row = (res as unknown as { rows?: Array<{ 
    id: string; 
    user_id: string | null; 
    text: string; 
    category: string | null; 
    status: string;
    created_at: Date | string;
    resolved_at: Date | string | null;
    display_number: number | string;
  }> }).rows?.[0];
  if (!row) return null;
  // Note: display_number should always be assigned in the INSERT, but handle missing gracefully
  const displayNumber = row.display_number 
    ? (typeof row.display_number === 'number' ? row.display_number : Number(row.display_number))
    : undefined;
  return {
    id: row.id,
    userId: row.user_id,
    text: row.text,
    category: row.category,
    status: row.status as 'draft' | 'open' | 'accepted' | 'rejected',
    createdAt: new Date(row.created_at),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
    displayNumber,
  };
}

export async function listSuggestions() {
  const db = getDb();
  const rows = await db.select().from(suggestions).orderBy(desc(suggestions.createdAt));
  return rows;
}

export async function updateSuggestionStatus(id: string, status: 'draft' | 'open' | 'accepted' | 'rejected') {
  const db = getDb();
  type SuggestionInsert = typeof suggestions.$inferInsert;
  const set: Partial<SuggestionInsert> = { status } as Partial<SuggestionInsert>;
  if (status === 'accepted' || status === 'rejected') {
    set.resolvedAt = new Date();
  } else {
    set.resolvedAt = null;
  }
  const [row] = await db.update(suggestions).set(set).where(eq(suggestions.id, id)).returning();
  return row || null;
}

export async function deleteSuggestion(id: string) {
  const db = getDb();
  const rows = await db.delete(suggestions).where(eq(suggestions.id, id)).returning();
  return Array.isArray(rows) ? rows.length > 0 : false;
}

// --- Suggestion sponsors (persist "endorse as team") ---
export async function ensureSuggestionSponsorColumn() {
  try {
    const db = getDb();
    // Best-effort: add column if missing. Safe in Postgres 9.6+.
    await db.execute(sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS sponsor_team varchar(255)`);
  } catch {}
}

export async function setSuggestionSponsor(id: string, team: string | null) {
  try {
    await ensureSuggestionSponsorColumn();
    const db = getDb();
    await db.execute(sql`UPDATE suggestions SET sponsor_team = ${team} WHERE id = ${id}::uuid`);
    return true;
  } catch {
    return false;
  }
}

export async function getSuggestionSponsorsMap(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    await ensureSuggestionSponsorColumn();
    const db = getDb();
    // Return id::text for stable mapping across drivers
    const res = await db.execute(sql`SELECT id::text AS id, sponsor_team FROM suggestions WHERE sponsor_team IS NOT NULL`);
    const rawRows = (res as unknown as { rows?: Array<{ id: string; sponsor_team: string }> }).rows || [];
    for (const r of rawRows) {
      const id = typeof r.id === 'string' ? r.id : '';
      const team = typeof r.sponsor_team === 'string' ? r.sponsor_team : '';
      if (id && team) out[id] = team;
    }
  } catch {}
  return out;
}

// --- Ballot eligibility notification (persisted, atomic) ---
export async function ensureSuggestionBallotNotifyColumns() {
  try {
    const db = getDb();
    await db.execute(sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS ballot_eligible_notified integer DEFAULT 0 NOT NULL`);
    await db.execute(sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS ballot_eligible_at timestamp NULL`);
  } catch {}
}

export async function markBallotEligibleIfThreshold(id: string): Promise<{ becameEligible: boolean; eligibleCount: number }> {
  await ensureSuggestionEndorsementsTable();
  await ensureSuggestionProposerColumn();
  await ensureSuggestionBallotNotifyColumns();
  const db = getDb();
  // Atomically compute eligible count (exclude proposer) and set notified flag if crossing threshold
  // Threshold is 3 endorsements (excluding proposer's own endorsement)
  const res = await db.execute(sql`
    WITH cnt AS (
      SELECT COUNT(1)::int AS c
      FROM suggestion_endorsements e
      LEFT JOIN suggestions s ON s.id = e.suggestion_id
      WHERE e.suggestion_id = ${id}::uuid
        AND (s.proposer_team IS NULL OR e.team <> s.proposer_team)
    ),
    upd AS (
      UPDATE suggestions
      SET ballot_eligible_notified = 1,
          ballot_eligible_at = now()
      WHERE id = ${id}::uuid
        AND ballot_eligible_notified = 0
        AND (SELECT c FROM cnt) >= 3
      RETURNING 1 AS updated
    )
    SELECT (SELECT c FROM cnt) AS count,
           EXISTS(SELECT 1 FROM upd) AS updated
  `);
  type Row = { count: number | string; updated: boolean };
  const row = (res as unknown as { rows?: Row[] }).rows?.[0];
  const eligibleCount = row ? (typeof row.count === 'number' ? row.count : Number(row.count || 0)) : 0;
  const becameEligible = Boolean(row && row.updated);
  return { becameEligible, eligibleCount };
}

// --- Suggestion proposer (who submitted publicly when also endorsing) ---
export async function ensureSuggestionProposerColumn() {
  try {
    const db = getDb();
    await db.execute(sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS proposer_team varchar(255)`);
  } catch {}
}

export async function setSuggestionProposer(id: string, team: string | null) {
  try {
    await ensureSuggestionProposerColumn();
    const db = getDb();
    await db.execute(sql`UPDATE suggestions SET proposer_team = ${team} WHERE id = ${id}::uuid`);
    return true;
  } catch {
    return false;
  }
}

export async function getSuggestionProposersMap(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    await ensureSuggestionProposerColumn();
    const db = getDb();
    const res = await db.execute(sql`SELECT id::text AS id, proposer_team FROM suggestions WHERE proposer_team IS NOT NULL`);
    const rawRows = (res as unknown as { rows?: Array<{ id: string; proposer_team: string }> }).rows || [];
    for (const r of rawRows) {
      const id = typeof r.id === 'string' ? r.id : '';
      const team = typeof r.proposer_team === 'string' ? r.proposer_team : '';
      if (id && team) out[id] = team;
    }
  } catch {}
  return out;
}

// --- Suggestion VAGUE flag ---
export async function ensureSuggestionVagueColumn() {
  try {
    const db = getDb();
    // use integer 0/1 for compatibility
    await db.execute(sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS vague integer DEFAULT 0 NOT NULL`);
  } catch {}
}

export async function setSuggestionVague(id: string, vague: boolean) {
  try {
    await ensureSuggestionVagueColumn();
    const db = getDb();
    await db.execute(sql`UPDATE suggestions SET vague = ${vague ? 1 : 0} WHERE id = ${id}::uuid`);
    return true;
  } catch {
    return false;
  }
}

export async function getSuggestionVagueMap(): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  try {
    await ensureSuggestionVagueColumn();
    const db = getDb();
    const res = await db.execute(sql`SELECT id::text AS id, vague FROM suggestions`);
    const rawRows = (res as unknown as { rows?: Array<{ id: string; vague: number | string }> }).rows || [];
    type Row = { id: string; vague: number | string };
    for (const r of rawRows as Row[]) {
      const id = typeof r.id === 'string' ? r.id : '';
      const vRaw = r.vague;
      const vNum = typeof vRaw === 'number' ? vRaw : Number(vRaw ?? 0);
      if (id) out[id] = vNum === 1;
    }
  } catch {}
  return out;
}

// --- Suggestion endorsements (multiple teams) ---
export async function ensureSuggestionEndorsementsTable() {
  try {
    const db = getDb();
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS suggestion_endorsements (
        suggestion_id uuid NOT NULL,
        team varchar(255) NOT NULL,
        endorsed_at timestamp DEFAULT now() NOT NULL,
        PRIMARY KEY (suggestion_id, team)
      )
    `);
  } catch {}
}

export async function addSuggestionEndorsement(suggestionId: string, team: string) {
  try {
    await ensureSuggestionEndorsementsTable();
    const db = getDb();
    await db.execute(sql`INSERT INTO suggestion_endorsements (suggestion_id, team) VALUES (${suggestionId}::uuid, ${team}) ON CONFLICT DO NOTHING`);
    return true;
  } catch {
    return false;
  }
}

export async function removeSuggestionEndorsement(suggestionId: string, team: string) {
  try {
    await ensureSuggestionEndorsementsTable();
    const db = getDb();
    await db.execute(sql`DELETE FROM suggestion_endorsements WHERE suggestion_id = ${suggestionId}::uuid AND team = ${team}`);
    return true;
  } catch {
    return false;
  }
}

export async function getSuggestionEndorsementsMap(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  try {
    await ensureSuggestionEndorsementsTable();
    await ensureSuggestionProposerColumn();
    const db = getDb();
    // Exclude proposer's own endorsement from the map (same logic as threshold check)
    const res = await db.execute(sql`
      SELECT e.suggestion_id::text AS suggestion_id, e.team
      FROM suggestion_endorsements e
      LEFT JOIN suggestions s ON s.id = e.suggestion_id
      WHERE s.proposer_team IS NULL OR e.team <> s.proposer_team
    `);
    const rawRows = (res as unknown as { rows?: Array<{ suggestion_id: string; team: string }> }).rows || [];
    for (const r of rawRows) {
      const id = typeof r.suggestion_id === 'string' ? r.suggestion_id : '';
      const team = typeof r.team === 'string' ? r.team : '';
      if (!id || !team) continue;
      if (!out[id]) out[id] = [];
      out[id].push(team);
    }
    // sort for stable UI
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.localeCompare(b));
  } catch {}
  return out;
}

// --- Suggestion vote tags (Voted On / Vote Passed / Vote Failed) ---
export async function ensureSuggestionVoteTagColumn() {
  try {
    const db = getDb();
    await db.execute(sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS vote_tag varchar(32)`);
  } catch {}
}

export type VoteTag = 'voted_on' | 'vote_passed' | 'vote_failed';

export async function setSuggestionVoteTag(id: string, tag: VoteTag | null) {
  try {
    await ensureSuggestionVoteTagColumn();
    const db = getDb();
    await db.execute(sql`UPDATE suggestions SET vote_tag = ${tag} WHERE id = ${id}::uuid`);
    return true;
  } catch {
    return false;
  }
}

export async function getSuggestionVoteTagsMap(): Promise<Record<string, VoteTag>> {
  const out: Record<string, VoteTag> = {};
  try {
    await ensureSuggestionVoteTagColumn();
    const db = getDb();
    const res = await db.execute(sql`SELECT id::text AS id, vote_tag FROM suggestions WHERE vote_tag IS NOT NULL`);
    const rawRows = (res as unknown as { rows?: Array<{ id: string; vote_tag: string }> }).rows || [];
    for (const r of rawRows) {
      const id = typeof r.id === 'string' ? r.id : '';
      const tag = typeof r.vote_tag === 'string' ? (r.vote_tag as VoteTag) : undefined;
      if (id && tag) out[id] = tag;
    }
  } catch {}
  return out;
}

// --- Suggestion grouping (multi-suggestion submissions) ---
export async function ensureSuggestionGroupColumns() {
  try {
    const db = getDb();
    await db.execute(sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS group_id varchar(64)`);
    await db.execute(sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS group_pos integer DEFAULT 1 NOT NULL`);
  } catch {}
}

export async function setSuggestionGroup(id: string, groupId: string | null, groupPos?: number | null) {
  try {
    await ensureSuggestionGroupColumns();
    const db = getDb();
    await db.execute(sql`UPDATE suggestions SET group_id = ${groupId}, group_pos = ${groupPos ?? 1} WHERE id = ${id}::uuid`);
    return true;
  } catch {
    return false;
  }
}

export async function getSuggestionGroupsMap(): Promise<Record<string, { groupId: string; groupPos: number }>> {
  const out: Record<string, { groupId: string; groupPos: number }> = {};
  try {
    await ensureSuggestionGroupColumns();
    const db = getDb();
    const res = await db.execute(sql`SELECT id::text AS id, group_id, group_pos FROM suggestions WHERE group_id IS NOT NULL`);
    const rawRows = (res as unknown as { rows?: Array<{ id: string; group_id: string; group_pos: number | string }> }).rows || [];
    for (const r of rawRows) {
      const id = typeof r.id === 'string' ? r.id : '';
      const gid = typeof r.group_id === 'string' ? r.group_id : '';
      const posRaw = r.group_pos;
      const pos = typeof posRaw === 'number' ? posRaw : Number(posRaw ?? 1);
      if (id && gid) out[id] = { groupId: gid, groupPos: pos > 0 ? pos : 1 };
    }
  } catch {}
  return out;
}

// --- Suggestion display numbers (stable sequential numbering) ---
export async function ensureSuggestionDisplayNumberColumn() {
  try {
    const db = getDb();
    await db.execute(sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS display_number integer`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS suggestions_display_number_idx ON suggestions(display_number) WHERE display_number IS NOT NULL`);
  } catch {}
}

export async function backfillSuggestionDisplayNumbers() {
  try {
    await ensureSuggestionDisplayNumberColumn();
    const db = getDb();
    // Backfill display_number for existing rows by ascending createdAt (ties broken by id)
    await db.execute(sql`
      WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS num
        FROM suggestions
        WHERE display_number IS NULL
      )
      UPDATE suggestions
      SET display_number = numbered.num
      FROM numbered
      WHERE suggestions.id = numbered.id
    `);
    return true;
  } catch {
    return false;
  }
}

export async function getNextDisplayNumber(): Promise<number> {
  try {
    await ensureSuggestionDisplayNumberColumn();
    const db = getDb();
    const res = await db.execute(sql`SELECT COALESCE(MAX(display_number), 0) + 1 AS next FROM suggestions`);
    const row = (res as unknown as { rows?: Array<{ next: number | string }> }).rows?.[0];
    return row ? (typeof row.next === 'number' ? row.next : Number(row.next || 1)) : 1;
  } catch {
    return 1;
  }
}

export async function assignDisplayNumber(id: string): Promise<number | null> {
  try {
    await ensureSuggestionDisplayNumberColumn();
    const db = getDb();
    // Atomically assign next display number using a single transaction
    const res = await db.execute(sql`
      WITH next_num AS (
        SELECT COALESCE(MAX(display_number), 0) + 1 AS num
        FROM suggestions
      )
      UPDATE suggestions
      SET display_number = (SELECT num FROM next_num)
      WHERE id = ${id}::uuid AND display_number IS NULL
      RETURNING display_number
    `);
    const row = (res as unknown as { rows?: Array<{ display_number: number | string }> }).rows?.[0];
    return row ? (typeof row.display_number === 'number' ? row.display_number : Number(row.display_number || 0)) : null;
  } catch {
    return null;
  }
}

export async function getSuggestionDisplayNumbersMap(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    await ensureSuggestionDisplayNumberColumn();
    const db = getDb();
    const res = await db.execute(sql`SELECT id::text AS id, display_number FROM suggestions WHERE display_number IS NOT NULL`);
    const rawRows = (res as unknown as { rows?: Array<{ id: string; display_number: number | string }> }).rows || [];
    for (const r of rawRows) {
      const id = typeof r.id === 'string' ? r.id : '';
      const num = typeof r.display_number === 'number' ? r.display_number : Number(r.display_number || 0);
      if (id && num > 0) out[id] = num;
    }
  } catch {}
  return out;
}

// --- Ballot forced (admin override to add/remove from ballot) ---
export async function ensureBallotForcedColumn() {
  try {
    const db = getDb();
    await db.execute(sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS ballot_forced integer DEFAULT 0 NOT NULL`);
  } catch {}
}

export async function setBallotForced(id: string, forced: boolean) {
  try {
    await ensureBallotForcedColumn();
    const db = getDb();
    await db.execute(sql`UPDATE suggestions SET ballot_forced = ${forced ? 1 : 0} WHERE id = ${id}::uuid`);
    return true;
  } catch {
    return false;
  }
}

export async function getBallotForcedMap(): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  try {
    await ensureBallotForcedColumn();
    const db = getDb();
    const res = await db.execute(sql`SELECT id::text AS id, ballot_forced FROM suggestions WHERE ballot_forced = 1`);
    const rawRows = (res as unknown as { rows?: Array<{ id: string; ballot_forced: number }> }).rows || [];
    for (const r of rawRows) {
      const id = typeof r.id === 'string' ? r.id : '';
      if (id) out[id] = true;
    }
  } catch {}
  return out;
}

export async function addTaxiMember(teamId: string, playerId: string, activeFrom?: Date) {
  const db = getDb();
  const [row] = await db.insert(taxiSquadMembers).values({ teamId, playerId, activeFrom: activeFrom || new Date() }).returning();
  return row;
}

export async function removeTaxiMember(teamId: string, playerId: string, activeTo?: Date) {
  const db = getDb();
  const [row] = await db
    .update(taxiSquadMembers)
    .set({ activeTo: activeTo || new Date() })
    .where(and(eq(taxiSquadMembers.teamId, teamId), eq(taxiSquadMembers.playerId, playerId), isNull(taxiSquadMembers.activeTo)))
    .returning();
  return row || null;
}

export async function listTaxiMembers(teamId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(taxiSquadMembers)
    .where(and(eq(taxiSquadMembers.teamId, teamId), isNull(taxiSquadMembers.activeTo)));
  return rows;
}

export async function logTaxiEvent(params: {
  teamId: string;
  playerId: string;
  eventType: 'add' | 'remove' | 'promote' | 'demote';
  eventAt?: Date;
  meta?: Record<string, unknown> | null;
}) {
  const db = getDb();
  const [row] = await db
    .insert(taxiSquadEvents)
    .values({ teamId: params.teamId, playerId: params.playerId, eventType: params.eventType, eventAt: params.eventAt || new Date(), meta: params.meta || null })
    .returning();
  return row;
}

export async function listTaxiEvents(teamId: string, limit = 100) {
  const db = getDb();
  const rows = await db
    .select()
    .from(taxiSquadEvents)
    .where(eq(taxiSquadEvents.teamId, teamId))
    .orderBy(desc(taxiSquadEvents.eventAt));
  return rows.slice(0, limit);
}

export async function getTeamPinBySlug(teamSlug: string) {
  const db = getDb();
  const [row] = await db.select().from(teamPins).where(eq(teamPins.teamSlug, teamSlug)).limit(1);
  return row || null;
}

export async function setTeamPin(teamSlug: string, value: { hash: string; salt: string; pinVersion: number; updatedAt?: Date }) {
  const db = getDb();
  const [row] = await db
    .insert(teamPins)
    .values({ teamSlug, hash: value.hash, salt: value.salt, pinVersion: value.pinVersion, updatedAt: value.updatedAt || new Date() })
    .onConflictDoUpdate({ target: teamPins.teamSlug, set: { hash: value.hash, salt: value.salt, pinVersion: value.pinVersion, updatedAt: value.updatedAt || new Date() } })
    .returning();
  return row;
}

export async function getTaxiObservation(team: string) {
  const db = getDb();
  const [row] = await db.select().from(taxiObservations).where(eq(taxiObservations.team, team)).limit(1);
  return row || null;
}

export async function setTaxiObservation(
  team: string,
  payload: { updatedAt: Date; players: Record<string, { firstSeen: string; lastSeen: string; seenCount: number }> }
) {
  const db = getDb();
  const [row] = await db
    .insert(taxiObservations)
    .values({ team, updatedAt: payload.updatedAt, players: payload.players })
    .onConflictDoUpdate({ target: taxiObservations.team, set: { updatedAt: payload.updatedAt, players: payload.players } })
    .returning();
  return row;
}

// ===== Taxi Auditor: Tenures / Txn Cache / Snapshots =====

export type AcqVia = 'free_agent' | 'waiver' | 'trade' | 'draft' | 'other';

export async function upsertTenure(params: { teamId: string; playerId: string; acquiredAt: Date; acquiredVia: AcqVia }) {
  const db = getDb();
  const [row] = await db
    .insert(tenures)
    .values({
      teamId: params.teamId,
      playerId: params.playerId,
      acquiredAt: params.acquiredAt,
      acquiredVia: params.acquiredVia,
      activeSeen: 0,
      lastActiveAt: null,
    })
    .onConflictDoUpdate({
      target: [tenures.teamId, tenures.playerId],
      // IMPORTANT: Do NOT reset activeSeen on re-acquisition
      // We need to preserve historical activation data across drop/re-acquire cycles
      // Only update acquisition metadata
      set: { acquiredAt: params.acquiredAt, acquiredVia: params.acquiredVia },
    })
    .returning();
  return row;
}

export async function markTenureActive(params: { teamId: string; playerId: string; at?: Date }) {
  const db = getDb();
  const [row] = await db
    .update(tenures)
    .set({ activeSeen: 1, lastActiveAt: params.at || new Date() })
    .where(and(eq(tenures.teamId, params.teamId), eq(tenures.playerId, params.playerId)))
    .returning();
  return row || null;
}

/**
 * Check if a player was ever activated by a team (across all tenures/acquisitions).
 * Returns true if activeSeen = 1, meaning the player appeared on active roster at some point.
 * This persists across drop/re-acquire cycles.
 */
export async function wasPlayerEverActivatedByTeam(params: { teamId: string; playerId: string }): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ activeSeen: tenures.activeSeen })
    .from(tenures)
    .where(and(eq(tenures.teamId, params.teamId), eq(tenures.playerId, params.playerId)))
    .limit(1);
  
  if (rows.length === 0) return false;
  return (rows[0].activeSeen ?? 0) === 1;
}

export async function deleteTenure(params: { teamId: string; playerId: string }) {
  const db = getDb();
  // When a player is dropped, we keep the tenure record to preserve activation history
  // We just mark when they were last active (if they were)
  // The activeSeen flag is preserved so we know if they were ever activated by this team
  const existing = await db
    .select()
    .from(tenures)
    .where(and(eq(tenures.teamId, params.teamId), eq(tenures.playerId, params.playerId)))
    .limit(1);
  
  if (existing.length > 0 && existing[0].activeSeen === 0) {
    // Player was never activated, we can safely delete the tenure
    await db.delete(tenures).where(and(eq(tenures.teamId, params.teamId), eq(tenures.playerId, params.playerId)));
    return null;
  }
  
  // Player was activated - keep the record for historical tracking
  // Just update lastActiveAt if not already set
  const [row] = await db
    .update(tenures)
    .set({ lastActiveAt: new Date() })
    .where(and(eq(tenures.teamId, params.teamId), eq(tenures.playerId, params.playerId)))
    .returning();
  return row || null;
}

export async function bulkInsertTxnCacheWithPrune(rows: Array<{ week: number; teamId: string; playerId: string; type: string; direction: string; ts: Date }>) {
  if (!rows || rows.length === 0) return 0;
  const db = getDb();
  await db.insert(txnCache).values(rows).catch(() => undefined);
  // prune older than ~120 days
  const now = Date.now();
  const cutoff = new Date(now - 120 * 24 * 60 * 60 * 1000);
  try {
    await db.delete(txnCache).where(lt(txnCache.ts, cutoff));
  } catch {}
  return rows.length;
}

export async function writeTaxiSnapshot(params: {
  season: number; week: number; runType: 'wed_warn' | 'thu_warn' | 'sun_am_warn' | 'sun_pm_official' | 'admin_rerun';
  runTs: Date; teamId: string; taxiIds: string[]; compliant: boolean; violations: Array<{ code: string; detail?: string; players?: string[] }>; degraded?: boolean;
}) {
  const db = getDb();
  const [row] = await db
    .insert(taxiSnapshots)
    .values({
      season: params.season,
      week: params.week,
      runType: params.runType,
      runTs: params.runTs,
      teamId: params.teamId,
      taxiIds: params.taxiIds as unknown as string[],
      compliant: params.compliant ? 1 : 0,
      violations: params.violations,
      degraded: params.degraded ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [taxiSnapshots.season, taxiSnapshots.week, taxiSnapshots.runType, taxiSnapshots.teamId],
      set: {
        runTs: params.runTs,
        taxiIds: params.taxiIds as unknown as string[],
        compliant: params.compliant ? 1 : 0,
        violations: params.violations,
        degraded: params.degraded ? 1 : 0,
      },
    })
    .returning();
  return row;
}

export async function getLatestTaxiRunMeta() {
  const db = getDb();
  const rows = await db.select().from(taxiSnapshots).orderBy(desc(taxiSnapshots.runTs)).limit(1);
  const latest = rows[0];
  if (!latest) return null as null | { season: number; week: number; runType: string; runTs: Date };
  return { season: latest.season, week: latest.week, runType: latest.runType, runTs: latest.runTs } as { season: number; week: number; runType: string; runTs: Date };
}

export async function getLatestAdminRerunMeta() {
  const db = getDb();
  const rows = await db
    .select()
    .from(taxiSnapshots)
    .where(eq(taxiSnapshots.runType, 'admin_rerun'))
    .orderBy(desc(taxiSnapshots.runTs))
    .limit(1);
  const latest = rows[0];
  if (!latest) return null as null | { season: number; week: number; runType: 'admin_rerun'; runTs: Date };
  return { season: latest.season, week: latest.week, runType: 'admin_rerun', runTs: latest.runTs } as { season: number; week: number; runType: 'admin_rerun'; runTs: Date };
}

export async function getTaxiSnapshotsForRun(params: { season: number; week: number; runType: 'wed_warn' | 'thu_warn' | 'sun_am_warn' | 'sun_pm_official' | 'admin_rerun' }) {
  const db = getDb();
  const rows = await db
    .select()
    .from(taxiSnapshots)
    .where(and(eq(taxiSnapshots.season, params.season), eq(taxiSnapshots.week, params.week), eq(taxiSnapshots.runType, params.runType)));
  return rows;
}

export async function getFirstTaxiSeenForPlayer(params: { season: number; teamId: string; playerId: string }) {
  const db = getDb();
  const rows = await db
    .select({ season: taxiSnapshots.season, week: taxiSnapshots.week, runTs: taxiSnapshots.runTs, runType: taxiSnapshots.runType })
    .from(taxiSnapshots)
    .where(and(
      eq(taxiSnapshots.season, params.season),
      eq(taxiSnapshots.teamId, params.teamId),
      sql`${params.playerId} = ANY(${taxiSnapshots.taxiIds})`
    ))
    .orderBy(taxiSnapshots.runTs)
    .limit(1);
  return rows[0] || null as null | { season: number; week: number; runTs: Date; runType: string };
}

export async function getUserDoc(userId: string) {
  const db = getDb();
  const [row] = await db.select().from(userDocs).where(eq(userDocs.userId, userId)).limit(1);
  return row || null;
}

export async function getUserDocByTeam(team: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(userDocs)
    .where(eq(userDocs.team, team))
    .orderBy(desc(userDocs.updatedAt))
    .limit(1);
  return row || null;
}

export async function setUserDoc(doc: {
  userId: string;
  team: string;
  version: number;
  updatedAt: Date;
  votes?: Record<string, Record<string, number>> | null;
  tradeBlock?: Array<Record<string, unknown>> | null;
  tradeWants?: { text?: string; positions?: string[] } | null;
}) {
  const db = getDb();
  const [row] = await db
    .insert(userDocs)
    .values({
      userId: doc.userId,
      team: doc.team,
      version: doc.version,
      updatedAt: doc.updatedAt,
      votes: doc.votes ?? null,
      tradeBlock: doc.tradeBlock ?? null,
      tradeWants: doc.tradeWants ?? null,
    })
    .onConflictDoUpdate({
      target: userDocs.userId,
      set: {
        team: doc.team,
        version: doc.version,
        updatedAt: doc.updatedAt,
        votes: doc.votes ?? null,
        tradeBlock: doc.tradeBlock ?? null,
        tradeWants: doc.tradeWants ?? null,
      },
    })
    .returning();
  return row;
}

// --- Trade Block Events ---
export async function createTradeBlockEvent(event: {
  team: string;
  eventType: string;
  assetType?: string | null;
  assetId?: string | null;
  assetLabel?: string | null;
  oldWants?: string | null;
  newWants?: string | null;
}) {
  const db = getDb();
  const [row] = await db
    .insert(tradeBlockEvents)
    .values({
      team: event.team,
      eventType: event.eventType,
      assetType: event.assetType ?? null,
      assetId: event.assetId ?? null,
      assetLabel: event.assetLabel ?? null,
      oldWants: event.oldWants ?? null,
      newWants: event.newWants ?? null,
    })
    .returning();
  return row;
}

export async function getPendingTradeBlockEvents(olderThanSeconds: number = 120) {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000);
  const rows = await db
    .select()
    .from(tradeBlockEvents)
    .where(and(
      isNull(tradeBlockEvents.sentAt),
      lt(tradeBlockEvents.createdAt, cutoff)
    ))
    .orderBy(tradeBlockEvents.team, tradeBlockEvents.createdAt);
  return rows;
}

export async function markTradeBlockEventsSent(eventIds: string[]) {
  if (eventIds.length === 0) return;
  const db = getDb();
  await db
    .update(tradeBlockEvents)
    .set({ sentAt: new Date() })
    .where(sql`${tradeBlockEvents.id} = ANY(${eventIds}::uuid[])`);
}

export async function clearAllPendingTradeBlockEvents() {
  const db = getDb();
  await db
    .update(tradeBlockEvents)
    .set({ sentAt: new Date() })
    .where(isNull(tradeBlockEvents.sentAt));
}

// ===== Draft Trade System =====

export type TradeStatus = 'pending' | 'accepted' | 'rejected' | 'countered' | 'approved' | 'cancelled';
export type TradeAssetType = 'player' | 'current_pick' | 'future_pick';

export type TradeAsset = {
  id: string;
  tradeId: string;
  fromTeam: string;
  toTeam: string;
  assetType: TradeAssetType;
  playerId?: string | null;
  playerName?: string | null;
  playerPos?: string | null;
  pickOverall?: number | null;
  pickYear?: number | null;
  pickRound?: number | null;
  pickOriginalTeam?: string | null;
};

export type DraftTrade = {
  id: string;
  draftId: string;
  status: TradeStatus;
  proposedBy: string;
  teams: string[];
  acceptedBy: string[];
  counterOf?: string | null;
  notes?: string | null;
  proposedAt: string;
  updatedAt: string;
  assets: TradeAsset[];
};

export type DraftRosterPlayer = {
  playerId: string;
  playerName: string | null;
  playerPos: string | null;
  playerNfl: string | null;
  acquiredVia: string;
};

export type DraftFuturePick = {
  id: string;
  draftId: string;
  ownerTeam: string;
  originalTeam: string;
  year: number;
  round: number;
};

// Roster snapshot helpers
export async function bulkInsertRosterSnapshot(draftId: string, team: string, players: Array<{ playerId: string; playerName?: string | null; playerPos?: string | null; playerNfl?: string | null }>, acquiredVia = 'sleeper') {
  await ensureDraftTables();
  const db = getDb();
  for (const p of players) {
    await db.execute(sql`
      INSERT INTO draft_roster_snapshots (draft_id, team, player_id, player_name, player_pos, player_nfl, acquired_via)
      VALUES (${draftId}::uuid, ${team}, ${p.playerId}, ${p.playerName ?? null}, ${p.playerPos ?? null}, ${p.playerNfl ?? null}, ${acquiredVia})
      ON CONFLICT (draft_id, team, player_id) DO NOTHING
    `);
  }
}

export async function addPlayerToRosterSnapshot(draftId: string, team: string, player: { playerId: string; playerName?: string | null; playerPos?: string | null; playerNfl?: string | null }, acquiredVia = 'draft_pick') {
  await ensureDraftTables();
  const db = getDb();
  await db.execute(sql`
    INSERT INTO draft_roster_snapshots (draft_id, team, player_id, player_name, player_pos, player_nfl, acquired_via)
    VALUES (${draftId}::uuid, ${team}, ${player.playerId}, ${player.playerName ?? null}, ${player.playerPos ?? null}, ${player.playerNfl ?? null}, ${acquiredVia})
    ON CONFLICT (draft_id, team, player_id) DO NOTHING
  `);
}

export async function movePlayerInSnapshot(draftId: string, playerId: string, fromTeam: string, toTeam: string) {
  const db = getDb();
  await db.execute(sql`
    UPDATE draft_roster_snapshots
    SET team = ${toTeam}, acquired_via = 'trade'
    WHERE draft_id = ${draftId}::uuid AND player_id = ${playerId} AND team = ${fromTeam}
  `);
}

export async function getRosterSnapshot(draftId: string, team: string): Promise<DraftRosterPlayer[]> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(sql`SELECT player_id, player_name, player_pos, player_nfl, acquired_via FROM draft_roster_snapshots WHERE draft_id = ${draftId}::uuid AND team = ${team} ORDER BY player_pos, player_name`);
  const rows = (res as unknown as { rows?: Array<{ player_id: string; player_name: string | null; player_pos: string | null; player_nfl: string | null; acquired_via: string }> }).rows || [];
  return rows.map(r => ({ playerId: r.player_id, playerName: r.player_name, playerPos: r.player_pos, playerNfl: r.player_nfl, acquiredVia: r.acquired_via }));
}

/**
 * Returns players drafted by `team` during this draft that are NOT yet in the snapshot table.
 * "Not in snapshot" means they were drafted this draft and haven't been traded
 * (traded players get inserted into the receiving team's snapshot by approveDraftTrade).
 * Use this alongside getRosterSnapshot to build a complete current roster.
 */
export async function getDraftPicksStillOwnedByTeam(draftId: string, team: string): Promise<DraftRosterPlayer[]> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(sql`
    SELECT p.player_id, p.player_name, p.player_pos, p.player_nfl
    FROM draft_picks p
    WHERE p.draft_id = ${draftId}::uuid AND p.team = ${team}
      AND NOT EXISTS (
        SELECT 1 FROM draft_roster_snapshots s
        WHERE s.draft_id = p.draft_id AND s.player_id = p.player_id
      )
  `);
  const rows = (res as unknown as { rows?: Array<{ player_id: string; player_name: string | null; player_pos: string | null; player_nfl: string | null }> }).rows || [];
  return rows.map(r => ({ playerId: r.player_id, playerName: r.player_name, playerPos: r.player_pos, playerNfl: r.player_nfl, acquiredVia: 'draft_pick' }));
}

export async function hasRosterSnapshot(draftId: string): Promise<boolean> {
  const db = getDb();
  const res = await db.execute(sql`SELECT 1 FROM draft_roster_snapshots WHERE draft_id = ${draftId}::uuid LIMIT 1`);
  return ((res as unknown as { rows?: unknown[] }).rows?.length ?? 0) > 0;
}

// Future picks helpers
export async function bulkInsertFuturePicks(draftId: string, picks: Array<{ ownerTeam: string; originalTeam: string; year: number; round: number }>) {
  await ensureDraftTables();
  const db = getDb();
  for (const p of picks) {
    await db.execute(sql`
      INSERT INTO draft_future_picks (draft_id, owner_team, original_team, year, round)
      VALUES (${draftId}::uuid, ${p.ownerTeam}, ${p.originalTeam}, ${p.year}, ${p.round})
    `);
  }
}

export async function getFuturePicks(draftId: string, ownerTeam?: string): Promise<DraftFuturePick[]> {
  await ensureDraftTables();
  const db = getDb();
  const res = ownerTeam
    ? await db.execute(sql`SELECT id::text AS id, draft_id::text AS draft_id, owner_team, original_team, year, round FROM draft_future_picks WHERE draft_id = ${draftId}::uuid AND owner_team = ${ownerTeam} ORDER BY year, round`)
    : await db.execute(sql`SELECT id::text AS id, draft_id::text AS draft_id, owner_team, original_team, year, round FROM draft_future_picks WHERE draft_id = ${draftId}::uuid ORDER BY owner_team, year, round`);
  const rows = (res as unknown as { rows?: Array<{ id: string; draft_id: string; owner_team: string; original_team: string; year: number; round: number }> }).rows || [];
  return rows.map(r => ({ id: r.id, draftId: r.draft_id, ownerTeam: r.owner_team, originalTeam: r.original_team, year: r.year, round: r.round }));
}

export async function moveFuturePick(pickId: string, toTeam: string) {
  const db = getDb();
  await db.execute(sql`UPDATE draft_future_picks SET owner_team = ${toTeam} WHERE id = ${pickId}::uuid`);
}

export async function hasFuturePickSnapshot(draftId: string): Promise<boolean> {
  const db = getDb();
  const res = await db.execute(sql`SELECT 1 FROM draft_future_picks WHERE draft_id = ${draftId}::uuid LIMIT 1`);
  return ((res as unknown as { rows?: unknown[] }).rows?.length ?? 0) > 0;
}

// Trade CRUD
export async function createDraftTrade(params: {
  draftId: string;
  proposedBy: string;
  teams: string[];
  assets: Array<{ fromTeam: string; toTeam: string; assetType: TradeAssetType; playerId?: string | null; playerName?: string | null; playerPos?: string | null; pickOverall?: number | null; pickYear?: number | null; pickRound?: number | null; pickOriginalTeam?: string | null }>;
  counterOf?: string | null;
  notes?: string | null;
}): Promise<string> {
  await ensureDraftTables();
  const db = getDb();
  const tradeId = randomUUID();
  const teamsJson = JSON.stringify(params.teams);
  const acceptedByJson = JSON.stringify([params.proposedBy]);
  await db.execute(sql`
    INSERT INTO draft_trades (id, draft_id, status, proposed_by, teams, accepted_by, counter_of, notes)
    VALUES (${tradeId}::uuid, ${params.draftId}::uuid, 'pending', ${params.proposedBy}, ${teamsJson}::jsonb, ${acceptedByJson}::jsonb, ${params.counterOf ? sql`${params.counterOf}::uuid` : sql`NULL`}, ${params.notes ?? null})
  `);
  for (const a of params.assets) {
    await db.execute(sql`
      INSERT INTO draft_trade_assets (trade_id, from_team, to_team, asset_type, player_id, player_name, player_pos, pick_overall, pick_year, pick_round, pick_original_team)
      VALUES (${tradeId}::uuid, ${a.fromTeam}, ${a.toTeam}, ${a.assetType}, ${a.playerId ?? null}, ${a.playerName ?? null}, ${a.playerPos ?? null}, ${a.pickOverall ?? null}, ${a.pickYear ?? null}, ${a.pickRound ?? null}, ${a.pickOriginalTeam ?? null})
    `);
  }
  return tradeId;
}

function parseJsonbArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

function mapTradeRow(r: Record<string, unknown>, assets: TradeAsset[]): DraftTrade {
  return {
    id: String(r.id),
    draftId: String(r.draft_id),
    status: r.status as TradeStatus,
    proposedBy: String(r.proposed_by),
    teams: parseJsonbArray(r.teams),
    acceptedBy: parseJsonbArray(r.accepted_by),
    counterOf: (r.counter_of as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    proposedAt: r.proposed_at ? new Date(r.proposed_at as string).toISOString() : '',
    updatedAt: r.updated_at ? new Date(r.updated_at as string).toISOString() : '',
    assets,
  };
}

function mapAssetRow(r: Record<string, unknown>): TradeAsset {
  return {
    id: String(r.id),
    tradeId: String(r.trade_id),
    fromTeam: String(r.from_team),
    toTeam: String(r.to_team),
    assetType: r.asset_type as TradeAssetType,
    playerId: (r.player_id as string | null) ?? null,
    playerName: (r.player_name as string | null) ?? null,
    playerPos: (r.player_pos as string | null) ?? null,
    pickOverall: r.pick_overall != null ? Number(r.pick_overall) : null,
    pickYear: r.pick_year != null ? Number(r.pick_year) : null,
    pickRound: r.pick_round != null ? Number(r.pick_round) : null,
    pickOriginalTeam: (r.pick_original_team as string | null) ?? null,
  };
}

async function fetchAssetsForTrades(db: ReturnType<typeof getDb>, tradeIds: string[]): Promise<Map<string, TradeAsset[]>> {
  if (tradeIds.length === 0) return new Map();
  const list = tradeIds.map(id => `'${id}'::uuid`).join(',');
  const res = await db.execute(sql`SELECT id::text AS id, trade_id::text AS trade_id, from_team, to_team, asset_type, player_id, player_name, player_pos, pick_overall, pick_year, pick_round, pick_original_team FROM draft_trade_assets WHERE trade_id = ANY(ARRAY[${sql.raw(list)}])`);
  const rows = (res as unknown as { rows?: Array<Record<string, unknown>> }).rows || [];
  const map = new Map<string, TradeAsset[]>();
  for (const r of rows) {
    const tid = String(r.trade_id);
    if (!map.has(tid)) map.set(tid, []);
    map.get(tid)!.push(mapAssetRow(r));
  }
  return map;
}

export async function getDraftTradesForTeam(draftId: string, team: string): Promise<DraftTrade[]> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(sql`
    SELECT id::text AS id, draft_id::text AS draft_id, status, proposed_by, teams, accepted_by, counter_of::text AS counter_of, notes, proposed_at, updated_at
    FROM draft_trades
    WHERE draft_id = ${draftId}::uuid AND teams @> ${JSON.stringify([team])}::jsonb
    ORDER BY proposed_at DESC
  `);
  const rows = (res as unknown as { rows?: Array<Record<string, unknown>> }).rows || [];
  const ids = rows.map(r => String(r.id));
  const assetsMap = await fetchAssetsForTrades(db, ids);
  return rows.map(r => mapTradeRow(r, assetsMap.get(String(r.id)) || []));
}

export async function getAllApprovedTrades(draftId: string): Promise<DraftTrade[]> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(sql`
    SELECT id::text AS id, draft_id::text AS draft_id, status, proposed_by, teams, accepted_by, counter_of::text AS counter_of, notes, proposed_at, updated_at
    FROM draft_trades
    WHERE draft_id = ${draftId}::uuid AND status = 'approved'
    ORDER BY updated_at ASC
  `);
  const rows = (res as unknown as { rows?: Array<Record<string, unknown>> }).rows || [];
  const ids = rows.map(r => String(r.id));
  const assetsMap = await fetchAssetsForTrades(db, ids);
  return rows.map(r => mapTradeRow(r, assetsMap.get(String(r.id)) || []));
}

export async function getAdminPendingTrades(draftId: string): Promise<DraftTrade[]> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(sql`
    SELECT id::text AS id, draft_id::text AS draft_id, status, proposed_by, teams, accepted_by, counter_of::text AS counter_of, notes, proposed_at, updated_at
    FROM draft_trades
    WHERE draft_id = ${draftId}::uuid AND status = 'accepted'
    ORDER BY updated_at ASC
  `);
  const rows = (res as unknown as { rows?: Array<Record<string, unknown>> }).rows || [];
  const ids = rows.map(r => String(r.id));
  const assetsMap = await fetchAssetsForTrades(db, ids);
  return rows.map(r => mapTradeRow(r, assetsMap.get(String(r.id)) || []));
}

export async function getDraftTradeById(tradeId: string): Promise<DraftTrade | null> {
  await ensureDraftTables();
  const db = getDb();
  const res = await db.execute(sql`
    SELECT id::text AS id, draft_id::text AS draft_id, status, proposed_by, teams, accepted_by, counter_of::text AS counter_of, notes, proposed_at, updated_at
    FROM draft_trades WHERE id = ${tradeId}::uuid LIMIT 1
  `);
  const row = (res as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0];
  if (!row) return null;
  const assetsMap = await fetchAssetsForTrades(db, [String(row.id)]);
  return mapTradeRow(row, assetsMap.get(String(row.id)) || []);
}

export async function updateTradeStatus(tradeId: string, status: TradeStatus) {
  const db = getDb();
  await db.execute(sql`UPDATE draft_trades SET status = ${status}, updated_at = now() WHERE id = ${tradeId}::uuid`);
}

export async function addTradeAcceptance(tradeId: string, team: string): Promise<{ allAccepted: boolean; trade: DraftTrade | null }> {
  const db = getDb();
  await db.execute(sql`
    UPDATE draft_trades
    SET accepted_by = (accepted_by || ${JSON.stringify([team])}::jsonb) - 'null',
        updated_at = now()
    WHERE id = ${tradeId}::uuid AND NOT (accepted_by @> ${JSON.stringify([team])}::jsonb)
  `);
  const trade = await getDraftTradeById(tradeId);
  if (!trade) return { allAccepted: false, trade: null };
  const allAccepted = trade.teams.every(t => trade.acceptedBy.includes(t));
  if (allAccepted) {
    await updateTradeStatus(tradeId, 'accepted');
    trade.status = 'accepted';
  }
  return { allAccepted, trade };
}

export async function approveDraftTrade(
  tradeId: string,
  opts: { resumeAfterAnimation?: boolean; triggerPickAnimation?: boolean; newClockTeam?: string | null } = {}
): Promise<DraftTrade | null> {
  await ensureDraftTables();
  const db = getDb();
  const trade = await getDraftTradeById(tradeId);
  if (!trade || trade.status !== 'accepted') return null;
  // Execute asset swaps
  for (const asset of trade.assets) {
    if (asset.assetType === 'player' && asset.playerId) {
      // Try to move within snapshot (handles pre-draft roster players)
      const updateRes = await db.execute(sql`
        UPDATE draft_roster_snapshots SET team = ${asset.toTeam}, acquired_via = 'trade'
        WHERE draft_id = ${trade.draftId}::uuid AND player_id = ${asset.playerId} AND team = ${asset.fromTeam}
      `);
      const updatedRows = (updateRes as unknown as { rowCount?: number }).rowCount ?? 0;
      // If the player wasn't in the snapshot, they were drafted during this draft —
      // look up their metadata from draft_picks and insert them into the receiving team's snapshot.
      if (updatedRows === 0) {
        const pickRes = await db.execute(sql`
          SELECT player_name, player_pos, player_nfl FROM draft_picks
          WHERE draft_id = ${trade.draftId}::uuid AND player_id = ${asset.playerId}
          LIMIT 1
        `);
        const pickRow = (pickRes as unknown as { rows?: Array<{ player_name: string | null; player_pos: string | null; player_nfl: string | null }> }).rows?.[0];
        if (pickRow) {
          await db.execute(sql`
            INSERT INTO draft_roster_snapshots (draft_id, team, player_id, player_name, player_pos, player_nfl, acquired_via)
            VALUES (${trade.draftId}::uuid, ${asset.toTeam}, ${asset.playerId}, ${pickRow.player_name}, ${pickRow.player_pos}, ${pickRow.player_nfl}, 'trade')
            ON CONFLICT (draft_id, team, player_id) DO UPDATE
              SET player_name = EXCLUDED.player_name, player_pos = EXCLUDED.player_pos,
                  player_nfl = EXCLUDED.player_nfl, acquired_via = 'trade'
          `);
        }
      }
    } else if (asset.assetType === 'current_pick' && asset.pickOverall != null) {
      await db.execute(sql`UPDATE draft_slots SET team = ${asset.toTeam} WHERE draft_id = ${trade.draftId}::uuid AND overall = ${asset.pickOverall}`);
    } else if (asset.assetType === 'future_pick' && asset.pickYear != null && asset.pickRound != null && asset.pickOriginalTeam) {
      await db.execute(sql`UPDATE draft_future_picks SET owner_team = ${asset.toTeam} WHERE draft_id = ${trade.draftId}::uuid AND owner_team = ${asset.fromTeam} AND year = ${asset.pickYear} AND round = ${asset.pickRound} AND original_team = ${asset.pickOriginalTeam}`);
    }
  }
  await updateTradeStatus(tradeId, 'approved');
  // Set pending animation trigger for overlay
  const animPayload = JSON.stringify({
    tradeId: trade.id,
    startedAt: new Date().toISOString(),
    teams: trade.teams,
    assets: trade.assets.map(a => ({
      fromTeam: a.fromTeam, toTeam: a.toTeam, assetType: a.assetType,
      playerName: a.playerName, playerPos: a.playerPos,
      pickOverall: a.pickOverall, pickYear: a.pickYear, pickRound: a.pickRound, pickOriginalTeam: a.pickOriginalTeam,
    })),
    resumeAfterAnimation: opts.resumeAfterAnimation ?? false,
    triggerPickAnimation: opts.triggerPickAnimation ?? false,
    newClockTeam: opts.newClockTeam ?? null,
  });
  await db.execute(sql`UPDATE drafts SET pending_trade_animation = ${animPayload}::jsonb WHERE id = ${trade.draftId}::uuid`);
  return getDraftTradeById(tradeId);
}

export async function clearTradeAnimation(draftId: string): Promise<void> {
  const db = getDb();
  await db.execute(sql`UPDATE drafts SET pending_trade_animation = NULL WHERE id = ${draftId}::uuid`);
}
