import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const draftStorePath = resolve(process.cwd(), 'src/lib/store/draft.ts');
let source = await readFile(draftStorePath, 'utf8');

const liveState = `export async function getDraftLiveState(options: { includeModeration?: boolean } = {}): Promise<DraftState & { revision: string }> {
  await ensureSchema();
  const sql = getSql();

  // Reads are the hot path during a live draft. Check the active draft once and
  // only invoke recovery/autopick mutations when their deadline has actually passed.
  let draftRow = await activeDraftRow();
  if (draftRow) {
    const status = String(draftRow.status);
    const reason = String(draftRow.pause_reason || '');
    let refreshDraft = false;

    if (status === 'LIVE' && draftRow.deadline_ts && new Date(String(draftRow.deadline_ts)).getTime() <= Date.now()) {
      await autoPickExpiredDraft();
      refreshDraft = true;
    } else if (status === 'PAUSED' && draftRow.pause_started_at) {
      const elapsed = Date.now() - new Date(String(draftRow.pause_started_at)).getTime();
      const recoveryAfter = reason === 'end_draft_animation'
        ? 120000
        : ['pick_animation', 'trade_animation'].includes(reason)
          ? 90000
          : Number.POSITIVE_INFINITY;
      if (elapsed >= recoveryAfter) {
        await recoverStalledAnimation();
        refreshDraft = true;
      }
    }

    if (refreshDraft) draftRow = await activeDraftRow();
  }

  const settings = rowsOf<Row>(await sql\`SELECT * FROM draft_settings WHERE id = 1 LIMIT 1\`)[0];
  if (!settings) {
    return { configured: false, databaseConfigured: true, draft: null, teams: [], players: [], slots: [], picks: [], pendingPick: null, pendingTrades: [], currentTeam: null, availablePlayers: [], revision: 'unconfigured' };
  }

  const teams = rowsOf<Row>(await sql\`SELECT * FROM draft_teams ORDER BY sort_order\`).map(mapTeam);
  const teamIds = teams.map((team) => team.id);
  const draftFormat = normalizeDraftFormat(settings.draft_format);
  const baseOrder = normalizeBaseOrder(settings.base_order, teamIds);
  const base = {
    configured: true,
    databaseConfigured: true,
    leagueName: String(settings.league_name),
    branding: {
      primaryColor: String(settings.primary_color),
      secondaryColor: String(settings.secondary_color),
      logoUrl: eventLogoUrl(settings.logo_url),
    },
    settings: {
      rounds: int(settings.rounds, 28),
      clockSeconds: int(settings.clock_seconds, 120),
      draftFormat,
      baseOrder,
    },
    teams,
    players: [],
    autoPickEnabled: settings.auto_pick_enabled !== false,
    activeDraftId: settings.active_draft_id ? String(settings.active_draft_id) : null,
  };

  if (!draftRow) {
    return { ...base, draft: null, slots: [], picks: [], pendingPick: null, pendingTrades: [], currentTeam: null, availablePlayers: [], revision: \`none:\${String(settings.updated_at || '')}\` };
  }

  const draft = {
    ...mapDraft(draftRow),
    pauseReason: draftRow.pause_reason ? String(draftRow.pause_reason) : null,
    pausedRemainingSeconds: draftRow.paused_remaining_seconds == null ? null : int(draftRow.paused_remaining_seconds),
  };
  const { slots, picks } = await loadDraftPieces(draft.id);
  const pendingPick = options.includeModeration || draft.pauseReason === 'pending_pick'
    ? await getPendingPick(draft.id)
    : null;
  const pendingTrades = options.includeModeration ? await listModerationTrades(draft.id) : [];
  const currentSlot = slots.find((slot) => slot.overall === draft.currentOverall);
  const currentTeam = currentSlot ? teams.find((team) => team.id === currentSlot.teamId) || null : null;
  const lastPick = picks[picks.length - 1];
  const revision = [
    draft.id,
    draft.status,
    draft.currentOverall,
    draft.deadlineTs || '',
    draft.pauseReason || '',
    picks.length,
    lastPick?.madeAt || '',
    pendingPick?.id || '',
    pendingTrades.map((trade) => \`\${trade.id}:\${trade.status}:\${trade.updatedAt}\`).join(','),
    String(settings.updated_at || ''),
  ].join(':');

  return {
    ...base,
    draft,
    slots,
    picks,
    pendingPick,
    pendingTrades,
    currentTeam,
    availablePlayers: [],
    revision,
  };
}

export async function listArchives`;

const liveStatePattern = /export async function getDraftLiveState\([\s\S]*?\n\}\n\nexport async function listArchives/;
if (!liveStatePattern.test(source)) {
  throw new Error('[free-neon-runtime] Could not locate generated getDraftLiveState.');
}
source = source.replace(liveStatePattern, liveState);
await writeFile(draftStorePath, source, 'utf8');

for (const marker of [
  'getDraftLiveState(options:',
  'Number.POSITIVE_INFINITY',
  'options.includeModeration ? await listModerationTrades',
]) {
  if (!source.includes(marker)) throw new Error(`[free-neon-runtime] Missing marker: ${marker}`);
}

console.log('[free-neon-runtime] Live reads avoid idle recovery queries and moderation work unless requested.');
