import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { handleDraftGet, handleDraftPost } from '@/server/draft-api-v149';
import {
  createDraftWithOrder,
  getActiveOrLatestDraftId,
  getDraftOverview,
  seedDraftFromWorkspace,
} from '@/server/db/queries';
import { getDb } from '@/server/db/client';
import { LEAGUE_IDS, TEAM_NAMES } from '@/lib/constants/league';
import { canonicalizeTeamName } from '@/lib/server/user-identity';
import { isAdminCookieValue } from '@/lib/auth/admin';
import {
  getAllPlayersCached,
  getLeagueRosters,
  getRosterIdToTeamNameMap,
  type SleeperPlayer,
} from '@/lib/utils/sleeper-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYNC_INTERVAL_MS = 20_000;
type SyncGlobals = typeof globalThis & {
  __evwDraftSleeperSyncAt?: Map<string, number>;
  __evwDraftSleeperSyncPending?: Map<string, Promise<void>>;
};
const syncGlobals = globalThis as SyncGlobals;
syncGlobals.__evwDraftSleeperSyncAt ??= new Map<string, number>();
syncGlobals.__evwDraftSleeperSyncPending ??= new Map<string, Promise<void>>();

function isAdmin(req: NextRequest): boolean {
  return isAdminCookieValue(req.cookies.get('evw_admin')?.value);
}

function canonicalTeam(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  const canonical = canonicalizeTeamName(raw);
  return TEAM_NAMES.includes(canonical) ? canonical : null;
}

function normalizeOwnerOrder(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length !== TEAM_NAMES.length) return null;
  const order = value.map(canonicalTeam);
  return order.some((team) => !team) ? null : order as string[];
}

async function ensureSyncControlTable(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS draft_sleeper_sync_control (
      draft_id uuid PRIMARY KEY,
      manual_order_locked boolean NOT NULL DEFAULT false
    )
  `);
}

async function setManualOrderLock(draftId: string, locked: boolean): Promise<void> {
  await ensureSyncControlTable();
  const db = getDb();
  await db.execute(sql`
    INSERT INTO draft_sleeper_sync_control (draft_id, manual_order_locked)
    VALUES (${draftId}::uuid, ${locked})
    ON CONFLICT (draft_id) DO UPDATE SET manual_order_locked = ${locked}
  `);
}

async function isManualOrderLocked(draftId: string): Promise<boolean> {
  await ensureSyncControlTable();
  const db = getDb();
  const result = await db.execute(sql`
    SELECT manual_order_locked
    FROM draft_sleeper_sync_control
    WHERE draft_id = ${draftId}::uuid
    LIMIT 1
  `);
  const value = (result as unknown as { rows?: Array<{ manual_order_locked: unknown }> }).rows?.[0]?.manual_order_locked;
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
}

function deploymentOrigin(req: NextRequest): string {
  const vercelHost = (process.env.VERCEL_URL || '').trim();
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  return req.nextUrl.origin.replace(/\/$/, '');
}

async function syncDraftOrderFromSleeper(draftId: string, req: NextRequest, overrideManualOrder: boolean): Promise<void> {
  if (!overrideManualOrder && await isManualOrderLocked(draftId)) return;
  const db = getDb();
  const draftResult = await db.execute(sql`
    SELECT year, rounds, status
    FROM drafts
    WHERE id = ${draftId}::uuid
    LIMIT 1
  `);
  const draft = (draftResult as unknown as {
    rows?: Array<{ year: number | string; rounds: number | string; status: string }>;
  }).rows?.[0];
  if (!draft || draft.status === 'COMPLETED') return;

  const year = Number(draft.year);
  const rounds = Number(draft.rounds);
  const response = await fetch(
    `${deploymentOrigin(req)}/api/draft/next-order?season=${encodeURIComponent(String(year))}&sync=${Date.now()}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`next_order_${response.status}`);
  const data = await response.json() as {
    roundsData?: Array<{ round?: number; picks?: Array<{ slot?: number; ownerTeam?: string }> }>;
  };

  const incoming: Array<{ overall: number; team: string }> = [];
  for (const roundData of data.roundsData || []) {
    const round = Number(roundData.round || 0);
    if (!Number.isInteger(round) || round < 1 || round > rounds) continue;
    for (const pick of roundData.picks || []) {
      const slot = Number(pick.slot || 0);
      const team = canonicalTeam(pick.ownerTeam);
      if (!Number.isInteger(slot) || slot < 1 || slot > TEAM_NAMES.length || !team) continue;
      incoming.push({ overall: ((round - 1) * TEAM_NAMES.length) + slot, team });
    }
  }
  if (!incoming.length) throw new Error('next_order_empty');

  await db.execute(sql`
    WITH incoming AS (
      SELECT overall, team
      FROM jsonb_to_recordset(${JSON.stringify(incoming)}::jsonb)
        AS item(overall integer, team text)
    )
    UPDATE draft_slots AS slot
    SET team = incoming.team,
        original_team = CASE WHEN ${draft.status} = 'NOT_STARTED' THEN incoming.team ELSE slot.original_team END
    FROM incoming
    WHERE slot.draft_id = ${draftId}::uuid
      AND slot.overall = incoming.overall
      AND NOT EXISTS (
        SELECT 1 FROM draft_picks AS picked
        WHERE picked.draft_id = slot.draft_id AND picked.overall = slot.overall
      )
      AND NOT EXISTS (
        SELECT 1
        FROM draft_trade_assets AS asset
        JOIN draft_trades AS trade ON trade.id = asset.trade_id
        WHERE trade.draft_id = slot.draft_id
          AND trade.status = 'approved'
          AND asset.asset_type = 'current_pick'
          AND asset.pick_overall = slot.overall
      )
  `);
}

async function syncDraftRostersFromSleeper(draftId: string): Promise<void> {
  const db = getDb();
  const snapshotCheck = await db.execute(sql`
    SELECT 1 FROM draft_roster_snapshots WHERE draft_id = ${draftId}::uuid LIMIT 1
  `);
  if (!(snapshotCheck as unknown as { rows?: unknown[] }).rows?.length) return;

  const [rosters, nameMap, allPlayers] = await Promise.all([
    getLeagueRosters(LEAGUE_IDS.CURRENT).catch(() => []),
    getRosterIdToTeamNameMap(LEAGUE_IDS.CURRENT).catch(() => new Map<number, string>()),
    getAllPlayersCached().catch(() => ({} as Record<string, SleeperPlayer>)),
  ]);
  const incoming: Array<{
    team: string; player_id: string; player_name: string;
    player_pos: string | null; player_nfl: string | null;
  }> = [];
  for (const roster of rosters) {
    const team = canonicalTeam(nameMap.get(roster.roster_id));
    if (!team) continue;
    const playerIds = Array.isArray(roster.players) ? (roster.players as string[]).filter(Boolean) : [];
    for (const playerId of playerIds) {
      const player = allPlayers[playerId];
      incoming.push({
        team,
        player_id: playerId,
        player_name: player ? [player.first_name, player.last_name].filter(Boolean).join(' ') || playerId : playerId,
        player_pos: player?.position || null,
        player_nfl: player?.team || null,
      });
    }
  }
  if (!incoming.length) throw new Error('sleeper_rosters_empty');
  const incomingJson = JSON.stringify(incoming);

  await db.execute(sql`
    WITH incoming AS (
      SELECT team, player_id, player_name, player_pos, player_nfl
      FROM jsonb_to_recordset(${incomingJson}::jsonb)
        AS player(team text, player_id text, player_name text, player_pos text, player_nfl text)
    )
    INSERT INTO draft_roster_snapshots
      (draft_id, team, player_id, player_name, player_pos, player_nfl, acquired_via)
    SELECT ${draftId}::uuid, team, player_id, player_name, player_pos, player_nfl, 'sleeper'
    FROM incoming
    WHERE NOT EXISTS (
      SELECT 1 FROM draft_roster_snapshots AS protected
      WHERE protected.draft_id = ${draftId}::uuid
        AND protected.player_id = incoming.player_id
        AND protected.acquired_via <> 'sleeper'
    )
    ON CONFLICT (draft_id, team, player_id) DO UPDATE SET
      player_name = EXCLUDED.player_name,
      player_pos = EXCLUDED.player_pos,
      player_nfl = EXCLUDED.player_nfl,
      acquired_via = 'sleeper'
  `);

  await db.execute(sql`
    WITH incoming AS (
      SELECT team, player_id
      FROM jsonb_to_recordset(${incomingJson}::jsonb) AS player(team text, player_id text)
    )
    DELETE FROM draft_roster_snapshots AS stale
    WHERE stale.draft_id = ${draftId}::uuid
      AND stale.acquired_via = 'sleeper'
      AND NOT EXISTS (
        SELECT 1 FROM incoming
        WHERE incoming.team = stale.team AND incoming.player_id = stale.player_id
      )
  `);
}

async function syncDraftFromSleeper(
  draftId: string,
  req: NextRequest,
  options: { force?: boolean; overrideManualOrder?: boolean } = {},
): Promise<void> {
  const pending = syncGlobals.__evwDraftSleeperSyncPending!.get(draftId);
  if (pending) return pending;
  const last = syncGlobals.__evwDraftSleeperSyncAt!.get(draftId) || 0;
  if (!options.force && Date.now() - last < SYNC_INTERVAL_MS) return;

  syncGlobals.__evwDraftSleeperSyncAt!.set(draftId, Date.now());
  const work = (async () => {
    await Promise.allSettled([
      syncDraftOrderFromSleeper(draftId, req, Boolean(options.overrideManualOrder)),
      syncDraftRostersFromSleeper(draftId),
    ]);
  })().finally(() => syncGlobals.__evwDraftSleeperSyncPending!.delete(draftId));
  syncGlobals.__evwDraftSleeperSyncPending!.set(draftId, work);
  return work;
}

function requestWithJsonBody(req: NextRequest, body: Record<string, unknown>): NextRequest {
  return new NextRequest(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(body),
  });
}

async function createDraftWithTradedOwners(req: NextRequest, body: Record<string, unknown>): Promise<Response> {
  if (!isAdmin(req)) return Response.json({ error: 'forbidden' }, { status: 403 });
  const teams = normalizeOwnerOrder(body.teams) || [...TEAM_NAMES];
  const rounds = Math.max(1, Number(body.rounds || 4));
  const roundOrders: Record<number, string[]> = {};
  const rawRounds = body.roundOrders && typeof body.roundOrders === 'object'
    ? body.roundOrders as Record<string, unknown>
    : {};
  for (let round = 1; round <= rounds; round += 1) {
    const raw = rawRounds[String(round)];
    if (raw == null) continue;
    const normalized = normalizeOwnerOrder(raw);
    if (!normalized) return Response.json({ error: 'invalid_round_order' }, { status: 400 });
    roundOrders[round] = normalized;
  }

  const created = await createDraftWithOrder({
    year: Number(body.year || new Date().getFullYear()),
    rounds,
    teams,
    roundOrders: Object.keys(roundOrders).length ? roundOrders : undefined,
    clockSeconds: Math.max(1, Number(body.clockSeconds || 60)),
  });
  await seedDraftFromWorkspace(created.id);
  await setManualOrderLock(created.id, false);
  await syncDraftFromSleeper(created.id, req, { force: true, overrideManualOrder: true });
  return Response.json({ ok: true, id: created.id, draft: await getDraftOverview(created.id) });
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action');
  if (action !== 'player_info') {
    const draftId = req.nextUrl.searchParams.get('id') || await getActiveOrLatestDraftId().catch(() => null);
    if (draftId) await syncDraftFromSleeper(draftId, req).catch(() => {});
  }
  return handleDraftGet(req);
}

export async function POST(req: NextRequest) {
  const body = await req.clone().json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : '';
  if (action === 'create') return createDraftWithTradedOwners(req, body);

  const draftId = typeof body.id === 'string' && body.id
    ? body.id
    : await getActiveOrLatestDraftId().catch(() => null);

  if (action === 'sync_sleeper') {
    if (!isAdmin(req)) return Response.json({ error: 'forbidden' }, { status: 403 });
    if (!draftId) return Response.json({ error: 'no_draft' }, { status: 400 });
    const overrideOrder = Boolean(body.overrideOrder);
    if (overrideOrder) await setManualOrderLock(draftId, false);
    await syncDraftFromSleeper(draftId, req, { force: true, overrideManualOrder: overrideOrder });
    return Response.json({ ok: true });
  }

  if (action === 'start' && draftId && isAdmin(req)) {
    await syncDraftFromSleeper(draftId, req, { force: true }).catch(() => {});
  }

  if (action === 'set_draft_slots' && Array.isArray(body.slots)) {
    const slots = body.slots.map((raw) => {
      const slot = raw as { overall?: unknown; team?: unknown };
      return { overall: Number(slot.overall), team: canonicalTeam(slot.team) };
    });
    if (slots.some((slot) => !slot.team)) {
      return Response.json({ error: 'invalid_slot' }, { status: 400 });
    }
    const response = await handleDraftPost(requestWithJsonBody(req, { ...body, slots }));
    if (response.ok && draftId) await setManualOrderLock(draftId, true);
    return response;
  }

  if (action === 'update_slot') {
    const team = canonicalTeam(body.team);
    if (!team) return Response.json({ error: 'invalid_team' }, { status: 400 });
    const response = await handleDraftPost(requestWithJsonBody(req, { ...body, team }));
    if (response.ok && draftId) await setManualOrderLock(draftId, true);
    return response;
  }

  if (action === 'set_draft_order' && Array.isArray(body.teams)) {
    const teams = body.teams.map(canonicalTeam);
    if (teams.some((team) => !team)) return Response.json({ error: 'invalid_team' }, { status: 400 });
    const response = await handleDraftPost(requestWithJsonBody(req, { ...body, teams }));
    if (response.ok && draftId) await setManualOrderLock(draftId, true);
    return response;
  }

  return handleDraftPost(req);
}
