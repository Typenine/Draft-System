import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function text(path) { return readFile(resolve(process.cwd(), path), 'utf8'); }
async function save(path, content) { await writeFile(resolve(process.cwd(), path), content, 'utf8'); }
function replaceRequired(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(search)) throw new Error(`[active-draft-recovery] Could not patch ${label}.`);
  return source.replace(search, replacement);
}
function replaceRegexRequired(source, pattern, replacement, label) {
  if (source.includes(replacement)) return source;
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`[active-draft-recovery] Could not patch ${label}.`);
  return next;
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
shared = replaceRegexRequired(
  shared,
  /export async function activeDraftRow\(\): Promise<Row \| null> \{[\s\S]*?\n\}/,
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
  "  return draftId;\n}\n\nexport async function advanceDraft",
  "  if (options.activate) {\n    await sql`UPDATE draft_settings SET active_draft_id = ${draftId}, updated_at = now() WHERE id = 1`;\n  } else {\n    await sql`UPDATE draft_settings SET active_draft_id = COALESCE(active_draft_id, ${draftId}), updated_at = now() WHERE id = 1`;\n  }\n  return draftId;\n}\n\nexport async function advanceDraft",
  'draft activation persistence',
);
draftStore = replaceRegexRequired(
  draftStore,
  /pause_reason = 'pending_pick',\s*\n\s*paused_remaining_seconds/,
  "pause_reason = 'pending_pick', pause_started_at = now(),\n      paused_remaining_seconds",
  'pending pick pause timestamp',
);
draftStore = draftStore.replaceAll(
  "pause_reason = 'pick_animation', deadline_ts = NULL,\n      paused_remaining_seconds = clock_seconds, completed_at = NULL",
  "pause_reason = 'pick_animation', pause_started_at = now(), deadline_ts = NULL,\n      paused_remaining_seconds = clock_seconds, completed_at = NULL",
);
draftStore = draftStore.replaceAll(
  "status = 'PAUSED', pause_reason = 'end_draft_animation', deadline_ts = NULL,",
  "status = 'PAUSED', pause_reason = 'end_draft_animation', pause_started_at = now(), deadline_ts = NULL,",
);
draftStore = draftStore.replaceAll(
  "status = 'PAUSED', pause_reason = 'round_end',\n        deadline_ts = NULL",
  "status = 'PAUSED', pause_reason = 'round_end', pause_started_at = now(),\n        deadline_ts = NULL",
);
draftStore = draftStore.replaceAll(
  "pause_reason = 'clock_expired', deadline_ts = NULL,",
  "pause_reason = 'clock_expired', pause_started_at = now(), deadline_ts = NULL,",
);
draftStore = draftStore.replaceAll('pause_reason = NULL,', 'pause_reason = NULL, pause_started_at = NULL,');
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
moderation = moderation.replaceAll('pause_reason = NULL,', 'pause_reason = NULL, pause_started_at = NULL,');
await save('src/lib/store/moderation.ts', moderation);

let admin = await text('src/lib/store/admin.ts');
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
  "  if (normalizedAction === 'delete') {\n    await sql`DELETE FROM drafts WHERE id = ${draftId}`;\n    return;\n  }",
  "  if (normalizedAction === 'delete') {\n    await sql`DELETE FROM drafts WHERE id = ${draftId}`;\n    await sql`UPDATE draft_settings SET active_draft_id = (SELECT id FROM drafts ORDER BY created_at DESC LIMIT 1), updated_at = now() WHERE id = 1`;\n    return;\n  }",
  'active draft deletion fallback',
);
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
  ['src/lib/db.ts', 'active_draft_id uuid'],
  ['src/lib/db.ts', 'pause_started_at timestamptz'],
  ['src/lib/store/shared.ts', 'settings.active_draft_id'],
  ['src/lib/store/draft.ts', 'recoverStalledAnimation'],
  ['src/lib/store/draft.ts', 'drafts: allDraftRows.map(mapDraft)'],
  ['src/lib/store/admin.ts', "normalizedAction === 'activate_draft'"],
  ['src/app/commissioner/page.tsx', 'Create inactive draft'],
];
for (const [path, marker] of required) {
  const source = await text(path);
  if (!source.includes(marker)) throw new Error(`[active-draft-recovery] ${path} is missing ${marker}`);
}
console.log('[active-draft-recovery] Draft activation is explicit and abandoned pick, trade, and final animations recover automatically.');
