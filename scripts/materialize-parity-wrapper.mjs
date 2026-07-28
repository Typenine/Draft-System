import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const DEFAULT_EVENT_LOGO = "/panther-nation-draft-2026.webp";
const DEFAULT_EVENT_LOGO_SHA256 = "e02cc68a5e66e7c3c38b56c68833632fcfa8441fa3cc62c8501aefc093973444";
const logoPayloadPaths = [
  "scripts/panther-logo-part-1.txt",
  "scripts/panther-logo-part-2.txt",
  "scripts/panther-logo-part-3.txt",
  "scripts/panther-logo-part-4.txt",
];

const playerPayloadPaths = [
  "src/data/draftable-players-payload-1.ts",
  "src/data/draftable-players-payload-2.ts",
  "src/data/draftable-players-payload-3.ts",
  "src/data/draftable-players-payload-4.ts",
];

const protectedPaths = [
  "src/app/admin/page.tsx",
  "src/app/admin-enhancements.css",
  "src/app/api/auth/login/route.ts",
  "src/app/api/setup/route.ts",
  "src/app/commissioner/page.tsx",
  "src/app/commissioner/settings/page.tsx",
  "src/app/entry-flow.css",
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/app/room/page.tsx",
  "src/components/admin/AnimationTestingPanel.tsx",
  "src/components/AppHeader.tsx",
  "src/components/setup/ClockDurationInput.tsx",
  "src/components/setup/DraftablePlayerSource.module.css",
  "src/components/setup/DraftablePlayerSource.tsx",
  "src/components/setup/DraftOrderEditor.tsx",
  "src/components/setup/TeamSetupEditor.tsx",
  "src/data/draftable-player-source.ts",
  ...playerPayloadPaths,
  "src/lib/db.ts",
  "src/lib/draftable-player-source.ts",
  "src/lib/store/admin.ts",
  "src/lib/store/draft.ts",
  "src/lib/store/setup.ts",
  "src/lib/types.ts",
];

function replaceRequired(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(search)) throw new Error(`[standalone-adapter] Could not patch ${label}.`);
  return source.replace(search, replacement);
}

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

// Use minutes + seconds wherever the pick clock is configured.
const homepagePath = resolve(process.cwd(), "src/app/page.tsx");
let homepage = await readFile(homepagePath, "utf8");
homepage = replaceRequired(
  homepage,
  "import { FormEvent, useMemo, useState, type CSSProperties } from 'react';",
  "import { FormEvent, useMemo, useState, type CSSProperties } from 'react';\nimport { ClockDurationInput } from '@/components/setup/ClockDurationInput';",
  "setup clock import",
);
homepage = replaceRequired(
  homepage,
  "<label>Pick clock in seconds<input type=\"number\" min=\"10\" value={setup.clockSeconds} onChange={(event) => setSetup({ ...setup, clockSeconds: Number(event.target.value) })} /></label>",
  "<ClockDurationInput value={setup.clockSeconds} onChange={(clockSeconds) => setSetup({ ...setup, clockSeconds })} />",
  "setup clock fields",
);
await writeFile(homepagePath, homepage, "utf8");

const commissionerPath = resolve(process.cwd(), "src/app/commissioner/page.tsx");
let commissionerPage = await readFile(commissionerPath, "utf8");
commissionerPage = replaceRequired(
  commissionerPage,
  "import { AnimationTestingPanel } from '@/components/admin/AnimationTestingPanel';",
  "import { AnimationTestingPanel } from '@/components/admin/AnimationTestingPanel';\nimport { ClockDurationInput } from '@/components/setup/ClockDurationInput';",
  "commissioner clock import",
);
commissionerPage = replaceRequired(
  commissionerPage,
  "<a className=\"button\" href=\"/draft/overlay\" target=\"_blank\" rel=\"noreferrer\">Open full-screen broadcast</a>",
  "<a className=\"button\" href=\"/draft/overlay\" target=\"_blank\" rel=\"noreferrer\">Open full-screen broadcast</a>\n            <a className=\"button\" href=\"/draft/room/team?commissionerTest=1\" target=\"_blank\" rel=\"noreferrer\">Open team-view tester</a>",
  "commissioner team-view link",
);
commissionerPage = replaceRequired(
  commissionerPage,
  "<label>Clock length in seconds<div className=\"input-row\"><input type=\"number\" min=\"10\" value={clockSeconds} onChange={(event) => setClockSeconds(Number(event.target.value))} /><button className=\"button\" disabled={working} onClick={() => action('set_clock', { clockSeconds })}>Save</button></div></label>",
  "<div className=\"clock-control-row\"><ClockDurationInput value={clockSeconds} onChange={setClockSeconds} disabled={working} /><button className=\"button\" disabled={working} onClick={() => action('set_clock', { clockSeconds })}>Save clock</button></div>",
  "commissioner clock fields",
);
await writeFile(commissionerPath, commissionerPage, "utf8");

const settingsPath = resolve(process.cwd(), "src/app/commissioner/settings/page.tsx");
let settingsPage = await readFile(settingsPath, "utf8");
settingsPage = replaceRequired(
  settingsPage,
  "import { AppHeader } from '@/components/AppHeader';",
  "import { AppHeader } from '@/components/AppHeader';\nimport { ClockDurationInput } from '@/components/setup/ClockDurationInput';",
  "settings clock import",
);
settingsPage = replaceRequired(
  settingsPage,
  "<label>Pick clock in seconds<input type=\"number\" min=\"10\" value={clockSeconds} onChange={(event) => setClockSeconds(Number(event.target.value))} /></label>",
  "<ClockDurationInput value={clockSeconds} onChange={setClockSeconds} />",
  "settings clock fields",
);
await writeFile(settingsPath, settingsPage, "utf8");

// Advance the broadcast board in four-round windows through all 28 rounds.
const overlayPath = resolve(process.cwd(), "src/components/draft-overlay/DraftOverlayLive.tsx");
let overlay = await readFile(overlayPath, "utf8");
overlay = replaceRequired(
  overlay,
  "  const pickInRound = (currentPickIndex % picksPerRound) + 1;",
  "  const pickInRound = (currentPickIndex % picksPerRound) + 1;\n  const totalRounds = Math.max(1, draft?.rounds || 28);\n  const activeRoundForBoard = Math.min(totalRounds, Math.max(1, roundNumber));\n  const visibleRoundStart = Math.floor((activeRoundForBoard - 1) / 4) * 4 + 1;\n  const visibleRounds = Array.from({ length: Math.min(4, totalRounds - visibleRoundStart + 1) }, (_, index) => visibleRoundStart + index);",
  "overlay visible-round calculation",
);
overlay = replaceRequired(overlay, "{[1, 2, 3, 4].map(r => (", "{visibleRounds.map(r => (", "overlay round headers");
overlay = replaceRequired(overlay, "{Array.from({ length: 12 }, (_, pickIdx) => (", "{Array.from({ length: picksPerRound }, (_, pickIdx) => (", "overlay pick rows");
overlay = replaceRequired(overlay, "currentPickIndex % 12 === pickIdx", "currentPickIndex % picksPerRound === pickIdx", "overlay active row");
overlay = replaceRequired(overlay, "{[0, 1, 2, 3].map(roundIdx => {", "{visibleRounds.map(visibleRound => {", "overlay round cells");
overlay = replaceRequired(overlay, "const gridIdx = roundIdx * 12 + pickIdx;", "const gridIdx = (visibleRound - 1) * picksPerRound + pickIdx;", "overlay global grid index");
await writeFile(overlayPath, overlay, "utf8");

// Let a signed-in commissioner open and exercise the real team-owner room.
const teamRoomPath = resolve(process.cwd(), "src/app/draft/room/team/page.tsx");
let teamRoom = await readFile(teamRoomPath, "utf8");
teamRoom = teamRoom.replace("import { TEAM_NAMES } from '@/lib/constants/league';\n", "");
teamRoom = replaceRequired(teamRoom, "{isAdmin && !me.authenticated && (", "{isAdmin && (", "admin team-view selector visibility");
teamRoom = replaceRequired(
  teamRoom,
  "{TEAM_NAMES.map(t => <option key={t} value={t}>{t}{t === onClock ? ' ⏰' : ''}</option>)}",
  "{Array.from(new Set((draft?.allSlots || []).map((slot) => slot.team))).map(t => <option key={t} value={t}>{t}{t === onClock ? ' ⏰' : ''}</option>)}",
  "dynamic team-view selector",
);
await writeFile(teamRoomPath, teamRoom, "utf8");

// Materialize the user-provided Panther Nation logo as a first-party public asset.
const logoPayload = (await Promise.all(
  logoPayloadPaths.map((relativePath) => readFile(resolve(process.cwd(), relativePath), "utf8")),
)).join("");
const logoBytes = Buffer.from(logoPayload, "base64");
const logoHash = createHash("sha256").update(logoBytes).digest("hex");
if (logoHash !== DEFAULT_EVENT_LOGO_SHA256) {
  throw new Error("[standalone-adapter] Default Panther Nation logo payload is incomplete or corrupt.");
}
const publicLogoPath = resolve(process.cwd(), `public${DEFAULT_EVENT_LOGO}`);
await mkdir(dirname(publicLogoPath), { recursive: true });
await writeFile(publicLogoPath, logoBytes);

// Keep the built-in logo selected when a new league is configured.
homepage = await readFile(homepagePath, "utf8");
homepage = homepage.replace("logoUrl: '',", `logoUrl: '${DEFAULT_EVENT_LOGO}',`);
if (!homepage.includes("setup-event-logo-preview")) {
  homepage = homepage.replace(
    '<section className="setup-intro">',
    `<section className="setup-intro"><img className="setup-event-logo-preview" src={setup.logoUrl || '${DEFAULT_EVENT_LOGO}'} alt="Panther Nation Draft 2026" />`,
  );
}
await writeFile(homepagePath, homepage, "utf8");

const enhancementsPath = resolve(process.cwd(), "src/app/admin-enhancements.css");
let enhancements = await readFile(enhancementsPath, "utf8");
if (!enhancements.includes(".setup-event-logo-preview")) {
  enhancements += `\n.setup-event-logo-preview {\n  width: clamp(110px, 13vw, 190px);\n  height: clamp(110px, 13vw, 190px);\n  object-fit: contain;\n  justify-self: start;\n  filter: drop-shadow(0 18px 34px rgba(0, 0, 0, .38));\n}\n@media (max-width: 700px) {\n  .setup-event-logo-preview { width: 118px; height: 118px; }\n}\n`;
}
if (!enhancements.includes(".clock-duration-field")) {
  enhancements += `\n.clock-duration-field {\n  min-width: 0;\n  margin: 0;\n  padding: 0;\n  border: 0;\n}\n.clock-duration-field legend {\n  margin-bottom: 8px;\n  color: var(--text);\n  font-size: .84rem;\n  font-weight: 800;\n}\n.clock-duration-inputs {\n  display: grid;\n  grid-template-columns: minmax(82px, 1fr) auto minmax(82px, 1fr);\n  align-items: end;\n  gap: 8px;\n}\n.clock-duration-inputs label { display: grid; gap: 5px; }\n.clock-duration-inputs label span { color: var(--muted); font-size: .68rem; font-weight: 850; text-transform: uppercase; letter-spacing: .06em; }\n.clock-duration-inputs input { width: 100%; text-align: center; font-variant-numeric: tabular-nums; }\n.clock-duration-separator { padding-bottom: 11px; color: var(--muted); font-size: 1.35rem; font-weight: 900; }\n.clock-duration-field > small { display: block; margin-top: 6px; color: var(--muted); font-size: .7rem; }\n.clock-control-row { display: grid; grid-template-columns: minmax(220px, 1fr) auto; align-items: end; gap: 12px; }\n@media (max-width: 650px) {\n  .clock-control-row { grid-template-columns: 1fr; }\n}\n`;
}
await writeFile(enhancementsPath, enhancements, "utf8");

// Fail the build instead of silently shipping an obsolete or incomplete setup flow.
homepage = await readFile(homepagePath, "utf8");
const setupApi = await readFile(resolve(process.cwd(), "src/app/api/setup/route.ts"), "utf8");
const setupStore = await readFile(resolve(process.cwd(), "src/lib/store/setup.ts"), "utf8");
const adminStore = await readFile(resolve(process.cwd(), "src/lib/store/admin.ts"), "utf8");
const draftStore = await readFile(resolve(process.cwd(), "src/lib/store/draft.ts"), "utf8");
commissionerPage = await readFile(commissionerPath, "utf8");
settingsPage = await readFile(settingsPath, "utf8");
const adminSignIn = await readFile(resolve(process.cwd(), "src/app/admin/page.tsx"), "utf8");
const animationTesting = await readFile(resolve(process.cwd(), "src/components/admin/AnimationTestingPanel.tsx"), "utf8");
const orderEditor = await readFile(resolve(process.cwd(), "src/components/setup/DraftOrderEditor.tsx"), "utf8");
const teamSetup = await readFile(resolve(process.cwd(), "src/components/setup/TeamSetupEditor.tsx"), "utf8");
const playerSource = await readFile(resolve(process.cwd(), "src/components/setup/DraftablePlayerSource.tsx"), "utf8");
const playerLoader = await readFile(resolve(process.cwd(), "src/lib/draftable-player-source.ts"), "utf8");
const clockDuration = await readFile(resolve(process.cwd(), "src/components/setup/ClockDurationInput.tsx"), "utf8");
overlay = await readFile(overlayPath, "utf8");
teamRoom = await readFile(teamRoomPath, "utf8");

if (!homepage.includes("Replace the temporary sample league") || !homepage.includes("DraftOrderEditor") || !homepage.includes("Commissioner sign in") || homepage.includes("PlayerImport")) {
  throw new Error("[standalone-adapter] Ordered Google Sheet-backed setup page was not preserved.");
}
if (!homepage.includes(DEFAULT_EVENT_LOGO) || !homepage.includes("setup-event-logo-preview")) {
  throw new Error("[standalone-adapter] Default Panther Nation event logo was not preserved.");
}
if (!homepage.includes("ClockDurationInput") || !settingsPage.includes("ClockDurationInput") || !commissionerPage.includes("Save clock") || !clockDuration.includes("Minutes")) {
  throw new Error("[standalone-adapter] Minutes-and-seconds clock controls were not preserved.");
}
if (!overlay.includes("visibleRoundStart") || !overlay.includes("visibleRounds.map(visibleRound") || overlay.includes("{[1, 2, 3, 4].map")) {
  throw new Error("[standalone-adapter] The 28-round moving broadcast window was not preserved.");
}
if (!commissionerPage.includes("Open team-view tester") || !teamRoom.includes("Admin mode — view as team") || !teamRoom.includes("Array.from(new Set((draft?.allSlots || [])")) {
  throw new Error("[standalone-adapter] Commissioner team-view testing was not preserved.");
}
if (!setupStore.includes("REQUIRED_TEAM_COUNT = 12") || !setupStore.includes("REQUIRED_ROUNDS = 28") || !setupStore.includes("draftOrder")) {
  throw new Error("[standalone-adapter] Required 12-team, 28-round, complete order setup rules were not preserved.");
}
if (!teamSetup.includes("Set up the 12 teams") || !teamSetup.includes("Use league colors") || !teamSetup.includes("requireAccessCodes")) {
  throw new Error("[standalone-adapter] Reusable visual team setup editor was not preserved.");
}
if (!orderEditor.includes("Snake") || !orderEditor.includes("All {rounds * teams.length} selections") || !draftStore.includes("generateSlotTeamIds")) {
  throw new Error("[standalone-adapter] Linear, snake, and traded-pick draft order tools were not preserved.");
}
if (!settingsPage.includes("update_setup") || !settingsPage.includes("DraftOrderEditor") || !adminStore.includes("action === 'update_setup'")) {
  throw new Error("[standalone-adapter] Persistent commissioner setup editing was not preserved.");
}
if (!adminSignIn.includes("Commissioner access code") || !commissionerPage.includes("AnimationTestingPanel")) {
  throw new Error("[standalone-adapter] Commissioner sign-in and testing entry were not preserved.");
}
for (const component of ["DraftPickAnimation", "NowOnClockAnimation", "DraftTradeAnimation", "StartOfRoundAnimation", "EndOfRoundAnimation"]) {
  if (!animationTesting.includes(component)) throw new Error(`[standalone-adapter] Missing animation test component: ${component}`);
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
