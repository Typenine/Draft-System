import { NextRequest } from 'next/server';
import {
  countDraftPlayers,
  getActiveOrLatestDraftId,
  getDraftOverview,
  getDraftPickedPlayerIds,
  getTeamQueue,
  setTeamQueue,
} from '@/server/db/queries';
import {
  advanceAfterPickAnimationV149,
  ensureDraftSchemaV149,
  finishTradeAnimationV149,
  getPendingPickV149,
  repairGhostPendingPickPauseV149,
  submitPendingPickV149,
} from '@/server/draft-v149';
import { canonicalizeTeamName } from '@/lib/server/user-identity';
import { requireTeamUser } from '@/lib/server/session';
import { ADMIN_ACTIONS, handleAdminDraftAction } from './admin';
import {
  activeViewers,
  availablePlayers,
  bad,
  isAdmin,
  ok,
  recordPresence,
  translateError,
} from './shared';

export async function handleDraftPost(req: NextRequest) {
  try {
    await ensureDraftSchemaV149();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : '';
    const requestedId = typeof body.id === 'string' ? body.id : '';

    if (ADMIN_ACTIONS.has(action)) {
      return handleAdminDraftAction(req, body, action, requestedId);
    }

    if (action === 'anim_clock_start') {
      const admin = isAdmin(req);
      const identity = admin ? null : await requireTeamUser().catch(() => null);
      if (!admin && !identity) return bad('auth_required', 401);
      const draftId = requestedId || (await getActiveOrLatestDraftId());
      if (!draftId) return bad('no_draft');
      const result = await advanceAfterPickAnimationV149(draftId);
      return result.ok ? ok({ ok: true, transition: result }) : bad(result.error, 409);
    }

    if (action === 'trade_anim_complete') {
      const admin = isAdmin(req);
      const identity = admin ? null : await requireTeamUser().catch(() => null);
      if (!admin && !identity) return bad('auth_required', 401);
      const draftId = requestedId || (await getActiveOrLatestDraftId());
      if (!draftId) return bad('no_draft');
      return ok({ ok: await finishTradeAnimationV149(draftId) });
    }

    if (action === 'pick') {
      const admin = isAdmin(req);
      const identity = admin ? null : await requireTeamUser().catch(() => null);
      if (!admin && !identity) return bad('auth_required', 401);
      const draftId = requestedId || (await getActiveOrLatestDraftId());
      if (!draftId) return bad('no_draft');
      const repaired = await repairGhostPendingPickPauseV149(draftId);
      if (repaired.repaired) {
        console.warn('[draft-v149] repaired ghost pending-pick pause before pick submit', { draftId });
      }
      const overview = await getDraftOverview(draftId);
      if (!overview) return bad('no_draft');
      const playerId = String(body.playerId || '').trim();
      if (!playerId) return bad('playerId required');
      const onClock = canonicalizeTeamName(overview.onClockTeam || '');
      const team = admin ? onClock : canonicalizeTeamName(identity!.team);
      if (!team) return bad('no_team_on_clock');
      if (!admin && team !== onClock) return bad('not_your_turn');

      // Exact retries are harmless, but a different second selection is rejected.
      const existing = await getPendingPickV149(draftId);
      if (existing) {
        if (
          existing.overall === overview.curOverall &&
          canonicalizeTeamName(existing.team) === team &&
          existing.playerId === playerId
        ) return ok({ ok: true, pending: true, duplicate: true });
        return bad('pick_already_pending', 409);
      }

      // No team is on the clock during any animation or between rounds.
      const allowed =
        overview.status === 'LIVE' ||
        (overview.status === 'PAUSED' && overview.pauseReason === 'manual');
      if (!allowed) {
        if (overview.pauseReason === 'pick_animation' || overview.pauseReason === 'trade_animation') {
          return bad('animation_in_progress', 409);
        }
        if (overview.pauseReason === 'round_end') return bad('round_end_pause', 409);
        return bad('draft_not_live', 409);
      }
      if ((await getDraftPickedPlayerIds(draftId)).includes(playerId)) return bad('player_already_picked', 409);

      const submitted = await submitPendingPickV149({
        draftId,
        overall: overview.curOverall,
        team,
        playerId,
        playerName: typeof body.playerName === 'string' ? body.playerName : null,
        playerPos: typeof body.playerPos === 'string' ? body.playerPos : null,
        playerNfl: typeof body.playerNfl === 'string' ? body.playerNfl : null,
      });
      if (!submitted.ok) return bad(submitted.error, submitted.error === 'pick_already_pending' ? 409 : 400);
      return ok({ ok: true, pending: true, duplicate: submitted.duplicate || undefined });
    }

    if (action === 'queue_get' || action === 'queue_set') {
      const admin = isAdmin(req);
      const identity = admin ? null : await requireTeamUser().catch(() => null);
      if (!admin && !identity) return bad('auth_required', 401);
      const draftId = requestedId || (await getActiveOrLatestDraftId());
      if (!draftId) return bad('no_draft');
      const team = admin ? (typeof body.team === 'string' ? body.team : '') : identity!.team;
      if (!team) return bad('no_team');
      if (action === 'queue_get') return ok({ ok: true, queue: await getTeamQueue(draftId, team) });
      const players = Array.isArray(body.players)
        ? body.players as Array<{ id: string; name?: string; pos?: string; nfl?: string }>
        : Array.isArray(body.playerIds)
          ? (body.playerIds as string[]).map((id) => ({ id }))
          : [];
      await setTeamQueue(draftId, team, players);
      return ok({ ok: true });
    }

    if (action === 'available') {
      const draftId = requestedId || (await getActiveOrLatestDraftId());
      if (!draftId) return ok({ available: [] });
      const pool = await availablePlayers(draftId, {
        showAll: Boolean(body.showAll),
        q: typeof body.q === 'string' ? body.q : '',
        pos: typeof body.pos === 'string' ? body.pos : '',
        limit: Number(body.limit || 50),
      });
      return ok({ available: pool.available, usingCustom: pool.usingCustom });
    }

    if (action === 'players_info') {
      const draftId = requestedId || (await getActiveOrLatestDraftId());
      if (!draftId) return ok({ useCustom: false, count: 0 });
      const count = await countDraftPlayers(draftId);
      return ok({ useCustom: count > 0, count });
    }

    if (action === 'presence') {
      const admin = isAdmin(req);
      const identity = admin ? null : await requireTeamUser().catch(() => null);
      const team = admin ? (typeof body.team === 'string' ? body.team : 'Admin') : identity?.team;
      if (team) recordPresence(team);
      return ok({
        ok: true,
        activeViewers: activeViewers(),
        presenceApproximate: true,
        presenceLabel: 'Recently active, approximate',
      });
    }

    return bad('unknown_action');
  } catch (error) {
    console.error('POST /api/draft failed', error);
    const translated = translateError(error);
    return bad(translated.message, translated.status);
  }
}
