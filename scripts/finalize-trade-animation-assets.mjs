import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const tradeAnimationPath = resolve(process.cwd(), 'src/components/draft-overlay/DraftTradeAnimation.tsx');
let source = await readFile(tradeAnimationPath, 'utf8');

function replaceRequired(search, replacement, label) {
  if (source.includes(replacement)) return;
  if (!source.includes(search)) throw new Error(`[trade-animation-assets] Could not patch ${label}.`);
  source = source.replace(search, replacement);
}

const assetFunctionStart = source.indexOf('function AcquiredAsset(');
const assetFunctionEnd = source.indexOf('\nexport default function DraftTradeAnimation', assetFunctionStart);
if (assetFunctionStart < 0 || assetFunctionEnd < 0) {
  throw new Error('[trade-animation-assets] Could not locate AcquiredAsset.');
}

const responsiveAssetFunction = `function AcquiredAsset({
  asset,
  ec1,
  picksPerRound = 12,
  compact = false,
  ultraCompact = false,
}: {
  asset: TradeAnimAsset;
  ec1: string;
  picksPerRound?: number;
  compact?: boolean;
  ultraCompact?: boolean;
}) {
  const fromLogo = getTeamLogoPath(asset.fromTeam);

  const pickInRound = asset.pickOverall != null
    ? ((asset.pickOverall - 1) % picksPerRound) + 1
    : null;

  const name =
    asset.assetType === 'player' ? (asset.playerName || '—') :
    asset.assetType === 'current_pick'
      ? \`Rd \${asset.pickRound ?? '?'} · Pk \${pickInRound ?? '?'} · Overall #\${asset.pickOverall}\`
      : \`\${asset.pickYear ?? '?'} · Rd \${asset.pickRound ?? '?'} Pick\`;

  const sub =
    asset.assetType === 'future_pick' && asset.pickOriginalTeam && asset.pickOriginalTeam !== asset.fromTeam
      ? \`via \${asset.pickOriginalTeam}\` : null;

  const rowClass = ultraCompact
    ? 'gap-2 rounded-xl px-3 py-2'
    : compact
      ? 'gap-3 rounded-xl px-4 py-2.5'
      : 'gap-5 rounded-2xl px-6 py-4';
  const badgeFontSize = ultraCompact
    ? 'clamp(0.72rem,1vw,0.95rem)'
    : compact
      ? 'clamp(0.9rem,1.35vw,1.2rem)'
      : 'clamp(1.2rem,2.2vw,1.8rem)';
  const badgeMinWidth = ultraCompact ? '40px' : compact ? '50px' : '68px';
  const pickIconSize = ultraCompact
    ? 'clamp(1.2rem,1.7vw,1.7rem)'
    : compact
      ? 'clamp(1.7rem,2.4vw,2.2rem)'
      : 'clamp(2.4rem,4vw,3.4rem)';
  const nameFontSize = ultraCompact
    ? 'clamp(0.82rem,1.18vw,1.15rem)'
    : compact
      ? 'clamp(1rem,1.65vw,1.55rem)'
      : 'clamp(1.8rem,3.8vw,3.2rem)';
  const subFontSize = ultraCompact
    ? 'clamp(0.62rem,0.8vw,0.78rem)'
    : compact
      ? 'clamp(0.72rem,1vw,0.9rem)'
      : 'clamp(1rem,1.6vw,1.3rem)';
  const fromFontSize = ultraCompact
    ? 'clamp(0.58rem,0.72vw,0.72rem)'
    : compact
      ? 'clamp(0.66rem,0.9vw,0.82rem)'
      : 'clamp(0.95rem,1.5vw,1.15rem)';
  const fromLogoSize = ultraCompact ? '14px' : compact ? '17px' : '22px';

  return (
    <div className={\`gtrade-asset-row flex min-w-0 items-center \${rowClass}\`} style={{
      background: 'rgba(0,0,0,0.65)',
      border: '1px solid rgba(255,255,255,0.18)',
      minHeight: 0,
    }}>
      {asset.assetType === 'player' && asset.playerPos ? (
        <span className="font-black rounded-lg flex-shrink-0 text-white"
          style={{
            background: POS_COLORS[asset.playerPos] || '#555',
            fontSize: badgeFontSize,
            minWidth: badgeMinWidth,
            padding: ultraCompact ? '0.3rem 0.42rem' : compact ? '0.38rem 0.55rem' : '0.5rem 1rem',
            textAlign: 'center',
            lineHeight: 1.2,
            boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
          }}>
          {asset.playerPos}
        </span>
      ) : asset.assetType === 'current_pick' ? (
        <span className="font-black flex-shrink-0" style={{ color: ec1, fontSize: pickIconSize, lineHeight: 1, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.8))' }}>⦿</span>
      ) : (
        <span className="font-black flex-shrink-0 text-sky-400" style={{ fontSize: pickIconSize, lineHeight: 1, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.8))' }}>◈</span>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-black text-white" style={{
          fontSize: nameFontSize,
          lineHeight: ultraCompact ? 1.05 : 1.12,
          overflowWrap: 'anywhere',
          textShadow: '0 2px 8px rgba(0,0,0,1), 0 4px 20px rgba(0,0,0,0.8)',
          WebkitTextStroke: ultraCompact ? '0.35px rgba(0,0,0,0.4)' : '1px rgba(0,0,0,0.4)',
          paintOrder: 'stroke fill',
        }}>{name}</div>
        {sub && <div className="text-white/65 font-semibold mt-0.5" style={{ fontSize: subFontSize, lineHeight: 1.1, overflowWrap: 'anywhere', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>{sub}</div>}
        <div className={\`flex items-center gap-1.5 \${ultraCompact ? 'mt-0.5' : 'mt-1'}\`}>
          {fromLogo && <img src={fromLogo} alt={asset.fromTeam} className="object-contain flex-shrink-0" style={{ width: fromLogoSize, height: fromLogoSize, opacity: 0.85 }} />}
          <span className="font-bold text-white/75" style={{ fontSize: fromFontSize, lineHeight: 1.05, overflowWrap: 'anywhere', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>from {asset.fromTeam}</span>
        </div>
      </div>
    </div>
  );
}
`;

source = source.slice(0, assetFunctionStart) + responsiveAssetFunction + source.slice(assetFunctionEnd);

replaceRequired(
  "                  const acquired = assets.filter(a => a.toTeam === t);\n                  return (",
  "                  const acquired = assets.filter(a => a.toTeam === t);\n                  const assetColumns = acquired.length >= 9 ? 5 : acquired.length >= 7 ? 4 : acquired.length >= 4 ? 3 : acquired.length >= 2 ? 2 : 1;\n                  const compactAssets = acquired.length >= 3 || teams.length >= 3;\n                  const ultraCompactAssets = acquired.length >= 7 || (teams.length >= 3 && acquired.length >= 4);\n                  return (",
  'per-team responsive asset density',
);

replaceRequired(
  `                      {/* Assets, full width, vertically centered in remaining space */}
                      <div className="relative z-10 flex-1 flex flex-col justify-center gap-2.5 px-8 pb-4">
                        {acquired.length === 0 ? (
                          <div className="text-white/25 text-xl font-semibold">— nothing —</div>
                        ) : (
                          acquired.map((a, i) => <AcquiredAsset key={i} asset={a} ec1={ec1} picksPerRound={picksPerRound} />)
                        )}
                      </div>`,
  `                      {/* Assets expand into a responsive grid so large trades remain readable. */}
                      <div className="relative z-10 flex-1 min-h-0 px-6 pb-4">
                        {acquired.length === 0 ? (
                          <div className="flex h-full items-center text-white/25 text-xl font-semibold">— nothing —</div>
                        ) : (
                          <div
                            className="gtrade-asset-grid grid h-full min-h-0 content-center gap-2.5 overflow-hidden"
                            style={{
                              gridTemplateColumns: \`repeat(\${assetColumns}, minmax(0, 1fr))\`,
                              gridAutoRows: 'minmax(0, auto)',
                            }}
                          >
                            {acquired.map((a, i) => (
                              <AcquiredAsset
                                key={i}
                                asset={a}
                                ec1={ec1}
                                picksPerRound={picksPerRound}
                                compact={compactAssets}
                                ultraCompact={ultraCompactAssets}
                              />
                            ))}
                          </div>
                        )}
                      </div>`,
  'responsive asset grid',
);

await writeFile(tradeAnimationPath, source, 'utf8');

for (const marker of [
  'gtrade-asset-grid',
  'assetColumns = acquired.length >= 9 ? 5',
  'compact={compactAssets}',
  'ultraCompact={ultraCompactAssets}',
  "overflowWrap: 'anywhere'",
]) {
  if (!source.includes(marker)) throw new Error(`[trade-animation-assets] Missing marker: ${marker}`);
}

console.log('[trade-animation-assets] Multi-asset trade details use a responsive grid and density-aware typography.');
