import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const markerPath = resolve(process.cwd(), '.next/.draft-system-materialized');
const force = process.argv.includes('--force');
const materializers = [
  'scripts/materialize-parity-wrapper.mjs',
  'scripts/finalize-runtime-adapters.mjs',
  'scripts/finalize-completion-archive.mjs',
  'scripts/finalize-player-search-autopick.mjs',
  'scripts/finalize-security-reliability.mjs',
  'scripts/finalize-active-draft-recovery.mjs',
];

if (process.env.CI && !force) {
  try {
    const marker = await readFile(markerPath, 'utf8');
    if (marker.trim() === process.env.GITHUB_SHA || (!process.env.GITHUB_SHA && marker.trim() === 'materialized')) {
      console.log('[materialize] Reusing the runtime already verified by the preceding CI typecheck.');
      process.exit(0);
    }
  } catch {
    // A clean production checkout has no marker and must materialize normally.
  }
}

for (const script of materializers) {
  execFileSync(process.execPath, [script], { cwd: process.cwd(), stdio: 'inherit' });
}

await mkdir(resolve(process.cwd(), '.next'), { recursive: true });
await writeFile(markerPath, process.env.GITHUB_SHA || 'materialized', 'utf8');
