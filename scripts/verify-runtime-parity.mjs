import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function source(path) { return readFile(resolve(process.cwd(), path), 'utf8'); }
function requireMarkers(path, text, markers) {
  for (const marker of markers) {
    if (!text.includes(marker)) throw new Error(`[parity] ${path} is missing: ${marker}`);
  }
}

const db = await source('src/lib/db.ts');
const auth = await source('src/lib/auth.ts');
const authServer = await source('src/lib/auth-server.ts');
const draftStore = await source('src/lib/store/draft.ts');
const adminStore = await source('src/lib/store/admin.ts');
const moderation = await source('src/lib/store/moderation.ts');
const shared = await source('src/lib/store/shared.ts');
const draftRoute = await source('src/app/api/draft/route.ts');
const tradeRoute = await source('src/app/api/draft/trade/route.ts');
const stateRoute = await source('src/app/api/state/route.ts');
const loginRoute = await source('src/app/api/auth/login/route.ts');
const setupRoute = await source('src/app/api/setup/route.ts');
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
const homepage = await source('src/app/page.tsx');

requireMarkers('src/lib/db.ts', db, [
  'CREATE TABLE IF NOT EXISTS draft_pending_picks',
  'CREATE TABLE IF NOT EXISTS draft_trades',
  'CREATE TABLE IF NOT EXISTS draft_roster_ownership',
  'CREATE TABLE IF NOT EXISTS draft_future_picks',
  'CREATE TABLE IF NOT EXISTS draft_team_boards',
  'CREATE TABLE IF NOT EXISTS draft_player_media',
  'CREATE TABLE IF NOT EXISTS draft_login_attempts',
  'auth_version integer NOT NULL DEFAULT 1',
  'from_team_id text REFERENCES draft_teams(id)',
  'auto_pick_enabled boolean NOT NULL DEFAULT true',
  'active_draft_id uuid',
  'pause_started_at timestamptz',
]);
requireMarkers('src/lib/auth.ts', auth, ['authVersion', 'hours = 24']);
requireMarkers('src/lib/auth-server.ts', authServer, ['verifyRequestSession', 'recordLoginFailure', 'setupSecretMatches']);
requireMarkers('src/app/api/auth/login/route.ts', loginRoute, ['checkLoginRateLimit', 'Retry-After', 'authenticateAdminWithVersion']);
requireMarkers('src/app/api/setup/route.ts', setupRoute, ['setupSecretMatches', 'invalid_setup_key']);
requireMarkers('src/app/api/state/route.ts', stateRoute, ['pendingTrades: []', 'ownPendingPick']);
requireMarkers('src/lib/store/shared.ts', shared, ['settings.active_draft_id', 'UPDATE draft_settings SET active_draft_id']);

requireMarkers('src/lib/store/draft.ts', draftStore, [
  "pause_reason = 'pending_pick'",
  'approvePendingPick',
  'rejectPendingPick',
  "pause_reason = 'pick_animation'",
  "pause_reason = 'clock_expired'",
  'autoPickEnabled: settings.auto_pick_enabled !== false',
  'pendingTrades: await listModerationTrades',
  'recoverStalledAnimation',
  "reason === 'trade_animation'",
  'drafts: allDraftRows.map(mapDraft)',
  'activeDraftId: settings.active_draft_id',
  'options.activate',
]);
requireMarkers('src/lib/store/admin.ts', adminStore, [
  "normalizedAction === 'approve_pick'",
  "normalizedAction === 'approve_trade'",
  "normalizedAction === 'finish_pick_animation'",
  "normalizedAction === 'finish_trade_animation'",
  "normalizedAction === 'set_auto_pick'",
  "normalizedAction === 'activate_draft'",
  'await resetDraftState(draftId)',
  'auth_version = auth_version + 1',
]);
requireMarkers('src/lib/store/moderation.ts', moderation, [
  "String(trade.status) !== 'accepted'",
  "status = 'approved'",
  'animation_pending = true',
  "pause_reason = 'trade_animation'",
  "pause_started_at = now()",
  "sql.transaction(operations, { isolationLevel: 'Serializable' })",
  'resetDraftState',
  'trade_reset_requires_manual_review',
  'requiredCurrentPickReversal',
  'tradeReversalOperations(draftId, true)',
]);
requireMarkers('src/app/api/draft/route.ts', draftRoute, [
  'pendingPickView',
  'canSeePending',
  "anim_clock_start: 'finish_pick_animation'",
  "trade_anim_complete: 'finish_trade_animation'",
  "end_draft_anim_complete: 'finish_end_draft_animation'",
  "identity.sessionRole !== 'admin'",
  "'queue_get'",
  "'queue_set'",
  "'set_auto_pick'",
  "'activate_draft'",
]);
requireMarkers('src/app/api/draft/trade/route.ts', tradeRoute, [
  'authentication_required',
  'from_team_id',
  'accepted_by_team_ids',
  "status = ${fullyAccepted ? 'accepted' : 'pending'}",
  'awaitingCommissioner',
  "action === 'approve'",
  "action === 'admin_reject'",
  'sql.transaction(operations',
]);
if (tradeRoute.includes("status = ${fullyAccepted ? 'approved' : 'pending'}")) throw new Error('[parity] Team acceptance still auto-approves trades.');

requireMarkers('src/app/api/draft/team-roster/route.ts', rosterRoute, ['FROM draft_roster_ownership', 'owner_team_id', 'fromSnapshot: true']);
requireMarkers('src/app/api/draft/player-videos/route.ts', mediaRoute, ['draft_player_media', 'verifyRequestSession', 'https_or_public_path']);
requireMarkers('src/app/api/draft/player-image/route.ts', imageRoute, ['draft_player_media', 'NextResponse.redirect']);
requireMarkers('src/app/api/team-prospect-draftboard/route.ts', boardRoute, ['draft_team_boards', 'orderIds', 'ON CONFLICT (team_id)']);
requireMarkers('src/lib/draft-compat.ts', compat, ['verifyRequestSession', 'eventLogoUrl(state.branding?.logoUrl)', 'resumeAfterAnimation', 'endDraftPause']);
requireMarkers('src/app/commissioner/page.tsx', commissioner, [
  'Pending approvals',
  "action('approve_pick')",
  "action('approve_trade'",
  'PlayerSearchPicker',
  'Clock-expiration auto-pick',
  'Create inactive draft',
  "action('activate_draft'",
]);
requireMarkers('src/app/commissioner/media/page.tsx', mediaPage, ['Player Media', '/api/draft/player-videos', 'PlayerSearchPicker']);
requireMarkers('src/components/admin/PlayerSearchPicker.tsx', playerPicker, ['Search player name, NFL team, college, rank, or player ID', "['idp', 'IDP']", 'PAGE_SIZE = 100']);
requireMarkers('src/app/archives/page.tsx', archives, ['/api/archives', 'Saved board']);
requireMarkers('src/app/api/archives/route.ts', archiveRoute, ['listArchives', 'Cache-Control']);
requireMarkers('src/components/draft-overlay/DraftOverlayLive.tsx', overlay, ['boardRoundStart', 'visibleBoardRounds', 'pendingTradeAnimation', '/api/draft/player-videos']);
requireMarkers('src/app/draft/room/team/page.tsx', teamRoom, ['Admin mode — view as team', 'Pick Submitted — Awaiting Admin Approval', 'DraftTradeCenter', 'Toggle auto-pick']);
requireMarkers('src/app/page.tsx', homepage, ['Deployment setup key', 'SETUP_SECRET']);

console.log('[parity] Standalone runtime preserves East v. West draft functionality with protected pending data, commissioner-only transitions, transactional trades/resets, explicit active drafts, animation recovery, keyed setup, revocable sessions, auto-pick, media, and archives.');
