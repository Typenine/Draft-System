import { DRAFTABLE_PLAYER_SOURCE } from '@/data/draftable-player-source';

const number = new Intl.NumberFormat('en-US');

export function DraftablePlayerSource() {
  const source = DRAFTABLE_PLAYER_SOURCE;
  const synced = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(source.syncedAt));

  return (
    <section className="setup-section player-source-section">
      <div className="setup-section-heading">
        <div>
          <span className="eyebrow">Step 3</span>
          <h2>Draftable player pool</h2>
          <p>The draft will automatically use every player from the linked spreadsheet’s <strong>Draftable Players</strong> tab. No upload or column mapping is required.</p>
        </div>
        <div className="setup-count complete"><strong>{number.format(source.playerCount)}</strong><span>players ready</span></div>
      </div>

      <div className="sheet-source-card">
        <div className="sheet-source-mark">GS</div>
        <div className="sheet-source-details">
          <span className="eyebrow">Google Sheets source</span>
          <h3>{source.spreadsheetTitle}</h3>
          <p><strong>{source.sheetName}</strong> tab · snapshot synced {synced}</p>
          <div className="position-summary">
            {Object.entries(source.positionCounts).map(([position, count]) => (
              <span key={position}><strong>{position}</strong>{number.format(count)}</span>
            ))}
          </div>
        </div>
        <a className="button sheet-source-link" href={source.sourceUrl} target="_blank" rel="noreferrer">Open source sheet</a>
      </div>

      <div className="sheet-source-note">
        <strong>Player pool is already loaded.</strong>
        <span>Creating the league will insert all {number.format(source.playerCount)} players into the standalone draft database.</span>
      </div>
    </section>
  );
}
