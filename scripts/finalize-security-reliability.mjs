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
  if (!source.includes(search)) throw new Error(`[security-reliability] Could not patch ${label}.`);
  return source.replace(search, replacement);
}

const canonicalFiles = [
  ['scripts/runtime-adapters/security-auth.ts.txt', 'src/lib/auth.ts'],
  ['scripts/runtime-adapters/security-auth-server.ts.txt', 'src/lib/auth-server.ts'],
  ['scripts/runtime-adapters/security-login-route.ts.txt', 'src/app/api/auth/login/route.ts'],
  ['scripts/runtime-adapters/security-session-route.ts.txt', 'src/app/api/auth/session/route.ts'],
  ['scripts/runtime-adapters/security-auth-me-route.ts.txt', 'src/app/api/auth/me/route.ts'],
  ['scripts/runtime-adapters/security-admin-action-route.ts.txt', 'src/app/api/admin/action/route.ts'],
  ['scripts/runtime-adapters/security-state-route.ts.txt', 'src/app/api/state/route.ts'],
  ['scripts/runtime-adapters/security-draft-route.ts.txt', 'src/app/api/draft/route.ts'],
  ['scripts/runtime-adapters/security-trade-route.ts.txt', 'src/app/api/draft/trade/route.ts'],
  ['scripts/runtime-adapters/security-player-videos-route.ts.txt', 'src/app/api/draft/player-videos/route.ts'],
  ['scripts/runtime-adapters/security-moderation.ts.txt', 'src/lib/store/moderation.ts'],
];
for (const [templatePath, outputPath] of canonicalFiles) {
  const canonical = (await text(templatePath)).replaceAll("isolationMode: 'Serializable'", "isolationLevel: 'Serializable'");
  await save(outputPath, canonical);
}

let db = await text('src/lib/db.ts');
db = replaceRequired(
  db,
  "      await sql`ALTER TABLE draft_settings ADD COLUMN IF NOT EXISTS auto_pick_enabled boolean NOT NULL DEFAULT true`;",
  "      await sql`ALTER TABLE draft_settings ADD COLUMN IF NOT EXISTS auto_pick_enabled boolean NOT NULL DEFAULT true`;\n      await sql`ALTER TABLE draft_settings ADD COLUMN IF NOT EXISTS active_draft_id uuid`;",
  'active draft setting',
);
db = replaceRequired(
  db,
  "      await sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS pause_reason text`;",
  "      await sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS pause_reason text`;\n      await sql`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS pause_started_at timestamptz`;\n      await sql`UPDATE drafts SET pause_started_at = COALESCE(pause_started_at, now()) WHERE status = 'PAUSED'`;\n      await sql`\n        UPDATE draft_settings SET active_draft_id = (SELECT id FROM drafts ORDER BY created_at DESC LIMIT 1)\n        WHERE id = 1 AND (active_draft_id IS NULL OR NOT EXISTS (SELECT 1 FROM drafts WHERE id = draft_settings.active_draft_id))\n      `;",
  'active draft and pause migration',
);
db = replaceRequired(
  db,
  "      await sql`\n        UPDATE draft_trade_assets asset SET\n          from_team_id = COALESCE(asset.from_team_id, from_team.id),\n          to_team_id = COALESCE(asset.to_team_id, to_team.id),\n          pick_original_team_id = COALESCE(asset.pick_original_team_id, original_team.id)\n        FROM draft_teams from_team, draft_teams to_team\n        LEFT JOIN draft_teams original_team ON original_team.name = asset.pick_original_team\n        WHERE from_team.name = asset.from_team AND to_team.name = asset.to_team\n          AND (asset.from_team_id IS NULL OR asset.to_team_id IS NULL OR (asset.pick_original_team IS NOT NULL AND asset.pick_original_team_id IS NULL))\n      `;",
  "      await sql`\n        UPDATE draft_trade_assets asset SET\n          from_team_id = COALESCE(asset.from_team_id, (SELECT team.id FROM draft_teams team WHERE team.name = asset.from_team LIMIT 1)),\n          to_team_id = COALESCE(asset.to_team_id, (SELECT team.id FROM draft_teams team WHERE team.name = asset.to_team LIMIT 1)),\n          pick_original_team_id = COALESCE(asset.pick_original_team_id, (SELECT team.id FROM draft_teams team WHERE team.name = asset.pick_original_team LIMIT 1))\n        WHERE asset.from_team_id IS NULL OR asset.to_team_id IS NULL\n          OR (asset.pick_original_team IS NOT NULL AND asset.pick_original_team_id IS NULL)\n      `;",
  'stable trade identity backfill',
);
await save('src/lib/db.ts', db);

let types = await text('src/lib/types.ts');
types = replaceRequired(
  types,
  '  draft: DraftSummary | null;',
  '  activeDraftId?: string | null;\n  drafts?: DraftSummary[];\n  draft: DraftSummary | null;',
  'active draft state types',
);
await save('src/lib/types.ts', types);

let shared = await text('src/lib/store/shared.ts');
shared = replaceRequired(
  shared,
  "export async function activeDraftRow(): Promise<Row | null> {\n  const sql = getSql();\n  const rows = rowsOf<Row>(await sql`SELECT * FROM drafts ORDER BY created_at DESC LIMIT 1`);\n  return rows[0] || null;\n}",
  "export async function activeDraftRow(): Promise<Row | null> {\n  const sql = getSql();\n  const selected = rowsOf<Row>(await sql`\n    SELECT draft.* FROM draft_settings settings\n    JOIN drafts draft ON draft.id = settings.active_draft_id\n    WHERE settings.id = 1 LIMIT 1\n  `)[0];\n  if (selected) return selected;\n  const fallback = rowsOf<Row>(await sql`SELECT * FROM drafts ORDER BY created_at DESC LIMIT 1`)[0] || null;\n  if (fallback) await sql`UPDATE draft_settings SET active_draft_id = ${String(fallback.id)}, updated_at = now() WHERE id = 1`;\n  return fallback;\n}",
  'explicit active draft lookup',
);
await save('src/lib/store/shared.ts', shared);

let setupStore = await text('src/lib/store/setup.ts');
setupStore = replaceRequired(
  setupStore,
  '  return createDraft(`Draft ${new Date().getFullYear()}`, { draftFormat, baseOrder, slotTeamIds });',
  '  return createDraft(`Draft ${new Date().getFullYear()}`, { draftFormat, baseOrder, slotTeamIds, activate: true });',
  'initial active draft',
);
await save('src/lib/store/setup.ts', setupStore);

let draftStore = await text('src/lib/store/draft.ts');
draftStore = replaceRequired(
  draftStore,
  "import { listModerationTrades } from './moderation';",
  "import { finishTradeAnimation, listModerationTrades } from './moderation';",
  'animation recovery import',
);
draftStore = replaceRequired(
  draftStore,
  "  slotTeamIds?: string[];\n} = {}): Promise<string> {",
  "  slotTeamIds?: string[];\n  activate?: boolean;\n} = {}): Promise<string> {",
  'draft activation option',
);
draftStore = replaceRequired(
  draftStore,
  "  await sql`\n    INSERT INTO draft_slots (draft_id, overall, round, pick_in_round, team_id)\n    SELECT ${draftId}, overall, round, pick_in_round, team_id\n    FROM jsonb_to_recordset(${JSON.stringify(slots)}::jsonb)\n      AS slot(overall integer, round integer, pick_in_round integer, team_id text)\n  `;\n  return draftId;",
  "  await sql`\n    INSERT INTO draft_slots (draft_id, overall, round, pick_in_round, team_id)\n    SELECT ${draftId}, overall, round, pick_in_round, team_id\n    FROM jsonb_to_recordset(${JSON.stringify(slots)}::jsonb)\n      AS slot(overall integer, round integer, pick_in_round integer, team_id text)\n  `;\n  if (options.activate) {\n    await sql`UPDATE draft_settings SET active_draft_id = ${draftId}, updated_at = now() WHERE id = 1`;\n  } else {\n    await sql`UPDATE draft_settings SET active_draft_id = COALESCE(active_draft_id, ${draftId}), updated_at = now() WHERE id = 1`;\n  }\n  return draftId;",
  'draft activation persistence',
);
draftStore = replaceRequired(
  draftStore,
  "      UPDATE drafts SET status = 'PAUSED', pause_reason = 'pending_pick',\n       paused_remaining_seconds = ${remaining}, deadline_ts = NULL",
  "      UPDATE drafts SET status = 'PAUSED', pause_reason = 'pending_pick', pause_started_at = now(),\n       paused_remaining_seconds = ${remaining}, deadline_ts = NULL",
  'pending pick pause timestamp',
);
draftStore = draftStore.replaceAll(
  "pause_reason = 'pick_animation', deadline_ts = NULL,\n      paused_remaining_seconds = clock_seconds, completed_at = NULL",
  "pause_reason = 'pick_animation', pause_started_at = now(), deadline_ts = NULL,\n      paused_remaining_seconds = clock_seconds, completed_at = NULL",
);
draftStore = draftStore.replaceAll(
  "status = 'PAUSED', pause_reason = 'end_draft_animation', deadline_ts = NULL,\n        paused_remaining_seconds = NULL",
  "status = 'PAUSED', pause_reason = 'end_draft_animation', pause_started_at = now(), deadline_ts = NULL,\n        paused_remaining_seconds = NULL",
);
draftStore = draftStore.replaceAll(
  "status = 'PAUSED', pause_reason = 'round_end',\n        deadline_ts = NULL",
  "status = 'PAUSED', pause_reason = 'round_end', pause_started_at = now(),\n        deadline_ts = NULL",
);
draftStore = draftStore.replaceAll(
  "pause_reason = NULL, deadline_ts = now() + (clock_seconds * interval '1 second'), paused_remaining_seconds = NULL",
  "pause_reason = NULL, pause_started_at = NULL, deadline_ts = now() + (clock_seconds * interval '1 second'), paused_remaining_seconds = NULL",
);
draftStore = draftStore.replaceAll(
  "paused_remaining_seconds = NULL, pause_reason = NULL WHERE id = ${draftId}",
  "paused_remaining_seconds = NULL, pause_reason = NULL, pause_started_at = NULL WHERE id = ${draftId}",
);
draftStore = draftStore.replaceAll(
  "pause_reason = 'clock_expired', deadline_ts = NULL,",
  "pause_reason = 'clock_expired', pause_started_at = now(), deadline_ts = NULL,",
);
draftStore = draftStore.replaceAll(
  "UPDATE drafts SET status = 'LIVE', pause_reason = NULL,\n      deadline_ts = now() +",
  "UPDATE drafts SET status = 'LIVE', pause_reason = NULL, pause_started_at = NULL,\n      deadline_ts = now() +",
);
draftStore = replaceRequired(
  draftStore,
  'export async function getDraftState(): Promise<DraftState> {\n  await ensureSchema();\n  await autoPickExpiredDraft();',
  "async function recoverStalledAnimation(): Promise<void> {\n  const draft = await activeDraftRow();\n  if (!draft || String(draft.status) !== 'PAUSED' || !draft.pause_started_at) return;\n  const elapsed = Date.now() - new Date(String(draft.pause_started_at)).getTime();\n  const reason = String(draft.pause_reason || '');\n  if (reason === 'pick_animation' && elapsed >= 90000) await finishPickAnimation();\n  else if (reason === 'trade_animation' && elapsed >= 90000) await finishTradeAnimation(String(draft.id));\n  else if (reason === 'end_draft_animation' && elapsed >= 120000) await finishEndDraftAnimation();\n}\n\nexport async function getDraftState(): Promise<DraftState> {\n  await ensureSchema();\n  await recoverStalledAnimation();\n  await autoPickExpiredDraft();",
  'stalled animation recovery',
);
draftStore = replaceRequired(
  draftStore,
  "  const settings = rowsOf<Row>(await sql`SELECT * FROM draft_settings WHERE id = 1 LIMIT 1`)[0];\n  if (!settings) {",
  "  const settings = rowsOf<Row>(await sql`SELECT * FROM draft_settings WHERE id = 1 LIMIT 1`)[0];\n  const allDraftRows = rowsOf<Row>(await sql`SELECT * FROM drafts ORDER BY created_at DESC`);\n  if (!settings) {",
  'draft management state query',
);
draftStore = replaceRequired(
  draftStore,
  '    autoPickEnabled: settings.auto_pick_enabled !== false,\n  };',
  "    autoPickEnabled: settings.auto_pick_enabled !== false,\n    activeDraftId: settings.active_draft_id ? String(settings.active_draft_id) : null,\n    drafts: allDraftRows.map(mapDraft),\n  };",
  'draft management state values',
);
await save('src/lib/store/draft.ts', draftStore);

let moderation = await text('src/lib/store/moderation.ts');
moderation = moderation.replaceAll(
  "status = 'PAUSED', pause_reason = 'trade_animation',\n        paused_remaining_seconds",
  "status = 'PAUSED', pause_reason = 'trade_animation', pause_started_at = now(),\n        paused_remaining_seconds",
);
moderation = moderation.replaceAll(
  "UPDATE drafts SET status = 'LIVE', pause_reason = NULL,\n        deadline_ts",
  "UPDATE drafts SET status = 'LIVE', pause_reason = NULL, pause_started_at = NULL,\n        deadline_ts",
);
moderation = moderation.replaceAll(
  "paused_remaining_seconds = NULL, pause_reason = NULL, started_at = NULL, completed_at = NULL",
  "paused_remaining_seconds = NULL, pause_reason = NULL, pause_started_at = NULL, started_at = NULL, completed_at = NULL",
);
await save('src/lib/store/moderation.ts', moderation);

let homepage = await text('src/app/page.tsx');
homepage = replaceRequired(
  homepage,
  "  if (message === 'admin_code_required') return 'Create a commissioner access code.';",
  "  if (message === 'admin_code_required') return 'Create a commissioner access code.';\n  if (message === 'invalid_setup_key') return 'Enter the deployment setup key configured in Vercel as SETUP_SECRET.';",
  'setup key error copy',
);
homepage = replaceRequired(homepage, "    adminCode: '',", "    adminCode: '',\n    setupKey: '',", 'setup key state');
homepage = replaceRequired(
  homepage,
  '  const setupReady = Boolean(setup.leagueName.trim() && setup.adminCode.trim() && teamStatus.ready && orderReady);',
  '  const setupReady = Boolean(setup.leagueName.trim() && setup.adminCode.trim() && setup.setupKey.trim() && teamStatus.ready && orderReady);',
  'setup key readiness',
);
homepage = replaceRequired(
  homepage,
  '<label>Commissioner access code<input type="password" value={setup.adminCode} onChange={(event) => setSetup({ ...setup, adminCode: event.target.value })} autoComplete="new-password" required /></label>',
  '<label>Commissioner access code<input type="password" value={setup.adminCode} onChange={(event) => setSetup({ ...setup, adminCode: event.target.value })} autoComplete="new-password" required /></label>\n               <label>Deployment setup key<input type="password" value={setup.setupKey} onChange={(event) => setSetup({ ...setup, setupKey: event.target.value })} autoComplete="off" required /><small>Matches SETUP_SECRET in the deployment environment.</small></label>',
  'setup key field',
);
await save('src/app/page.tsx', homepage);

let admin = await text('src/lib/store/admin.ts');
admin = replaceRequired(
  admin,
  "import { approveTrade, finishTradeAnimation, rejectTrade, resetTrades } from './moderation';",
  "import { approveTrade, finishTradeAnimation, rejectTrade, resetDraftState, resetTrades } from './moderation';",
  'transactional reset import',
);
admin = replaceRequired(
  admin,
  "    await createDraft(String(body.name || `Draft ${new Date().getFullYear()}`));",
  "    await createDraft(String(body.name || `Draft ${new Date().getFullYear()}`), { activate: body.activate === true });",
  'inactive future draft creation',
);
admin = replaceRequired(
  admin,
  "  if (normalizedAction === 'update_branding') {",
  "  if (normalizedAction === 'activate_draft') {\n    if (String(draft?.status || '') === 'LIVE') throw new Error('pause_current_draft_first');\n    if (draft && await getPendingPick(String(draft.id))) throw new Error('resolve_pending_pick_first');\n    const animation = draft ? rowsOf<Row>(await sql`SELECT id FROM draft_trades WHERE draft_id = ${String(draft.id)} AND animation_pending = true LIMIT 1`)[0] : null;\n    if (animation || ['pick_animation','trade_animation','end_draft_animation'].includes(String(draft?.pause_reason || ''))) throw new Error('finish_current_animation_first');\n    const targetId = String(body.draftId || '');\n    const target = rowsOf<Row>(await sql`SELECT id, status FROM drafts WHERE id = ${targetId} LIMIT 1`)[0];\n    if (!target) throw new Error('draft_not_found');\n    if (String(target.status) === 'COMPLETED') throw new Error('completed_draft_is_archive_only');\n    await sql`UPDATE draft_settings SET active_draft_id = ${targetId}, updated_at = now() WHERE id = 1`;\n    return;\n  }\n  if (normalizedAction === 'update_branding') {",
  'explicit active draft action',
);
admin = replaceRequired(
  admin,
  '          admin_code_hash = ${hashCode(adminCode)}, primary_color = ${primaryColor}, secondary_color = ${secondaryColor},',
  '          admin_code_hash = ${hashCode(adminCode)}, auth_version = auth_version + 1, primary_color = ${primaryColor}, secondary_color = ${secondaryColor},',
  'commissioner session revocation',
);
admin = replaceRequired(
  admin,
  '        login_code_hash = COALESCE(incoming.login_code_hash, team.login_code_hash),\n        sort_order = incoming.sort_order',
  '        login_code_hash = COALESCE(incoming.login_code_hash, team.login_code_hash),\n        auth_version = CASE WHEN incoming.login_code_hash IS NULL THEN team.auth_version ELSE team.auth_version + 1 END,\n        sort_order = incoming.sort_order',
  'team session revocation',
);
admin = replaceRequired(
  admin,
  "  if (normalizedAction === 'delete') {\n    await sql`DELETE FROM drafts WHERE id = ${draftId}`;\n    return;\n  }",
  "  if (normalizedAction === 'delete') {\n    await sql`DELETE FROM drafts WHERE id = ${draftId}`;\n    await sql`\n      UPDATE draft_settings SET active_draft_id = (SELECT id FROM drafts ORDER BY created_at DESC LIMIT 1), updated_at = now()\n      WHERE id = 1\n    `;\n    return;\n  }",
  'active draft deletion fallback',
);
const resetStart = admin.indexOf("  if (normalizedAction === 'reset') {");
const undoStart = admin.indexOf("  if (normalizedAction === 'undo') {", resetStart);
if (resetStart < 0 || undoStart < 0) throw new Error('[security-reliability] Could not replace full reset action.');
admin = `${admin.slice(0, resetStart)}  if (normalizedAction === 'reset') {\n    await resetDraftState(draftId);\n    return;\n  }\n${admin.slice(undoStart)}`;
await save('src/lib/store/admin.ts', admin);

let draftRoute = await text('src/app/api/draft/route.ts');
draftRoute = replaceRequired(
  draftRoute,
  "      'reset_trades','repair_state','update_setup',",
  "      'reset_trades','repair_state','update_setup','activate_draft',",
  'active draft API action',
);
await save('src/app/api/draft/route.ts', draftRoute);

let commissioner = await text('src/app/commissioner/page.tsx');
commissioner = replaceRequired(
  commissioner,
  '<p className="muted">The current draft remains in Archives. Team settings, the 28-round format, player pool, and selected linear or snake base order carry forward.</p>',
  '<p className="muted">New drafts are created inactive, so a rehearsal or future draft cannot replace the live draft until you deliberately activate it.</p>',
  'inactive draft creation copy',
);
commissioner = replaceRequired(
  commissioner,
  '<button className="button primary" disabled={working} onClick={() => action(\'create\', { name: newDraftName || `Draft ${new Date().getFullYear() + 1}` })}>Create next draft</button>',
  '<button className="button primary" disabled={working} onClick={() => action(\'create\', { name: newDraftName || `Draft ${new Date().getFullYear() + 1}`, activate: false })}>Create inactive draft</button>\n          <div className="draft-management-list">\n            {(state.drafts || []).map((draftItem) => {\n              const active = draftItem.id === state.activeDraftId;\n              return <div className="draft-management-row" key={draftItem.id}><div><strong>{draftItem.name}</strong><span>{draftItem.status.replaceAll(\'_\', \' \')} · {draftItem.id.slice(0, 8)}</span></div>{active ? <span className="status-pill">ACTIVE</span> : draftItem.status === \'COMPLETED\' ? <a className="button" href="/archives">Archived</a> : <button className="button" disabled={working || state.draft?.status === \'LIVE\'} onClick={() => action(\'activate_draft\', { draftId: draftItem.id })}>Make active</button>}</div>;\n            })}\n          </div>',
  'draft management controls',
);
await save('src/app/commissioner/page.tsx', commissioner);

let enhancements = await text('src/app/admin-enhancements.css');
if (!enhancements.includes('.draft-management-list')) enhancements += `
.draft-management-list { display:grid; gap:8px; margin-top:14px; }
.draft-management-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:#080e1a; }
.draft-management-row > div { display:grid; gap:3px; min-width:0; }
.draft-management-row strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.draft-management-row span:not(.status-pill) { color:var(--muted); font-size:.72rem; }
`;
await save('src/app/admin-enhancements.css', enhancements);

const required = [
  ['src/lib/auth.ts', 'authVersion'],
  ['src/lib/auth-server.ts', 'draft_login_attempts'],
  ['src/app/api/state/route.ts', 'pendingTrades: []'],
  ['src/app/api/draft/route.ts', "identity.sessionRole !== 'admin'"],
  ['src/app/api/draft/trade/route.ts', 'from_team_id'],
  ['src/lib/store/moderation.ts', "sql.transaction(operations, { isolationLevel: 'Serializable' })"],
  ['src/lib/store/moderation.ts', 'resetDraftState'],
  ['src/lib/store/admin.ts', 'auth_version = auth_version + 1'],
  ['src/lib/store/admin.ts', "normalizedAction === 'activate_draft'"],
  ['src/lib/store/draft.ts', 'recoverStalledAnimation'],
  ['src/lib/store/shared.ts', 'settings.active_draft_id'],
  ['src/app/commissioner/page.tsx', 'Create inactive draft'],
  ['src/app/page.tsx', 'Deployment setup key'],
];
for (const [path, marker] of required) {
  const source = await text(path);
  if (!source.includes(marker)) throw new Error(`[security-reliability] ${path} is missing ${marker}`);
}
console.log('[security-reliability] Pending data is protected, transitions are commissioner-controlled, trades/resets are transactional, draft activation is explicit, stalled animations recover, setup is keyed, and sessions are rate-limited and revocable.');
