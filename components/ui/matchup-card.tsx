'use client';

import Link from 'next/link';
import { readableAccentOnDark } from '@/lib/trades/trade-card-model';
import { getTeamColors } from '@/lib/utils/team-utils';
import {
  BroadcastTeamLogo,
  PANEL,
  broadcastBodyTextStyle,
  broadcastFaintTextStyle,
  broadcastMutedTextStyle,
} from '@/components/ui/BroadcastPanel';

interface MatchupCardProps {
  homeTeam: string;
  awayTeam: string;
  homeRosterId: number;
  awayRosterId: number;
  homeScore?: number;
  awayScore?: number;
  kickoffTime?: string;
  week: number;
  matchupId?: number;
  className?: string;
}

function TeamLine({
  team,
  rosterId,
  accent,
  score,
}: {
  team: string;
  rosterId: number;
  accent: string;
  score?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-3">
        <BroadcastTeamLogo team={team} accent={accent} size="sm" />
        <Link
          href={`/teams/${rosterId}`}
          aria-label={`View ${team} team page`}
          className="truncate text-sm font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 rounded-sm"
          style={broadcastBodyTextStyle}
        >
          {team}
        </Link>
      </div>
      {score !== undefined ? (
        <div className="shrink-0 text-base font-extrabold tabular-nums" style={broadcastBodyTextStyle}>
          {Number(score).toFixed(2)}
        </div>
      ) : null}
    </div>
  );
}

export default function MatchupCard({
  homeTeam,
  awayTeam,
  homeRosterId,
  awayRosterId,
  homeScore,
  awayScore,
  kickoffTime,
  week,
  matchupId,
  className = '',
}: MatchupCardProps) {
  const hasScores = homeScore !== undefined && awayScore !== undefined;
  const awayAccent = readableAccentOnDark(getTeamColors(awayTeam));
  const homeAccent = readableAccentOnDark(getTeamColors(homeTeam));
  const accentStops = `${awayAccent} 0%, ${awayAccent} 50%, ${homeAccent} 50%, ${homeAccent} 100%`;

  return (
    <article
      className={[
        'overflow-hidden rounded-2xl transition-shadow duration-200 hover:shadow-[0_8px_30px_rgba(0,0,0,0.45)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        background: PANEL.card,
        boxShadow: `inset 0 0 0 1px ${PANEL.border}, 0 4px 18px rgba(0,0,0,0.30)`,
      }}
    >
      <div
        className="h-[3px] w-full"
        style={{ background: `linear-gradient(90deg, ${accentStops})` }}
        aria-hidden="true"
      />

      <div
        className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
        style={{ background: PANEL.headerBg, borderBottom: `1px solid ${PANEL.hairline}` }}
      >
        <span
          className="text-[11px] font-extrabold uppercase tracking-[0.3em]"
          style={{ color: PANEL.text }}
        >
          Matchup
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider" style={broadcastFaintTextStyle}>
          Week {week}
        </span>
      </div>

      <div className="space-y-0 px-4 py-4 sm:px-5">
        <TeamLine team={awayTeam} rosterId={awayRosterId} accent={awayAccent} score={hasScores ? awayScore : undefined} />

        <div className="relative my-3 flex items-center justify-center">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2" style={{ background: PANEL.hairline }} />
          <span
            className="relative z-10 inline-flex h-6 min-w-[2rem] items-center justify-center rounded px-2 text-[10px] font-extrabold uppercase tracking-[0.25em]"
            style={{
              color: PANEL.text,
              background: PANEL.card,
              boxShadow: `inset 0 0 0 1px ${PANEL.hairline}`,
            }}
          >
            @
          </span>
        </div>

        <TeamLine team={homeTeam} rosterId={homeRosterId} accent={homeAccent} score={hasScores ? homeScore : undefined} />

        {!hasScores && kickoffTime ? (
          <div className="mt-3 rounded-xl px-3 py-2 text-center text-sm" style={{ background: PANEL.tintSoft, boxShadow: `inset 0 0 0 1px ${PANEL.hairline}` }}>
            <span style={broadcastFaintTextStyle}>Kickoff </span>
            <span style={broadcastMutedTextStyle}>{kickoffTime}</span>
          </div>
        ) : null}

        {typeof matchupId === 'number' ? (
          <div className="flex justify-end pt-3">
            <Link
              href={`/matchups/${week}/${matchupId}`}
              className="text-xs font-semibold uppercase tracking-wider hover:text-[var(--panel-text)] transition-colors"
              style={broadcastMutedTextStyle}
              aria-label={`View matchup details for Week ${week}`}
            >
              View matchup →
            </Link>
          </div>
        ) : null}
      </div>
    </article>
  );
}
