import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function text(path) { return readFile(resolve(process.cwd(), path), 'utf8'); }
async function save(path, content) { await writeFile(resolve(process.cwd(), path), content, 'utf8'); }
function replaceRequired(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(search)) throw new Error(`[full-reset-safety] Could not patch ${label}.`);
  return source.replace(search, replacement);
}

let moderation = await text('src/lib/store/moderation.ts');
moderation = replaceRequired(
  moderation,
  'function requiredPlayerUpdate(sql: ReturnType<typeof getSql>, draftId: string, playerId: string, fromTeamId: string, toTeamId: string) {',
  "function requiredCurrentPickReversal(sql: ReturnType<typeof getSql>, draftId: string, overall: number, currentTeamId: string, originalTeamId: string) {\n  return sql`\n    WITH changed AS (\n      UPDATE draft_slots SET team_id = ${originalTeamId}\n      WHERE draft_id = ${draftId} AND overall = ${overall} AND team_id = ${currentTeamId}\n      RETURNING 1\n    )\n    SELECT 1 / COUNT(*)::int AS applied FROM changed\n  `;\n}\n\nfunction requiredPlayerUpdate(sql: ReturnType<typeof getSql>, draftId: string, playerId: string, fromTeamId: string, toTeamId: string) {",
  'used-pick reversal helper',
);
moderation = replaceRequired(
  moderation,
  'async function tradeReversalOperations(draftId: string) {',
  'async function tradeReversalOperations(draftId: string, fullDraftReset = false) {',
  'full reset mode',
);
const reversalStart = moderation.indexOf('async function tradeReversalOperations');
const reversalEnd = moderation.indexOf('\nexport async function resetTrades', reversalStart);
if (reversalStart < 0 || reversalEnd < 0) throw new Error('[full-reset-safety] Trade reversal section was not found.');
let reversal = moderation.slice(reversalStart, reversalEnd);
reversal = replaceRequired(
  reversal,
  'operations.push(requiredCurrentPickUpdate(sql, draftId, overall, toTeamId, fromTeamId));',
  'operations.push(fullDraftReset\n          ? requiredCurrentPickReversal(sql, draftId, overall, toTeamId, fromTeamId)\n          : requiredCurrentPickUpdate(sql, draftId, overall, toTeamId, fromTeamId));',
  'current pick reversal mode',
);
reversal = replaceRequired(
  reversal,
  'operations.push(requiredPlayerUpdate(sql, draftId, playerId, toTeamId, fromTeamId));',
  'if (!fullDraftReset) operations.push(requiredPlayerUpdate(sql, draftId, playerId, toTeamId, fromTeamId));',
  'full reset roster handling',
);
moderation = moderation.slice(0, reversalStart) + reversal + moderation.slice(reversalEnd);
moderation = replaceRequired(
  moderation,
  '  const operations = await tradeReversalOperations(draftId);\n  operations.push(sql`DELETE FROM draft_trades WHERE draft_id = ${draftId}`);',
  '  const operations = await tradeReversalOperations(draftId, true);\n  operations.push(sql`DELETE FROM draft_trades WHERE draft_id = ${draftId}`);',
  'full draft reset transaction',
);
await save('src/lib/store/moderation.ts', moderation);

if (!moderation.includes('requiredCurrentPickReversal') || !moderation.includes('tradeReversalOperations(draftId, true)')) {
  throw new Error('[full-reset-safety] Full reset protections were not materialized.');
}
console.log('[full-reset-safety] Full reset restores used traded picks transactionally; trade-only reset remains conservative.');
