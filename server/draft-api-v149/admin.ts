import { NextRequest } from 'next/server';
import { snapshotDraftFuturePicks, snapshotDraftRosters } from '@/server/draft-snapshot';
import {
  clearDraftPlayers,
  copyPlayerPoolToDraft,
  countDraftPlayers,
  createDraftWithOrder,
  createPlayerPool,
  deleteBrandingTemplate,
  deleteDraft,
  deletePlayerPool,
  getActiveOrLatestDraftId,
  getDraftOverview,
  getDraftWorkspace,
  listBrandingTemplates,
  listPlayerPools,
  pauseDraftManual,
  replacePlayerPoolRows,
  resetDraft,
  resetDraftTrades,
  resetPickClock,
  resumeDraft,
  saveBrandingTemplate,
  saveDraftWorkspaceBranding,
  seedDraftFromWorkspace,
  setClockSeconds,
  setDraftOrder,
  setDraftPlayers,
  setDraftSlots,
  setDraftWorkspaceDefaultPool,
  startDraft,
  undoLastPick,
  updateDraftBranding,
} from '@/server/db/queries';
import {
  advanceAfterPickAnimationV149,
  cleanupCommittedPickV149,
  commitCurrentPickForAnimationV149,
  finishTradeAnimationV149,
  getPendingPickV149,
  rejectPendingPickV149,
  repairGhostPendingPickPauseV149,
  safeSkipPickV149,
  safeUpdateSlotV149,
  type DraftPlayerInput,
} from '@/server/draft-v149';
import { TEAM_NAMES } from '@/lib/constants/league';
import { canonicalizeTeamName } from '@/lib/server/user-identity';
import {
  autoPickCurrent,
  bad,
  isAdmin,
  isDataUrl,
  ok,
  translateError,
  validateOrder,
} from './shared';

export const ADMIN_ACTIONS = new Set([
  'create', 'delete', 'start', 'pause', 'resume', 'set_clock', 'reset_clock',
  'force_pick', 'undo', 'skip_pick', 'approve_pick', 'reject_pick', 'auto_pick',
  'reset', 'reset_trades', 'set_draft_order', 'set_draft_slots', 'update_slot',
  'upload_players', 'clear_players', 'update_branding', 'admin_workspace',
  'delete_player_pool', 'apply_player_pool', 'repair_state',
  'list_branding_templates', 'save_branding_template', 'delete_branding_template',
]);

async function repairGhostPendingIfNeeded(draftId: string) {
  const repaired = await repairGhostPendingPickPauseV149(draftId);
  if (repaired.repaired) {
    console.warn('[draft-v149] repaired ghost pending-pick pause', { draftId });
  }
  return repaired;
}

export async function handleAdminDraftAction(
  req: NextRequest,
  body: Record<string, unknown>,
  action: string,
  requestedId: string,
) {
  if (!isAdmin(req)) return bad('forbidden', 403);

  if (action === 'admin_workspace') {
    const [workspace, pools] = await Promise.all([getDraftWorkspace(), listPlayerPools()]);
    return ok({ workspace, pools });
  }
  if (action === 'delete_player_pool') {
    const poolId = typeof body.poolId === 'string' ? body.poolId.trim() : '';
    if (!poolId) return bad('poolId required');
    await deletePlayerPool(poolId);
    return ok({ ok: true });
  }
  if (action === 'upload_players') {
    const players = Array.isArray(body.players)
      ? body.players as Array<{ id: string; name: string; pos: string; nfl?: string | null; rank?: number | null; meta?: unknown }>
      : [];
    if (!players.length) return bad('players required');
    let poolId = typeof body.poolId === 'string' ? body.poolId.trim() : '';
    if (!poolId) {
      const label = typeof body.poolLabel === 'string' && body.poolLabel.trim()
        ? body.poolLabel.trim()
        : `Pool ${new Date().toISOString().slice(0, 10)}`;
      poolId = await createPlayerPool(label);
    }
    const rows = players.map((player) => ({
      id: player.id,
      name: player.name,
      pos: player.pos,
      nfl: player.nfl ?? null,
      rank: player.rank ?? null,
      meta: player.meta,
    }));
    await replacePlayerPoolRows(poolId, rows);
    await setDraftWorkspaceDefaultPool(poolId);
    const draftId = requestedId || (await getActiveOrLatestDraftId());
    if (draftId) await setDraftPlayers(draftId, rows);
    return ok({ ok: true, poolId, count: draftId ? await countDraftPlayers(draftId) : rows.length });
  }
  if (action === 'update_branding') {
    const eventLogoUrl = typeof body.eventLogoUrl === 'string' ? body.eventLogoUrl : null;
    if (isDataUrl(eventLogoUrl)) return bad('base64_logos_disabled');
    const branding = {
      eventName: typeof body.eventName === 'string' ? body.eventName : null,
      eventLogoUrl,
      eventColor1: typeof body.eventColor1 === 'string' ? body.eventColor1 : null,
      eventColor2: typeof body.eventColor2 === 'string' ? body.eventColor2 : null,
    };
    if (requestedId) await updateDraftBranding(requestedId, branding);
    else await saveDraftWorkspaceBranding(branding);
    return ok({ ok: true });
  }
  if (action === 'list_branding_templates') {
    return ok({ templates: await listBrandingTemplates() });
  }
  if (action === 'save_branding_template') {
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    if (!label) return bad('label required');
    const eventLogoUrl = typeof body.eventLogoUrl === 'string' ? body.eventLogoUrl : null;
    if (isDataUrl(eventLogoUrl)) return bad('base64_logos_disabled');
    const templateId = typeof body.templateId === 'string' && body.templateId.trim() ? body.templateId.trim() : undefined;
    const id = await saveBrandingTemplate({
      id: templateId,
      label,
      eventName: typeof body.eventName === 'string' ? body.eventName : null,
      eventLogoUrl,
      eventColor1: typeof body.eventColor1 === 'string' ? body.eventColor1 : null,
      eventColor2: typeof body.eventColor2 === 'string' ? body.eventColor2 : null,
    });
    return ok({ ok: true, id, templates: await listBrandingTemplates() });
  }
  if (action === 'delete_branding_template') {
    const templateId = typeof body.templateId === 'string' ? body.templateId.trim() : '';
    if (!templateId) return bad('templateId required');
    await deleteBrandingTemplate(templateId);
    return ok({ ok: true, templates: await listBrandingTemplates() });
  }
  if (action === 'apply_player_pool') {
    const poolId = typeof body.poolId === 'string' ? body.poolId.trim() : '';
    const draftId = requestedId || (await getActiveOrLatestDraftId());
    if (!poolId) return bad('poolId required');
    if (!draftId) return bad('no_draft');
    await copyPlayerPoolToDraft(poolId, draftId);
    await setDraftWorkspaceDefaultPool(poolId);
    return ok({ ok: true, count: await countDraftPlayers(draftId) });
  }
  if (action === 'create') {
    const year = Number(body.year || new Date().getFullYear());
    const rounds = Math.max(1, Number(body.rounds || 4));
    const teams = Array.isArray(body.teams) && body.teams.length ? body.teams as string[] : TEAM_NAMES;
    const roundOrders = body.roundOrders && typeof body.roundOrders === 'object'
      ? body.roundOrders as Record<number, string[]>
      : undefined;
    const validation = validateOrder(teams, rounds, roundOrders);
    if (validation) return bad(validation);
    const created = await createDraftWithOrder({
      year,
      rounds,
      teams,
      clockSeconds: Math.max(1, Number(body.clockSeconds || 60)),
      roundOrders,
    });
    await seedDraftFromWorkspace(created.id);
    return ok({ ok: true, id: created.id, draft: await getDraftOverview(created.id) });
  }

  const draftId = requestedId || (await getActiveOrLatestDraftId());
  if (!draftId) return bad('no_draft');

  if (action === 'repair_state') {
    const repaired = await repairGhostPendingIfNeeded(draftId);
    return ok({ ok: true, ...repaired, draft: await getDraftOverview(draftId) });
  }
  if (action === 'delete') {
    await deleteDraft(draftId);
    return ok({ ok: true });
  }
  if (action === 'reset') {
    await resetDraft(draftId);
    return ok({ ok: true });
  }
  if (action === 'reset_trades') {
    await resetDraftTrades(draftId);
    return ok({ ok: true });
  }
  if (action === 'set_draft_order') {
    const teams = body.teams as string[];
    const validation = validateOrder(teams, 1);
    if (validation) return bad(validation);
    await setDraftOrder(draftId, teams);
    return ok({ ok: true });
  }
  if (action === 'set_draft_slots') {
    const slots = body.slots as Array<{ overall: number; team: string }>;
    if (!Array.isArray(slots) || !slots.length) return bad('slots array required');
    if (new Set(slots.map((slot) => slot.overall)).size !== slots.length) return bad('duplicate_slot');
    if (slots.some((slot) => !Number.isInteger(slot.overall) || slot.overall < 1 || !TEAM_NAMES.includes(slot.team))) {
      return bad('invalid_slot');
    }
    await setDraftSlots(draftId, slots, Boolean(body.setAsDefault));
    return ok({ ok: true });
  }
  if (action === 'update_slot') {
    const overall = Number(body.overall || 0);
    const team = typeof body.team === 'string' ? body.team.trim() : '';
    if (!Number.isInteger(overall) || overall < 1) return bad('invalid_slot');
    if (!TEAM_NAMES.includes(team)) return bad('invalid_team');
    const result = await safeUpdateSlotV149(draftId, overall, team);
    return result.ok ? ok({ ok: true }) : bad(result.error, 409);
  }
  if (action === 'start') {
    try {
      const result = await startDraft(draftId);
      if (!result.ok) return bad(result.error || 'failed', 409);
    } catch (error) {
      const translated = translateError(error);
      return bad(translated.message, translated.status);
    }
    const snapshots = await Promise.allSettled([
      snapshotDraftRosters(draftId),
      snapshotDraftFuturePicks(draftId),
    ]);
    const warnings = snapshots
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => String(result.reason));
    return ok({ ok: true, snapshotWarnings: warnings.length ? warnings : undefined });
  }
  if (action === 'pause') {
    const overview = await getDraftOverview(draftId);
    if (!overview || overview.status !== 'LIVE') return bad('invalid_state');
    await pauseDraftManual(draftId);
    return ok({ ok: true });
  }
  if (action === 'resume') {
    let overview = await getDraftOverview(draftId);
    if (!overview || overview.status !== 'PAUSED') return bad('invalid_state');
    if (overview.pauseReason === 'pending_pick') {
      const repaired = await repairGhostPendingIfNeeded(draftId);
      if (repaired.repaired) overview = await getDraftOverview(draftId);
    }
    if (!overview || overview.status !== 'PAUSED') return bad('invalid_state');
    if (overview.pauseReason !== 'manual' && overview.pauseReason !== 'round_end') {
      return bad(overview.pauseReason === 'pending_pick' ? 'pending_pick_exists' : 'animation_in_progress', 409);
    }
    if (await getPendingPickV149(draftId)) return bad('pending_pick_exists', 409);
    await resumeDraft(draftId);
    return ok({ ok: true });
  }
  if (action === 'set_clock') {
    await setClockSeconds(draftId, Math.max(1, Number(body.seconds || 60)));
    return ok({ ok: true });
  }
  if (action === 'reset_clock') {
    const overview = await getDraftOverview(draftId);
    if (!overview) return bad('no_draft');
    if (overview.pauseReason === 'pending_pick') await repairGhostPendingIfNeeded(draftId);
    if (overview.pauseReason === 'pick_animation') {
      const result = await advanceAfterPickAnimationV149(draftId);
      return result.ok ? ok({ ok: true, transition: result }) : bad(result.error, 409);
    }
    if (overview.pauseReason === 'trade_animation') {
      return ok({ ok: await finishTradeAnimationV149(draftId), transition: 'trade_complete' });
    }
    if (overview.status !== 'LIVE') return bad('invalid_state', 409);
    await resetPickClock(draftId);
    return ok({ ok: true });
  }
  if (action === 'skip_pick') {
    await repairGhostPendingIfNeeded(draftId);
    const overview = await getDraftOverview(draftId);
    const allowManual = overview?.status === 'PAUSED' && overview.pauseReason === 'manual';
    const result = await safeSkipPickV149(draftId, allowManual);
    return result.ok ? ok(result) : bad(result.error, 409);
  }
  if (action === 'force_pick') {
    await repairGhostPendingIfNeeded(draftId);
    if (await getPendingPickV149(draftId)) return bad('pending_pick_exists', 409);
    const overview = await getDraftOverview(draftId);
    if (!overview) return bad('no_draft');
    const team = canonicalizeTeamName(
      typeof body.team === 'string' && body.team ? body.team : overview.onClockTeam || '',
    );
    const playerId = String(body.playerId || '').trim();
    if (!team) return bad('no_team_on_clock');
    if (!playerId) return bad('playerId required');
    const player: DraftPlayerInput = {
      playerId,
      playerName: typeof body.playerName === 'string' ? body.playerName : null,
      playerPos: typeof body.playerPos === 'string' ? body.playerPos : null,
      playerNfl: typeof body.playerNfl === 'string' ? body.playerNfl : null,
    };
    const committed = await commitCurrentPickForAnimationV149({
      draftId,
      team,
      expectedOverall: overview.curOverall,
      madeBy: 'admin',
      allowPaused: overview.pauseReason === 'manual',
      ...player,
    });
    if (!committed.ok) return bad(committed.error, 409);
    const warnings = await cleanupCommittedPickV149({ draftId, team, ...player });
    return ok({ ok: true, warnings: warnings.length ? warnings : undefined });
  }
  if (action === 'auto_pick') {
    await repairGhostPendingIfNeeded(draftId);
    const result = await autoPickCurrent(draftId, true);
    return ok({ ok: result.picked, ...result });
  }
  if (action === 'approve_pick') {
    const pending = await getPendingPickV149(draftId);
    if (!pending) {
      const repaired = await repairGhostPendingIfNeeded(draftId);
      return repaired.repaired ? ok({ ok: true, repaired: true }) : bad('no_pending_pick');
    }
    const overview = await getDraftOverview(draftId);
    if (!overview) return bad('no_draft');
    if (
      pending.overall !== overview.curOverall ||
      canonicalizeTeamName(pending.team) !== canonicalizeTeamName(overview.onClockTeam || '')
    ) return bad('stale_pending_pick', 409);

    const committed = await commitCurrentPickForAnimationV149({
      draftId,
      team: pending.team,
      expectedOverall: pending.overall,
      madeBy: 'admin_approved',
      allowPaused: true,
      pendingId: pending.id,
      playerId: pending.playerId,
      playerName: pending.playerName,
      playerPos: pending.playerPos,
      playerNfl: pending.playerNfl,
    });
    if (!committed.ok) return bad(committed.error, 409);
    const warnings = await cleanupCommittedPickV149({
      draftId,
      team: pending.team,
      playerId: pending.playerId,
      playerName: pending.playerName,
      playerPos: pending.playerPos,
      playerNfl: pending.playerNfl,
    });
    return ok({ ok: true, warnings: warnings.length ? warnings : undefined });
  }
  if (action === 'reject_pick') {
    const pending = await getPendingPickV149(draftId);
    if (!pending) {
      const repaired = await repairGhostPendingIfNeeded(draftId);
      return repaired.repaired ? ok({ ok: true, repaired: true }) : bad('no_pending_pick');
    }
    await rejectPendingPickV149(pending);
    return ok({ ok: true });
  }
  if (action === 'undo') {
    const result = await undoLastPick(draftId);
    return result.ok ? ok({ ok: true, overall: result.overall }) : bad(result.error || 'failed');
  }
  if (action === 'clear_players') {
    await clearDraftPlayers(draftId);
    return ok({ ok: true, count: 0 });
  }

  return bad('unknown_admin_action');
}
