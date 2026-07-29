import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

async function text(path) { return readFile(resolve(process.cwd(), path), 'utf8'); }
async function save(path, content) {
  const absolute = resolve(process.cwd(), path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
}
function replaceRequired(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(search)) throw new Error(`[polling-animation-layout] Could not patch ${label}.`);
  return source.replace(search, replacement);
}

await save('src/components/useDraftState.ts', await text('scripts/runtime-adapters/optimized-use-draft-state.ts.txt'));
await save('src/components/draft-overlay/useDraftData.ts', await text('scripts/runtime-adapters/optimized-use-draft-data.ts.txt'));
await save('src/app/api/state/route.ts', await text('scripts/runtime-adapters/optimized-state-route.ts.txt'));
await save('src/app/api/draft/route.ts', await text('scripts/runtime-adapters/optimized-draft-route.ts.txt'));

let draftStore = await text('src/lib/store/draft.ts');
const liveStoreFunction = `export async function getDraftLiveState(): Promise<DraftState & { revision: string }> {
  await ensureSchema();
  await recoverStalledAnimation();
  await autoPickExpiredDraft();
  const sql = getSql();
  const settings = rowsOf<Row>(await sql\`SELECT * FROM draft_settings WHERE id = 1 LIMIT 1\`)[0];
  if (!settings) {
    return { configured: false, databaseConfigured: true, draft: null, teams: [], players: [], slots: [], picks: [], pendingPick: null, pendingTrades: [], currentTeam: null, availablePlayers: [], revision: 'unconfigured' };
  }
  const teams = rowsOf<Row>(await sql\`SELECT * FROM draft_teams ORDER BY sort_order\`).map(mapTeam);
  const allDraftRows = rowsOf<Row>(await sql\`SELECT * FROM drafts ORDER BY created_at DESC\`);
  const teamIds = teams.map((team) => team.id);
  const draftFormat = normalizeDraftFormat(settings.draft_format);
  const baseOrder = normalizeBaseOrder(settings.base_order, teamIds);
  const draftRow = await activeDraftRow();
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
    drafts: allDraftRows.map(mapDraft),
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
  const pendingPick = await getPendingPick(draft.id);
  const pendingTrades = await listModerationTrades(draft.id);
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

`;
if (!draftStore.includes('export async function getDraftLiveState()')) {
  draftStore = replaceRequired(draftStore, 'export async function listArchives(): Promise<ArchiveDraft[]> {', `${liveStoreFunction}export async function listArchives(): Promise<ArchiveDraft[]> {`, 'lightweight live state store');
}
await save('src/lib/store/draft.ts', draftStore);

let overlay = await text('src/components/draft-overlay/DraftOverlayLive.tsx');
overlay = replaceRequired(
  overlay,
  "    if (!animInitializedRef.current) {\n      // First time we see picks after load — picks already existed, skip them\n      animInitializedRef.current = true;\n      lastAnimatedPickRef.current = draftPickAnimationIdentity(lastPick);\n      return;\n    }",
  "    if (!animInitializedRef.current) {\n      // Existing picks are skipped on a normal page load, but an active pick-animation pause\n      // means this exact pick still needs to be shown—even after a refresh or reconnect.\n      animInitializedRef.current = true;\n      if (draft?.pauseReason !== 'pick_animation') {\n        lastAnimatedPickRef.current = draftPickAnimationIdentity(lastPick);\n        return;\n      }\n    }",
  'reconnect-safe pick animation',
);
overlay = replaceRequired(
  overlay,
  "      const ppr = draftPicksPerRound(draft);\n      animDataRef.current = {\n        pick: lastPick,\n        nextTeamName: nextTeamsRef.current[0]?.name || draft?.onClockTeam || null,",
  "      const ppr = draftPicksPerRound(draft);\n      const nextSlot = (draft?.allSlots || draft?.upcoming || []).find((slot) => slot.overall > lastPick.overall);\n      animDataRef.current = {\n        pick: lastPick,\n        nextTeamName: nextSlot?.team || null,",
  'next team after selected pick',
);
overlay = replaceRequired(
  overlay,
  "  useEffect(() => {\n    if (!draft?.endDraftPause || animPhase !== null || tradeAnimData || endOfRoundAnimRound !== null || startOfRoundAnimRound !== null) return;",
  "  useEffect(() => {\n    const endDraftPending = draft?.endDraftPause === true || draft?.pauseReason === 'end_draft_animation';\n    if (!endDraftPending || animPhase !== null || tradeAnimData || endOfRoundAnimRound !== null || startOfRoundAnimRound !== null) return;",
  'end draft trigger fallback',
);
overlay = overlay.replace(
  "  }, [draft?.endDraftPause, draft?.id, draft?.allPicks?.length, animPhase, tradeAnimData, endOfRoundAnimRound, startOfRoundAnimRound]);",
  "  }, [draft?.endDraftPause, draft?.pauseReason, draft?.id, draft?.allPicks?.length, animPhase, tradeAnimData, endOfRoundAnimRound, startOfRoundAnimRound]);",
);
await save('src/components/draft-overlay/DraftOverlayLive.tsx', overlay);

for (const path of ['src/components/draft-overlay/EndOfRoundAnimation.tsx', 'src/components/draft-overlay/StartOfRoundAnimation.tsx']) {
  let source = await text(path);
  source = source.replaceAll('Pittsburgh 26', 'Seattle 26').replaceAll('Pittsburgh steel grid texture', 'Seattle event grid texture');
  await save(path, source);
}

let commissioner = await text('src/app/commissioner/page.tsx');
commissioner = replaceRequired(commissioner, '<div className="panel control-panel">\n          <h2>Draft controls</h2>', '<div className="panel control-panel commissioner-control-panel">\n          <h2>Draft controls</h2>', 'draft controls layout class');
commissioner = replaceRequired(commissioner, '<div className="panel control-panel">\n          <h2>Clock and force pick</h2>', '<div className="panel control-panel commissioner-player-panel">\n          <h2>Clock and force pick</h2>', 'player search layout class');
commissioner = replaceRequired(commissioner, '<div className="panel control-panel">\n          <h2>Create another draft</h2>', '<div className="panel control-panel commissioner-draft-management-panel">\n          <h2>Create another draft</h2>', 'draft management layout class');
await save('src/app/commissioner/page.tsx', commissioner);

let css = await text('src/app/admin-enhancements.css');
if (!css.includes('.commissioner-player-panel')) css += `
.commissioner-page .admin-grid {
  grid-template-columns: minmax(300px, .72fr) minmax(0, 1.55fr);
  grid-template-areas:
    "controls player"
    "create player";
  align-items: start;
}
.commissioner-control-panel { grid-area: controls; min-width: 0; }
.commissioner-player-panel { grid-area: player; min-width: 0; overflow: hidden; }
.commissioner-draft-management-panel { grid-area: create; min-width: 0; align-self: start; }
.commissioner-draft-management-panel .draft-management-list { max-height: 260px; overflow: auto; }
.commissioner-player-panel .player-browser-results { max-height: 520px; }
@media (max-width: 1100px) {
  .commissioner-page .admin-grid {
    grid-template-columns: 1fr;
    grid-template-areas: "controls" "player" "create";
  }
  .commissioner-draft-management-panel .draft-management-list { max-height: none; }
}
`;
await save('src/app/admin-enhancements.css', css);

const checks = [
  ['src/lib/store/draft.ts', 'getDraftLiveState'],
  ['src/app/api/state/route.ts', "mode') === 'live"],
  ['src/app/api/draft/route.ts', 'getDraftLiveState'],
  ['src/components/useDraftState.ts', '/api/state?mode=live'],
  ['src/components/draft-overlay/useDraftData.ts', '/api/draft?mode=live'],
  ['src/components/draft-overlay/DraftOverlayLive.tsx', 'nextSlot?.team || null'],
  ['src/components/draft-overlay/DraftOverlayLive.tsx', "draft?.pauseReason !== 'pick_animation'"],
  ['src/components/draft-overlay/EndOfRoundAnimation.tsx', 'Seattle 26'],
  ['src/app/commissioner/page.tsx', 'commissioner-player-panel'],
  ['src/app/admin-enhancements.css', 'grid-template-areas'],
];
for (const [path, marker] of checks) {
  const source = await text(path);
  if (!source.includes(marker)) throw new Error(`[polling-animation-layout] ${path} is missing ${marker}`);
}
console.log('[polling-animation-layout] Lightweight live polling, correct next-team/final animations, Seattle 2026 branding, and commissioner layout are materialized.');
