import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const targets = [
  ['src/app/api/draft/route.ts', ['pendingPick', 'pendingTradeAnimation', 'eventLogoUrl', 'handleDraftPost']],
  ['src/server/draft-api-v149/post.ts', ['case "pick"', "case 'pick'", 'insertPendingPickAtomic', 'force_add', 'queue_set']],
  ['src/server/draft-api-v149/admin.ts', ['approve_pick', 'reject_pick', 'pendingPicks', 'pendingTrades', 'approve_trade']],
  ['src/app/api/draft/trade/route.ts', ["action === 'accept'", "action === 'approve'", 'pendingTradeAnimation', 'setDraftPendingTradeAnimation']],
  ['src/server/db/queries.fixed.ts', ['ensureDraftPendingPicksTable', 'insertPendingPickAtomic', 'listPendingPicks', 'ensureDraftTradesTable', 'addTradeAcceptance', 'listPendingTradesForAdmin']],
];

for (const [relativePath, needles] of targets) {
  let source;
  try {
    source = await readFile(resolve(process.cwd(), relativePath), 'utf8');
  } catch (error) {
    console.log(`\n=== ${relativePath}: MISSING ===`);
    continue;
  }
  const lines = source.split('\n');
  console.log(`\n=== ${relativePath} (${lines.length} lines) ===`);
  for (const needle of needles) {
    const indexes = [];
    lines.forEach((line, index) => { if (line.includes(needle)) indexes.push(index); });
    console.log(`\n--- ${needle}: ${indexes.length} matches ---`);
    for (const index of indexes.slice(0, 8)) {
      const start = Math.max(0, index - 10);
      const end = Math.min(lines.length, index + 28);
      console.log(lines.slice(start, end).map((line, offset) => `${start + offset + 1}: ${line}`).join('\n'));
    }
  }
}
