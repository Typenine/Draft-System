import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const runtimeTemplates = [
  ['scripts/runtime-adapters/draft-route.ts.txt', 'src/app/api/draft/route.ts'],
  ['scripts/runtime-adapters/trade-route.ts.txt', 'src/app/api/draft/trade/route.ts'],
  ['scripts/runtime-adapters/team-roster-route.ts.txt', 'src/app/api/draft/team-roster/route.ts'],
  ['scripts/runtime-adapters/player-videos-route.ts.txt', 'src/app/api/draft/player-videos/route.ts'],
  ['scripts/runtime-adapters/player-image-route.ts.txt', 'src/app/api/draft/player-image/route.ts'],
  ['scripts/runtime-adapters/draft-compat.ts.txt', 'src/lib/draft-compat.ts'],
];

for (const [templatePath, outputPath] of runtimeTemplates) {
  const template = await readFile(resolve(process.cwd(), templatePath), 'utf8');
  await writeFile(resolve(process.cwd(), outputPath), template, 'utf8');
}

const adminStorePath = resolve(process.cwd(), 'src/lib/store/admin.ts');
let adminStore = await readFile(adminStorePath, 'utf8');
adminStore = adminStore.replace(
  "    await sql`UPDATE draft_trades SET animation_pending = false, resume_after_animation = false WHERE draft_id = ${draftId}`;",
  '    await resetTrades(draftId);',
);
if (!adminStore.includes('await resetTrades(draftId);')) {
  throw new Error('[standalone-adapter] Full draft reset does not clear trade state.');
}
await writeFile(adminStorePath, adminStore, 'utf8');

const commissionerPath = resolve(process.cwd(), 'src/app/commissioner/page.tsx');
let commissioner = await readFile(commissionerPath, 'utf8');
if (!commissioner.includes('href="/commissioner/media"')) {
  commissioner = commissioner.replace(
    '<a className="button" href="/commissioner/settings">Edit full setup</a>',
    '<a className="button" href="/commissioner/settings">Edit full setup</a>\n            <a className="button" href="/commissioner/media">Player media</a>',
  );
}
if (!commissioner.includes('href="/commissioner/media"')) {
  throw new Error('[standalone-adapter] Player media controls were not linked from the commissioner room.');
}
await writeFile(commissionerPath, commissioner, 'utf8');

const teamRoomPath = resolve(process.cwd(), 'src/app/draft/room/team/page.tsx');
let teamRoom = await readFile(teamRoomPath, 'utf8');
teamRoom = teamRoom.replace(
  'allTeams={TEAM_NAMES}',
  'allTeams={Array.from(new Set((draft?.allSlots || []).map((slot) => slot.team)))}',
);
if (teamRoom.includes('TEAM_NAMES')) {
  throw new Error('[standalone-adapter] Static East v. West team names remain in the standalone team room.');
}
if (!teamRoom.includes('allTeams={Array.from(new Set((draft?.allSlots || [])')) {
  throw new Error('[standalone-adapter] Dynamic trade-center team list was not applied.');
}
await writeFile(teamRoomPath, teamRoom, 'utf8');

const draftRoute = await readFile(resolve(process.cwd(), 'src/app/api/draft/route.ts'), 'utf8');
const tradeRoute = await readFile(resolve(process.cwd(), 'src/app/api/draft/trade/route.ts'), 'utf8');
const rosterRoute = await readFile(resolve(process.cwd(), 'src/app/api/draft/team-roster/route.ts'), 'utf8');
const mediaRoute = await readFile(resolve(process.cwd(), 'src/app/api/draft/player-videos/route.ts'), 'utf8');
const imageRoute = await readFile(resolve(process.cwd(), 'src/app/api/draft/player-image/route.ts'), 'utf8');
const compat = await readFile(resolve(process.cwd(), 'src/lib/draft-compat.ts'), 'utf8');
if (!draftRoute.includes('pendingPickView') || !draftRoute.includes("runAdminAction('finish_pick_animation'")) {
  throw new Error('[standalone-adapter] Moderated pick runtime was not materialized.');
}
if (!tradeRoute.includes("status = ${fullyAccepted ? 'accepted' : 'pending'}") || !tradeRoute.includes("action === 'approve'")) {
  throw new Error('[standalone-adapter] Commissioner-approved trade runtime was not materialized.');
}
if (!tradeRoute.includes('ensureFuturePicks') || !tradeRoute.includes('draft_future_picks')) {
  throw new Error('[standalone-adapter] Future pick trade assets were not materialized.');
}
if (!rosterRoute.includes('FROM draft_roster_ownership') || rosterRoute.includes('state.picks.filter')) {
  throw new Error('[standalone-adapter] Ownership-aware team roster runtime was not materialized.');
}
if (!mediaRoute.includes('draft_player_media') || !mediaRoute.includes('videoUrl') || !imageRoute.includes('NextResponse.redirect')) {
  throw new Error('[standalone-adapter] Player media runtime was not materialized.');
}
if (!compat.includes('resumeAfterAnimation: Boolean(trade.resume_after_animation)') || !compat.includes('eventLogoUrl(state.branding?.logoUrl)')) {
  throw new Error('[standalone-adapter] Runtime animation and event-branding compatibility was not materialized.');
}
