import type { DraftState } from '@/lib/types';
import { TeamMark } from './TeamMark';

export function DraftBoard({ state, compact = false }: { state: DraftState; compact?: boolean }) {
  const picks = new Map(state.picks.map((pick) => [pick.overall, pick]));
  const teams = new Map(state.teams.map((team) => [team.id, team]));
  const rounds = state.draft?.rounds || 0;

  if (!state.draft) return <div className="empty">No draft has been created.</div>;

  return (
    <div className={compact ? 'draft-board compact' : 'draft-board'}>
      {Array.from({ length: rounds }, (_, index) => index + 1).map((round) => (
        <section className="round-column" key={round}>
          <h3>Round {round}</h3>
          {state.slots.filter((slot) => slot.round === round).map((slot) => {
            const team = teams.get(slot.teamId);
            const pick = picks.get(slot.overall);
            const active = state.draft?.currentOverall === slot.overall && state.draft.status !== 'COMPLETED';
            return (
              <div className={`board-pick ${active ? 'active' : ''}`} key={slot.overall}>
                <span className="pick-number">{slot.round}.{slot.pickInRound.toString().padStart(2, '0')}</span>
                {team && <TeamMark team={team} size="small" />}
                <span className="pick-copy">
                  <strong>{pick?.playerName || team?.name || 'Open slot'}</strong>
                  <small>{pick ? `${pick.playerPosition}${pick.playerProTeam ? ` · ${pick.playerProTeam}` : ''}` : active ? 'On the clock' : 'Waiting'}</small>
                </span>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
