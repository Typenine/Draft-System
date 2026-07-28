import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const playerPayloadPaths = [
  "src/data/draftable-players-payload-1.ts",
  "src/data/draftable-players-payload-2.ts",
  "src/data/draftable-players-payload-3.ts",
  "src/data/draftable-players-payload-4.ts",
];

const protectedPaths = [
  "src/app/api/auth/login/route.ts",
  "src/app/api/setup/route.ts",
  "src/app/commissioner/page.tsx",
  "src/app/entry-flow.css",
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/app/room/page.tsx",
  "src/components/setup/DraftablePlayerSource.module.css",
  "src/components/setup/DraftablePlayerSource.tsx",
  "src/components/setup/TeamSetupEditor.tsx",
  "src/data/draftable-player-source.ts",
  ...playerPayloadPaths,
  "src/lib/db.ts",
  "src/lib/draftable-player-source.ts",
  "src/lib/store/setup.ts",
];

// The parity core intentionally replaces the East v. West presentation files.
// These standalone integration files must survive that process unchanged.
const protectedFiles = new Map(
  await Promise.all(
    protectedPaths.map(async (relativePath) => [
      relativePath,
      await readFile(resolve(process.cwd(), relativePath), "utf8"),
    ]),
  ),
);

const parts = ["materializer-source-1.txt", "materializer-source-2.txt", "materializer-source-3.txt"];
const encoded = (await Promise.all(parts.map((name) => readFile(new URL(`./${name}`, import.meta.url), "utf8")))).join("");
const corePath = resolve(process.cwd(), "scripts/.materialize-parity-core.mjs");
await writeFile(corePath, Buffer.from(encoded, "base64"));
await import(`${pathToFileURL(corePath).href}?v=${Date.now()}`);

for (const [relativePath, content] of protectedFiles) {
  const absolutePath = resolve(process.cwd(), relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

// Fail the build instead of silently shipping an obsolete or incomplete setup flow.
const homepage = await readFile(resolve(process.cwd(), "src/app/page.tsx"), "utf8");
const setupApi = await readFile(resolve(process.cwd(), "src/app/api/setup/route.ts"), "utf8");
const setupStore = await readFile(resolve(process.cwd(), "src/lib/store/setup.ts"), "utf8");
const commissionerPage = await readFile(resolve(process.cwd(), "src/app/commissioner/page.tsx"), "utf8");
const teamSetup = await readFile(resolve(process.cwd(), "src/components/setup/TeamSetupEditor.tsx"), "utf8");
const playerSource = await readFile(resolve(process.cwd(), "src/components/setup/DraftablePlayerSource.tsx"), "utf8");
const playerLoader = await readFile(resolve(process.cwd(), "src/lib/draftable-player-source.ts"), "utf8");

if (!homepage.includes("Replace the temporary sample league") || !homepage.includes("TeamSetupEditor") || !homepage.includes("DraftablePlayerSource") || homepage.includes("PlayerImport")) {
  throw new Error("[standalone-adapter] Google Sheet-backed 12-team setup page was not preserved.");
}
if (!setupStore.includes("REQUIRED_TEAM_COUNT = 12") || !setupStore.includes("REQUIRED_ROUNDS = 28") || !setupStore.includes("REQUIRED_PLAYER_COUNT")) {
  throw new Error("[standalone-adapter] Required 12-team, 28-round, 336-player setup rules were not preserved.");
}
if (!teamSetup.includes("Set up the 12 teams") || !teamSetup.includes("Use league colors")) {
  throw new Error("[standalone-adapter] Visual team setup editor was not preserved.");
}
if (!playerSource.includes("Draftable Players") || !playerSource.includes("No upload or column mapping is required")) {
  throw new Error("[standalone-adapter] Google Sheet player source confirmation was not preserved.");
}
if (!setupApi.includes("getDraftablePlayers") || !playerLoader.includes("gunzipSync")) {
  throw new Error("[standalone-adapter] Server-side Google Sheet player source was not preserved.");
}

const playerPayload = (await Promise.all(playerPayloadPaths.map(async (relativePath) => {
  const text = await readFile(resolve(process.cwd(), relativePath), "utf8");
  const match = text.match(/const payload = '([A-Za-z0-9+/=]+)'/);
  if (!match) throw new Error(`[standalone-adapter] Invalid player payload module: ${relativePath}`);
  return match[1];
}))).join("");
const players = JSON.parse(gunzipSync(Buffer.from(playerPayload, "base64")).toString("utf8"));
if (!Array.isArray(players) || players.length !== 2340 || !players.every((player) => player?.name && player?.position)) {
  throw new Error("[standalone-adapter] Google Sheet player snapshot is incomplete or corrupt.");
}
if (!commissionerPage.includes("DraftOverlayLive") || !commissionerPage.includes("commissioner-overlay-frame")) {
  throw new Error("[standalone-adapter] Overlay-first commissioner room was not preserved.");
}
