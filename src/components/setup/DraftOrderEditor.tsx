'use client';

import { useMemo } from 'react';

export type DraftFormat = 'linear' | 'snake';

export type DraftOrderTeam = {
  id: string;
  name: string;
  shortName: string;
  primaryColor: string;
};

export function generateDraftOrder(baseOrder: string[], rounds: number, format: DraftFormat): string[] {
  const output: string[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const roundOrder = format === 'snake' && round % 2 === 0 ? [...baseOrder].reverse() : baseOrder;
    output.push(...roundOrder);
  }
  return output;
}

function swapValue(order: string[], index: number, nextValue: string): string[] {
  const next = [...order];
  const otherIndex = next.indexOf(nextValue);
  if (otherIndex >= 0) next[otherIndex] = next[index];
  next[index] = nextValue;
  return next;
}

export function DraftOrderEditor({
  teams,
  rounds,
  format,
  baseOrder,
  slotOrder,
  lockedOverall = [],
  stepLabel = 'Draft order',
  onFormatChange,
  onBaseOrderChange,
  onSlotOrderChange,
}: {
  teams: DraftOrderTeam[];
  rounds: number;
  format: DraftFormat;
  baseOrder: string[];
  slotOrder: string[];
  lockedOverall?: number[];
  stepLabel?: string;
  onFormatChange: (format: DraftFormat) => void;
  onBaseOrderChange: (order: string[]) => void;
  onSlotOrderChange: (order: string[]) => void;
}) {
  const locked = useMemo(() => new Set(lockedOverall), [lockedOverall]);
  const generated = useMemo(() => generateDraftOrder(baseOrder, rounds, format), [baseOrder, format, rounds]);
  const overrides = slotOrder.reduce((total, teamId, index) => total + (teamId !== generated[index] ? 1 : 0), 0);

  function moveBase(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= baseOrder.length) return;
    const next = [...baseOrder];
    [next[index], next[target]] = [next[target], next[index]];
    onBaseOrderChange(next);
  }

  function applyGenerated() {
    onSlotOrderChange(generated.map((teamId, index) => locked.has(index + 1) ? slotOrder[index] : teamId));
  }

  function resetRound(round: number) {
    const start = (round - 1) * teams.length;
    const next = [...slotOrder];
    for (let index = 0; index < teams.length; index += 1) {
      const overall = start + index + 1;
      if (!locked.has(overall)) next[start + index] = generated[start + index];
    }
    onSlotOrderChange(next);
  }

  function changeSlot(index: number, teamId: string) {
    if (locked.has(index + 1)) return;
    const next = [...slotOrder];
    next[index] = teamId;
    onSlotOrderChange(next);
  }

  return (
    <section className="setup-section draft-order-section">
      <div className="setup-section-heading">
        <div>
          <span className="eyebrow">{stepLabel}</span>
          <h2>Set the complete draft order</h2>
          <p>Choose a linear or snake base order, then customize any individual pick to account for trades. Picks already made are locked.</p>
        </div>
        <div className={`setup-count ${overrides ? '' : 'complete'}`}><strong>{overrides}</strong><span>custom pick{overrides === 1 ? '' : 's'}</span></div>
      </div>

      <div className="draft-order-toolbar">
        <div className="draft-format-choice" role="group" aria-label="Draft format">
          <button type="button" className={format === 'linear' ? 'active' : ''} onClick={() => onFormatChange('linear')}>
            <strong>Linear</strong><span>Same order every round</span>
          </button>
          <button type="button" className={format === 'snake' ? 'active' : ''} onClick={() => onFormatChange('snake')}>
            <strong>Snake</strong><span>Reverse order in even rounds</span>
          </button>
        </div>
        <button type="button" className="button primary" onClick={applyGenerated}>Apply {format} order to all unlocked picks</button>
      </div>

      <div className="base-order-panel">
        <div className="section-title">
          <div><span className="eyebrow">Base order</span><h3>Round-one team order</h3></div>
          <small>This order generates all 28 rounds before traded-pick overrides.</small>
        </div>
        <div className="base-order-grid">
          {baseOrder.map((teamId, index) => {
            const team = teams.find((item) => item.id === teamId);
            return (
              <div className="base-order-row" key={`${teamId}-${index}`}>
                <span>{index + 1}</span>
                <i style={{ background: team?.primaryColor || '#64748b' }} />
                <select value={teamId} onChange={(event) => onBaseOrderChange(swapValue(baseOrder, index, event.target.value))}>
                  {teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <div>
                  <button type="button" aria-label={`Move ${team?.name || 'team'} up`} disabled={index === 0} onClick={() => moveBase(index, -1)}>↑</button>
                  <button type="button" aria-label={`Move ${team?.name || 'team'} down`} disabled={index === baseOrder.length - 1} onClick={() => moveBase(index, 1)}>↓</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="full-order-heading">
        <div><span className="eyebrow">Pick ownership</span><h3>All {rounds * teams.length} selections</h3><p>Open any round and reassign individual selections for traded picks.</p></div>
      </div>
      <div className="round-order-list">
        {Array.from({ length: rounds }, (_, roundIndex) => {
          const round = roundIndex + 1;
          const start = roundIndex * teams.length;
          const roundSlots = slotOrder.slice(start, start + teams.length);
          const roundOverrides = roundSlots.filter((teamId, index) => teamId !== generated[start + index]).length;
          return (
            <details key={round} defaultOpen={round <= 2}>
              <summary><span>Round {round}</span><small>{roundOverrides ? `${roundOverrides} customized` : format === 'snake' && round % 2 === 0 ? 'Snake reverse' : 'Base order'}</small></summary>
              <div className="round-order-actions"><button type="button" onClick={() => resetRound(round)}>Reset round to {format}</button></div>
              <div className="round-slot-grid">
                {roundSlots.map((teamId, pickIndex) => {
                  const overall = start + pickIndex + 1;
                  const team = teams.find((item) => item.id === teamId);
                  const isLocked = locked.has(overall);
                  return (
                    <label className={`round-slot ${isLocked ? 'locked' : ''}`} key={overall}>
                      <span>{round}.{String(pickIndex + 1).padStart(2, '0')} <small>#{overall}</small></span>
                      <select value={teamId} disabled={isLocked} onChange={(event) => changeSlot(overall - 1, event.target.value)}>
                        {teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                      <i style={{ background: team?.primaryColor || '#64748b' }} />
                    </label>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
