import { NextResponse } from 'next/server';
import { loadDraftOwnershipForSeason } from '@/lib/server/trade-assets';
import type { NextDraftOwnership } from '@/lib/server/trade-assets';
import { buildPlayoffAwareSlotOrder } from '@/lib/server/draft-slot-order';
import { getTeamsData } from '@/lib/utils/sleeper-api';
import { CURRENT_SEASON, LEAGUE_IDS, getLeagueIdForSeason } from '@/lib/constants/league';

export async function GET(req: Request) {
  try {
    const normalizeTeam = (name: string | undefined): string =>
      String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

    const url = new URL(req.url);
    const seasonParam = url.searchParams.get('season');
    const defaultSeason = Number(CURRENT_SEASON);
    const parsedSeason = seasonParam ? Number(seasonParam) : Number.NaN;
    const targetSeason = Number.isFinite(parsedSeason) ? parsedSeason : defaultSeason;
    const sourceLeagueSeason = String(targetSeason - 1);
    const standingsLeagueId = getLeagueIdForSeason(sourceLeagueSeason) || LEAGUE_IDS.CURRENT;
    // Keep slot order tied to prior-season standings, but read tradable pick ownership
    // for the active draft year from the current league context when needed.
    const ownershipLeagueId = targetSeason === defaultSeason ? LEAGUE_IDS.CURRENT : standingsLeagueId;
    const [ownershipFromStandingsLeague, ownershipFromActiveLeague] = await Promise.all([
      loadDraftOwnershipForSeason({ leagueId: standingsLeagueId, season: targetSeason }),
      ownershipLeagueId !== standingsLeagueId
        ? loadDraftOwnershipForSeason({ leagueId: ownershipLeagueId, season: targetSeason })
        : Promise.resolve(null),
    ]);

    const ownership =
      ownershipFromStandingsLeague && ownershipFromActiveLeague
        ? {
            ...ownershipFromStandingsLeague,
            rosterIdToTeam: {
              ...ownershipFromStandingsLeague.rosterIdToTeam,
              ...ownershipFromActiveLeague.rosterIdToTeam,
            },
            ownership: (() => {
              const standingsRosterByTeam = new Map<string, number>();
              for (const [rid, team] of Object.entries(ownershipFromStandingsLeague.rosterIdToTeam)) {
                const rosterId = Number(rid);
                if (!Number.isFinite(rosterId)) continue;
                const norm = normalizeTeam(team);
                if (!norm) continue;
                standingsRosterByTeam.set(norm, rosterId);
              }

              const remapActiveRosterIdToStandings = (activeRosterId: number): number => {
                const team = ownershipFromActiveLeague.rosterIdToTeam[String(activeRosterId)];
                const norm = normalizeTeam(team);
                if (!norm) return activeRosterId;
                return standingsRosterByTeam.get(norm) ?? activeRosterId;
              };

              const remappedActiveOwnership: NextDraftOwnership['ownership'] = {};
              for (const [key, value] of Object.entries(ownershipFromActiveLeague.ownership)) {
                const [origRosterStr, roundStr] = key.split('-');
                const origRosterId = Number(origRosterStr);
                const round = Number(roundStr);
                if (!Number.isFinite(origRosterId) || !Number.isFinite(round)) continue;
                const remappedOrigRosterId = remapActiveRosterIdToStandings(origRosterId);
                const remappedKey = `${remappedOrigRosterId}-${round}`;
                const remappedOwner = remapActiveRosterIdToStandings(value.ownerRosterId);
                const remappedHistory = (value.history || []).map((h) => ({
                  ...h,
                  fromRosterId: remapActiveRosterIdToStandings(h.fromRosterId),
                  toRosterId: remapActiveRosterIdToStandings(h.toRosterId),
                }));
                const existing = remappedActiveOwnership[remappedKey];
                remappedActiveOwnership[remappedKey] = existing
                  ? {
                      ownerRosterId: remappedOwner,
                      history: [...existing.history, ...remappedHistory],
                    }
                  : {
                      ownerRosterId: remappedOwner,
                      history: remappedHistory,
                    };
              }

              const merged: NextDraftOwnership['ownership'] = {};
              const keys = new Set([
                ...Object.keys(ownershipFromStandingsLeague.ownership),
                ...Object.keys(remappedActiveOwnership),
              ]);
              for (const key of keys) {
                const a: NextDraftOwnership['ownership'][string] | undefined = ownershipFromStandingsLeague.ownership[key];
                const b: NextDraftOwnership['ownership'][string] | undefined = remappedActiveOwnership[key];
                const ownerRosterId = b?.ownerRosterId ?? a?.ownerRosterId;
                if (ownerRosterId == null) continue;
                const hist: NextDraftOwnership['ownership'][string]['history'] = [...(a?.history ?? []), ...(b?.history ?? [])];
                hist.sort((x, y) => x.timestamp - y.timestamp);
                const deduped: NextDraftOwnership['ownership'][string]['history'] = [];
                const seen = new Set<string>();
                for (const h of hist) {
                  const k = `${h.tradeId}|${h.timestamp}|${h.fromRosterId}|${h.toRosterId}`;
                  if (seen.has(k)) continue;
                  seen.add(k);
                  deduped.push(h);
                }
                merged[key] = { ownerRosterId, history: deduped };
              }
              return merged;
            })(),
            tradeSummaries: {
              ...ownershipFromStandingsLeague.tradeSummaries,
              ...ownershipFromActiveLeague.tradeSummaries,
            },
          }
        : (ownershipFromActiveLeague || ownershipFromStandingsLeague);

    const [rawTeams, slotOrderEntries] = await Promise.all([
      getTeamsData(standingsLeagueId),
      buildPlayoffAwareSlotOrder(targetSeason),
    ]);
    if (!ownership) {
      return NextResponse.json({ error: 'ownership_unavailable' }, { status: 503 });
    }

    const tradeSummaries = ownership.tradeSummaries ?? {};
    const teams = rawTeams;
    const teamByRosterId = new Map(teams.map((t) => [t.rosterId, t] as const));
    const slotOrder = slotOrderEntries.map((entry) => ({
      slot: entry.slot,
      rosterId: entry.rosterId,
      team: entry.team,
      record: entry.record,
    }));

    const slotByRoster = new Map<number, number>();
    for (const entry of slotOrder) slotByRoster.set(entry.rosterId, entry.slot);

    const roundsToShow = Math.min(4, ownership.rounds || 4);
    const roundsData = Array.from({ length: roundsToShow }, (_, i) => i + 1).map((round) => {
      const picks = slotOrder.map((slotInfo) => {
        const key = `${slotInfo.rosterId}-${round}`;
        const entry = ownership.ownership[key];
        const ownerRosterId = entry?.ownerRosterId ?? slotInfo.rosterId;
        const ownerTeam = ownership.rosterIdToTeam[String(ownerRosterId)]
          ?? teamByRosterId.get(ownerRosterId)?.teamName
          ?? `Roster ${ownerRosterId}`;
        const originalTeam = ownership.rosterIdToTeam[String(slotInfo.rosterId)]
          ?? teamByRosterId.get(slotInfo.rosterId)?.teamName
          ?? `Roster ${slotInfo.rosterId}`;
        const hist = entry?.history ?? [];
        const historyWithSummaries = hist.map((h) => ({
          tradeId: h.tradeId,
          timestamp: h.timestamp,
          fromTeam: h.fromTeam,
          toTeam: h.toTeam,
          ...(tradeSummaries[h.tradeId] ? { summary: tradeSummaries[h.tradeId] } : {}),
        }));
        const latestEv = hist.length ? hist[hist.length - 1] : null;
        const latestTradeId = latestEv?.tradeId;
        return {
          slot: slotInfo.slot,
          round,
          originalTeam,
          ownerTeam,
          originalRosterId: slotInfo.rosterId,
          ownerRosterId,
          history: historyWithSummaries,
          ...(latestTradeId && tradeSummaries[latestTradeId]
            ? { tradeSummary: tradeSummaries[latestTradeId] }
            : {}),
        };
      });
      return { round, picks };
    });

    const totals = new Map<string, { overall: number; firstTwo: number; r3: number; r4: number }>();
    const ensureTotals = (team: string) => {
      if (!totals.has(team)) totals.set(team, { overall: 0, firstTwo: 0, r3: 0, r4: 0 });
      return totals.get(team)!;
    };

    for (const [key, entry] of Object.entries(ownership.ownership)) {
      const [, roundStr] = key.split('-');
      const round = Number(roundStr);
      const ownerTeam = ownership.rosterIdToTeam[String(entry.ownerRosterId)]
        ?? teamByRosterId.get(entry.ownerRosterId)?.teamName
        ?? `Roster ${entry.ownerRosterId}`;
      const agg = ensureTotals(ownerTeam);
      agg.overall += 1;
      if (round <= 2) agg.firstTwo += 1;
      if (round === 3) agg.r3 += 1;
      if (round === 4) agg.r4 += 1;
    }

    for (const team of slotOrder.map((s) => s.team)) ensureTotals(team);

    const sortedTotals = [...totals.entries()].sort((a, b) => {
      if (b[1].overall !== a[1].overall) return b[1].overall - a[1].overall;
      if (b[1].firstTwo !== a[1].firstTwo) return b[1].firstTwo - a[1].firstTwo;
      return a[0].localeCompare(b[0]);
    });

    const sortedTopFirstTwo = [...totals.entries()].sort((a, b) => {
      if (b[1].firstTwo !== a[1].firstTwo) return b[1].firstTwo - a[1].firstTwo;
      if (b[1].overall !== a[1].overall) return b[1].overall - a[1].overall;
      return a[0].localeCompare(b[0]);
    });

    const mostOverall = sortedTotals[0]
      ? { team: sortedTotals[0][0], count: sortedTotals[0][1].overall }
      : null;
    const mostFirstTwo = sortedTopFirstTwo[0]
      ? { team: sortedTopFirstTwo[0][0], count: sortedTopFirstTwo[0][1].firstTwo }
      : null;
    const sortedTopR3 = [...totals.entries()].sort((a, b) => b[1].r3 - a[1].r3 || b[1].overall - a[1].overall || a[0].localeCompare(b[0]));
    const sortedTopR4 = [...totals.entries()].sort((a, b) => b[1].r4 - a[1].r4 || b[1].overall - a[1].overall || a[0].localeCompare(b[0]));
    const mostR3 = sortedTopR3[0] ? { team: sortedTopR3[0][0], count: sortedTopR3[0][1].r3 } : null;
    const mostR4 = sortedTopR4[0] ? { team: sortedTopR4[0][0], count: sortedTopR4[0][1].r4 } : null;

    const factoids: string[] = [];
    if (mostOverall && mostOverall.count > 0) {
      factoids.push(`${mostOverall.team} lead the war chest with ${mostOverall.count} total picks.`);
    }
    if (mostFirstTwo && mostFirstTwo.count > 0) {
      factoids.push(`${mostFirstTwo.team} control ${mostFirstTwo.count} premium picks in rounds 1-2.`);
    }
    if (mostR3 && mostR3.count > 0) {
      factoids.push(`${mostR3.team} have the most 3rd-round picks (${mostR3.count}).`);
    }
    if (mostR4 && mostR4.count > 0) {
      factoids.push(`${mostR4.team} have the most 4th-round picks (${mostR4.count}).`);
    }
    if (!factoids.length) {
      factoids.push('No trades yet — everyone still holds their original picks.');
    }

    const picksPerTeam = [...totals.entries()].map(([team, counts]) => ({
      team,
      overall: counts.overall,
      firstTwo: counts.firstTwo,
    })).sort((a, b) => b.overall - a.overall || b.firstTwo - a.firstTwo || a.team.localeCompare(b.team));

    const transfers = [] as Array<{
      round: number;
      slot: number | null;
      tradeId: string;
      timestamp: number;
      fromTeam: string;
      toTeam: string;
      originalTeam: string;
      ownerTeam: string;
      summary?: string;
    }>;

    for (const [key, entry] of Object.entries(ownership.ownership)) {
      const [origRosterIdStr, roundStr] = key.split('-');
      const round = Number(roundStr);
      const slot = slotByRoster.get(Number(origRosterIdStr)) ?? null;
      const originalTeam = ownership.rosterIdToTeam[origRosterIdStr]
        ?? teamByRosterId.get(Number(origRosterIdStr))?.teamName
        ?? `Roster ${origRosterIdStr}`;
      const ownerTeam = ownership.rosterIdToTeam[String(entry.ownerRosterId)]
        ?? teamByRosterId.get(entry.ownerRosterId)?.teamName
        ?? `Roster ${entry.ownerRosterId}`;
      for (const history of entry.history) {
        const s = tradeSummaries[history.tradeId];
        transfers.push({
          round,
          slot,
          tradeId: history.tradeId,
          timestamp: history.timestamp,
          fromTeam: history.fromTeam,
          toTeam: history.toTeam,
          originalTeam,
          ownerTeam,
          ...(s ? { summary: s } : {}),
        });
      }
    }

    transfers.sort((a, b) => b.timestamp - a.timestamp);

    return NextResponse.json({
      season: ownership.season,
      rounds: roundsToShow,
      rosterCount: ownership.rosterCount,
      generatedAt: new Date().toISOString(),
      slotOrder,
      roundsData,
      summary: {
        factoids,
        picksPerTeam,
        leaders: {
          mostOverall,
          mostFirstTwo,
          mostR3,
          mostR4,
        },
      },
      transfers,
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error) {
    console.error('Failed to build draft order data', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
