import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

async function text(path) { return readFile(resolve(process.cwd(), path), 'utf8'); }
async function save(path, content) {
  const absolute = resolve(process.cwd(), path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
}
function replaceRequired(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(search)) throw new Error(`[security-reliability] Could not patch ${label}.`);
  return source.replace(search, replacement);
}

const canonicalFiles = [
  ['scripts/runtime-adapters/security-auth.ts.txt', 'src/lib/auth.ts'],
  ['scripts/runtime-adapters/security-auth-server.ts.txt', 'src/lib/auth-server.ts'],
  ['scripts/runtime-adapters/security-login-route.ts.txt', 'src/app/api/auth/login/route.ts'],
  ['scripts/runtime-adapters/security-session-route.ts.txt', 'src/app/api/auth/session/route.ts'],
  ['scripts/runtime-adapters/security-auth-me-route.ts.txt', 'src/app/api/auth/me/route.ts'],
  ['scripts/runtime-adapters/security-admin-action-route.ts.txt', 'src/app/api/admin/action/route.ts'],
  ['scripts/runtime-adapters/security-state-route.ts.txt', 'src/app/api/state/route.ts'],
  ['scripts/runtime-adapters/security-draft-route.ts.txt', 'src/app/api/draft/route.ts'],
  ['scripts/runtime-adapters/security-trade-route.ts.txt', 'src/app/api/draft/trade/route.ts'],
  ['scripts/runtime-adapters/security-player-videos-route.ts.txt', 'src/app/api/draft/player-videos/route.ts'],
  ['scripts/runtime-adapters/security-moderation.ts.txt', 'src/lib/store/moderation.ts'],
];
for (const [templatePath, outputPath] of canonicalFiles) await save(outputPath, await text(templatePath));

let homepage = await text('src/app/page.tsx');
homepage = replaceRequired(
  homepage,
  "  if (message === 'admin_code_required') return 'Create a commissioner access code.';",
  "  if (message === 'admin_code_required') return 'Create a commissioner access code.';\n  if (message === 'invalid_setup_key') return 'Enter the deployment setup key configured in Vercel as SETUP_SECRET.';",
  'setup key error copy',
);
homepage = replaceRequired(homepage, "    adminCode: '',", "    adminCode: '',\n    setupKey: '',", 'setup key state');
homepage = replaceRequired(
  homepage,
  '  const setupReady = Boolean(setup.leagueName.trim() && setup.adminCode.trim() && teamStatus.ready && orderReady);',
  '  const setupReady = Boolean(setup.leagueName.trim() && setup.adminCode.trim() && setup.setupKey.trim() && teamStatus.ready && orderReady);',
  'setup key readiness',
);
homepage = replaceRequired(
  homepage,
  '<label>Commissioner access code<input type="password" value={setup.adminCode} onChange={(event) => setSetup({ ...setup, adminCode: event.target.value })} autoComplete="new-password" required /></label>',
  '<label>Commissioner access code<input type="password" value={setup.adminCode} onChange={(event) => setSetup({ ...setup, adminCode: event.target.value })} autoComplete="new-password" required /></label>\n               <label>Deployment setup key<input type="password" value={setup.setupKey} onChange={(event) => setSetup({ ...setup, setupKey: event.target.value })} autoComplete="off" required /><small>Matches SETUP_SECRET in the deployment environment.</small></label>',
  'setup key field',
);
await save('src/app/page.tsx', homepage);

let admin = await text('src/lib/store/admin.ts');
admin = replaceRequired(
  admin,
  "import { approveTrade, finishTradeAnimation, rejectTrade, resetTrades } from './moderation';",
  "import { approveTrade, finishTradeAnimation, rejectTrade, resetDraftState, resetTrades } from './moderation';",
  'transactional reset import',
);
admin = replaceRequired(
  admin,
  '          admin_code_hash = ${hashCode(adminCode)}, primary_color = ${primaryColor}, secondary_color = ${secondaryColor},',
  '          admin_code_hash = ${hashCode(adminCode)}, auth_version = auth_version + 1, primary_color = ${primaryColor}, secondary_color = ${secondaryColor},',
  'commissioner session revocation',
);
admin = replaceRequired(
  admin,
  '        login_code_hash = COALESCE(incoming.login_code_hash, team.login_code_hash),\n        sort_order = incoming.sort_order',
  '        login_code_hash = COALESCE(incoming.login_code_hash, team.login_code_hash),\n        auth_version = CASE WHEN incoming.login_code_hash IS NULL THEN team.auth_version ELSE team.auth_version + 1 END,\n        sort_order = incoming.sort_order',
  'team session revocation',
);
const resetStart = admin.indexOf("  if (normalizedAction === 'reset') {");
const undoStart = admin.indexOf("  if (normalizedAction === 'undo') {", resetStart);
if (resetStart < 0 || undoStart < 0) throw new Error('[security-reliability] Could not replace full reset action.');
admin = `${admin.slice(0, resetStart)}  if (normalizedAction === 'reset') {\n    await resetDraftState(draftId);\n    return;\n  }\n${admin.slice(undoStart)}`;
await save('src/lib/store/admin.ts', admin);

const required = [
  ['src/lib/auth.ts', 'authVersion'],
  ['src/lib/auth-server.ts', 'draft_login_attempts'],
  ['src/app/api/state/route.ts', 'pendingTrades: []'],
  ['src/app/api/draft/route.ts', "identity.sessionRole !== 'admin'"],
  ['src/app/api/draft/trade/route.ts', 'from_team_id'],
  ['src/lib/store/moderation.ts', "sql.transaction(operations, { isolationMode: 'Serializable' })"],
  ['src/lib/store/moderation.ts', 'resetDraftState'],
  ['src/lib/store/admin.ts', 'auth_version = auth_version + 1'],
  ['src/app/page.tsx', 'Deployment setup key'],
];
for (const [path, marker] of required) {
  const source = await text(path);
  if (!source.includes(marker)) throw new Error(`[security-reliability] ${path} is missing ${marker}`);
}
console.log('[security-reliability] Pending data is protected, animation transitions are commissioner-only, trades/resets are transactional, setup is keyed, and sessions are rate-limited and revocable.');
