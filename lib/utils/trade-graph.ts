// Trade graph types and scaffolding utilities

import { Trade } from '@/lib/utils/trades';

// Node kinds in the trade graph
export type GraphNode =
  | { id: string; type: 'player'; label: string; playerId: string }
  | { id: string; type: 'pick'; label: string; season: string; round: number; slot: number; pickInRound?: number; becameName?: string; originalOwnerName?: string }
  | { id: string; type: 'trade'; label: string; tradeId: string; date: string; teams: string[] };

export type GraphEdge = {
  id: string;
  from: string; // source node id
  to: string;   // target node id
  kind: 'traded' | 'became';
  tradeId?: string; // present for 'traded' edges
};

export type TradeGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type RootSelector =
  | { type: 'player'; playerId: string }
  | { type: 'pick'; season: string; round: number; slot: number };

function slugPart(value: string | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function buildPickNodeId(input: {
  season: string;
  round: number;
  slot?: number;
  pickInRound?: number;
  originalOwnerName?: string;
  name?: string;
}): { id: string; slotValue: number } {
  const explicitSlot = Number.isFinite(input.slot as number) ? (input.slot as number) : undefined;
  if (typeof explicitSlot === 'number') {
    return { id: `pick:${input.season}-${input.round}-${explicitSlot}`, slotValue: explicitSlot };
  }
  const pir = Number.isFinite(input.pickInRound as number) ? (input.pickInRound as number) : undefined;
  if (typeof pir === 'number') {
    return { id: `pick:${input.season}-${input.round}-pir-${pir}`, slotValue: pir };
  }
  const owner = slugPart(input.originalOwnerName);
  if (owner) {
    return { id: `pick:${input.season}-${input.round}-owner-${owner}`, slotValue: -1 };
  }
  const name = slugPart(input.name);
  if (name) {
    return { id: `pick:${input.season}-${input.round}-name-${name}`, slotValue: -1 };
  }
  return { id: `pick:${input.season}-${input.round}-unknown`, slotValue: -1 };
}

function fallbackPickNodeId(params: {
  tradeId: string;
  teamIndex: number;
  assetIndex: number;
  name?: string;
}): string {
  const safeName = slugPart(params.name) || "pick";
  return `pick:fallback:${params.tradeId}:${params.teamIndex}:${params.assetIndex}:${safeName}`;
}

// Build a full trade graph from the provided trades
export function buildTradeGraph(trades: Trade[]): TradeGraph {
  const nodesById = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();

  const ensureNode = (node: GraphNode) => {
    if (!nodesById.has(node.id)) nodesById.set(node.id, node);
  };

  for (const trade of trades) {
    // Trade node
    const tradeNodeId = `trade:${trade.id}`;
    ensureNode({ id: tradeNodeId, type: 'trade', label: `Trade ${trade.date}`, tradeId: trade.id, date: trade.date, teams: trade.teams.map(t => t.name) });

    // Assets received by each team in this trade
    trade.teams.forEach((team, teamIndex) => {
      team.assets.forEach((asset, assetIndex) => {
        if (asset.type === 'player') {
          if (!asset.playerId) return; // skip if missing stable id
          const playerNodeId = `player:${asset.playerId}`;
          const pos = asset.position;
          const team = asset.team;
          const label = `${pos ? pos + ' - ' : ''}${asset.name}${team ? ` (${team})` : ''}`;
          ensureNode({ id: playerNodeId, type: 'player', label, playerId: asset.playerId });
          const edgeId = `traded:${trade.id}:${teamIndex}:${assetIndex}`;
          if (!edgeIds.has(edgeId)) {
            edges.push({ id: edgeId, from: tradeNodeId, to: playerNodeId, kind: 'traded', tradeId: trade.id });
            edgeIds.add(edgeId);
          }
        } else if (asset.type === 'pick') {
          const season = String(asset.year ?? asset.pick?.season ?? '');
          const round = Number(asset.round ?? asset.pick?.round);
          const slot = Number.isFinite(Number(asset.draftSlot ?? asset.pickInRound))
            ? Number(asset.draftSlot ?? asset.pickInRound)
            : undefined; // prefer stable draftSlot
          const pickInRound = asset.pickInRound;
          const becameName = (asset.became as string | undefined) || undefined;
          const originalOwnerName = (asset.originalOwner as string | undefined) || asset.pick?.originalOwner;
          const hasStructuredPick = Boolean(season) && Number.isFinite(round);
          const pickLabel = asset.name || (hasStructuredPick
            ? `${season} R${round}${typeof pickInRound === 'number' ? ` #${pickInRound}` : (typeof slot === 'number' ? ` S${slot}` : '')}`
            : 'Draft Pick');
          const pickNodeId = hasStructuredPick
            ? buildPickNodeId({
                season,
                round,
                slot,
                pickInRound,
                originalOwnerName,
                name: asset.name,
              }).id
            : fallbackPickNodeId({ tradeId: trade.id, teamIndex, assetIndex, name: asset.name });
          const slotValue = hasStructuredPick
            ? buildPickNodeId({
                season,
                round,
                slot,
                pickInRound,
                originalOwnerName,
                name: asset.name,
              }).slotValue
            : -1;
          const existing = nodesById.get(pickNodeId);
          if (!existing) {
            nodesById.set(pickNodeId, {
              id: pickNodeId,
              type: 'pick',
              label: pickLabel,
              season: hasStructuredPick ? season : 'unknown',
              round: hasStructuredPick ? round : 0,
              slot: slotValue,
              pickInRound,
              becameName,
              originalOwnerName
            });
          } else if (existing && existing.type === 'pick') {
            // Enrich existing pick node if missing fields
            nodesById.set(pickNodeId, {
              ...existing,
              label: existing.label || pickLabel,
              pickInRound: existing.pickInRound ?? pickInRound,
              becameName: existing.becameName ?? becameName,
              originalOwnerName: existing.originalOwnerName ?? originalOwnerName,
            });
          }
          const edgeId = `traded:${trade.id}:${teamIndex}:${assetIndex}`;
          if (!edgeIds.has(edgeId)) {
            edges.push({ id: edgeId, from: tradeNodeId, to: pickNodeId, kind: 'traded', tradeId: trade.id });
            edgeIds.add(edgeId);
          }

          // If the pick became a player, connect with 'became'
          const becamePlayerId = asset.becamePlayerId;
          const becameLabel = asset.became as string | undefined;
          if (becamePlayerId) {
            const playerNodeId = `player:${becamePlayerId}`;
            ensureNode({ id: playerNodeId, type: 'player', label: becameLabel || becamePlayerId, playerId: becamePlayerId });
            const becameEdgeId = `became:${pickNodeId}:${becamePlayerId}`;
            if (!edgeIds.has(becameEdgeId)) {
              edges.push({ id: becameEdgeId, from: pickNodeId, to: playerNodeId, kind: 'became' });
              edgeIds.add(becameEdgeId);
            }
          }
        }
      });
    });
  }

  return { nodes: Array.from(nodesById.values()), edges };
}

// Extract a subgraph around a root asset (stubbed)
export function getTradeSubgraphByRoot(
  trades: Trade[],
  root: RootSelector,
  options: { depth?: number } = {}
): TradeGraph {
  const depth = Math.max(1, Math.min(10, options.depth ?? 2));
  const full = buildTradeGraph(trades);

  // Build adjacency (undirected for traversal)
  const adj = new Map<string, Set<string>>();
  const addAdj = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  full.edges.forEach((e) => addAdj(e.from, e.to));

  const rootId = root.type === 'player'
    ? `player:${root.playerId}`
    : `pick:${root.season}-${root.round}-${root.slot}`;

  if (!full.nodes.some((n) => n.id === rootId)) {
    // If the root doesn't exist in the graph yet (e.g., player never involved in trades), return just the root node
    if (root.type === 'player') {
      return { nodes: [{ id: rootId, type: 'player', label: `Player ${root.playerId}`, playerId: root.playerId }], edges: [] };
    } else {
      return { nodes: [{ id: rootId, type: 'pick', label: `${root.season} R${root.round} S${root.slot}`, season: root.season, round: root.round, slot: root.slot }], edges: [] };
    }
  }

  // BFS from root up to depth
  const visited = new Set<string>([rootId]);
  const queue: Array<{ id: string; d: number }> = [{ id: rootId, d: 0 }];
  while (queue.length) {
    const { id, d } = queue.shift()!;
    if (d >= depth) continue;
    const neighbors = adj.get(id);
    if (!neighbors) continue;
    for (const nb of neighbors) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push({ id: nb, d: d + 1 });
      }
    }
  }

  const nodes = full.nodes.filter((n) => visited.has(n.id));
  const edges = full.edges.filter((e) => visited.has(e.from) && visited.has(e.to));
  return { nodes, edges };
}
