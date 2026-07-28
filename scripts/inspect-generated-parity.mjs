import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const fullTargets = [
  'src/app/api/draft/team-roster/route.ts',
  'src/app/api/draft/player-videos/route.ts',
  'src/app/api/draft/player-image/route.ts',
  'src/app/api/team-prospect-draftboard/route.ts',
  'src/app/api/draft/trade/route.ts',
  'src/app/archives/page.tsx',
  'src/app/api/archives/route.ts',
  'src/app/draft/room/team/page.tsx',
];

for (const relativePath of fullTargets) {
  try {
    const source = await readFile(resolve(process.cwd(), relativePath), 'utf8');
    console.log(`\n=== FULL ${relativePath} ===\n${source}\n=== END ${relativePath} ===`);
  } catch {
    console.log(`\n=== ${relativePath}: MISSING ===`);
  }
}
