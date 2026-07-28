import { promises as fs } from 'fs';
import path from 'path';
import { getKV } from '@/lib/server/kv';
import { TEAM_NAMES } from '@/lib/constants/league';
import { normalizeName } from '@/lib/constants/team-mapping';
import { getTeamPinBySlug, setTeamPin } from '@/server/db/queries';

export type StoredPin = {
  hash: string;
  salt: string;
  pinVersion: number;
  updatedAt: string; // ISO
};

export type PinMap = Record<string, StoredPin>; // ownerId -> StoredPin

const DATA_PATH = path.join(process.cwd(), 'data', 'team-pins.json');
const PINS_DIR = path.join(process.cwd(), 'data', 'pins');

function teamSlug(team: string): string {
  return team.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function teamBlobKey(team: string): string {
  return `auth/pins/${teamSlug(canonicalizeTeamName(team))}.json`;
}

function canonicalizeTeamName(name: string): string {
  const want = normalizeName(name);
  const found = TEAM_NAMES.find((t) => normalizeName(t) === want);
  return found || name;
}

export async function readTeamPin(team: string): Promise<StoredPin | null> {
  // DB first
  try {
    const slug = teamSlug(canonicalizeTeamName(team));
    const row = await getTeamPinBySlug(slug);
    if (row && typeof row.hash === 'string' && typeof row.salt === 'string') {
      return { hash: row.hash as string, salt: row.salt as string, pinVersion: Number(row.pinVersion || 1), updatedAt: new Date(row.updatedAt as unknown as Date).toISOString() };
    }
  } catch {}
  // Migration fallback: read legacy global map and backfill (canonicalizing the team name)
  try {
    const legacy = await readPins();
    const canon = canonicalizeTeamName(team);
    let entry: StoredPin | undefined = legacy[canon];
    if (!entry) {
      const targetNorm = normalizeName(team);
      for (const [k, v] of Object.entries(legacy)) {
        if (normalizeName(k) === targetNorm) { entry = v as StoredPin; break; }
      }
    }
    if (entry) {
      try { await writeTeamPin(canon, entry); } catch {}
      return entry;
    }
  } catch {}
  // KV fallback
  try {
    const kv = await getKV();
    if (kv) {
      const k = `pins:team:${teamSlug(canonicalizeTeamName(team))}`;
      const raw = (await kv.get(k)) as string | null;
      if (raw && typeof raw === 'string') {
        const parsed = JSON.parse(raw) as unknown;
        if (isStoredPin(parsed)) return parsed;
      }
    }
  } catch {}
  // FS fallback (dev)
  try {
    const slug = teamSlug(canonicalizeTeamName(team));
    const file = path.join(PINS_DIR, `${slug}.json`);
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (isStoredPin(parsed)) return parsed;
  } catch {}
  return null;
}

function isStoredPin(v: unknown): v is StoredPin {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.hash === 'string' &&
    typeof o.salt === 'string' &&
    typeof o.pinVersion === 'number' &&
    typeof o.updatedAt === 'string'
  );
}

export async function writeTeamPinWithError(team: string, value: StoredPin): Promise<{ ok: boolean; error?: string }> {
  try {
    const slug = teamSlug(canonicalizeTeamName(team));
    await setTeamPin(slug, { hash: value.hash, salt: value.salt, pinVersion: value.pinVersion, updatedAt: new Date(value.updatedAt) });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[pins] DB write failed', { team, err: msg });
    return { ok: false, error: msg };
  }
}

export async function writeTeamPin(team: string, value: StoredPin): Promise<boolean> {
  const res = await writeTeamPinWithError(team, value);
  return res.ok;
}

export type TeamWriteResult = { blob: boolean; kv: boolean; fs: boolean };

export async function writeTeamPinWithResult(team: string, value: StoredPin): Promise<TeamWriteResult> {
  const blobOk = false;
  let kvOk = false;
  let fsOk = false;
  // DB write
  try {
    const slug = teamSlug(canonicalizeTeamName(team));
    await setTeamPin(slug, { hash: value.hash, salt: value.salt, pinVersion: value.pinVersion, updatedAt: new Date(value.updatedAt) });
  } catch {}
  try { await writeTeamPin(team, value); } catch {}
  try {
    const kv = await getKV();
    if (kv) {
      const k = `pins:team:${teamSlug(canonicalizeTeamName(team))}`;
      await kv.set(k, JSON.stringify(value));
      kvOk = true;
    }
  } catch { kvOk = false; }
  // FS write (dev)
  try {
    const slug = teamSlug(canonicalizeTeamName(team));
    await fs.mkdir(PINS_DIR, { recursive: true });
    await fs.writeFile(path.join(PINS_DIR, `${slug}.json`), JSON.stringify(value, null, 2), 'utf8');
    fsOk = true;
  } catch { fsOk = false; }
  return { blob: !!blobOk, kv: !!kvOk, fs: !!fsOk };
}

export async function listAllTeamPins(): Promise<PinMap> {
  const out: PinMap = {};
  for (const name of TEAM_NAMES) {
    try {
      const slug = teamSlug(canonicalizeTeamName(name));
      const row = await getTeamPinBySlug(slug);
      if (row && typeof row.hash === 'string' && typeof row.salt === 'string') {
        out[name] = { hash: row.hash as string, salt: row.salt as string, pinVersion: Number(row.pinVersion || 1), updatedAt: new Date(row.updatedAt as unknown as Date).toISOString() };
      }
    } catch {}
  }
  try {
    const legacy = await readPins();
    for (const [team, entry] of Object.entries(legacy)) {
      if (!out[team] || (entry.pinVersion || 0) > (out[team].pinVersion || 0)) out[team] = entry;
    }
  } catch {}
  return out;
}

export async function readPins(): Promise<PinMap> {
  const blobMap: PinMap = {};
  let kvMap: PinMap = {};

  // KV
  try {
    const kv = await getKV();
    if (kv) {
      const raw = (await kv.get('pins:map')) as string | null;
      if (raw && typeof raw === 'string') {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') kvMap = parsed as PinMap;
      }
    }
  } catch {}

  // Merge: pick higher pinVersion per team
  const merged: PinMap = { ...blobMap };
  for (const [team, entry] of Object.entries(kvMap)) {
    const cur = merged[team];
    if (!cur || (entry.pinVersion || 0) > (cur.pinVersion || 0)) {
      merged[team] = entry as StoredPin;
    }
  }
  if (Object.keys(merged).length > 0) return merged;

  // Local fs (dev)
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as PinMap;
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (!(err && err.code === 'ENOENT')) throw err;
  }
  return {};
}

export async function writePins(pins: PinMap): Promise<void> {
  await writePinsWithResult(pins);
}

export type WriteResult = { kv: boolean; blob: boolean; fs: boolean };

export async function writePinsWithResult(pins: PinMap): Promise<WriteResult> {
  let kvOk = false;
  const blobOk = false;
  let fsOk = false;

  // Then KV
  try {
    const kv = await getKV();
    if (kv) {
      await kv.set('pins:map', JSON.stringify(pins));
      kvOk = true;
    }
  } catch {}

  // Finally, local filesystem (dev)
  try {
    await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
    await fs.writeFile(DATA_PATH, JSON.stringify(pins, null, 2), 'utf8');
    fsOk = true;
  } catch {}

  return { kv: kvOk, blob: blobOk, fs: fsOk };
}
