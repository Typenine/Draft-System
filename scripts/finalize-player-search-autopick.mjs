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
db = replaceRequired(
  db,
  "          base_order jsonb NOT NULL DEFAULT '[]'::jsonb,\n          updated_at",
  "          base_order jsonb NOT NULL DEFAULT '[]'::jsonb,\n          auto_pick_enabled boolean NOT NULL DEFAULT true,\n          updated_at",
  'auto-pick schema column',
);
db = replaceRequired(
  db,
  "      await sql`ALTER TABLE draft_settings ADD COLUMN IF NOT EXISTS base_order jsonb NOT NULL DEFAULT '[]'::jsonb`;",
  "      await sql`ALTER TABLE draft_settings ADD COLUMN IF NOT EXISTS base_order jsonb NOT NULL DEFAULT '[]'::jsonb`;\n      await sql`ALTER TABLE draft_settings ADD COLUMN IF NOT EXISTS auto_pick_enabled boolean NOT NULL DEFAULT true`;",
  'auto-pick schema migration',
);
await save('src/lib/db.ts', db);

let draft = await text('src/lib/store/draft.ts');
draft = replaceRequired(
  draft,
  "  if (new Date(String(draft.deadline_ts)).getTime() > Date.now()) return;\n\n  const draftId = String(draft.id);",
  "  if (new Date(String(draft.deadline_ts)).getTime() > Date.now()) return;\n\n  const draftId = String(draft.id);\n  const preference = rowsOf<Row>(await sql`SELECT auto_pick_enabled FROM draft_settings WHERE id = 1 LIMIT 1`)[0];\n  if (preference?.auto_pick_enabled === false) {\n    await sql`\n      UPDATE drafts SET status = 'PAUSED', pause_reason = 'clock_expired', deadline_ts = NULL,\n        paused_remaining_seconds = clock_seconds\n      WHERE id = ${draftId} AND status = 'LIVE'\n    `;\n    return;\n  }",
  'clock-expiration auto-pick gate',
);
draft = replaceRequired(
  draft,
  '    teams,\n    players,\n  };',
  "    teams,\n    players,\n    autoPickEnabled: settings.auto_pick_enabled !== false,\n  };",
  'auto-pick state value',
);
await save('src/lib/store/draft.ts', draft);

let admin = await text('src/lib/store/admin.ts');
admin = replaceRequired(
  admin,
  "  if (normalizedAction === 'update_branding') {",
  "  if (normalizedAction === 'set_auto_pick') {\n    const enabled = body.enabled !== false && body.enabled !== 'false';\n    await sql`UPDATE draft_settings SET auto_pick_enabled = ${enabled}, updated_at = now() WHERE id = 1`;\n    return;\n  }\n  if (normalizedAction === 'update_branding') {",
  'commissioner auto-pick action',
);
await save('src/lib/store/admin.ts', admin);

let route = await text('src/app/api/draft/route.ts');
route = replaceRequired(route, "      usingCustom: true,\n      revision,", "      usingCustom: true,\n      autoPickEnabled: state.autoPickEnabled !== false,\n      revision,", 'legacy auto-pick state');
route = replaceRequired(route, "      'start','resume','pause','reset','undo','skip','skip_pick','force_pick','auto_pick',", "      'start','resume','pause','reset','undo','skip','skip_pick','force_pick','auto_pick','set_auto_pick',", 'auto-pick admin route');
await save('src/app/api/draft/route.ts', route);

let commissioner = await text('src/app/commissioner/page.tsx');
commissioner = replaceRequired(
  commissioner,
  "import { ClockDurationInput } from '@/components/setup/ClockDurationInput';",
  "import { ClockDurationInput } from '@/components/setup/ClockDurationInput';\nimport { PlayerSearchPicker } from '@/components/admin/PlayerSearchPicker';",
  'commissioner player picker import',
);
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
media = replaceRequired(
  media,
  '<label>Player<select value={playerId} onChange={(event) => setPlayerId(event.target.value)}><option value="">Select player</option>{state.players.map((player) => <option key={player.id} value={player.id}>{player.rank}. {player.name} · {player.position}</option>)}</select></label>',
  '<PlayerSearchPicker players={state.players} value={playerId} onChange={setPlayerId} label="Player" disabled={working} />',
  'media player dropdown',
);
await save('src/app/commissioner/media/page.tsx', media);

let teamRoom = await text('src/app/draft/room/team/page.tsx');
teamRoom = teamRoom.replaceAll('const authenticatedTeam = me?.claims?.team;', 'const authenticatedTeam = me?.claims?.team || (isAdmin ? myTeam : null);');
teamRoom = teamRoom.replace('  }, [me?.claims?.team]);', '  }, [me?.claims?.team, isAdmin, myTeam]);');
teamRoom = teamRoom.replace('    const authenticatedTeam = me?.claims?.team || null;', '    const authenticatedTeam = me?.claims?.team || (isAdmin ? myTeam : null);');
teamRoom = teamRoom.replace('  }, [autoPickEnabled, draft?.curOverall, draft?.status, instantSubmitRetry, me?.claims?.team, onClock, pendingPick, pickStatus, queue, submitting]);', '  }, [autoPickEnabled, draft?.curOverall, draft?.status, instantSubmitRetry, isAdmin, me?.claims?.team, myTeam, onClock, pendingPick, pickStatus, queue, submitting]);');
teamRoom = teamRoom.replace("? `Queue${queue.length ? ` (${queue.length})` : ''}`", "? `Queue${queue.length ? ` (${queue.length})` : ''}${autoPickEnabled ? ' · Auto' : ''}`");
teamRoom = teamRoom.replace('<span className="text-xs text-[var(--muted)]">Instant submit</span>', '<span className="text-xs text-[var(--muted)]">Auto-pick</span>');
teamRoom = teamRoom.replace('aria-label="Toggle instant submit"', 'aria-label="Toggle auto-pick"');
teamRoom = teamRoom.replace('disabled={!me?.claims?.team}', 'disabled={!myTeam}');
teamRoom = teamRoom.replace('Top queued player submits immediately when you are on the clock.', 'Auto-pick is on: your top queued player submits immediately when you are on the clock.');
await save('src/app/draft/room/team/page.tsx', teamRoom);

let css = await text('src/app/admin-enhancements.css');
if (!css.includes('.player-search-picker')) css += `
.player-search-picker { position:relative; display:grid; gap:8px; }
.player-search-picker > label { font-size:.84rem; font-weight:800; }
.player-search-toolbar { display:grid; grid-template-columns:minmax(0,1fr) minmax(140px,190px) auto; gap:8px; }
.player-search-toolbar input, .player-search-toolbar select { min-width:0; width:100%; }
.player-search-popover { overflow:hidden; border:1px solid var(--line); border-radius:12px; background:#080e1a; box-shadow:0 18px 40px rgba(0,0,0,.28); }
.player-search-count { display:flex; justify-content:space-between; gap:12px; padding:9px 11px; border-bottom:1px solid var(--line); color:var(--muted); font-size:.7rem; font-weight:800; }
.player-search-results { max-height:310px; overflow:auto; }
.player-search-result { width:100%; display:grid; grid-template-columns:48px minmax(0,1fr) auto; align-items:center; gap:10px; padding:9px 11px; border:0; border-bottom:1px solid rgba(51,65,85,.55); background:transparent; color:var(--text); text-align:left; cursor:pointer; }
.player-search-result:hover, .player-search-result.active { background:color-mix(in srgb,var(--primary) 18%,#080e1a); }
.player-search-rank { color:var(--muted); font-size:.72rem; font-weight:900; font-variant-numeric:tabular-nums; }
.player-search-name { min-width:0; display:grid; gap:2px; }
.player-search-name strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.player-search-name small, .player-search-meta small { color:var(--muted); font-size:.68rem; }
.player-search-meta { display:grid; justify-items:end; gap:2px; }
.player-search-meta b { font-size:.7rem; }
.player-search-empty { padding:22px; color:var(--muted); text-align:center; }
.player-search-selected { display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:12px; padding:11px; border:1px solid color-mix(in srgb,var(--primary) 55%,var(--line)); border-radius:12px; background:color-mix(in srgb,var(--primary) 12%,#080e1a); }
.player-search-selected > div { display:grid; gap:2px; }
.player-search-selected small, .player-search-selected > span { color:var(--muted); font-size:.7rem; }
.setting-toggle-row { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:14px; border:1px solid var(--line); border-radius:12px; background:#080e1a; }
.setting-toggle-row > div { display:grid; gap:4px; }
.setting-toggle-row span { color:var(--muted); font-size:.74rem; line-height:1.4; }
.setting-switch { position:relative; flex:0 0 auto; width:48px; height:27px; padding:0; border:1px solid #526078; border-radius:999px; background:#334155; cursor:pointer; }
.setting-switch i { position:absolute; top:3px; left:3px; width:19px; height:19px; border-radius:50%; background:#fff; box-shadow:0 2px 5px rgba(0,0,0,.35); transition:transform .18s ease; }
.setting-switch.on { border-color:#22c55e; background:#16a34a; }
.setting-switch.on i { transform:translateX(21px); }
.setting-switch:disabled { opacity:.55; cursor:not-allowed; }
@media (max-width:700px){ .player-search-toolbar { grid-template-columns:1fr; } .player-search-selected { grid-template-columns:1fr auto; } .player-search-selected > span { grid-column:1/-1; } }
`;
await save('src/app/admin-enhancements.css', css);

const required = [
  ['src/lib/db.ts', db, 'auto_pick_enabled boolean'],
  ['src/lib/store/draft.ts', draft, "pause_reason = 'clock_expired'"],
  ['src/lib/store/admin.ts', admin, "normalizedAction === 'set_auto_pick'"],
  ['src/app/api/draft/route.ts', route, "'set_auto_pick'"],
  ['src/app/commissioner/page.tsx', commissioner, 'PlayerSearchPicker'],
  ['src/app/commissioner/page.tsx', commissioner, 'Clock-expiration auto-pick'],
  ['src/app/commissioner/media/page.tsx', media, 'PlayerSearchPicker'],
  ['src/app/draft/room/team/page.tsx', teamRoom, 'Toggle auto-pick'],
];
for (const [path, source, marker] of required) if (!source.includes(marker)) throw new Error(`[player-search-autopick] ${path} is missing ${marker}`);
if (commissioner.includes('<label>Available player<select') || media.includes('<label>Player<select')) throw new Error('[player-search-autopick] A full player dropdown remains in commissioner tools.');
console.log('[player-search-autopick] Searchable player selection and global/team auto-pick controls are materialized.');
