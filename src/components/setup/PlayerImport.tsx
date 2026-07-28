'use client';

import { useMemo, useState } from 'react';
import type { SetupPlayerInput } from '@/lib/types';

type FieldKey = 'rank' | 'name' | 'position' | 'proTeam' | 'college' | 'id';
type ColumnMap = Record<FieldKey, number | null>;
type ParsedSource = { headers: string[]; rows: string[][]; sourceName: string; hasHeader: boolean };
type PreviewRow = { player: SetupPlayerInput | null; errors: string[]; sourceRow: number };

const FIELD_DEFINITIONS: Array<{ key: FieldKey; label: string; required: boolean }> = [
  { key: 'rank', label: 'Rank', required: false },
  { key: 'name', label: 'Player name', required: true },
  { key: 'position', label: 'Position', required: true },
  { key: 'proTeam', label: 'NFL team', required: false },
  { key: 'college', label: 'College', required: false },
  { key: 'id', label: 'Unique ID', required: false },
];

const HEADER_ALIASES: Record<FieldKey, string[]> = {
  rank: ['rank', 'rk', 'overall', 'adp', 'ranking'],
  name: ['name', 'player', 'playername', 'fullname', 'displayname'],
  position: ['position', 'pos', 'fantasyposition'],
  proTeam: ['team', 'nflteam', 'proteam', 'teamabbr', 'activeteam'],
  college: ['college', 'school', 'university'],
  id: ['id', 'playerid', 'sleeperid', 'uniqueid'],
};

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function delimiterCount(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    else if (!quoted && line[index] === delimiter) count += 1;
  }
  return count;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || '';
  return [',', '\t', ';'].sort((left, right) => delimiterCount(firstLine, right) - delimiterCount(firstLine, left))[0];
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(field.trim());
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  row.push(field.trim());
  if (row.some((value) => value.length)) rows.push(row);
  return rows;
}

function primitiveValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(primitiveValue).filter(Boolean).join('|');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function parseJsonSource(text: string, sourceName: string): ParsedSource {
  const parsed = JSON.parse(text) as unknown;
  let objects: Array<Record<string, unknown>> = [];

  if (Array.isArray(parsed)) {
    objects = parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  } else if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.players)) {
      objects = record.players.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
    } else {
      objects = Object.entries(record)
        .filter(([, value]) => Boolean(value) && typeof value === 'object' && !Array.isArray(value))
        .map(([key, value]) => ({ id: key, ...(value as Record<string, unknown>) }));
    }
  }

  if (!objects.length) throw new Error('No player records were found in that JSON file.');
  objects = objects.map((item) => {
    if (!item.full_name && (item.first_name || item.last_name)) {
      return { ...item, full_name: [item.first_name, item.last_name].filter(Boolean).join(' ') };
    }
    return item;
  });

  const headerSet = new Set<string>();
  objects.slice(0, 200).forEach((item) => Object.keys(item).forEach((key) => headerSet.add(key)));
  const headers = Array.from(headerSet);
  return {
    headers,
    rows: objects.map((item) => headers.map((header) => primitiveValue(item[header]))),
    sourceName,
    hasHeader: true,
  };
}

function autoMap(headers: string[], hasHeader: boolean): ColumnMap {
  const mapping: ColumnMap = { rank: null, name: null, position: null, proTeam: null, college: null, id: null };
  if (!hasHeader) {
    mapping.rank = headers[0] ? 0 : null;
    mapping.name = headers[1] ? 1 : null;
    mapping.position = headers[2] ? 2 : null;
    mapping.proTeam = headers[3] ? 3 : null;
    mapping.college = headers[4] ? 4 : null;
    mapping.id = headers[5] ? 5 : null;
    return mapping;
  }

  const normalized = headers.map(normalizeHeader);
  FIELD_DEFINITIONS.forEach(({ key }) => {
    const aliases = HEADER_ALIASES[key];
    const index = normalized.findIndex((header) => aliases.includes(header));
    mapping[key] = index >= 0 ? index : null;
  });
  return mapping;
}

function parseSource(text: string, sourceName: string): { parsed: ParsedSource; mapping: ColumnMap } {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('The selected file is empty.');
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || sourceName.toLowerCase().endsWith('.json')) {
    const parsed = parseJsonSource(trimmed, sourceName);
    return { parsed, mapping: autoMap(parsed.headers, true) };
  }

  const rows = parseDelimited(trimmed, detectDelimiter(trimmed));
  if (!rows.length) throw new Error('No player rows were found.');
  const normalizedFirstRow = rows[0].map(normalizeHeader);
  const headerMatches = normalizedFirstRow.filter((header) => Object.values(HEADER_ALIASES).some((aliases) => aliases.includes(header))).length;
  const hasHeader = headerMatches >= 2;
  const width = Math.max(...rows.map((row) => row.length));
  const headers = hasHeader ? rows[0].map((header, index) => header || `Column ${index + 1}`) : Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  const parsed: ParsedSource = { headers, rows: hasHeader ? rows.slice(1) : rows, sourceName, hasHeader };
  return { parsed, mapping: autoMap(headers, hasHeader) };
}

function downloadTemplate() {
  const template = [
    'rank,name,position,nfl_team,college,id',
    '1,Patrick Mahomes,QB,KC,Texas Tech,mahomes-patrick',
    '2,Micah Parsons,EDGE,DAL,Penn State,parsons-micah',
  ].join('\n');
  const url = URL.createObjectURL(new Blob([template], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'draft-player-import-template.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PlayerImport({
  selectedCount,
  requiredCount,
  onPlayersChange,
}: {
  selectedCount: number;
  requiredCount: number;
  onPlayersChange: (players: SetupPlayerInput[]) => void;
}) {
  const [parsed, setParsed] = useState<ParsedSource | null>(null);
  const [mapping, setMapping] = useState<ColumnMap>({ rank: null, name: null, position: null, proTeam: null, college: null, id: null });
  const [pasteValue, setPasteValue] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [appliedSource, setAppliedSource] = useState<string | null>(null);

  function loadText(text: string, sourceName: string) {
    try {
      const result = parseSource(text, sourceName);
      setParsed(result.parsed);
      setMapping(result.mapping);
      setImportError(null);
      setAppliedSource(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Unable to read that player file.');
      setParsed(null);
    }
  }

  const preview = useMemo(() => {
    if (!parsed) return { rows: [] as PreviewRow[], players: [] as SetupPlayerInput[], invalid: 0, positions: [] as Array<[string, number]> };
    const seen = new Set<string>();
    const positionCounts = new Map<string, number>();
    const rows: PreviewRow[] = parsed.rows.map((row, index) => {
      const value = (field: FieldKey) => mapping[field] === null ? '' : String(row[mapping[field] as number] || '').trim();
      const name = value('name');
      const position = value('position').toUpperCase();
      const errors: string[] = [];
      if (!name) errors.push('Missing name');
      if (!position) errors.push('Missing position');
      const duplicateKey = `${name.toLowerCase()}|${position}|${value('proTeam').toLowerCase()}`;
      if (name && position && seen.has(duplicateKey)) errors.push('Duplicate player');
      if (name && position) seen.add(duplicateKey);
      const rankValue = Number(value('rank'));
      const player: SetupPlayerInput | null = errors.length ? null : {
        id: value('id') || undefined,
        rank: Number.isFinite(rankValue) && rankValue > 0 ? rankValue : index + 1,
        name,
        position,
        proTeam: value('proTeam') || null,
        college: value('college') || null,
      };
      if (player) positionCounts.set(position, (positionCounts.get(position) || 0) + 1);
      return { player, errors, sourceRow: index + (parsed.hasHeader ? 2 : 1) };
    });
    const players = rows.flatMap((row) => row.player ? [row.player] : []);
    return {
      rows,
      players,
      invalid: rows.length - players.length,
      positions: Array.from(positionCounts.entries()).sort((left, right) => right[1] - left[1]),
    };
  }, [mapping, parsed]);

  const missingRequiredMapping = mapping.name === null || mapping.position === null;

  return (
    <section className="setup-section player-import-section">
      <div className="setup-section-heading">
        <div>
          <span className="eyebrow">Step 3</span>
          <h2>Import the draftable players</h2>
          <p>Upload CSV, TSV, TXT, or JSON. The importer recognizes common Sleeper-style fields, lets you correct the column mapping, and previews errors before anything is saved.</p>
        </div>
        <div className={`setup-count ${selectedCount >= requiredCount ? 'complete' : ''}`}><strong>{selectedCount}</strong><span>players selected</span></div>
      </div>

      <div className="player-import-grid">
        <div className="import-source-panel">
          <label className="file-drop">
            <input
              type="file"
              accept=".csv,.tsv,.txt,.json,text/csv,text/tab-separated-values,application/json"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 15 * 1024 * 1024) {
                  setImportError('Player import files must be smaller than 15 MB.');
                  return;
                }
                loadText(await file.text(), file.name);
              }}
            />
            <strong>Choose a player file</strong>
            <span>CSV, TSV, TXT, or JSON · up to 15 MB</span>
          </label>
          <div className="import-divider"><span>or paste data</span></div>
          <textarea
            rows={8}
            value={pasteValue}
            onChange={(event) => setPasteValue(event.target.value)}
            placeholder="Paste a spreadsheet export or JSON player list here"
            spellCheck={false}
          />
          <div className="import-source-actions">
            <button type="button" className="button" disabled={!pasteValue.trim()} onClick={() => loadText(pasteValue, 'Pasted player data')}>Parse pasted data</button>
            <button type="button" className="button" onClick={downloadTemplate}>Download CSV template</button>
          </div>
          {importError && <p className="form-message error">{importError}</p>}
        </div>

        <div className="import-status-panel">
          <div className="import-status-summary">
            <div><small>Current pool</small><strong>{selectedCount}</strong></div>
            <div><small>Minimum needed</small><strong>{requiredCount}</strong></div>
            <div><small>Still needed</small><strong>{Math.max(0, requiredCount - selectedCount)}</strong></div>
          </div>
          <p>A 12-team, 28-round draft needs at least {requiredCount} valid players. Importing more than that is recommended so teams have choices late in the draft.</p>
          {appliedSource && <div className="import-applied">Using {selectedCount} players from <strong>{appliedSource}</strong>.</div>}
        </div>
      </div>

      {parsed && (
        <div className="import-review">
          <div className="import-review-heading">
            <div><span className="eyebrow">Review import</span><h3>{parsed.sourceName}</h3><p>{parsed.rows.length} data rows detected{parsed.hasHeader ? ' with a header row' : ' without a header row'}.</p></div>
            <div className="import-review-counts"><span className="valid">{preview.players.length} valid</span><span className={preview.invalid ? 'invalid' : ''}>{preview.invalid} needs attention</span></div>
          </div>

          <div className="column-mapping">
            {FIELD_DEFINITIONS.map((field) => (
              <label key={field.key}>{field.label}{field.required && <em>Required</em>}
                <select value={mapping[field.key] ?? ''} onChange={(event) => setMapping({ ...mapping, [field.key]: event.target.value === '' ? null : Number(event.target.value) })}>
                  <option value="">Not included</option>
                  {parsed.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header}</option>)}
                </select>
              </label>
            ))}
          </div>

          {missingRequiredMapping && <p className="form-message error">Map both Player name and Position before applying this import.</p>}

          <div className="position-summary">
            {preview.positions.slice(0, 14).map(([position, count]) => <span key={position}><strong>{position}</strong>{count}</span>)}
          </div>

          <div className="player-preview-table-wrap">
            <table className="player-preview-table">
              <thead><tr><th>Source row</th><th>Rank</th><th>Name</th><th>Position</th><th>NFL team</th><th>College</th><th>Status</th></tr></thead>
              <tbody>
                {preview.rows.slice(0, 20).map((row) => (
                  <tr key={row.sourceRow} className={row.errors.length ? 'row-error' : ''}>
                    <td>{row.sourceRow}</td>
                    <td>{row.player?.rank ?? '—'}</td>
                    <td>{row.player?.name || '—'}</td>
                    <td>{row.player?.position || '—'}</td>
                    <td>{row.player?.proTeam || '—'}</td>
                    <td>{row.player?.college || '—'}</td>
                    <td>{row.errors.length ? row.errors.join(', ') : 'Ready'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 20 && <p className="field-help">Showing the first 20 rows. All {preview.rows.length} rows will be validated and imported.</p>}

          <div className="import-apply-bar">
            <div><small>Ready to apply</small><strong>{preview.players.length} valid players</strong>{preview.invalid > 0 && <span>{preview.invalid} invalid rows will be skipped.</span>}</div>
            <button
              type="button"
              className="button primary"
              disabled={missingRequiredMapping || preview.players.length === 0}
              onClick={() => {
                onPlayersChange(preview.players);
                setAppliedSource(parsed.sourceName);
              }}
            >Use these players</button>
          </div>
        </div>
      )}
    </section>
  );
}
