import { gunzipSync } from 'node:zlib';
import payload1 from '@/data/draftable-players-payload-1';
import payload2 from '@/data/draftable-players-payload-2';
import payload3 from '@/data/draftable-players-payload-3';
import payload4 from '@/data/draftable-players-payload-4';
import { DRAFTABLE_PLAYER_SOURCE } from '@/data/draftable-player-source';
import type { SetupPlayerInput } from '@/lib/types';

let cachedPlayers: SetupPlayerInput[] | null = null;

export function getDraftablePlayers(): SetupPlayerInput[] {
  if (cachedPlayers) return cachedPlayers;
  const encoded = payload1 + payload2 + payload3 + payload4;
  const decoded = gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
  const players = JSON.parse(decoded) as SetupPlayerInput[];
  if (!Array.isArray(players) || players.length !== DRAFTABLE_PLAYER_SOURCE.playerCount) {
    throw new Error('draftable_player_source_invalid');
  }
  cachedPlayers = players;
  return cachedPlayers;
}
