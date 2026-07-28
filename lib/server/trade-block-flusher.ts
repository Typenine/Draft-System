import { getPendingTradeBlockEvents, getUserDocByTeam, markTradeBlockEventsSent, setUserDoc } from '@/server/db/queries.fixed';
import { TradeAsset, TradeWants } from '@/lib/server/user-store';
import { getAllPlayersCached } from '@/lib/utils/sleeper-api';

type TradeBlockEvent = {
  id: string;
  team: string;
  eventType: string;
  assetType: string | null;
  assetId: string | null;
  assetLabel: string | null;
  oldWants: string | null;
  newWants: string | null;
  createdAt: Date;
  sentAt: Date | null;
};

type TeamBatch = {
  team: string;
  added: string[];
  removed: string[];
  wantsChanged: boolean;
  newWants?: string;
  eventIds: string[];
};

type TeamEventBatch = {
  team: string;
  eventIds: string[];
  wantsChanged: boolean;
};

const TRADE_BLOCK_DEBUG = process.env.TRADE_BLOCK_DEBUG === '1' || process.env.TRADE_BLOCK_DEBUG === 'true';

function assetToKey(asset: TradeAsset): string {
  if (asset.type === 'player') return `player:${asset.playerId}`;
  if (asset.type === 'pick') return `pick:${asset.year}-${asset.round}-${asset.originalTeam}`;
  if (asset.type === 'faab') return `faab:${asset.amount ?? 0}`;
  return '';
}

function assetToLabel(asset: TradeAsset, players: Record<string, { first_name?: string; last_name?: string; position?: string; team?: string }>): string {
  if (asset.type === 'player') {
    const player = players[asset.playerId];
    if (player) {
      const pos = player.position || '';
      const team = player.team || '';
      const name = `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim() || asset.playerId;
      return `${name} (${pos}${team ? ', ' + team : ''})`;
    }
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

function diffAssets(current: TradeAsset[], baseline: TradeAsset[]) {
  const currentKeys = new Set(current.map(assetToKey).filter(Boolean));
  const baselineKeys = new Set(baseline.map(assetToKey).filter(Boolean));
  const added = current.filter((asset) => {
    const key = assetToKey(asset);
    return key && !baselineKeys.has(key);
  });
  const removed = baseline.filter((asset) => {
    const key = assetToKey(asset);
    return key && !currentKeys.has(key);
  });
  return { added, removed, currentKeys, baselineKeys };
}

function getTradeBlockBaseUrl(): string | null {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (siteUrl) return siteUrl.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return null;
}

function groupEventsByTeam(events: TradeBlockEvent[]): TeamEventBatch[] {
  const teamMap = new Map<string, TeamEventBatch>();
  for (const event of events) {
    if (!teamMap.has(event.team)) {
      teamMap.set(event.team, { team: event.team, eventIds: [], wantsChanged: false });
    }
    const entry = teamMap.get(event.team)!;
    entry.eventIds.push(event.id);
    if (event.eventType === 'wants_changed') entry.wantsChanged = true;
  }
  return Array.from(teamMap.values());
}

async function updateLastPublishedTradeBlock(params: {
  doc: { userId: string; team: string; version: number; updatedAt: Date; votes?: Record<string, Record<string, number>> | null; tradeBlock?: Array<Record<string, unknown>> | null; tradeWants?: Record<string, unknown> | null };
  currentBlock: TradeAsset[];
  currentWants: TradeWants | null;
}) {
  const nextWants: TradeWants = {
    ...(params.currentWants ?? {}),
    lastPublishedTradeBlock: params.currentBlock,
  };

  await setUserDoc({
    userId: params.doc.userId,
    team: params.doc.team,
    version: Number(params.doc.version ?? 0),
    updatedAt: params.doc.updatedAt,
    votes: (params.doc.votes as Record<string, Record<string, number>> | null) ?? null,
    tradeBlock: (params.doc.tradeBlock as Array<Record<string, unknown>> | null) ?? null,
    tradeWants: nextWants as unknown as { text?: string; positions?: string[] },
  });
}

function formatSchefterMessage(batch: TeamBatch, baseUrl: string | null): string {
  const tradeBlockUrl = baseUrl ? `${baseUrl}/trades/block` : '/trades/block';
  const parts: string[] = [];
  
  // Authentic Schefter-style variations - breaking news tone with source attribution
  const variants = {
    addSingle: [
      `Breaking: League sources say the ${batch.team} are open to moving ${batch.added[0]}.`,
      `Sources: The ${batch.team} have made ${batch.added[0]} available in trade talks.`,
      `${batch.added[0]} is now on the trade block, per sources familiar with the ${batch.team}'s plans.`,
      `Sources tell ESPN the ${batch.team} are listening on ${batch.added[0]}.`,
    ],
    addMultiple: [
      `Breaking: League sources say the ${batch.team} are open to moving {list}.`,
      `Sources: The ${batch.team} have made {list} available in trade talks.`,
      `Sources tell ESPN the ${batch.team} are listening on {list}.`,
      `Per league sources, the ${batch.team} are open to offers for {list}.`,
    ],
    removeSingle: [
      `Sources: The ${batch.team} have pulled ${batch.removed[0]} off the trade block.`,
      `${batch.removed[0]} is no longer available, per league sources.`,
      `Sources tell ESPN the ${batch.team} have decided to keep ${batch.removed[0]}.`,
      `League sources: The ${batch.team} are no longer shopping ${batch.removed[0]}.`,
    ],
    removeMultiple: [
      `Sources: The ${batch.team} have taken {list} off the market.`,
      `{list} are no longer available, per league sources.`,
      `Sources tell ESPN the ${batch.team} have decided to keep {list}.`,
      `League sources say the ${batch.team} are no longer shopping {list}.`,
    ],
    mixed: [
      `Sources: The ${batch.team} are adding {added} to the block while taking {removed} off.`,
      `Per league sources, the ${batch.team} are making {added} available but keeping {removed}.`,
      `Breaking: The ${batch.team} are shopping {added} but no longer listening on {removed}.`,
      `Sources tell ESPN: The ${batch.team} add {added} to the block and remove {removed}.`,
    ],
  };
  
  // Pick a random variant for variety
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  
  if (batch.added.length > 0 && batch.removed.length === 0) {
    // Only additions
    if (batch.added.length === 1) {
      parts.push(pick(variants.addSingle));
    } else {
      const lastAsset = batch.added[batch.added.length - 1];
      const otherAssets = batch.added.slice(0, -1).join(', ');
      const list = `${otherAssets} and ${lastAsset}`;
      parts.push(pick(variants.addMultiple).replace('{list}', list));
    }
  } else if (batch.removed.length > 0 && batch.added.length === 0) {
    // Only removals
    if (batch.removed.length === 1) {
      parts.push(pick(variants.removeSingle));
    } else {
      const lastAsset = batch.removed[batch.removed.length - 1];
      const otherAssets = batch.removed.slice(0, -1).join(', ');
      const list = `${otherAssets} and ${lastAsset}`;
      parts.push(pick(variants.removeMultiple).replace('{list}', list));
    }
  } else if (batch.added.length > 0 && batch.removed.length > 0) {
    // Both additions and removals
    const addedList = batch.added.length === 1 
      ? batch.added[0]
      : batch.added.slice(0, -1).join(', ') + ' and ' + batch.added[batch.added.length - 1];
    const removedList = batch.removed.length === 1
      ? batch.removed[0]
      : batch.removed.slice(0, -1).join(', ') + ' and ' + batch.removed[batch.removed.length - 1];
    
    parts.push(pick(variants.mixed).replace('{added}', addedList).replace('{removed}', removedList));
  }
  
  // Add wants as a follow-up sentence if changed - vary this too
  if (batch.wantsChanged && batch.newWants) {
    const wantsVariants = [
      ` The team is believed to be targeting: ${batch.newWants}.`,
      ` Sources say the ${batch.team} are looking for: ${batch.newWants}.`,
      ` According to league sources, the team's focus is on acquiring: ${batch.newWants}.`,
    ];
    parts.push(pick(wantsVariants));
  }
  
  // Link
  parts.push(`\n\n${tradeBlockUrl}`);
  
  return parts.join('');
}

async function postToDiscord(message: string): Promise<boolean> {
  const webhookUrl = process.env.DISCORD_TRADE_BLOCK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('DISCORD_TRADE_BLOCK_WEBHOOK_URL not configured');
    return false;
  }
  
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('Discord webhook failed:', res.status, text);
      return false;
    }
    
    return true;
  } catch (e) {
    console.error('Failed to post to Discord:', e);
    return false;
  }
}

export async function flushTradeBlockEvents(): Promise<{ processed: number; sent: number }> {
  try {
    // Get events older than 40 seconds
    const events = await getPendingTradeBlockEvents(40);
    console.log(`[trade-block-flusher] Found ${events.length} pending events`);
    
    if (events.length === 0) {
      return { processed: 0, sent: 0 };
    }
    
    const baseUrl = getTradeBlockBaseUrl();
    if (!baseUrl) {
      console.warn('[trade-block-flusher] Missing NEXT_PUBLIC_SITE_URL/VERCEL_URL for trade block links');
    }

    const players = await getAllPlayersCached().catch(() => ({} as Record<string, { first_name?: string; last_name?: string; position?: string; team?: string }>));

    // Group by team
    const teamBatches = groupEventsByTeam(events as TradeBlockEvent[]);
    
    let sentCount = 0;
    const sentEventIds: string[] = [];
    
    // Post each team's batch
    for (const batch of teamBatches) {
      const doc = await getUserDocByTeam(batch.team);
      if (!doc) {
        console.warn(`[trade-block-flusher] No user doc found for team ${batch.team}; skipping`);
        sentEventIds.push(...batch.eventIds);
        continue;
      }

      const currentBlock = (doc.tradeBlock as TradeAsset[] | null) ?? [];
      const currentWants = (doc.tradeWants as TradeWants | null) ?? null;
      const lastPublished = currentWants?.lastPublishedTradeBlock ?? [];

      const { added, removed, currentKeys, baselineKeys } = diffAssets(currentBlock, lastPublished);
      const addedLabels = added.map((asset) => assetToLabel(asset, players));
      const removedLabels = removed.map((asset) => assetToLabel(asset, players));

      if (TRADE_BLOCK_DEBUG) {
        console.log(`[trade-block-flusher][${batch.team}] baseline keys:`, Array.from(baselineKeys));
        console.log(`[trade-block-flusher][${batch.team}] current keys:`, Array.from(currentKeys));
        console.log(`[trade-block-flusher][${batch.team}] added:`, added.map(assetToKey));
        console.log(`[trade-block-flusher][${batch.team}] removed:`, removed.map(assetToKey));
        console.log(`[trade-block-flusher][${batch.team}] url:`, baseUrl ? `${baseUrl}/trades/block` : '/trades/block');
      }

      const messageBatch: TeamBatch = {
        team: batch.team,
        added: addedLabels,
        removed: removedLabels,
        wantsChanged: batch.wantsChanged,
        newWants: batch.wantsChanged ? (currentWants?.text ?? undefined) : undefined,
        eventIds: batch.eventIds,
      };

      // Skip if no actual changes
      if (messageBatch.added.length === 0 && messageBatch.removed.length === 0 && !messageBatch.wantsChanged) {
        sentEventIds.push(...messageBatch.eventIds);
        continue;
      }

      const message = formatSchefterMessage(messageBatch, baseUrl);
      const success = await postToDiscord(message);

      if (success) {
        sentCount++;
        sentEventIds.push(...messageBatch.eventIds);
        try {
          await updateLastPublishedTradeBlock({
            doc: {
              userId: doc.userId as string,
              team: doc.team as string,
              version: Number(doc.version ?? 0),
              updatedAt: doc.updatedAt as Date,
              votes: (doc.votes as Record<string, Record<string, number>> | null) ?? null,
              tradeBlock: (doc.tradeBlock as Array<Record<string, unknown>> | null) ?? null,
              tradeWants: (doc.tradeWants as Record<string, unknown> | null) ?? null,
            },
            currentBlock,
            currentWants,
          });
        } catch (e) {
          console.error(`[trade-block-flusher] Failed to update lastPublishedTradeBlock for ${batch.team}:`, e);
        }
      } else {
        console.error(`Failed to post trade block update for ${batch.team}`);
      }
    }
    
    // Mark events as sent
    if (sentEventIds.length > 0) {
      await markTradeBlockEventsSent(sentEventIds);
    }
    
    return { processed: events.length, sent: sentCount };
  } catch (e) {
    console.error('Failed to flush trade block events:', e);
    return { processed: 0, sent: 0 };
  }
}
