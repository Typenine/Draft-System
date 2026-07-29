import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function text(path) { return readFile(resolve(process.cwd(), path), 'utf8'); }
async function save(path, content) { await writeFile(resolve(process.cwd(), path), content, 'utf8'); }
function replaceRequired(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(search)) throw new Error(`[player-search-autopick] Could not patch ${label}.`);
  return source.replace(search, replacement);
}

let types = await text('src/lib/types.ts');
types = replaceRequired(types, '  settings?: DraftSettings;\n  draft:', '  settings?: DraftSettings;\n  autoPickEnabled?: boolean;\n  draft:', 'draft state auto-pick type');
await save('src/lib/types.ts', types);

let db = await text('src/lib/db.ts');
db = replaceRequired(db, "          base_order jsonb NOT NULL DEFAULT '[]'::jsonb,\n          updated_at", "          base_order jsonb NOT NULL DEFAULT '[]'::jsonb,\n          auto_pick_enabled boolean NOT NULL DEFAULT true,\n          updated_at", 'auto-pick schema column');
db = replaceRequired(db, "      await sql`ALTER TABLE draft_settings ADD COLUMN IF NOT EXISTS base_order jsonb NOT NULL DEFAULT '[]'::jsonb`;", "      await sql`ALTER TABLE draft_settings ADD COLUMN IF NOT EXISTS base_order jsonb NOT NULL DEFAULT '[]'::jsonb`;\n      await sql`ALTER TABLE draft_settings ADD COLUMN IF NOT EXISTS auto_pick_enabled boolean NOT NULL DEFAULT true`;", 'auto-pick schema migration');
await save('src/lib/db.ts', db);

let draft = await text('src/lib/store/draft.ts');
draft = replaceRequired(
  draft,
  "  if (new Date(String(draft.deadline_ts)).getTime() > Date.now()) return;\n\n  const draftId = String(draft.id);",
  "  if (new Date(String(draft.deadline_ts)).getTime() > Date.now()) return;\n\n  const draftId = String(draft.id);\n  const preference = rowsOf<Row>(await sql`SELECT auto_pick_enabled FROM draft_settings WHERE id = 1 LIMIT 1`)[0];\n  if (preference?.auto_pick_enabled === false) {\n    await sql`\n      UPDATE drafts SET status = 'PAUSED', pause_reason = 'clock_expired', deadline_ts = NULL,\n        paused_remaining_seconds = clock_seconds\n      WHERE id = ${draftId} AND status = 'LIVE'\n    `;\n    return;\n  }",
  'clock-expiration auto-pick gate',
);
draft = replaceRequired(draft, '    teams,\n    players,\n  };', "    teams,\n    players,\n    autoPickEnabled: settings.auto_pick_enabled !== false,\n  };", 'auto-pick state value');
await save('src/lib/store/draft.ts', draft);

let moderation = await text('src/lib/store/moderation.ts');
moderation = replaceRequired(
  moderation,
  "export async function resetTrades(draftId?: string | null): Promise<void> {\n  await ensureSchema();\n  const sql = getSql();\n  const id = draftId || String((await activeDraftRow())?.id || '');\n  if (!id) return;\n  await sql`DELETE FROM draft_trades WHERE draft_id = ${id}`;\n}",
  "export async function resetTrades(draftId?: string | null): Promise<void> {\n  await ensureSchema();\n  const sql = getSql();\n  const id = draftId || String((await activeDraftRow())?.id || '');\n  if (!id) return;\n\n  const teamRows = rowsOf<Row>(await sql`SELECT id, name FROM draft_teams`);\n  const teamByName = new Map(teamRows.map((team) => [String(team.name), String(team.id)]));\n  const approvedTrades = rowsOf<Row>(await sql`\n    SELECT id FROM draft_trades\n    WHERE draft_id = ${id} AND status = 'approved'\n    ORDER BY updated_at DESC, id DESC\n  `);\n\n  for (const trade of approvedTrades) {\n    const assets = rowsOf<Row>(await sql`SELECT * FROM draft_trade_assets WHERE trade_id = ${String(trade.id)} ORDER BY id DESC`);\n    for (const asset of assets) {\n      const fromTeamId = teamByName.get(String(asset.from_team));\n      const toTeamId = teamByName.get(String(asset.to_team));\n      if (!fromTeamId || !toTeamId) continue;\n      const assetType = String(asset.asset_type);\n      if (assetType === 'current_pick') {\n        const overall = int(asset.pick_overall);\n        if (overall) await sql`UPDATE draft_slots SET team_id = ${fromTeamId} WHERE draft_id = ${id} AND overall = ${overall} AND team_id = ${toTeamId}`;\n      } else if (assetType === 'future_pick') {\n        const year = int(asset.pick_year);\n        const round = int(asset.pick_round);\n        const originalTeamId = teamByName.get(String(asset.pick_original_team || asset.from_team));\n        if (year && round && originalTeamId) await sql`UPDATE draft_future_picks SET owner_team_id = ${fromTeamId} WHERE draft_id = ${id} AND pick_year = ${year} AND pick_round = ${round} AND original_team_id = ${originalTeamId} AND owner_team_id = ${toTeamId}`;\n      } else if (assetType === 'player' && asset.player_id) {\n        await sql`UPDATE draft_roster_ownership SET owner_team_id = ${fromTeamId}, acquired_at = now() WHERE draft_id = ${id} AND player_id = ${String(asset.player_id)} AND owner_team_id = ${toTeamId}`;\n      }\n    }\n  }\n  await sql`DELETE FROM draft_trades WHERE draft_id = ${id}`;\n}",
  'trade ownership reset',
);
await save('src/lib/store/moderation.ts', moderation);

let admin = await text('src/lib/store/admin.ts');
admin = replaceRequired(admin, "  if (normalizedAction === 'update_branding') {", "  if (normalizedAction === 'set_auto_pick') {\n    const enabled = body.enabled !== false && body.enabled !== 'false';\n    await sql`UPDATE draft_settings SET auto_pick_enabled = ${enabled}, updated_at = now() WHERE id = 1`;\n    return;\n  }\n  if (normalizedAction === 'update_branding') {", 'commissioner auto-pick action');
const resetStart = "  if (normalizedAction === 'reset') {";
const resetUpdate = "    await sql`\n      UPDATE drafts SET status = 'NOT_STARTED'";
const resetStartIndex = admin.indexOf(resetStart);
const resetUpdateIndex = admin.indexOf(resetUpdate, resetStartIndex);
if (resetStartIndex < 0 || resetUpdateIndex < 0) throw new Error('[player-search-autopick] Could not patch full draft trade reset.');
const archiveReset = admin.includes("import { removeArchiveSnapshot } from './archive';") ? '    await removeArchiveSnapshot(draftId);\n' : '';
admin = `${admin.slice(0, resetStartIndex)}${resetStart}\n    await resetTrades(draftId);\n${archiveReset}    await sql\`DELETE FROM draft_pending_picks WHERE draft_id = \${draftId}\`;\n    await sql\`DELETE FROM draft_picks WHERE draft_id = \${draftId}\`;\n    await sql\`DELETE FROM draft_roster_ownership WHERE draft_id = \${draftId}\`;\n    await sql\`DELETE FROM draft_queues WHERE draft_id = \${draftId}\`;\n${admin.slice(resetUpdateIndex)}`;
await save('src/lib/store/admin.ts', admin);

let route = await text('src/app/api/draft/route.ts');
route = replaceRequired(route, "      usingCustom: true,\n      revision,", "      usingCustom: true,\n      autoPickEnabled: state.autoPickEnabled !== false,\n      revision,", 'legacy auto-pick state');
route = replaceRequired(route, "      'start','resume','pause','reset','undo','skip','skip_pick','force_pick','auto_pick',", "      'start','resume','pause','reset','undo','skip','skip_pick','force_pick','auto_pick','set_auto_pick',", 'auto-pick admin route');
await save('src/app/api/draft/route.ts', route);

let commissioner = await text('src/app/commissioner/page.tsx');
commissioner = replaceRequired(commissioner, "import { ClockDurationInput } from '@/components/setup/ClockDurationInput';", "import { ClockDurationInput } from '@/components/setup/ClockDurationInput';\nimport { PlayerSearchPicker } from '@/components/admin/PlayerSearchPicker';", 'commissioner player picker import');
commissioner = replaceRequired(
  commissioner,
  "          <div className=\"on-clock-card\">\n            {state.currentTeam ? <><TeamMark team={state.currentTeam} /><div><small>On the clock</small><strong>{state.currentTeam.name}</strong><span>Pick {state.draft?.currentOverall}</span></div></> : <span>No team is on the clock.</span>}\n          </div>",
  "          <div className=\"on-clock-card\">\n            {state.currentTeam ? <><TeamMark team={state.currentTeam} /><div><small>On the clock</small><strong>{state.currentTeam.name}</strong><span>Pick {state.draft?.currentOverall}</span></div></> : <span>No team is on the clock.</span>}\n          </div>\n          <div className=\"setting-toggle-row\">\n            <div><strong>Clock-expiration auto-pick</strong><span>{state.autoPickEnabled !== false ? 'On: uses the top queued player, then the best available player.' : 'Off: pauses the draft when the clock reaches zero.'}</span></div>\n            <button type=\"button\" className={`setting-switch${state.autoPickEnabled !== false ? ' on' : ''}`} aria-pressed={state.autoPickEnabled !== false} disabled={working} onClick={() => action('set_auto_pick', { enabled: state.autoPickEnabled === false })}><i /></button>\n          </div>\n          {state.draft?.pauseReason === 'clock_expired' && <div className=\"notice warning\">The clock expired with auto-pick off. Force a player, skip the slot, or resume for a fresh clock.</div>}",
  'commissioner auto-pick controls',
);
commissioner = replaceRequired(
  commissioner,
  '<label>Available player<select value={forcePlayer} onChange={(event) => setForcePlayer(event.target.value)}><option value="">Select player</option>{state.availablePlayers.map((player) => <option key={player.id} value={player.id}>{player.rank}. {player.name} · {player.position}</option>)}</select></label>\n          <button className="button warning" disabled={working || !forcePlayer || Boolean(state.pendingPick)} onClick={() => action(\'force_pick\', { playerId: forcePlayer })}>Force pick for current team</button>',
  '<PlayerSearchPicker players={state.availablePlayers} value={forcePlayer} onChange={setForcePlayer} label="Available player" disabled={working} />\n          <button className="button warning" disabled={working || !forcePlayer || Boolean(state.pendingPick)} onClick={async () => { await action(\'force_pick\', { playerId: forcePlayer }); setForcePlayer(\'\'); }}>Force pick for current team</button>',
  'commissioner force-pick dropdown',
);
await save('src/app/commissioner/page.tsx', commissioner);

let media = await text('src/app/commissioner/media/page.tsx');
media = replaceRequired(media, "import { AppHeader } from '@/components/AppHeader';", "import { AppHeader } from '@/components/AppHeader';\nimport { PlayerSearchPicker } from '@/components/admin/PlayerSearchPicker';", 'media player picker import');
media = replaceRequired(media, '<label>Player<select value={playerId} onChange={(event) => setPlayerId(event.target.value)}><option value="">Select player</option>{state.players.map((player) => <option key={player.id} value={player.id}>{player.rank}. {player.name} · {player.position}</option>)}</select></label>', '<PlayerSearchPicker players={state.players} value={playerId} onChange={setPlayerId} label="Player" disabled={working} />', 'media player dropdown');
await save('src/app/commissioner/media/page.tsx', media);

let teamRoom = await text('src/app/draft/room/team/page.tsx');
teamRoom = teamRoom.replaceAll('const authenticatedTeam = me?.claims?.team;', 'const authenticatedTeam = me?.claims?.team || (isAdmin ? myTeam : null);');
teamRoom = teamRoom.replace('  }, [me?.claims?.team]);', '  }, [me?.claims?.team, isAdmin, myTeam]);');
teamRoom = teamRoom.replace('    const authenticatedTeam = me?.claims?.team || null;', '    const authenticatedTeam = me?.claims?.team || (isAdmin ? myTeam : null);');
teamRoom = teamRoom.replace('  }, [autoPickEnabled, draft?.curOverall, draft?.status, instantSubmitRetry, me?.claims?.team, onClock, pendingPick, pickStatus, queue, submitting]);', '  }, [autoPickEnabled, draft?.curOverall, draft?.status, instantSubmitRetry, isAdmin, me?.claims?.team, myTeam, onClock, pendingPick, pickStatus, queue, submitting]);');
teamRoom = teamRoom.replace("? `Queue${queue.length ? ` (${queue.length})` : ''}`", "? `Queue${queue.length ? ` (${queue.length})` : ''}${autoPickEnabled ? ' · Auto' : ''}`");
teamRoom = teamRoom.replace('Instant submit', 'Auto-pick').replace('Toggle instant submit', 'Toggle auto-pick').replace('disabled={!me?.claims?.team}', 'disabled={!myTeam}').replace('Top queued player submits immediately when you are on the clock.', 'Auto-pick is on: your top queued player submits immediately when you are on the clock.');
await save('src/app/draft/room/team/page.tsx', teamRoom);

let css = await text('src/app/admin-enhancements.css');
if (!css.includes('.setting-toggle-row')) css += `
.setting-toggle-row { display:flex; align-items:center; justify-content:space-between; gap:18px; margin-top:13px; padding:14px; border:1px solid var(--line); border-radius:12px; background:#080e1a; }
.setting-toggle-row > div { display:grid; gap:4px; }
.setting-toggle-row span { color:var(--muted); font-size:.74rem; line-height:1.4; }
.setting-switch { position:relative; flex:0 0 auto; width:48px; height:27px; padding:0; border:1px solid #526078; border-radius:999px; background:#334155; cursor:pointer; }
.setting-switch i { position:absolute; top:3px; left:3px; width:19px; height:19px; border-radius:50%; background:#fff; transition:transform .18s ease; }
.setting-switch.on { border-color:#22c55e; background:#16a34a; }
.setting-switch.on i { transform:translateX(21px); }
.setting-switch:disabled { opacity:.55; cursor:not-allowed; }
`;
await save('src/app/admin-enhancements.css', css);

const required = [
  [db, 'auto_pick_enabled boolean'], [draft, "pause_reason = 'clock_expired'"], [moderation, 'ORDER BY updated_at DESC, id DESC'],
  [admin, "if (normalizedAction === 'reset') {\n    await resetTrades(draftId);"], [route, "'set_auto_pick'"],
  [commissioner, 'PlayerSearchPicker'], [commissioner, 'Clock-expiration auto-pick'], [media, 'PlayerSearchPicker'], [teamRoom, 'Toggle auto-pick'],
];
for (const [source, marker] of required) if (!source.includes(marker)) throw new Error(`[player-search-autopick] Materialized output is missing ${marker}`);
if (commissioner.includes('<label>Available player<select') || media.includes('<label>Player<select')) throw new Error('[player-search-autopick] A full player dropdown remains in commissioner tools.');
console.log('[player-search-autopick] Player browser, trade-safe reset, and global/team auto-pick controls are materialized.');
