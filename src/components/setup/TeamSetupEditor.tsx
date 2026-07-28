'use client';

import type { SetupTeamInput } from '@/lib/types';

export type EditableTeam = Required<Pick<SetupTeamInput, 'name' | 'loginCode'>> & {
  shortName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
};

const PALETTES: Array<[string, string]> = [
  ['#be161e', '#bf9944'],
  ['#1d4ed8', '#0f172a'],
  ['#15803d', '#052e16'],
  ['#c2410c', '#1c1917'],
  ['#7e22ce', '#2e1065'],
  ['#0f766e', '#042f2e'],
  ['#b91c1c', '#111827'],
  ['#0369a1', '#082f49'],
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function abbreviation(name: string, index: number): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return `T${String(index + 1).padStart(2, '0')}`;
  if (words.length > 1) return words.map((word) => word[0]).join('').slice(0, 4).toUpperCase();
  return words[0].slice(0, 4).toUpperCase();
}

function safeColor(value: string, fallback: string): string {
  return HEX_COLOR.test(value.trim()) ? value.trim() : fallback;
}

function generateCode(index: number): string {
  const bytes = new Uint8Array(4);
  window.crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (byte) => byte.toString(36)).join('').slice(0, 6);
  return `team${String(index + 1).padStart(2, '0')}-${suffix}`;
}

export function createDefaultTeams(): EditableTeam[] {
  return Array.from({ length: 12 }, (_, index) => {
    const palette = PALETTES[index % PALETTES.length];
    return {
      name: `Team ${index + 1}`,
      shortName: `T${String(index + 1).padStart(2, '0')}`,
      primaryColor: palette[0],
      secondaryColor: palette[1],
      loginCode: `team${String(index + 1).padStart(2, '0')}`,
      logoUrl: '',
    };
  });
}

export function TeamSetupEditor({
  teams,
  leaguePrimary,
  leagueSecondary,
  onChange,
}: {
  teams: EditableTeam[];
  leaguePrimary: string;
  leagueSecondary: string;
  onChange: (teams: EditableTeam[]) => void;
}) {
  const complete = teams.filter((team) => team.name.trim() && team.shortName.trim() && team.loginCode.trim()).length;

  function updateTeam(index: number, patch: Partial<EditableTeam>) {
    onChange(teams.map((team, teamIndex) => teamIndex === index ? { ...team, ...patch } : team));
  }

  return (
    <section className="setup-section">
      <div className="setup-section-heading">
        <div>
          <span className="eyebrow">Step 2</span>
          <h2>Set up the 12 teams</h2>
          <p>Each team has its own branding and access code. The preview matches how its colors will appear throughout the draft room.</p>
        </div>
        <div className={`setup-count ${complete === 12 ? 'complete' : ''}`}><strong>{complete}</strong><span>of 12 complete</span></div>
      </div>

      <div className="team-setup-grid">
        {teams.map((team, index) => {
          const primary = safeColor(team.primaryColor, '#2563eb');
          const secondary = safeColor(team.secondaryColor, '#0f172a');
          const defaultShortName = abbreviation(team.name, index);
          return (
            <article className="team-setup-card" key={index}>
              <div className="team-preview" style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}>
                <div className="team-preview-logo">
                  <span>{team.shortName || defaultShortName}</span>
                  {team.logoUrl.trim() && <img src={team.logoUrl.trim()} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
                </div>
                <div><small>Team {index + 1}</small><strong>{team.name.trim() || `Team ${index + 1}`}</strong></div>
              </div>

              <div className="team-fields">
                <label>Team name
                  <input
                    value={team.name}
                    onChange={(event) => {
                      const nextName = event.target.value;
                      const shouldUpdateShortName = !team.shortName.trim() || team.shortName === abbreviation(team.name, index) || /^T\d{2}$/.test(team.shortName);
                      updateTeam(index, {
                        name: nextName,
                        ...(shouldUpdateShortName ? { shortName: abbreviation(nextName, index) } : {}),
                      });
                    }}
                    placeholder={`Team ${index + 1}`}
                    required
                  />
                </label>
                <div className="team-two-column">
                  <label>Abbreviation
                    <input value={team.shortName} maxLength={4} onChange={(event) => updateTeam(index, { shortName: event.target.value.toUpperCase() })} required />
                  </label>
                  <label>Team access code
                    <div className="inline-control">
                      <input value={team.loginCode} onChange={(event) => updateTeam(index, { loginCode: event.target.value })} required />
                      <button type="button" onClick={() => updateTeam(index, { loginCode: generateCode(index) })}>Generate</button>
                    </div>
                  </label>
                </div>
                <label>Logo URL
                  <input value={team.logoUrl} onChange={(event) => updateTeam(index, { logoUrl: event.target.value })} placeholder="Optional image URL" />
                </label>

                <div className="team-color-grid">
                  <label>Primary color
                    <div className="color-control">
                      <input type="color" value={primary} onChange={(event) => updateTeam(index, { primaryColor: event.target.value })} />
                      <input value={team.primaryColor} onChange={(event) => updateTeam(index, { primaryColor: event.target.value })} maxLength={7} aria-label={`Team ${index + 1} primary color hex`} />
                    </div>
                  </label>
                  <label>Secondary color
                    <div className="color-control">
                      <input type="color" value={secondary} onChange={(event) => updateTeam(index, { secondaryColor: event.target.value })} />
                      <input value={team.secondaryColor} onChange={(event) => updateTeam(index, { secondaryColor: event.target.value })} maxLength={7} aria-label={`Team ${index + 1} secondary color hex`} />
                    </div>
                  </label>
                </div>

                <div className="team-color-actions">
                  <button type="button" onClick={() => updateTeam(index, { primaryColor: leaguePrimary, secondaryColor: leagueSecondary })}>Use league colors</button>
                  <button type="button" onClick={() => updateTeam(index, { primaryColor: team.secondaryColor, secondaryColor: team.primaryColor })}>Swap colors</button>
                </div>
                <div className="palette-row" aria-label={`Color presets for team ${index + 1}`}>
                  {PALETTES.map(([presetPrimary, presetSecondary]) => (
                    <button
                      type="button"
                      key={`${presetPrimary}-${presetSecondary}`}
                      title={`${presetPrimary} / ${presetSecondary}`}
                      style={{ background: `linear-gradient(135deg, ${presetPrimary} 50%, ${presetSecondary} 50%)` }}
                      onClick={() => updateTeam(index, { primaryColor: presetPrimary, secondaryColor: presetSecondary })}
                    />
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
