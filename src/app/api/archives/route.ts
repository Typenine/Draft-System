import { NextResponse } from 'next/server';
import { listArchives } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ drafts: await listArchives() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'archive_load_failed' }, { status: 500 });
  }
}
