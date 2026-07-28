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
  if (!source.includes(search)) throw new Error(`[completion-archive] Could not patch ${label}.`);
  return source.replace(search, replacement);
}

await save('src/lib/store/archive.ts', await text('scripts/runtime-adapters/archive-store.ts.txt'));
await save('src/components/draft-overlay/EndOfDraftAnimation.tsx', await text('scripts/runtime-adapters/end-of-draft-animation.tsx.txt'));
await save('src/app/archives/page.tsx', await text('scripts/runtime-adapters/archives-page.tsx.txt'));
await save('src/app/api/archives/[draftId]/export/route.ts', await text('scripts/runtime-adapters/archive-export-route.ts.txt'));

let db = await text('src/lib/db.ts');
db = replaceRequired(
  db,
  "      await sql`\n        INSERT INTO draft_roster_ownership",
  "      await sql`\n        CREATE TABLE IF NOT EXISTS draft_archives (\n          draft_id text PRIMARY KEY,\n          draft_name text NOT NULL,\n          snapshot jsonb NOT NULL,\n          created_at timestamptz NOT NULL,\n          completed_at timestamptz,\n          archived_at timestamptz NOT NULL DEFAULT now()\n        )\n      `;\n      await sql`CREATE INDEX IF NOT EXISTS draft_archives_completed_idx ON draft_archives (completed_at DESC, archived_at DESC)`;\n      await sql`\n        INSERT INTO draft_roster_ownership",
  'archive schema',
);
await save('src/lib/db.ts', db);

let types = await text('src/lib/types.ts');
types = replaceRequired(
  types,
  "export type ArchiveDraft = DraftSummary & {\n  picks: DraftPick[];\n  slots: DraftSlot[];\n};",
  "export type ArchiveRosterEntry = {\n  playerId: string;\n  ownerTeamId: string;\n  playerName: string;\n  playerPosition: string;\n  playerProTeam: string | null;\n  acquiredAt: string;\n};\n\nexport type ArchiveFuturePick = {\n  id: string;\n  pickYear: number;\n  pickRound: number;\n  originalTeamId: string;\n  ownerTeamId: string;\n};\n\nexport type ArchivePickReview = {\n  id: string;\n  overall: number;\n  teamId: string;\n  playerId: string;\n  playerName: string;\n  status: string;\n  submittedAt: string;\n  reviewedAt: string | null;\n};\n\nexport type ArchiveDraft = DraftSummary & {\n  archiveVersion: number;\n  archivedAt: string;\n  leagueName: string;\n  branding: Branding;\n  settings: DraftSettings;\n  teams: Team[];\n  picks: DraftPick[];\n  slots: DraftSlot[];\n  trades: ModerationTrade[];\n  roster: ArchiveRosterEntry[];\n  futurePicks: ArchiveFuturePick[];\n  pickReviews: ArchivePickReview[];\n};",
  'archive types',
);
await save('src/lib/types.ts', types);

let index = await text('src/lib/store/index.ts');
if (!index.includes("export * from './archive';")) index += "\nexport * from './archive';\n";
await save('src/lib/store/index.ts', index);

let draft = await text('src/lib/store/draft.ts');
draft = replaceRequired(
  draft,
  "import { listModerationTrades } from './moderation';",
  "import { listModerationTrades } from './moderation';\nimport { archiveCompletedDraft, listArchiveSnapshots } from './archive';",
  'draft archive imports',
);
draft = replaceRequired(
  draft,
  "    await sql`\n      UPDATE drafts SET status = 'COMPLETED', completed_at = now(), deadline_ts = NULL,\n        paused_remaining_seconds = NULL, pause_reason = NULL WHERE id = ${draftId}\n    `;\n    return;",
  "    await sql`\n      UPDATE drafts SET status = 'COMPLETED', completed_at = now(), deadline_ts = NULL,\n        paused_remaining_seconds = NULL, pause_reason = NULL WHERE id = ${draftId}\n    `;\n    await archiveCompletedDraft(draftId);\n    return;",
  'skipped-draft archive completion',
);
draft = replaceRequired(
  draft,
  "  const draft = rowsOf<Row>(await sql`SELECT status, clock_seconds FROM drafts WHERE id = ${draftId} LIMIT 1`)[0];\n  const pick = inserted[0];\n  const overall = int(pick.overall);\n  await sql`DELETE FROM draft_queues WHERE draft_id = ${draftId} AND player_id = ${playerId}`;\n  await sql`\n    INSERT INTO draft_roster_ownership\n      (draft_id, player_id, owner_team_id, player_name, player_position, player_pro_team)\n    VALUES (${draftId}, ${String(pick.player_id)}, ${teamId}, ${String(pick.player_name)}, ${String(pick.player_position)},\n      ${pick.player_pro_team ? String(pick.player_pro_team) : null})\n    ON CONFLICT (draft_id, player_id) DO UPDATE SET owner_team_id = EXCLUDED.owner_team_id,\n      player_name = EXCLUDED.player_name, player_position = EXCLUDED.player_position,\n      player_pro_team = EXCLUDED.player_pro_team, acquired_at = now()\n  `;\n  await advanceDraft(draftId, overall, String(draft.status), int(draft.clock_seconds, 120));\n  const after = rowsOf<Row>(await sql`SELECT status FROM drafts WHERE id = ${draftId} LIMIT 1`)[0];\n  if (after && String(after.status) !== 'COMPLETED') {\n    await sql`\n      UPDATE drafts SET status = 'PAUSED', pause_reason = 'pick_animation', deadline_ts = NULL,\n        paused_remaining_seconds = clock_seconds\n      WHERE id = ${draftId}\n    `;\n  }\n  return true;",
  "  const pick = inserted[0];\n  await sql`DELETE FROM draft_queues WHERE draft_id = ${draftId} AND player_id = ${playerId}`;\n  await sql`\n    INSERT INTO draft_roster_ownership\n      (draft_id, player_id, owner_team_id, player_name, player_position, player_pro_team)\n    VALUES (${draftId}, ${String(pick.player_id)}, ${teamId}, ${String(pick.player_name)}, ${String(pick.player_position)},\n      ${pick.player_pro_team ? String(pick.player_pro_team) : null})\n    ON CONFLICT (draft_id, player_id) DO UPDATE SET owner_team_id = EXCLUDED.owner_team_id,\n      player_name = EXCLUDED.player_name, player_position = EXCLUDED.player_position,\n      player_pro_team = EXCLUDED.player_pro_team, acquired_at = now()\n  `;\n  await sql`\n    UPDATE drafts SET status = 'PAUSED', pause_reason = 'pick_animation', deadline_ts = NULL,\n      paused_remaining_seconds = clock_seconds, completed_at = NULL\n    WHERE id = ${draftId}\n  `;\n  return true;",
  'pick-before-advance animation sequence',
);
draft = replaceRequired(
  draft,
  "export async function finishPickAnimation(): Promise<void> {\n  await ensureSchema();\n  const sql = getSql();\n  const draft = await activeDraftRow();\n  if (!draft) return;\n  await sql`\n    UPDATE drafts SET status = 'LIVE', started_at = COALESCE(started_at, now()), pause_reason = NULL,\n      deadline_ts = now() + (clock_seconds * interval '1 second'), paused_remaining_seconds = NULL\n    WHERE id = ${String(draft.id)} AND status = 'PAUSED' AND pause_reason = 'pick_animation'\n  `;\n}",
  "export async function finishPickAnimation(): Promise<void> {\n  await ensureSchema();\n  const sql = getSql();\n  const draft = await activeDraftRow();\n  if (!draft || String(draft.status) !== 'PAUSED' || String(draft.pause_reason) !== 'pick_animation') return;\n  const draftId = String(draft.id);\n  const currentOverall = int(draft.current_overall, 1);\n  const picked = rowsOf<Row>(await sql`SELECT round FROM draft_picks WHERE draft_id = ${draftId} AND overall = ${currentOverall} LIMIT 1`)[0];\n  if (!picked) return;\n  const next = rowsOf<Row>(await sql`\n    SELECT slot.overall, slot.round FROM draft_slots slot\n    WHERE slot.draft_id = ${draftId} AND slot.overall > ${currentOverall}\n      AND NOT EXISTS (SELECT 1 FROM draft_picks pick WHERE pick.draft_id = slot.draft_id AND pick.overall = slot.overall)\n    ORDER BY slot.overall LIMIT 1\n  `)[0];\n  if (!next) {\n    await sql`\n      UPDATE drafts SET status = 'PAUSED', pause_reason = 'end_draft_animation', deadline_ts = NULL,\n        paused_remaining_seconds = NULL WHERE id = ${draftId}\n    `;\n    return;\n  }\n  const nextOverall = int(next.overall);\n  const roundEnded = int(next.round) > int(picked.round);\n  if (roundEnded) {\n    await sql`\n      UPDATE drafts SET current_overall = ${nextOverall}, status = 'PAUSED', pause_reason = 'round_end',\n        deadline_ts = NULL, paused_remaining_seconds = clock_seconds WHERE id = ${draftId}\n    `;\n    return;\n  }\n  await sql`\n    UPDATE drafts SET current_overall = ${nextOverall}, status = 'LIVE', started_at = COALESCE(started_at, now()),\n      pause_reason = NULL, deadline_ts = now() + (clock_seconds * interval '1 second'), paused_remaining_seconds = NULL\n    WHERE id = ${draftId}\n  `;\n}\n\nexport async function finishEndDraftAnimation(): Promise<void> {\n  await ensureSchema();\n  const sql = getSql();\n  const draft = await activeDraftRow();\n  if (!draft) return;\n  const draftId = String(draft.id);\n  if (String(draft.status) !== 'COMPLETED') {\n    await sql`\n      UPDATE drafts SET status = 'COMPLETED', completed_at = COALESCE(completed_at, now()), deadline_ts = NULL,\n        paused_remaining_seconds = NULL, pause_reason = NULL WHERE id = ${draftId}\n          AND status = 'PAUSED' AND pause_reason = 'end_draft_animation'\n    `;\n  }\n  const completed = rowsOf<Row>(await sql`SELECT status FROM drafts WHERE id = ${draftId} LIMIT 1`)[0];\n  if (completed && String(completed.status) === 'COMPLETED') await archiveCompletedDraft(draftId);\n}",
  'final pick and end-draft transition',
);
draft = replaceRequired(
  draft,
  "export async function listArchives(): Promise<ArchiveDraft[]> {\n  await ensureSchema();\n  const sql = getSql();\n  const drafts = rowsOf<Row>(await sql`SELECT * FROM drafts ORDER BY created_at DESC`);\n  const archives: ArchiveDraft[] = [];\n  for (const row of drafts) {\n    const draft = mapDraft(row);\n    const pieces = await loadDraftPieces(draft.id);\n    archives.push({ ...draft, ...pieces });\n  }\n  return archives;\n}",
  "export async function listArchives(): Promise<ArchiveDraft[]> {\n  return listArchiveSnapshots();\n}",
  'immutable archive listing',
);
await save('src/lib/store/draft.ts', draft);

let admin = await text('src/lib/store/admin.ts');
admin = replaceRequired(admin, '  finishPickAnimation,', '  finishEndDraftAnimation,\n  finishPickAnimation,', 'admin completion import');
admin = replaceRequired(admin, "import { approveTrade, finishTradeAnimation, rejectTrade, resetTrades } from './moderation';", "import { approveTrade, finishTradeAnimation, rejectTrade, resetTrades } from './moderation';\nimport { removeArchiveSnapshot } from './archive';", 'admin archive import');
admin = replaceRequired(
  admin,
  "  if (normalizedAction === 'finish_pick_animation') {\n    await finishPickAnimation();\n    return;\n  }",
  "  if (normalizedAction === 'finish_pick_animation') {\n    await finishPickAnimation();\n    return;\n  }\n  if (normalizedAction === 'finish_end_draft_animation') {\n    await finishEndDraftAnimation();\n    return;\n  }",
  'admin end draft action',
);
admin = admin.replace('    await resetTrades(draftId);\n    await sql`\n      UPDATE drafts SET status = \'NOT_STARTED\'', '    await resetTrades(draftId);\n    await removeArchiveSnapshot(draftId);\n    await sql`\n      UPDATE drafts SET status = \'NOT_STARTED\'');
admin = admin.replace('    await sql`DELETE FROM draft_roster_ownership WHERE draft_id = ${draftId} AND player_id = ${String(last.player_id)}`;', '    await removeArchiveSnapshot(draftId);\n    await sql`DELETE FROM draft_roster_ownership WHERE draft_id = ${draftId} AND player_id = ${String(last.player_id)}`;');
await save('src/lib/store/admin.ts', admin);

let route = await text('src/app/api/draft/route.ts');
route = replaceRequired(
  route,
  "    if (action === 'trade_anim_complete') {\n      await runAdminAction('finish_trade_animation', body);\n      return noStore({ ok: true });\n    }",
  "    if (action === 'trade_anim_complete') {\n      await runAdminAction('finish_trade_animation', body);\n      return noStore({ ok: true });\n    }\n    if (action === 'end_draft_anim_complete') {\n      await runAdminAction('finish_end_draft_animation', body);\n      return noStore({ ok: true });\n    }",
  'end draft API action',
);
await save('src/app/api/draft/route.ts', route);

let compat = await text('src/lib/draft-compat.ts');
compat = replaceRequired(
  compat,
  "  const roundEndPause = Boolean(\n    draft.status === 'PAUSED' && draft.pauseReason === 'pick_animation' && lastPick && currentSlot && lastPick.round < currentSlot.round,\n  );\n  const onClockTeam = draft.pauseReason === 'pick_animation' ? null : state.currentTeam?.name || currentSlot?.team || null;",
  "  const roundEndPause = Boolean(draft.status === 'PAUSED' && draft.pauseReason === 'round_end');\n  const endDraftPause = Boolean(draft.status === 'PAUSED' && draft.pauseReason === 'end_draft_animation');\n  const onClockTeam = draft.pauseReason === 'pick_animation' || draft.pauseReason === 'end_draft_animation'\n    ? null\n    : state.currentTeam?.name || currentSlot?.team || null;",
  'legacy completion flags',
);
compat = replaceRequired(compat, '    roundEndPause,\n    pendingTradeAnimation:', '    roundEndPause,\n    endDraftPause,\n    pendingTradeAnimation:', 'legacy end draft flag');
await save('src/lib/draft-compat.ts', compat);

let dataHook = await text('src/components/draft-overlay/useDraftData.ts');
dataHook = dataHook.replaceAll('  roundEndPause?: boolean | null;\n', '  roundEndPause?: boolean | null;\n  endDraftPause?: boolean | null;\n');
await save('src/components/draft-overlay/useDraftData.ts', dataHook);

let overlay = await text('src/components/draft-overlay/DraftOverlayLive.tsx');
overlay = replaceRequired(overlay, "import StartOfRoundAnimation from './StartOfRoundAnimation';", "import StartOfRoundAnimation from './StartOfRoundAnimation';\nimport EndOfDraftAnimation from './EndOfDraftAnimation';", 'end draft animation import');
overlay = replaceRequired(
  overlay,
  "  const [startOfRoundAnimRound, setStartOfRoundAnimRound] = useState<number | null>(null);",
  "  const [startOfRoundAnimRound, setStartOfRoundAnimRound] = useState<number | null>(null);\n  const [endOfDraftAnimActive, setEndOfDraftAnimActive] = useState(false);\n  const endOfDraftSeenRef = useRef<string | null>(null);",
  'end draft animation state',
);
overlay = replaceRequired(
  overlay,
  "  const showRoundRecap = draft?.roundEndPause === true && animPhase === null && !tradeAnimData && endOfRoundAnimRound === null && startOfRoundAnimRound === null;",
  "  const showRoundRecap = draft?.roundEndPause === true && animPhase === null && !tradeAnimData && endOfRoundAnimRound === null && startOfRoundAnimRound === null;\n\n  useEffect(() => {\n    if (!draft?.endDraftPause || animPhase !== null || tradeAnimData || endOfRoundAnimRound !== null || startOfRoundAnimRound !== null) return;\n    const key = `${draft.id}:${draft.allPicks?.length || 0}`;\n    if (endOfDraftSeenRef.current === key) return;\n    endOfDraftSeenRef.current = key;\n    setEndOfDraftAnimActive(true);\n  }, [draft?.endDraftPause, draft?.id, draft?.allPicks?.length, animPhase, tradeAnimData, endOfRoundAnimRound, startOfRoundAnimRound]);",
  'end draft animation trigger',
);
overlay = replaceRequired(
  overlay,
  "      {/* PHASE: Trade animation (full-screen, independent of pick pipeline) */}",
  "      {/* PHASE: End-of-draft animation — final pick completes before this begins */}\n      {endOfDraftAnimActive && draft && (\n        <EndOfDraftAnimation\n          key={`draft-complete-${draft.id}`}\n          eventName={draft.eventName}\n          eventYear={draft.year}\n          eventLogoUrl={eventLogoUrl}\n          eventColor1={eventColor1}\n          totalPicks={draft.allPicks?.length || 0}\n          totalRounds={draft.rounds}\n          onComplete={() => {\n            setEndOfDraftAnimActive(false);\n            fetch('/api/draft', {\n              method: 'POST',\n              headers: { 'content-type': 'application/json' },\n              body: JSON.stringify({ action: 'end_draft_anim_complete' }),\n            }).then(() => refetch()).catch(() => {});\n          }}\n        />\n      )}\n\n      {/* PHASE: Trade animation (full-screen, independent of pick pipeline) */}",
  'end draft animation render',
);
await save('src/components/draft-overlay/DraftOverlayLive.tsx', overlay);

let css = await text('src/app/admin-enhancements.css');
if (!css.includes('.archive-summary-grid')) css += `\n.archive-export-actions { margin: 0 0 16px; flex-wrap: wrap; }\n.archive-summary-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin:0 0 18px; }\n.archive-summary-grid > div { display:grid; gap:4px; padding:12px; border:1px solid var(--border); border-radius:12px; background:rgba(255,255,255,.025); }\n.archive-summary-grid small { color:var(--muted); text-transform:uppercase; letter-spacing:.06em; font-size:.66rem; font-weight:800; }\n.archive-summary-grid strong { font-size:.9rem; }\n@media (max-width:800px){ .archive-summary-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }\n`;
await save('src/app/admin-enhancements.css', css);

const required = [
  ['src/lib/db.ts', db, 'CREATE TABLE IF NOT EXISTS draft_archives'],
  ['src/lib/store/draft.ts', draft, "pause_reason = 'end_draft_animation'"],
  ['src/lib/store/draft.ts', draft, 'finishEndDraftAnimation'],
  ['src/lib/store/archive.ts', await text('src/lib/store/archive.ts'), 'archiveCompletedDraft'],
  ['src/app/archives/page.tsx', await text('src/app/archives/page.tsx'), 'Export results CSV'],
  ['src/app/api/archives/[draftId]/export/route.ts', await text('src/app/api/archives/[draftId]/export/route.ts'), 'full-archive.json'],
  ['src/components/draft-overlay/DraftOverlayLive.tsx', overlay, 'EndOfDraftAnimation'],
  ['src/lib/draft-compat.ts', compat, 'endDraftPause'],
];
for (const [path, source, marker] of required) if (!source.includes(marker)) throw new Error(`[completion-archive] ${path} is missing ${marker}`);
console.log('[completion-archive] Final pick animation, end-of-draft animation, immutable archive snapshots, and CSV/JSON exports are materialized.');
