import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const fullTargets = [
  'src/app/api/draft/route.ts',
  'src/app/api/draft/trade/route.ts',
  'src/lib/draft-compat.ts',
  'src/lib/legacy-draft.ts',
  'src/lib/draft-legacy.ts',
  'src/lib/store/shared.ts',
];

for (const relativePath of fullTargets) {
  try {
    const source = await readFile(resolve(process.cwd(), relativePath), 'utf8');
    console.log(`\n=== FULL ${relativePath} ===\n${source}\n=== END ${relativePath} ===`);
  } catch {
    console.log(`\n=== ${relativePath}: MISSING ===`);
  }
}
