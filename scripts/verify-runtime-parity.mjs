import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function source(path) {
  return readFile(resolve(process.cwd(), path), 'utf8');
}
function requireMarkers(path, text, markers) {
  for (const marker of markers) {
    if (!text.includes(marker)) throw new Error(`[parity] ${path} is missing: ${marker}`);
  }
}

const db = await source('src/lib/db.ts');
const draftStore = await source('src/lib/store/draft.ts');
const adminStore = await source('src/lib/store/admin.ts');
const moderation = await source('src/lib/store/moderation.ts');
const draftRoute = await source('src/app/api/draft/route.ts');
const tradeRoute = await source('src/app/api/draft/trade/route.ts');
const rosterRoute = await source('src/app/api/draft/team-roster/route.ts');
const mediaRoute = await source('src/app/api/draft/player-videos/route.ts');
const imageRoute = await source('src/app/api/draft/player-image/route.ts');
const boardRoute = await source('src/app/api/team-prospect-draftboard/route.ts');
const compat = await source('src/lib/draft-compat.ts');
const commissioner = await source('src/app/commissioner/page.tsx');
const mediaPage = await source('src/app/commissioner/media/page.tsx');
const playerPicker = await source('src/components/admin/PlayerSearchPicker.tsx');
const archives = await source('src/app/archives/page.tsx');
const archiveRoute = await source('src/app/api/archives/route.ts');
const overlay = await source('src/components/draft-overlay/DraftOverlayLive.tsx');
const teamRoom = await source('src/app/draft/room/team/page.tsx');

requireMarkers('src/lib/db.ts', db, [
  'DEFAULT_EVENT_LOGO',
  'CREATE TABLE IF NOT EXISTS draft_pending_picks',
  'CREATE TABLE IF NOT EXISTS draft_trades',
  'CREATE TABLE IF NOT EXISTS draft_roster_ownership',
  'CREATE TABLE IF NOT EXISTS draft_future_picks',
  'CREATE TABLE IF NOT EXISTS draft_team_boards',
  'CREATE TABLE IF NOT EXISTS draft_player_media',
  'auto_pick_enabled boolean NOT NULL DEFAULT true',
  "WHERE logo_url IS NULL OR btrim(logo_url) = ''",
]);
requireMarkers('src/lib/store/draft.ts', draftStore, [
  "pause_reason = 'pending_pick'",
  'approvePendingPick',
  'rejectPendingPick',
  "pause_reason = 'pick_animation'",
  "pause_reason = 'clock_expired'",
  'autoPickEnabled: settings.auto_pick_enabled !== false',
  'pendingTrades: await listModerationTrades',
  'draft_roster_ownership',
]);
requireMarkers('src/lib/store/admin.ts', adminStore, [
  "normalizedAction === 'approve_pick'",
  "normalizedAction === 'approve_trade'",
  "normalizedAction === 'finish_pick_animation'",
  "normalizedAction === 'finish_trade_animation'",
  "normalizedAction === 'force_pick'",
  "normalizedAction === 'set_auto_pick'",
  "normalizedAction === 'undo'",
  "normalizedAction === 'skip'",
  "if (normalizedAction === 'reset') {\n    await resetTrades(draftId);",
]);
requireMarkers('src/lib/store/moderation.ts', moderation, [
  "String(trade.status) !== 'accepted'",
  "status = 'approved'",
  'animation_pending = true',
  "pause_reason = 'trade_animation'",
  'draft_roster_ownership',
  'draft_future_picks',
  'ORDER BY updated_at DESC, id DESC',
  'UPDATE draft_slots SET team_id = ${fromTeamId}',
]);
requireMarkers('src/app/api/draft/route.ts', draftRoute, [
  'pendingPickView',
  'pending: true',
  "runAdminAction('finish_pick_animation'",
  "runAdminAction('finish_trade_animation'",
  "'queue_get'",
  "'queue_set'",
  "action === 'presence'",
  "'auto_pick'",
  "'set_auto_pick'",
  "'repair_state'",
]);
requireMarkers('src/app/api/draft/trade/route.ts', tradeRoute, [
  "status = ${fullyAccepted ? 'accepted' : 'pending'}",
  'awaitingCommissioner',
  "action === 'approve'",
  "action === 'admin_reject'",
  "action === 'propose'",
  "action === 'cancel'",
  'ensureFuturePicks',
  'draft_future_picks',
]);
if (tradeRoute.includes("status = ${fullyAccepted ? 'approved' : 'pending'}")) {
  throw new Error('[parity] Team acceptance still auto-approves trades.');
}
requireMarkers('src/app/api/draft/team-roster/route.ts', rosterRoute, [
  'FROM draft_roster_ownership',
  'owner_team_id',
  'fromSnapshot: true',
]);
if (rosterRoute.includes('state.picks.filter')) {
  throw new Error('[parity] Team roster still ignores approved player trades.');
}
requireMarkers('src/app/api/draft/player-videos/route.ts', mediaRoute, [
  'draft_player_media',
  'commissioner_required',
  'imageUrl',
  'videoUrl',
]);
requireMarkers('src/app/api/draft/player-image/route.ts', imageRoute, [
  'draft_player_media',
  'NextResponse.redirect',
]);
requireMarkers('src/app/api/team-prospect-draftboard/route.ts', boardRoute, [
  'draft_team_boards',
  'orderIds',
  'ON CONFLICT (team_id)',
]);
requireMarkers('src/lib/draft-compat.ts', compat, [
  'eventLogoUrl(state.branding?.logoUrl)',
  'resumeAfterAnimation: Boolean(trade.resume_after_animation)',
  "draft.pauseReason === 'pick_animation'",
]);
requireMarkers('src/app/commissioner/page.tsx', commissioner, [
  'Pending approvals',
  "action('approve_pick')",
  "action('approve_trade'",
  'commissioner-event-logo',
  'Open team-view tester',
  'href="/commissioner/media"',
  'PlayerSearchPicker',
  'Clock-expiration auto-pick',
  "action('set_auto_pick'",
]);
if (commissioner.includes('<label>Available player<select')) throw new Error('[parity] Commissioner force-pick still renders every player in a select.');
requireMarkers('src/app/commissioner/media/page.tsx', mediaPage, [
  'Player Media',
  '/api/draft/player-videos',
  'Save media',
  'PlayerSearchPicker',
]);
if (mediaPage.includes('<label>Player<select')) throw new Error('[parity] Player media still renders every player in a select.');
requireMarkers('src/components/admin/PlayerSearchPicker.tsx', playerPicker, [
  'Search player name, NFL team, college, rank, or player ID',
  "['all', 'All players']",
  "['offense', 'Offense']",
  "['idp', 'IDP']",
  'All NFL teams',
  'Any college',
  'PAGE_SIZE = 100',
  'Show {Math.min(PAGE_SIZE',
  "event.key === 'ArrowDown'",
]);
requireMarkers('src/app/archives/page.tsx', archives, [
  '/api/archives',
  'Saved board',
]);
requireMarkers('src/app/api/archives/route.ts', archiveRoute, [
  'listArchives',
  'Cache-Control',
]);
requireMarkers('src/components/draft-overlay/DraftOverlayLive.tsx', overlay, [
  'boardRoundStart',
  'visibleBoardRounds',
  'pendingTradeAnimation',
  '/api/draft/player-videos',
]);
requireMarkers('src/app/draft/room/team/page.tsx', teamRoom, [
  'Admin mode — view as team',
  'Array.from(new Set((draft?.allSlots || [])',
  'Pick Submitted — Awaiting Admin Approval',
  'DraftTradeCenter',
  'TeamProspectDraftboardCompact',
  'Toggle auto-pick',
  "' · Auto'",
  'My upcoming picks',
]);

console.log('[parity] Standalone runtime preserves East v. West approvals, robust player browsing, queue auto-pick controls, clock-expiration settings, trade-safe reset, ownership, media, animations, and archives.');
