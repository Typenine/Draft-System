import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const path = resolve(process.cwd(), 'src/components/draft-overlay/DraftTradeAnimation.tsx');
const source = await readFile(path, 'utf8');

for (const marker of [
  'gtrade-asset-grid',
  'assetColumns = acquired.length >= 9 ? 5',
  'compact={compactAssets}',
  'ultraCompact={ultraCompactAssets}',
  "overflowWrap: 'anywhere'",
]) {
  if (!source.includes(marker)) throw new Error(`[trade-animation-assets] Missing runtime marker: ${marker}`);
}

if (source.includes('flex-1 flex flex-col justify-center gap-2.5 px-8 pb-4')) {
  throw new Error('[trade-animation-assets] Legacy single-column asset stack is still present.');
}

console.log('[trade-animation-assets] Responsive multi-asset trade layout verified.');
