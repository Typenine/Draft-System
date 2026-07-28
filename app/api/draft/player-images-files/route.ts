import { NextRequest, NextResponse } from 'next/server';
import { readdir } from 'fs/promises';
import path from 'path';
import { isAdminCookieValue } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;

function isAdmin(req: NextRequest): boolean {
  return isAdminCookieValue(req.cookies.get('evw_admin')?.value);
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const dir = path.join(process.cwd(), 'public', 'player-images');
  try {
    const names = await readdir(dir, { withFileTypes: true });
    const files = names
      .filter((d) => d.isFile() && IMAGE_EXT.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const paths = files.map((name) => `/player-images/${name}`);
    return NextResponse.json({ paths, files });
  } catch {
    return NextResponse.json({ paths: [], files: [] });
  }
}
