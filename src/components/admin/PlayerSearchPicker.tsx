'use client';

import { useId, useMemo, useState } from 'react';
import type { Player } from '@/lib/types';

type Props = {
  players: Player[];
  value: string;
  onChange: (playerId: string) => void;
  label?: string;
  disabled?: boolean;
};

export function PlayerSearchPicker({ players, value, onChange, label = 'Player', disabled = false }: Props) {
  const inputId = useId();
  const selected = useMemo(() => players.find((player) => player.id === value) || null, [players, value]);
  const positions = useMemo(() => [...new Set(players.map((player) => player.position))].sort(), [players]);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState('');
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players
      .filter((player) => !position || player.position === position)
      .filter((player) => !q || `${player.name} ${player.position} ${player.proTeam || ''} ${player.college || ''} ${player.rank} ${player.id}`.toLowerCase().includes(q))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  }, [players, position, query]);
  const visible = matches.slice(0, 50);

  function choose(player: Player) {
    onChange(player.id);
    setQuery(player.name);
    setActive(0);
  }

  function clear() {
    onChange('');
    setQuery('');
    setPosition('');
    setActive(0);
  }

  return (
    <div className="player-search-picker">
      <label htmlFor={inputId}>{label}</label>
      <div className="player-search-toolbar">
        <input
          id={inputId}
          role="combobox"
          aria-expanded={!selected}
          autoComplete="off"
          disabled={disabled}
          placeholder="Search name, position, NFL team, college, rank, or ID…"
          value={selected ? selected.name : query}
          onChange={(event) => { if (selected) onChange(''); setQuery(event.target.value); setActive(0); }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, visible.length - 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
            if (event.key === 'Enter' && visible[active]) { event.preventDefault(); choose(visible[active]); }
            if (event.key === 'Escape') clear();
          }}
        />
        <select aria-label="Filter by position" value={position} disabled={disabled} onChange={(event) => { setPosition(event.target.value); setActive(0); }}>
          <option value="">All positions</option>
          {positions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        {(query || selected || position) && <button type="button" className="button" onClick={clear} disabled={disabled}>Clear</button>}
      </div>

      {selected ? (
        <div className="player-search-selected">
          <div><small>Selected player</small><strong>{selected.name}</strong></div>
          <span>{selected.position}{selected.proTeam ? ` · ${selected.proTeam}` : ''}{selected.college ? ` · ${selected.college}` : ''}</span>
          <button type="button" className="button" onClick={clear} disabled={disabled}>Change</button>
        </div>
      ) : (
        <div className="player-search-popover">
          <div className="player-search-count">{matches.length.toLocaleString()} matches{matches.length > visible.length ? ` · showing first ${visible.length}` : ''}</div>
          <div className="player-search-results" role="listbox">
            {!visible.length && <div className="player-search-empty">No available players match that search.</div>}
            {visible.map((player, index) => (
              <button key={player.id} type="button" role="option" aria-selected={index === active} className={`player-search-result${index === active ? ' active' : ''}`} onMouseEnter={() => setActive(index)} onClick={() => choose(player)}>
                <span className="player-search-rank">#{player.rank}</span>
                <span className="player-search-name"><strong>{player.name}</strong><small>{player.college || 'College unavailable'}</small></span>
                <span className="player-search-meta"><b>{player.position}</b><small>{player.proTeam || 'FA'}</small></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
