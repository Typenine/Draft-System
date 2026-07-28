import { getKV } from '@/lib/server/kv';
import { TEAM_NAMES } from '@/lib/constants/league';
import { normalizeName } from '@/lib/constants/team-mapping';
import { getUserDoc as dbGetUserDoc, setUserDoc as dbSetUserDoc } from '@/server/db/queries';

export type TradeAsset =
  | { type: 'player'; playerId: string }
  | { type: 'pick'; year: number; round: number; originalTeam: string }
  | { type: 'faab'; amount?: number };

export type TradeWants = {
  text?: string;
  positions?: string[];
  // Preferred communication settings for Trade Block
  contactMethod?: 'text' | 'discord' | 'snap' | 'sleeper';
  phone?: string; // only if contactMethod === 'text'
  snap?: string;  // only if contactMethod === 'snap'
  // Internal: last published trade block baseline for Discord webhook diffing
  lastPublishedTradeBlock?: TradeAsset[];
};

export type UserDoc = {
  userId: string;
  team: string;
  version: number;
  updatedAt: string;
  tradeBlock?: TradeAsset[];
  tradeWants?: TradeWants;
  votes?: Record<string, Record<string, number>>;
};

function canonicalizeTeamName(name: string): string {
  const want = normalizeName(name);
  const found = TEAM_NAMES.find((t) => normalizeName(t) === want);
  return found || name;
}

function userBlobKey(userId: string): string {
  return `auth/users/${userId}.json`;
}

export async function readUserDoc(userId: string, team: string): Promise<UserDoc> {
  // DB first
  try {
    const row = await dbGetUserDoc(userId);
    if (row) {
      return {
        userId: row.userId as string,
        team: row.team as string,
        version: Number(row.version || 0),
        updatedAt: new Date(row.updatedAt as unknown as Date).toISOString(),
        tradeBlock: (row.tradeBlock as unknown as UserDoc['tradeBlock']) || undefined,
        tradeWants: (row.tradeWants as unknown as UserDoc['tradeWants']) || undefined,
        votes: (row.votes as unknown as UserDoc['votes']) || undefined,
      };
    }
  } catch {}
  return { userId, team: canonicalizeTeamName(team), version: 0, updatedAt: new Date().toISOString() };
}

export async function writeUserDoc(doc: UserDoc): Promise<boolean> {
  let dbOk = false;
  try {
    await dbSetUserDoc({
      userId: doc.userId,
      team: canonicalizeTeamName(doc.team),
      version: doc.version ?? 0,
      updatedAt: new Date(doc.updatedAt),
      votes: doc.votes ?? null,
      tradeBlock: (doc.tradeBlock as Array<Record<string, unknown>> | null) ?? null,
      tradeWants: (doc.tradeWants as unknown as Record<string, unknown> | null) ?? null,
    });
    dbOk = true;
  } catch {}
  return dbOk;
}

function isUserDoc(v: unknown): v is UserDoc {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.userId === 'string' &&
    typeof o.team === 'string' &&
    typeof o.version === 'number' &&
    typeof o.updatedAt === 'string'
  );
}
