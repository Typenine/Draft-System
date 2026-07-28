import { NextRequest } from 'next/server';
import {
  getActiveOrLatestDraftId,
  getDraftOverview,
  getDraftTradesForTeam,
  getAdminPendingTrades,
  getAllApprovedTrades,
  getDraftTradeById,
  createDraftTrade,
  addTradeAcceptance,
  updateTradeStatus,
  approveDraftTrade,
  clearTradeAnimation,
  getRosterSnapshot,
  getFuturePicks,
  pauseDraftForTradeAnimation,
  type TradeAssetType,
} from '@/server/db/queries.fixed';
import { requireTeamUser } from '@/lib/server/session';
import { snapshotDraftRosters, snapshotDraftFuturePicks, snapshotTeamRosterIfMissing } from '@/server/draft-snapshot';
import { isAdminCookieValue } from '@/lib/auth/admin';
import { getAllPlayersCached } from '@/lib/utils/sleeper-api';

function isAdmin(req: NextRequest): boolean {
  try {
    const cookie = req.cookies.get('evw_admin')?.value;
    return isAdminCookieValue(cookie);
  } catch { return false; }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ok(data: unknown) {
  return Response.json(data);
}
function bad(msg: string, status = 400) {
  return Response.json({ error: msg }, { status });
}

export async function GET(req: NextRequest) {
  try {
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'get_team';
  const draftIdParam = url.searchParams.get('draftId') || '';

  const draftId = draftIdParam || (await getActiveOrLatestDraftId().catch(() => null)) || '';
  if (!draftId) return bad('no active draft', 404);

  // get_assets — returns roster snapshot + current picks + future picks for a team
  if (action === 'get_assets') {
    const team = url.searchParams.get('team') || '';
    if (!team) return bad('team required');
    // Ensure snapshot is populated (idempotent — no-op if already done)
    await Promise.all([
      snapshotDraftRosters(draftId).catch(() => {}),
      snapshotDraftFuturePicks(draftId).catch(() => {}),
    ]);
    const [futurePicksRaw, overview] = await Promise.all([
      getFuturePicks(draftId, team),
      getDraftOverview(draftId),
    ]);
    // Only show future picks from years strictly after the current draft year.
    // Picks for the current year are already in draft_slots (current picks), and
    // picks from past years are stale and no longer tradeable.
    const draftYear = overview?.year ?? null;
    const futurePicks = draftYear != null
      ? futurePicksRaw.filter(fp => fp.year > draftYear)
      : futurePicksRaw;
    let rosterPlayers = await getRosterSnapshot(draftId, team);
    // If this team was missed in the global snapshot (name-map gap), fill it now
    if (rosterPlayers.length === 0) {
      await snapshotTeamRosterIfMissing(draftId, team).catch(() => {});
      rosterPlayers = await getRosterSnapshot(draftId, team);
    }
    // Resolve any snapshot rows whose name is still the raw Sleeper ID (can happen
    // when getAllPlayersCached didn't include that player at snapshot time).
    const needsResolution = rosterPlayers.some(p => !p.playerName || p.playerName === p.playerId);
    if (needsResolution) {
      const sleeperPlayers = await getAllPlayersCached().catch(() => ({} as Record<string, { first_name?: string; last_name?: string; position?: string; team?: string }>));
      rosterPlayers = rosterPlayers.map(p => {
        if (p.playerName && p.playerName !== p.playerId) return p;
        const sp = sleeperPlayers[p.playerId];
        if (!sp) return p;
        const name = [sp.first_name, sp.last_name].filter(Boolean).join(' ') || p.playerId;
        return { ...p, playerName: name, playerPos: p.playerPos || sp.position || null, playerNfl: p.playerNfl || sp.team || null };
      });
    }
    // Current draft picks owned by this team (not yet made)
    const allSlots = overview?.allSlots || [];
    const allPicksMade = new Set((overview?.allPicks || []).map(p => p.overall));
    const currentPicks = allSlots.filter(s => s.team === team && !allPicksMade.has(s.overall));
    return ok({ rosterPlayers, futurePicks, currentPicks });
  }

  // get_admin_pending — admin only
  if (action === 'get_admin_pending') {
    if (!isAdmin(req)) return bad('forbidden', 403);
    const trades = await getAdminPendingTrades(draftId);
    return ok({ trades });
  }

  // get_team — trades involving myTeam
  if (action === 'get_team') {
    const teamParam = url.searchParams.get('team');
    const adminReq = isAdmin(req);
    const ident = adminReq ? null : await requireTeamUser().catch(() => null);
    if (teamParam && !adminReq && teamParam !== ident?.team) return bad('forbidden', 403);
    const team = (adminReq ? teamParam : ident?.team) || '';
    if (!team) return bad('auth_required', 401);
    const trades = await getDraftTradesForTeam(draftId, team);
    return ok({ trades });
  }

  // list_approved — all approved trades for this draft (used by round recap overlay)
  if (action === 'list_approved') {
    const trades = await getAllApprovedTrades(draftId);
    return ok({ trades });
  }

  return bad('unknown action');
  } catch (e) {
    console.error('GET /api/draft/trade failed', e);
    return bad('internal error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : '';
  const draftIdParam = typeof body.draftId === 'string' ? body.draftId : '';

  const draftId = draftIdParam || (await getActiveOrLatestDraftId().catch(() => null)) || '';
  if (!draftId) return bad('no active draft', 404);

  const adminReq = isAdmin(req);
  const ident = adminReq ? null : await requireTeamUser().catch(() => null);
  const myTeam = ident?.team || null;

  // propose — create a new trade offer
  if (action === 'propose') {
    if (!myTeam && !adminReq) return bad('not authenticated', 401);
    const requestedProposer = typeof body.proposedBy === 'string' ? body.proposedBy : '';
    if (requestedProposer && !adminReq && requestedProposer !== myTeam) return bad('forbidden', 403);
    const proposingTeam = (adminReq ? requestedProposer : myTeam) || '';
    if (!proposingTeam) return bad('proposedBy required');
    const teams = Array.isArray(body.teams) ? (body.teams as string[]) : [];
    if (teams.length < 2 || teams.length > 3) return bad('2 or 3 teams required');
    if (!teams.includes(proposingTeam)) return bad('proposing team must be in teams list');
    const assets = Array.isArray(body.assets) ? (body.assets as Array<{
      fromTeam: string; toTeam: string; assetType: TradeAssetType;
      playerId?: string; playerName?: string; playerPos?: string;
      pickOverall?: number; pickYear?: number; pickRound?: number; pickOriginalTeam?: string;
    }>) : [];
    if (assets.length === 0) return bad('assets required');
    const notes = typeof body.notes === 'string' ? body.notes : null;
    const counterOf = typeof body.counterOf === 'string' ? body.counterOf : null;
    // If countering, mark original as countered
    if (counterOf) {
      const original = await getDraftTradeById(counterOf);
      if (!original || !['pending', 'accepted'].includes(original.status)) return bad('original trade not found or not counterable');
      await updateTradeStatus(counterOf, 'countered');
    }
    const tradeId = await createDraftTrade({ draftId, proposedBy: proposingTeam, teams, assets, counterOf, notes });
    return ok({ ok: true, tradeId });
  }

  // accept
  if (action === 'accept') {
    const requestedTeam = typeof body.team === 'string' ? body.team : '';
    if (requestedTeam && !adminReq && requestedTeam !== myTeam) return bad('forbidden', 403);
    const team = (adminReq ? requestedTeam : myTeam) || '';
    const tradeId = typeof body.tradeId === 'string' ? body.tradeId : '';
    if (!team || !tradeId) return bad('team and tradeId required');
    const trade = await getDraftTradeById(tradeId);
    if (!trade || trade.draftId !== draftId) return bad('trade not found');
    if (!trade.teams.includes(team)) return bad('team not part of this trade');
    if (trade.status !== 'pending') return bad('trade is not pending');
    // Validate that all pick assets are still valid at accept time
    const [overview, futurePicks] = await Promise.all([
      getDraftOverview(draftId),
      getFuturePicks(draftId),
    ]);
    const madeOveralls = new Set((overview?.allPicks || []).map(p => p.overall));
    const allSlots = overview?.allSlots || [];
    for (const asset of trade.assets) {
      if (asset.assetType === 'current_pick' && asset.pickOverall != null) {
        if (madeOveralls.has(asset.pickOverall)) {
          return bad(`Pick #${asset.pickOverall} has already been used and can no longer be traded`);
        }
        const slot = allSlots.find(s => s.overall === asset.pickOverall);
        if (!slot || slot.team !== asset.fromTeam) {
          return bad(`Pick #${asset.pickOverall} is no longer owned by ${asset.fromTeam}`);
        }
      }
      if (asset.assetType === 'future_pick') {
        const fp = futurePicks.find(fp =>
          fp.round === asset.pickRound &&
          fp.year === asset.pickYear &&
          fp.ownerTeam === asset.fromTeam
        );
        if (!fp) {
          return bad(`${asset.pickYear} Round ${asset.pickRound} pick is no longer owned by ${asset.fromTeam}`);
        }
      }
    }
    const result = await addTradeAcceptance(tradeId, team);
    return ok({ ok: true, allAccepted: result.allAccepted, trade: result.trade });
  }

  // reject
  if (action === 'reject') {
    const requestedTeam = typeof body.team === 'string' ? body.team : '';
    if (requestedTeam && !adminReq && requestedTeam !== myTeam) return bad('forbidden', 403);
    const team = (adminReq ? requestedTeam : myTeam) || '';
    const tradeId = typeof body.tradeId === 'string' ? body.tradeId : '';
    if (!team || !tradeId) return bad('team and tradeId required');
    const trade = await getDraftTradeById(tradeId);
    if (!trade || trade.draftId !== draftId) return bad('trade not found');
    if (!trade.teams.includes(team)) return bad('team not part of this trade');
    if (!['pending', 'accepted'].includes(trade.status)) return bad('trade cannot be rejected');
    await updateTradeStatus(tradeId, 'rejected');
    return ok({ ok: true });
  }

  // cancel — proposing team withdraws offer
  if (action === 'cancel') {
    const requestedTeam = typeof body.team === 'string' ? body.team : '';
    if (requestedTeam && !adminReq && requestedTeam !== myTeam) return bad('forbidden', 403);
    const team = (adminReq ? requestedTeam : myTeam) || '';
    const tradeId = typeof body.tradeId === 'string' ? body.tradeId : '';
    if (!team || !tradeId) return bad('team and tradeId required');
    const trade = await getDraftTradeById(tradeId);
    if (!trade || trade.draftId !== draftId) return bad('trade not found');
    if (trade.proposedBy !== team && !adminReq) return bad('only proposing team can cancel');
    if (!['pending', 'accepted'].includes(trade.status)) return bad('trade cannot be cancelled');
    await updateTradeStatus(tradeId, 'cancelled');
    return ok({ ok: true });
  }

  // approve — admin only
  if (action === 'approve') {
    if (!adminReq) return bad('forbidden', 403);
    const tradeId = typeof body.tradeId === 'string' ? body.tradeId : '';
    if (!tradeId) return bad('tradeId required');
    const trade = await getDraftTradeById(tradeId);
    if (!trade || trade.draftId !== draftId) return bad('trade not found');
    if (trade.status !== 'accepted') return bad('trade must be accepted before approval');
    // Check current draft state so we know whether to resume after animation
    const overview = await getDraftOverview(draftId);
    const wasLive = overview?.status === 'LIVE';
    const curOverall = overview?.curOverall ?? null;
    // Detect if the current on-clock pick is being traded — triggers pick animation after
    const tradedPickAsset = curOverall != null
      ? trade.assets.find(a => a.assetType === 'current_pick' && a.pickOverall === curOverall)
      : null;
    const triggerPickAnimation = !!tradedPickAsset;
    const newClockTeam = tradedPickAsset?.toTeam ?? null;
    // Pause draft clock for the duration of the animation
    await pauseDraftForTradeAnimation(draftId);
    const approved = await approveDraftTrade(tradeId, {
      resumeAfterAnimation: wasLive,
      triggerPickAnimation,
      newClockTeam,
    });
    if (!approved) return bad('trade approval failed');
    return ok({ ok: true, trade: approved });
  }

  // reject_admin — commissioner rejects
  if (action === 'reject_admin') {
    if (!adminReq) return bad('forbidden', 403);
    const tradeId = typeof body.tradeId === 'string' ? body.tradeId : '';
    if (!tradeId) return bad('tradeId required');
    const trade = await getDraftTradeById(tradeId);
    if (!trade || trade.draftId !== draftId) return bad('trade not found');
    await updateTradeStatus(tradeId, 'rejected');
    return ok({ ok: true });
  }

  // clear_trade_animation — called by overlay after animation plays
  if (action === 'clear_trade_animation') {
    await clearTradeAnimation(draftId);
    return ok({ ok: true });
  }

  return bad('unknown action');
  } catch (e) {
    console.error('POST /api/draft/trade failed', e);
    return bad('internal error', 500);
  }
}
