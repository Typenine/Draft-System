import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const parts = ['materializer-source-1.txt', 'materializer-source-2.txt', 'materializer-source-3.txt'];
const encoded = (await Promise.all(parts.map((name) => readFile(new URL(`./${name}`, import.meta.url), 'utf8')))).join('');
const corePath = resolve(process.cwd(), 'scripts/.inspect-materialize-core.mjs');
await writeFile(corePath, Buffer.from(encoded, 'base64'));
await import(`${pathToFileURL(corePath).href}?inspect=${Date.now()}`);

const overlayPath = resolve(process.cwd(), 'src/components/draft-overlay/DraftOverlayLive.tsx');
const overlay = await readFile(overlayPath, 'utf8');
const lines = overlay.split('\n');
const needles = ['gridTemplateColumns', 'Round {', 'Array.from({ length:', 'currentPickIndex %', 'roundIdx', 'gridIdx ='];
for (const needle of needles) {
  console.log(`\n--- ${needle} ---`);
  lines.forEach((line, index) => {
    if (!line.includes(needle)) return;
    const start = Math.max(0, index - 3);
    const end = Math.min(lines.length, index + 4);
    console.log(lines.slice(start, end).map((value, offset) => `${start + offset + 1}: ${value}`).join('\n'));
  });
}
