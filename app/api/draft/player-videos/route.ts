import { NextRequest, NextResponse } from 'next/server';
import { ensureDraftTables, getPlayerMediaSummaries, setPlayerVideo, setPlayerImage, deletePlayerVideo } from '@/server/db/queries';
import { isAdminCookieValue } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ok(data: unknown) { return new NextResponse(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }); }
function bad(msg: string, status = 400) { return new NextResponse(JSON.stringify({ error: msg }), { status, headers: { 'content-type': 'application/json' } }); }

function isAdmin(req: NextRequest): boolean {
  return isAdminCookieValue(req.cookies.get('evw_admin')?.value);
}

export async function GET() {
  try {
    await ensureDraftTables();
    // getPlayerMediaSummaries() uses DB-side boolean expressions and CASE/LIKE guards so
    // image_url and video_url full text values are never selected — no base64 data crosses
    // the Neon wire even when stored media is large.
    const videos = await getPlayerMediaSummaries();
    return ok({ videos });
  } catch (e) {
    console.error('GET /api/draft/player-videos failed', e);
    return ok({ videos: [] });
  }
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return bad('Unauthorized', 403);
  try {
    const body = await req.json().catch(() => null);
    if (!body?.playerId) return bad('playerId required');

    if (body.action === 'delete') {
      await deletePlayerVideo(body.playerId);
      return ok({ ok: true });
    }

    if (body.imageUrl) {
      if (typeof body.imageUrl === 'string' && body.imageUrl.startsWith('data:')) {
        return bad('data: URLs are not allowed. Host the image externally and submit its URL.');
      }
      await setPlayerImage(body.playerId, body.imageUrl, body.playerName ?? null);
      return ok({ ok: true });
    }

    if (!body.videoUrl) return bad('videoUrl or imageUrl required');
    if (typeof body.videoUrl === 'string' && body.videoUrl.startsWith('data:')) {
      return bad('data: URLs are not allowed. Host the video externally and submit its URL.');
    }
    await setPlayerVideo(body.playerId, body.videoUrl, body.playerName ?? null);
    return ok({ ok: true });
  } catch (e) {
    console.error('POST /api/draft/player-videos failed', e);
    return bad('internal error', 500);
  }
}
