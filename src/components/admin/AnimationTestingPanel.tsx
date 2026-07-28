'use client';

import { useMemo, useState } from 'react';
import DraftPickAnimation from '@/components/draft-overlay/DraftPickAnimation';
import DraftTradeAnimation, { type TradeAnimAsset } from '@/components/draft-overlay/DraftTradeAnimation';
import EndOfRoundAnimation from '@/components/draft-overlay/EndOfRoundAnimation';
import NowOnClockAnimation from '@/components/draft-overlay/NowOnClockAnimation';
import StartOfRoundAnimation from '@/components/draft-overlay/StartOfRoundAnimation';
import type { DraftState } from '@/lib/types';

type Preview = 'pick' | 'clock' | 'sequence-pick' | 'sequence-clock' | 'trade' | 'start-round' | 'end-round' | null;

export function AnimationTestingPanel({ state }: { state: DraftState }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview>(null);
  const [teamId, setTeamId] = useState(state.teams[0]?.id || '');
  const [nextTeamId, setNextTeamId] = useState(state.teams[1]?.id || state.teams[0]?.id || '');
  const [playerId, setPlayerId] = useState(state.players[0]?.id || '');
  const [overall, setOverall] = useState(1);
  const [round, setRound] = useState(1);

  const team = useMemo(() => state.teams.find((item) => item.id === teamId) || state.teams[0], [state.teams, teamId]);
  const nextTeam = useMemo(() => state.teams.find((item) => item.id === nextTeamId) || state.teams[1] || team, [nextTeamId, state.teams, team]);
  const player = useMemo(() => state.players.find((item) => item.id === playerId) || state.players[0], [playerId, state.players]);
  const pickInRound = ((Math.max(1, overall) - 1) % Math.max(1, state.teams.length)) + 1;
  const eventColor = state.branding?.primaryColor || '#bf9944';
  const eventLogo = state.branding?.logoUrl || null;
  const eventName = state.leagueName || 'Draft';

  function closePreview() {
    setPreview(null);
  }

  function teamColors(target = team): [string, string, string | null] {
    return [target?.primaryColor || '#2563eb', target?.secondaryColor || '#0f172a', null];
  }

  const tradeAssets: TradeAnimAsset[] = team && nextTeam ? [{
    fromTeam: team.name,
    toTeam: nextTeam.name,
    assetType: 'current_pick',
    pickOverall: Math.max(1, overall),
    pickRound: Math.max(1, round),
    pickOriginalTeam: team.name,
  }] : [];

  if (!state.teams.length || !state.players.length) return null;

  return (
    <section className="panel animation-testing-panel">
      <div className="animation-testing-heading">
        <div><span className="eyebrow">Testing mode</span><h2>Rehearse broadcast animations</h2><p>Preview animations locally without making picks, changing the clock, or modifying draft data.</p></div>
        <button className="button" type="button" onClick={() => setOpen((value) => !value)}>{open ? 'Close testing mode' : 'Open testing mode'}</button>
      </div>

      {open && (
        <div className="animation-testing-body">
          <div className="animation-test-fields">
            <label>Drafting team<select value={teamId} onChange={(event) => setTeamId(event.target.value)}>{state.teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Next or trade team<select value={nextTeamId} onChange={(event) => setNextTeamId(event.target.value)}>{state.teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Player<select value={playerId} onChange={(event) => setPlayerId(event.target.value)}>{state.players.slice(0, 500).map((item) => <option key={item.id} value={item.id}>{item.rank}. {item.name} · {item.position}</option>)}</select></label>
            <label>Overall pick<input type="number" min="1" max="336" value={overall} onChange={(event) => setOverall(Math.max(1, Number(event.target.value) || 1))} /></label>
            <label>Round<input type="number" min="1" max="28" value={round} onChange={(event) => setRound(Math.max(1, Math.min(28, Number(event.target.value) || 1)))} /></label>
          </div>
          <div className="animation-test-buttons">
            <button type="button" className="button primary" onClick={() => setPreview('sequence-pick')}>Full pick → on-clock sequence</button>
            <button type="button" className="button" onClick={() => setPreview('pick')}>Pick announcement only</button>
            <button type="button" className="button" onClick={() => setPreview('clock')}>On-the-clock only</button>
            <button type="button" className="button" onClick={() => setPreview('trade')}>Trade animation</button>
            <button type="button" className="button" onClick={() => setPreview('end-round')}>End-of-round animation</button>
            <button type="button" className="button" onClick={() => setPreview('start-round')}>Start-of-round animation</button>
          </div>
          <p className="animation-test-note">Testing mode uses the selected real team branding and player data, but every trigger exists only in this browser tab.</p>
        </div>
      )}

      {(preview === 'pick' || preview === 'sequence-pick') && team && player && (
        <DraftPickAnimation
          player={{ name: player.name, position: player.position, team: player.proTeam || undefined, college: player.college || undefined }}
          fantasyTeam={{ name: team.name, colors: teamColors(team), logoPath: team.logoUrl }}
          pickNumber={overall}
          round={round}
          pickInRound={pickInRound}
          eventLogoUrl={eventLogo}
          eventColor1={eventColor}
          onComplete={() => setPreview(preview === 'sequence-pick' ? 'sequence-clock' : null)}
        />
      )}
      {(preview === 'clock' || preview === 'sequence-clock') && nextTeam && (
        <NowOnClockAnimation
          team={{ name: nextTeam.name, colors: teamColors(nextTeam) }}
          pickNumber={Math.min(336, overall + 1)}
          round={round}
          pickInRound={((pickInRound) % Math.max(1, state.teams.length)) + 1}
          eventName={eventName}
          eventYear={new Date().getFullYear()}
          eventLogoUrl={eventLogo}
          eventColor1={eventColor}
          layout="broadcast"
          onComplete={closePreview}
        />
      )}
      {preview === 'trade' && team && nextTeam && (
        <DraftTradeAnimation teams={[team.name, nextTeam.name]} assets={tradeAssets} eventLogoUrl={eventLogo} eventColor1={eventColor} picksPerRound={12} onComplete={closePreview} />
      )}
      {preview === 'start-round' && <StartOfRoundAnimation roundNumber={round} eventLogoUrl={eventLogo} eventColor1={eventColor} onComplete={closePreview} />}
      {preview === 'end-round' && <EndOfRoundAnimation roundNumber={round} eventLogoUrl={eventLogo} eventColor1={eventColor} onComplete={closePreview} />}
    </section>
  );
}
