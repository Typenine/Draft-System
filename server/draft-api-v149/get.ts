import { NextRequest } from 'next/server';
import { getActiveOrLatestDraftId, getDraftOverview } from '@/server/db/queries';
import type { DraftOverview } from '@/server/db/queries';
import {
  checkStalePickAnimationV149,
  checkStaleTradeAnimationV149,
  ensureDraftSchemaV149,
  getPendingPickV149,
  repairGhostPendingPickPauseV149,
} from '@/server/draft-v149';
import { getAllPlayersCached } from '@/lib/utils/sleeper-api';
import {
  activeViewers,
  autoPickCurrent,
  availablePlayers,
  bad,
  ok,
  revision,
  sanitizeLogo,
  translateError,
} from './shared';

export async function handleDraftGet(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    if (action === 'player_info') {
      const playerId = url.searchParams.get('playerId') || '';
      const player = (await getAllPlayersCached())[playerId];
      if (!player) return ok({ college: null });
      return ok({
        college: player.college || null,
        name: `${player.first_name} ${player.last_name}`.trim(),
        pos: player.position,
        nfl: player.team,
      });
    }

    await ensureDraftSchemaV149();
    const draftId = url.searchParams.get('id') || (await getActiveOrLatestDraftId());
    if (!draftId) return ok({ draft: null });

    await autoPickCurrent(draftId, false);
    await checkStalePickAnimationV149(draftId).catch((error) => {
      console.error('[draft-v149] stale animation fallback failed', error);
    });
    await checkStaleTradeAnimationV149(draftId).catch((error) => {
      console.error('[draft-v149] stale trade animation fallback failed', error);
    });
    const ghostRepair = await repairGhostPendingPickPauseV149(draftId).catch((error) => {
      console.error('[draft-v149] ghost pending-pick repair failed', error);
      return { repaired: false };
    });
    if (ghostRepair.repaired) {
      console.warn('[draft-v149] repaired ghost pending-pick pause during draft load', { draftId });
    }

    const overview = await getDraftOverview(draftId);
    if (!overview) return ok({ draft: null });
    const pending = await getPendingPickV149(draftId);
    const presentedOverview: DraftOverview = overview.pauseReason === 'pick_animation'
      ? { ...overview, onClockTeam: null }
      : overview;
    const deadline = overview.deadlineTs ? Date.parse(overview.deadlineTs) : 0;
    const rawRemaining = overview.status === 'LIVE' && deadline > Date.now()
      ? Math.max(0, Math.floor((deadline - Date.now()) / 1000))
      : overview.status === 'PAUSED' && overview.pausedRemainingSecs != null
        ? overview.pausedRemainingSecs
        : null;
    const remainingSec = rawRemaining == null
      ? null
      : Math.min(rawRemaining, Math.max(1, Number(overview.clockSeconds || 1)));
    const draftRevision = revision(overview, pending);

    if (url.searchParams.get('mode') === 'live') {
      return ok({
        live: {
          id: presentedOverview.id,
          year: presentedOverview.year,
          rounds: presentedOverview.rounds,
          clockSeconds: presentedOverview.clockSeconds,
          status: presentedOverview.status,
          curOverall: presentedOverview.curOverall,
          onClockTeam: presentedOverview.onClockTeam ?? null,
          deadlineTs: presentedOverview.deadlineTs ?? null,
          eventName: presentedOverview.eventName ?? null,
          eventLogoUrl: sanitizeLogo(presentedOverview.eventLogoUrl),
          eventColor1: presentedOverview.eventColor1 ?? null,
          eventColor2: presentedOverview.eventColor2 ?? null,
          pausedRemainingSecs: presentedOverview.pausedRemainingSecs ?? null,
          pendingTradeAnimation: presentedOverview.pendingTradeAnimation ?? null,
          roundEndPause: presentedOverview.roundEndPause ?? null,
          pauseReason: presentedOverview.pauseReason ?? null,
        },
        remainingSec,
        pendingPick: pending || undefined,
        revision: draftRevision,
      });
    }

    const response: Record<string, unknown> = {
      draft: { ...presentedOverview, eventLogoUrl: sanitizeLogo(presentedOverview.eventLogoUrl) },
      remainingSec,
      pendingPick: pending || undefined,
      revision: draftRevision,
      activeViewers: activeViewers(),
      presenceApproximate: true,
      presenceLabel: 'Recently active, approximate',
    };
    if (url.searchParams.get('include') === 'available') {
      const pool = await availablePlayers(draftId);
      response.available = pool.available;
      response.usingCustom = pool.usingCustom;
    }
    return ok(response);
  } catch (error) {
    console.error('GET /api/draft failed', error);
    const translated = translateError(error);
    return bad(translated.message, translated.status);
  }
}
