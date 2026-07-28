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
const compat = await source('src/lib/draft-compat.ts');
const commissioner = await source('src/app/commissioner/page.tsx');
const overlay = await source('src/components/draft-overlay/DraftOverlayLive.tsx');
const teamRoom = await source('src/app/draft/room/team/page.tsx');

requireMarkers('src/lib/db.ts', db, [
  'DEFAULT_EVENT_LOGO',
  'CREATE TABLE IF NOT EXISTS draft_pending_picks',
  'CREATE TABLE IF NOT EXISTS draft_trades',
  'CREATE TABLE IF NOT EXISTS draft_roster_ownership',
  "WHERE logo_url IS NULL OR btrim(logo_url) = ''",
]);
requireMarkers('src/lib/store/draft.ts', draftStore, [
  "pause_reason = 'pending_pick'",
  'approvePendingPick',
  'rejectPendingPick',
  "pause_reason = 'pick_animation'",
  'pendingTrades: await listModerationTrades',
]);
requireMarkers('src/lib/store/admin.ts', adminStore, [
  "normalizedAction === 'approve_pick'",
  "normalizedAction === 'approve_trade'",
  "normalizedAction === 'finish_pick_animation'",
  "normalizedAction === 'finish_trade_animation'",
]);
requireMarkers('src/lib/store/moderation.ts', moderation, [
  "String(trade.status) !== 'accepted'",
  "status = 'approved'",
  'animation_pending = true',
  "pause_reason = 'trade_animation'",
]);
requireMarkers('src/app/api/draft/route.ts', draftRoute, [
  'pendingPickView',
  'pending: true',
  "runAdminAction('finish_pick_animation'",
  "runAdminAction('finish_trade_animation'",
  "'queue_get'",
  "'queue_set'",
  "action === 'presence'",
]);
requireMarkers('src/app/api/draft/trade/route.ts', tradeRoute, [
  "status = ${fullyAccepted ? 'accepted' : 'pending'}",
  'awaitingCommissioner',
  "action === 'approve'",
  "action === 'admin_reject'",
  "action === 'propose'",
  "action === 'cancel'",
]);
if (tradeRoute.includes("status = ${fullyAccepted ? 'approved' : 'pending'}")) {
  throw new Error('[parity] Team acceptance still auto-approves trades.');
}
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
]);
requireMarkers('src/components/draft-overlay/DraftOverlayLive.tsx', overlay, [
  'boardRoundStart',
  'visibleBoardRounds',
  'pendingTradeAnimation',
]);
requireMarkers('src/app/draft/room/team/page.tsx', teamRoom, [
  'Admin mode — view as team',
  'Array.from(new Set((draft?.allSlots || [])',
  'Pick Submitted — Awaiting Admin Approval',
  'DraftTradeCenter',
]);

console.log('[parity] Standalone draft runtime matches the required East v. West approval, queue, trade, animation, and board workflows.');
