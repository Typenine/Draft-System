'use client';

import { useDeferredValue, useId, useMemo, useState } from 'react';
import type { Player } from '@/lib/types';

type Props = {
  players: Player[];
  value: string;
  onChange: (playerId: string) => void;
  label?: string;
  disabled?: boolean;
};

type PositionGroup = 'all' | 'offense' | 'idp';
type SortMode = 'relevance' | 'rank' | 'name' | 'position';

const OFFENSE = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
const IDP = new Set(['DL', 'DE', 'DT', 'LB', 'CB', 'S', 'DB', 'IDP']);
const PAGE_SIZE = 100;

function normalize(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function fieldScore(field: string, term: string, weight: number): number {
  if (!field) return -1;
  if (field === term) return weight + 80;
  if (field.startsWith(term)) return weight + 45;
  if (field.split(' ').some((word) => word.startsWith(term))) return weight + 30;
  if (field.includes(term)) return weight + 12;
  return -1;
}

function relevance(player: Player, query: string): number | null {
  const terms = normalize(query).split(' ').filter(Boolean);
  if (!terms.length) return 0;
  const fields = [
    [normalize(player.name), 140],
    [normalize(player.id), 115],
    [normalize(player.proTeam), 70],
    [normalize(player.college), 55],
    [normalize(player.position), 45],
    [normalize(player.rank), 30],
  ] as const;

  let total = 0;
  for (const term of terms) {
    const best = Math.max(...fields.map(([field, weight]) => fieldScore(field, term, weight)));
    if (best < 0) return null;
    total += best;
  }
  if (normalize(player.name) === normalize(query)) total += 500;
  return total;
}

export function PlayerSearchPicker({ players, value, onChange, label = 'Player', disabled = false }: Props) {
  const inputId = useId();
  const selected = useMemo(() => players.find((player) => player.id === value) || null, [players, value]);
  const positions = useMemo(() => [...new Set(players.map((player) => player.position).filter(Boolean))].sort(), [players]);
  const proTeams = useMemo(() => [...new Set(players.map((player) => player.proTeam || 'FA'))].sort(), [players]);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [positionGroup, setPositionGroup] = useState<PositionGroup>('all');
  const [position, setPosition] = useState('');
  const [proTeam, setProTeam] = useState('');
  const [college, setCollege] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('relevance');
  const [active, setActive] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const matches = useMemo(() => {
    const collegeFilter = normalize(college);
    return players
      .map((player) => ({ player, score: relevance(player, deferredQuery) }))
      .filter(({ player, score }) => {
        if (score == null) return false;
        if (positionGroup === 'offense' && !OFFENSE.has(player.position)) return false;
        if (positionGroup === 'idp' && !IDP.has(player.position)) return false;
        if (position && player.position !== position) return false;
        if (proTeam && (player.proTeam || 'FA') !== proTeam) return false;
        if (collegeFilter && !normalize(player.college).includes(collegeFilter)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortMode === 'name') return a.player.name.localeCompare(b.player.name) || a.player.rank - b.player.rank;
        if (sortMode === 'position') return a.player.position.localeCompare(b.player.position) || a.player.rank - b.player.rank;
        if (sortMode === 'relevance' && deferredQuery.trim() && b.score !== a.score) return (b.score ?? -1) - (a.score ?? -1);
        return a.player.rank - b.player.rank || a.player.name.localeCompare(b.player.name);
      })
      .map(({ player }) => player);
  }, [college, deferredQuery, players, position, positionGroup, proTeam, sortMode]);

  const visible = matches.slice(0, visibleCount);
  const hasFilters = Boolean(query || position || proTeam || college || positionGroup !== 'all' || sortMode !== 'relevance');

  function resetCursor() {
    setActive(0);
    setVisibleCount(PAGE_SIZE);
  }

  function choose(player: Player) {
    onChange(player.id);
    setQuery('');
    setActive(0);
  }

  function clearAll() {
    onChange('');
    setQuery('');
    setPositionGroup('all');
    setPosition('');
    setProTeam('');
    setCollege('');
    setSortMode('relevance');
    resetCursor();
  }

  if (selected) {
    return (
      <div className="player-browser">
        <span className="player-browser-label">{label}</span>
        <div className="player-browser-selected">
          <span className="player-browser-rank">#{selected.rank}</span>
          <div><small>Selected player</small><strong>{selected.name}</strong><span>{selected.position} · {selected.proTeam || 'FA'}{selected.college ? ` · ${selected.college}` : ''}</span></div>
          <button type="button" className="button" onClick={() => onChange('')} disabled={disabled}>Change player</button>
        </div>
      </div>
    );
  }

  return (
    <div className="player-browser">
      <label className="player-browser-label" htmlFor={inputId}>{label}</label>
      <div className="player-browser-groups" aria-label="Position group">
        {([['all', 'All players'], ['offense', 'Offense'], ['idp', 'IDP']] as const).map(([group, copy]) => (
          <button key={group} type="button" className={positionGroup === group ? 'active' : ''} aria-pressed={positionGroup === group} disabled={disabled} onClick={() => { setPositionGroup(group); resetCursor(); }}>{copy}</button>
        ))}
      </div>
      <div className="player-browser-search-row">
        <input
          id={inputId}
          role="combobox"
          aria-expanded="true"
          aria-controls={`${inputId}-results`}
          aria-activedescendant={visible[active] ? `${inputId}-${visible[active].id}` : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder="Search player name, NFL team, college, rank, or player ID…"
          value={query}
          onChange={(event) => { setQuery(event.target.value); resetCursor(); }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, Math.max(0, visible.length - 1))); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
            if (event.key === 'Enter' && visible[active]) { event.preventDefault(); choose(visible[active]); }
            if (event.key === 'Escape') clearAll();
          }}
        />
        {hasFilters && <button type="button" className="button" onClick={clearAll} disabled={disabled}>Clear filters</button>}
      </div>
      <div className="player-browser-filters">
        <label>Position<select value={position} disabled={disabled} onChange={(event) => { setPosition(event.target.value); resetCursor(); }}><option value="">All positions</option>{positions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>NFL team<select value={proTeam} disabled={disabled} onChange={(event) => { setProTeam(event.target.value); resetCursor(); }}><option value="">All NFL teams</option>{proTeams.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>College<input value={college} disabled={disabled} placeholder="Any college" onChange={(event) => { setCollege(event.target.value); resetCursor(); }} /></label>
        <label>Sort<select value={sortMode} disabled={disabled} onChange={(event) => { setSortMode(event.target.value as SortMode); resetCursor(); }}><option value="relevance">Best match</option><option value="rank">Overall rank</option><option value="name">Player name</option><option value="position">Position</option></select></label>
      </div>

      <div className="player-browser-summary"><strong>{matches.length.toLocaleString()} available players</strong><span>Showing {Math.min(visible.length, matches.length).toLocaleString()}</span></div>
      <div className="player-browser-results" id={`${inputId}-results`} role="listbox">
        <div className="player-browser-head" aria-hidden="true"><span>Rank</span><span>Player</span><span>Pos.</span><span>NFL</span><span>College</span><span /></div>
        {!visible.length && <div className="player-browser-empty">No available players match those filters.</div>}
        {visible.map((player, index) => (
          <button
            id={`${inputId}-${player.id}`}
            key={player.id}
            type="button"
            role="option"
            aria-selected={index === active}
            className={`player-browser-result${index === active ? ' active' : ''}`}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(player)}
            disabled={disabled}
          >
            <span className="player-browser-rank">#{player.rank}</span>
            <strong>{player.name}</strong>
            <b>{player.position}</b>
            <span>{player.proTeam || 'FA'}</span>
            <span title={player.college || undefined}>{player.college || '—'}</span>
            <em>Select</em>
          </button>
        ))}
      </div>
      {visible.length < matches.length && <button type="button" className="button player-browser-more" disabled={disabled} onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, matches.length - visible.length)} more players</button>}
    </div>
  );
}
