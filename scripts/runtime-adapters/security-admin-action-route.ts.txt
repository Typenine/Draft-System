import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestSession } from '@/lib/auth-server';
import { runAdminAction } from '@/lib/store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await verifyRequestSession(req);
  if (!session || session.role !== 'admin') return NextResponse.json({ error: 'Commissioner access required.' }, { status: 403 });
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action || '');
    await runAdminAction(action, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'action_failed' }, { status: 400 });
  }
}
