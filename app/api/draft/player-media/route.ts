import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { isAdminCookieValue } from '@/lib/auth/admin';
import { ensureDraftTables, setPlayerImage, setPlayerVideo } from '@/server/db/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAdmin(req: NextRequest): boolean {
  return isAdminCookieValue(req.cookies.get('evw_admin')?.value);
}

function bad(msg: string, status = 400) {
  return new NextResponse(JSON.stringify({ error: msg }), { status, headers: { 'content-type': 'application/json' } });
}

function ok(data: unknown) {
  return new NextResponse(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
}

function extFromName(name: string, mediaType: 'image' | 'video'): string {
  const lower = name.toLowerCase();
  const m = lower.match(/(\.[a-z0-9]+)$/);
  if (m && m[1]) return m[1].slice(0, 8);
  return mediaType === 'image' ? '.jpg' : '.mp4';
}

/** Single segment safe for a filename (no slashes). */
function safeFileLeaf(raw: string, mediaType: 'image' | 'video'): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'upload';
  if (cleaned.includes('.')) return cleaned;
  return `${cleaned}${extFromName(cleaned, mediaType)}`;
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return bad('Unauthorized', 403);

  const ct = req.headers.get('content-type') || '';
  let buffer: Buffer;
  let fileName: string;
  let mediaType: string | null = null;
  let playerId: string | null = null;
  let playerName: string | null = null;

  if (ct.includes('application/json')) {
    const body = await req.json().catch(() => null);
    if (!body) return bad('Invalid JSON body');
    playerId = (typeof body.playerId === 'string' ? body.playerId : '').trim() || null;
    playerName = typeof body.playerName === 'string' ? body.playerName.trim() || null : null;
    mediaType = (typeof body.type === 'string' ? body.type : '').toLowerCase() || null;
    const fileData = typeof body.fileData === 'string' ? body.fileData : null;
    fileName = typeof body.fileName === 'string' ? body.fileName : 'upload';
    if (!fileData) return bad('fileData required');
    try {
      buffer = Buffer.from(fileData, 'base64');
    } catch {
      return bad('Invalid base64 fileData');
    }
  } else {
    const formData = await req.formData().catch(() => null);
    if (!formData) return bad('Invalid form data');
    const file = formData.get('file') as File | null;
    mediaType = (formData.get('type') as string | null)?.toLowerCase() ?? null;
    playerId = (formData.get('playerId') as string | null)?.trim() ?? null;
    const pn = formData.get('playerName');
    playerName = typeof pn === 'string' ? pn.trim() || null : null;
    if (!file) return bad('file required');
    fileName = file.name;
    buffer = Buffer.from(await file.arrayBuffer());
  }

  if (!buffer || !mediaType || !playerId) return bad('file, type, playerId required');
  if (mediaType !== 'video' && mediaType !== 'image') return bad('type must be video or image');
  const maxBytes = mediaType === 'image' ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
  if (buffer.length > maxBytes) return bad(`File too large (max ${mediaType === 'image' ? '10' : '50'} MB)`);

  const mt = mediaType === 'image' ? 'image' : 'video';
  const leaf = safeFileLeaf(fileName, mt);
  const unique = `${playerId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32)}_${Date.now()}_${leaf}`;
  const subdir = mt === 'image' ? 'player-images' : 'player-videos';
  const absDir = path.join(process.cwd(), 'public', subdir);
  const absFile = path.join(absDir, unique);
  const publicPath = `/${subdir}/${unique}`;

  try {
    await mkdir(absDir, { recursive: true });
    await writeFile(absFile, buffer, { mode: 0o644 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('player-media write to public/ failed', msg);
    return bad(
      'Could not write the file under `public/` (this is normal on read-only hosts like Vercel). ' +
        'Add the file to your repo under `public/player-images/` or `public/player-videos/`, deploy, then set the `/player-images/...` or `/player-videos/...` path (or an https URL) with Save Media.',
      503,
    );
  }

  try {
    await ensureDraftTables();
    if (mt === 'image') {
      await setPlayerImage(playerId, publicPath, playerName);
    } else {
      await setPlayerVideo(playerId, publicPath, playerName);
    }
  } catch (err) {
    console.error('player-media DB save failed', err);
    return bad('Saved file to disk but failed to update the database.', 500);
  }

  return ok({ ok: true, publicPath });
}
