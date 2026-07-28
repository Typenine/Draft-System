'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { getTeamLogoPath, getTeamColors } from '@/lib/utils/team-utils';

type MeResp = { authenticated: boolean; isAdmin?: boolean; claims?: { team?: string } };

export default function DraftRoomLandingPage() {
  const [me, setMe] = useState<MeResp>({ authenticated: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: MeResp) => setMe(j))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sessionTeam = me?.claims?.team || null;
  const isAdmin = !!me?.isAdmin;
  const teamColors = sessionTeam ? getTeamColors(sessionTeam) : null;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="text-zinc-400 text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{
        background: teamColors
          ? `linear-gradient(135deg, ${teamColors.primary}22 0%, ${teamColors.secondary}22 100%), #0a0a0e`
          : 'linear-gradient(135deg, #be161e22 0%, #bf994422 100%), #0a0a0e',
      }}
    >
      {/* Header */}
      <div className="text-center mb-10">
        {sessionTeam && (
          <div className="mb-4">
            <Image
              src={getTeamLogoPath(sessionTeam)}
              alt={sessionTeam}
              width={80}
              height={80}
              className="mx-auto rounded-lg"
              style={{ border: `3px solid ${teamColors?.secondary || '#333'}` }}
            />
          </div>
        )}
        <h1 className="text-4xl font-black text-white mb-2">Draft Room</h1>
        <p className="text-zinc-400 text-lg">
          {sessionTeam ? `Welcome, ${sessionTeam}` : isAdmin ? 'Admin Mode' : 'Select your view'}
        </p>
      </div>

      {/* View Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl w-full">
        {/* Team Room */}
        <Link
          href="/draft/room/team"
          className="group relative overflow-hidden rounded-2xl border-2 p-8 transition-all hover:scale-[1.02] hover:shadow-2xl"
          style={{
            borderColor: teamColors?.primary || '#be161e',
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          }}
        >
          <div className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity"
            style={{ background: `linear-gradient(135deg, ${teamColors?.primary || '#be161e'}, ${teamColors?.secondary || '#bf9944'})` }}
          />
          <div className="relative z-10">
            <div className="text-5xl mb-4">🎯</div>
            <h2 className="text-2xl font-bold text-white mb-2">Team Room</h2>
            <p className="text-zinc-400 text-sm">
              Make picks, manage your queue, view the draft board, and trade with other teams.
            </p>
            <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold"
              style={{ color: teamColors?.primary || '#be161e' }}
            >
              Enter Room
              <span className="group-hover:translate-x-1 transition-transform">→</span>
            </div>
          </div>
        </Link>

        {/* Presentation View */}
        <Link
          href="/draft/overlay"
          className="group relative overflow-hidden rounded-2xl border-2 p-8 transition-all hover:scale-[1.02] hover:shadow-2xl"
          style={{
            borderColor: teamColors?.secondary || '#bf9944',
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          }}
        >
          <div className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity"
            style={{ background: `linear-gradient(135deg, ${teamColors?.secondary || '#bf9944'}, ${teamColors?.primary || '#be161e'})` }}
          />
          <div className="relative z-10">
            <div className="text-5xl mb-4">📺</div>
            <h2 className="text-2xl font-bold text-white mb-2">Presentation View</h2>
            <p className="text-zinc-400 text-sm">
              Full-screen broadcast view with animations. Perfect for streaming or a second screen.
            </p>
            <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold"
              style={{ color: teamColors?.secondary || '#bf9944' }}
            >
              Open Broadcast
              <span className="group-hover:translate-x-1 transition-transform">→</span>
            </div>
          </div>
        </Link>
      </div>

      {/* Back link */}
      <div className="mt-10">
        <Link
          href="/draft"
          className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
        >
          ← Back to Draft Hub
        </Link>
      </div>
    </div>
  );
}
