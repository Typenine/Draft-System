import { NextRequest, NextResponse } from 'next/server';
import {
  countDraftPlayers,
  getDraftOverview,
  getDraftPickedPlayerIds,
  getDraftPlayers,
  getTeamQueue,
} from '@/server/db/queries';
import type { DraftOverview } from '@/server/db/queries';
import {
  cleanupCommittedPickV149,
  commitCurrentPickForAnimationV149,
  getPendingPickV149,
  safeSkipPickV149,
  submitPendingPickV149,
  type DraftPlayerInput,
  type PendingPickRow,
} from '@/server/draft-v149';
import { TEAM_NAMES } from '@/lib/constants/league';
import { isAdminCookieValue } from '@/lib/auth/admin';
import { canonicalizeTeamName } from '@/lib/server/user-identity';
import { getAllPlayersCached, type SleeperPlayer } from '@/lib/utils/sleeper-api';

const draftPresence = new Map<string, number>();
const PRESENCE_TIMEOUT_MS = 20_000;

export function ok(data: unknown, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function bad(error: string, status = 400) {
  return ok({ error }, status);
}

export function isAdmin(req: NextRequest): boolean {
  try {
    return isAdminCookieValue(req.cookies.get('evw_admin')?.value);
  } catch {
    return false;
  }
}

export function isDataUrl(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trimStart().toLowerCase().startsWith('data:');
}

export function sanitizeLogo(value: string | null | undefined): string | null {
  if (!value || isDataUrl(value)) return null;
  return value;
}

export function recordPresence(team: string): void {
  if (team) draftPresence.set(team, Date.now());
}

export function activeViewers(): string[] {
  const now = Date.now();
  const active: string[] = [];
  for (const [team, lastSeen] of draftPresence.entries()) {
    if (now - lastSeen < PRESENCE_TIMEOUT_MS) active.push(team);
    else draftPresence.delete(team);
  }
  return active;
}

export function validateOrder(
  teams: string[],
  rounds: number,
  roundOrders?: Record<number, string[]>,
): string | null {
  if (!Array.isArray(teams) || !teams.length) return 'teams_required';
  const allowed = new Set<string>(TEAM_NAMES);
  const expected = new Set(teams);
  const validate = (order: string[]) => {
    if (!Array.isArray(order) || order.length !== teams.length) return 'invalid_round_length';
    if (new Set(order).size !== order.length) return 'duplicate_team';
    if (order.some((team) => !allowed.has(team))) return 'invalid_team';
    if (order.some((team) => !expected.has(team))) return 'round_team_mismatch';
    return null;
  };
  const baseError = validate(teams);
  if (baseError) return baseError;
  for (let round = 1; round <= rounds; round += 1) {
    const error = validate(roundOrders?.[round] || teams);
    if (error) return error;
  }
  return null;
}

export type AvailablePlayer = {
  id: string;
  name: string;
  pos: string;
  nfl: string;
  college?: string | null;
  rank?: number | null;
};

function customRowToPlayer(row: Awaited<ReturnType<typeof getDraftPlayers>>[number]): AvailablePlayer {
  let college: string | null = null;
  if (row.meta && typeof row.meta === 'object') {
    const meta = row.meta as Record<string, unknown>;
    const value = meta.college ?? meta.school;
    if (typeof value === 'string' && value.trim()) college = value.trim();
  }
  return {
    id: row.player_id,
    name: row.name,
    pos: row.pos,
    nfl: row.nfl || '',
    college,
    rank: row.rank,
  };
}

export async function availablePlayers(
  draftId: string,
  options: { showAll?: boolean; q?: string; pos?: string; limit?: number } = {},
): Promise<{ available: AvailablePlayer[]; usingCustom: boolean }> {
  const taken = options.showAll ? new Set<string>() : new Set(await getDraftPickedPlayerIds(draftId));
  if (!options.showAll) {
    const pending = await getPendingPickV149(draftId);
    if (pending) taken.add(pending.playerId);
  }
  const query = (options.q || '').trim().toLowerCase();
  const position = (options.pos || '').trim().toUpperCase();
  const limit = Math.max(1, Math.min(500, Number(options.limit || 500)));
  const useCustom = (await countDraftPlayers(draftId)) > 0;

  let list: AvailablePlayer[];
  if (useCustom) {
    const customRows = await getDraftPlayers(draftId) as Array<{
      player_id: string; name: string; pos: string; nfl: string | null; rank: number | null; meta: unknown | null;
    }>;
    list = customRows
      .filter((row) => options.showAll || !taken.has(row.player_id))
      .map(customRowToPlayer)
      .sort((a, b) => {
        const ar = a.rank == null ? Number.POSITIVE_INFINITY : Number(a.rank);
        const br = b.rank == null ? Number.POSITIVE_INFINITY : Number(b.rank);
        return ar !== br ? ar - br : a.name.localeCompare(b.name);
      });

    const customIds = new Set(list.map((player) => player.id));
    const sleeper = await getAllPlayersCached();
    const defenses = (Object.values(sleeper) as SleeperPlayer[])
      .filter((player: SleeperPlayer) =>
        (player.position || '').toUpperCase() === 'DEF' &&
        (options.showAll || !taken.has(player.player_id)) &&
        !customIds.has(player.player_id))
      .map((player) => ({
        id: player.player_id,
        name: `${player.first_name} ${player.last_name}`.trim(),
        pos: 'DEF',
        nfl: player.team || '',
        college: player.college || null,
        rank: null,
      }));
    list.push(...defenses);
  } else {
    const allowed = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FB', 'RB/FB']);
    list = (Object.values(await getAllPlayersCached()) as SleeperPlayer[])
      .filter((player: SleeperPlayer) =>
        allowed.has((player.position || '').toUpperCase()) &&
        (options.showAll || !taken.has(player.player_id)))
      .map((player) => ({
        id: player.player_id,
        name: `${player.first_name} ${player.last_name}`.trim(),
        pos: player.position || '',
        nfl: player.team || '',
        college: player.college || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  if (position) list = list.filter((player) => player.pos.toUpperCase() === position);
  if (query) list = list.filter((player) => player.name.toLowerCase().includes(query));
  return { available: list.slice(0, limit), usingCustom: useCustom };
}

export function revision(overview: DraftOverview, pending: PendingPickRow | null): string {
  const trade = overview.pendingTradeAnimation
    ? overview.pendingTradeAnimation.tradeId || `${overview.pendingTradeAnimation.teams.join('|')}:${overview.pendingTradeAnimation.assets.length}`
    : '';
  return [
    overview.id,
    overview.status,
    overview.curOverall,
    overview.onClockTeam || '',
    overview.deadlineTs || '',
    overview.pauseReason || '',
    pending?.id || '',
    trade,
    overview.roundEndPause ? 1 : 0,
  ].join('|');
}

export async function autoPickCurrent(
  draftId: string,
  force: boolean,
): Promise<{ picked: boolean; playerId?: string; playerName?: string; warnings?: string[]; error?: string }> {
  const overview = await getDraftOverview(draftId);
  if (!overview || overview.status !== 'LIVE') return { picked: false, error: 'wrong_state' };
  if (!force) {
    const deadline = overview.deadlineTs ? Date.parse(overview.deadlineTs) : Number.POSITIVE_INFINITY;
    if (deadline > Date.now()) return { picked: false };
  }
  if (await getPendingPickV149(draftId)) return { picked: false, error: 'pending_pick_exists' };

  const team = canonicalizeTeamName(overview.onClockTeam || '');
  if (!team) return { picked: false, error: 'no_team_on_clock' };
  const taken = new Set(await getDraftPickedPlayerIds(draftId));
  const queue = await getTeamQueue(draftId, team) as Array<{ id: string; name: string; pos: string; nfl: string }>;
  const queued = queue.find((player) => !taken.has(player.id));
  let player: DraftPlayerInput | null = queued
    ? {
        playerId: queued.id,
        playerName: queued.name || null,
        playerPos: queued.pos || null,
        playerNfl: queued.nfl || null,
      }
    : null;

  if (!player) {
    const pool = await availablePlayers(draftId, { limit: 1 });
    const first = pool.available[0];
    if (first) {
      player = {
        playerId: first.id,
        playerName: first.name,
        playerPos: first.pos,
        playerNfl: first.nfl,
      };
    }
  }
  if (!player) {
    await safeSkipPickV149(draftId, false);
    return { picked: false, error: 'no_available_player' };
  }

  if (!force) {
    const submitted = await submitPendingPickV149({
      draftId,
      overall: overview.curOverall,
      team,
      ...player,
    });
    if (!submitted.ok) return { picked: false, error: submitted.error };
    return {
      picked: true,
      playerId: player.playerId,
      playerName: player.playerName || undefined,
    };
  }

  const committed = await commitCurrentPickForAnimationV149({
    draftId,
    team,
    expectedOverall: overview.curOverall,
    madeBy: 'admin_auto',
    ...player,
  });
  if (!committed.ok) return { picked: false, error: committed.error };
  const warnings = await cleanupCommittedPickV149({ draftId, team, ...player });
  return {
    picked: true,
    playerId: player.playerId,
    playerName: player.playerName || undefined,
    warnings: warnings.length ? warnings : undefined,
  };
}

export function translateError(error: unknown): { message: string; status: number } {
  const text = String(error);
  if (text.includes('draft_data_conflict')) return { message: 'draft_data_conflict', status: 409 };
  if (text.includes('multiple_active_drafts')) return { message: 'multiple_active_drafts', status: 409 };
  if (text.includes('uq_drafts_single_active') || text.includes('23505')) {
    return { message: 'another_draft_active', status: 409 };
  }
  return { message: 'server_error', status: 500 };
}
