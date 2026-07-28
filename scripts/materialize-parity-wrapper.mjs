import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const protectedPaths = [
  "src/app/api/auth/login/route.ts",
  "src/app/api/setup/route.ts",
  "src/app/commissioner/page.tsx",
  "src/app/entry-flow.css",
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/app/room/page.tsx",
  "src/lib/db.ts",
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

// Fail the build instead of silently shipping the obsolete four-team login flow again.
const homepage = await readFile(resolve(process.cwd(), "src/app/page.tsx"), "utf8");
const setupStore = await readFile(resolve(process.cwd(), "src/lib/store/setup.ts"), "utf8");
const commissionerPage = await readFile(resolve(process.cwd(), "src/app/commissioner/page.tsx"), "utf8");

if (!homepage.includes("Replace the temporary sample league") || !homepage.includes("336 picks")) {
  throw new Error("[standalone-adapter] Corrected 12-team setup page was not preserved.");
}
if (!setupStore.includes("REQUIRED_TEAM_COUNT = 12") || !setupStore.includes("REQUIRED_ROUNDS = 28")) {
  throw new Error("[standalone-adapter] Required 12-team, 28-round setup rules were not preserved.");
}
if (!commissionerPage.includes("DraftOverlayLive") || !commissionerPage.includes("commissioner-overlay-frame")) {
  throw new Error("[standalone-adapter] Overlay-first commissioner room was not preserved.");
}
