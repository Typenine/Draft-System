import { NextRequest, NextResponse } from 'next/server';
import { getActiveOrLatestDraftId, getPickVideos, setPickVideo, deletePickVideo } from '@/server/db/queries';
import { isAdminCookieValue } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ok(data: unknown) { return new NextResponse(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }); }
function bad(msg: string, status = 400) { return new NextResponse(JSON.stringify({ error: msg }), { status, headers: { 'content-type': 'application/json' } }); }

function isAdmin(req: NextRequest): boolean {
  return isAdminCookieValue(req.cookies.get('evw_admin')?.value);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const draftId = url.searchParams.get('draftId') || (await getActiveOrLatestDraftId());
    if (!draftId) return ok({ videos: [] });
    const videos = await getPickVideos(draftId);
    return ok({ draftId, videos });
  } catch (e) {
    console.error('GET /api/draft/pick-videos failed', e);
    return new NextResponse(JSON.stringify({ error: 'failed' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return new NextResponse(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
  try {
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action : 'set';
    const draftId = typeof body.draftId === 'string' ? body.draftId : (await getActiveOrLatestDraftId());
    if (!draftId) return bad('no_draft');
    const overall = Number(body.overall || 0);
    if (!overall) return bad('overall required');
    if (action === 'delete') {
      await deletePickVideo(draftId, overall);
      return ok({ ok: true });
    }
    const videoUrl = typeof body.videoUrl === 'string' ? body.videoUrl.trim() : '';
    if (!videoUrl) return bad('videoUrl required');
    const playerName = typeof body.playerName === 'string' ? body.playerName.trim() : null;
    await setPickVideo(draftId, overall, videoUrl, playerName);
    return ok({ ok: true });
  } catch (e) {
    console.error('POST /api/draft/pick-videos failed', e);
    return new NextResponse(JSON.stringify({ error: 'failed' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
