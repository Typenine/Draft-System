import { TradeAsset } from './user-store';
import { createTradeBlockEvent } from '@/server/db/queries.fixed';
import { getAllPlayersCached } from '@/lib/utils/sleeper-api';

type AssetKey = string; // Unique identifier for an asset

function assetToKey(asset: TradeAsset): AssetKey {
  if (asset.type === 'player') return `player:${asset.playerId}`;
  if (asset.type === 'pick') return `pick:${asset.year}-${asset.round}-${asset.originalTeam}`;
  if (asset.type === 'faab') return `faab:${asset.amount ?? 0}`;
  return '';
}

async function assetToLabel(asset: TradeAsset): Promise<string> {
  if (asset.type === 'player') {
    try {
      const players = await getAllPlayersCached();
      const player = players[asset.playerId];
      if (player) {
        const pos = player.position || '';
        const team = player.team || '';
        const name = `${player.first_name} ${player.last_name}`.trim();
        return `${name} (${pos}${team ? ', ' + team : ''})`;
      }
    } catch {}
    return `Player ${asset.playerId}`;
  }
  if (asset.type === 'pick') {
    return `${asset.year} Round ${asset.round} (${asset.originalTeam})`;
  }
  if (asset.type === 'faab') {
    return `$${asset.amount ?? 0} FAAB`;
  }
  return 'Unknown asset';
}

export async function captureTradeBlockChanges(params: {
  team: string;
  oldBlock: TradeAsset[];
  newBlock: TradeAsset[];
  oldWants?: string;
  newWants?: string;
}) {
  const { team, oldBlock, newBlock, oldWants, newWants } = params;
  
  console.log(`[trade-block-reporter] Capturing changes for ${team}`);
  console.log(`[trade-block-reporter] Old block: ${oldBlock.length} items, New block: ${newBlock.length} items`);
  
  // Build sets of asset keys
  const oldKeys = new Set(oldBlock.map(assetToKey));
  const newKeys = new Set(newBlock.map(assetToKey));
  
  // Find added and removed assets
  const added: TradeAsset[] = [];
  const removed: TradeAsset[] = [];
  
  for (const asset of newBlock) {
    const key = assetToKey(asset);
    if (!oldKeys.has(key)) added.push(asset);
  }
  
  for (const asset of oldBlock) {
    const key = assetToKey(asset);
    if (!newKeys.has(key)) removed.push(asset);
  }
  
  console.log(`[trade-block-reporter] Added: ${added.length}, Removed: ${removed.length}`);
  
  // Create events for added assets
  for (const asset of added) {
    try {
      const label = await assetToLabel(asset);
      await createTradeBlockEvent({
        team,
        eventType: 'added',
        assetType: asset.type,
        assetId: assetToKey(asset),
        assetLabel: label,
      });
    } catch (e) {
      console.error('Failed to create trade block event for added asset:', e);
    }
  }
  
  // Create events for removed assets
  for (const asset of removed) {
    try {
      const label = await assetToLabel(asset);
      await createTradeBlockEvent({
        team,
        eventType: 'removed',
        assetType: asset.type,
        assetId: assetToKey(asset),
        assetLabel: label,
      });
    } catch (e) {
      console.error('Failed to create trade block event for removed asset:', e);
    }
  }
  
  // Create event for wants change (if changed)
  const oldWantsText = (oldWants || '').trim();
  const newWantsText = (newWants || '').trim();
  if (oldWantsText !== newWantsText) {
    try {
      await createTradeBlockEvent({
        team,
        eventType: 'wants_changed',
        oldWants: oldWantsText || null,
        newWants: newWantsText || null,
      });
    } catch (e) {
      console.error('Failed to create trade block event for wants change:', e);
    }
  }
}
