import { getDb } from './client';
import { sql } from 'drizzle-orm';
import type { RivalryCycle, RivalrySubmission, RivalryPair, CalculatedPair } from '@/lib/rivalry/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return String(v);
}

function rowToCycle(r: Record<string, unknown>): RivalryCycle {
  return {
    id: String(r.id),
    status: r.status as RivalryCycle['status'],
    openedAt: toIso(r.opened_at),
    closedAt: toIso(r.closed_at),
    calculatedAt: toIso(r.calculated_at),
    publishedAt: toIso(r.published_at),
    createdAt: toIso(r.created_at) ?? new Date().toISOString(),
  };
}

function rowToSubmission(r: Record<string, unknown>): RivalrySubmission {
  return {
    cycleId: String(r.cycle_id),
    teamId: String(r.team_id),
    submittedAt: toIso(r.submitted_at) ?? new Date().toISOString(),
    scores: (r.scores as RivalrySubmission['scores']) ?? [],
    reopenedAt: toIso(r.reopened_at),
  };
}

function rowToPair(r: Record<string, unknown>): RivalryPair {
  return {
    id: String(r.id),
    cycleId: String(r.cycle_id),
    teamAId: String(r.team_a_id),
    teamBId: String(r.team_b_id),
    teamAScoreForB: Number(r.team_a_score_for_b),
    teamBScoreForA: Number(r.team_b_score_for_a),
    combinedScore: Number(r.combined_score),
    isBloodFeud: Number(r.is_blood_feud) === 1,
    status: r.status as RivalryPair['status'],
    lockedAt: toIso(r.locked_at),
  };
}

function rows(res: unknown): Record<string, unknown>[] {
  return ((res as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[];
}

// ── cycle ─────────────────────────────────────────────────────────────────────

export async function getLatestCycle(): Promise<RivalryCycle | null> {
  try {
    const db = getDb();
    const res = await db.execute(
      sql`SELECT * FROM rivalry_cycles ORDER BY created_at DESC LIMIT 1`,
    );
    const r = rows(res)[0];
    return r ? rowToCycle(r) : null;
  } catch {
    return null;
  }
}

export async function createCycle(): Promise<RivalryCycle | null> {
  try {
    const db = getDb();
    const res = await db.execute(
      sql`INSERT INTO rivalry_cycles (status) VALUES ('not_started') RETURNING *`,
    );
    const r = rows(res)[0];
    return r ? rowToCycle(r) : null;
  } catch {
    return null;
  }
}

export async function updateCycleStatus(
  cycleId: string,
  status: RivalryCycle['status'],
  timestamps: {
    openedAt?: string;
    closedAt?: string;
    calculatedAt?: string;
    publishedAt?: string;
  } = {},
): Promise<boolean> {
  try {
    const db = getDb();
    const sets: string[] = [`status = '${status}'`];
    if (timestamps.openedAt) sets.push(`opened_at = '${timestamps.openedAt}'`);
    if (timestamps.closedAt) sets.push(`closed_at = '${timestamps.closedAt}'`);
    if (timestamps.calculatedAt) sets.push(`calculated_at = '${timestamps.calculatedAt}'`);
    if (timestamps.publishedAt) sets.push(`published_at = '${timestamps.publishedAt}'`);
    await db.execute(
      sql.raw(`UPDATE rivalry_cycles SET ${sets.join(', ')} WHERE id = '${cycleId}'`),
    );
    return true;
  } catch {
    return false;
  }
}

// ── submissions ──────────────────────────────────────────────────────────────

export async function getSubmissionsForCycle(cycleId: string): Promise<RivalrySubmission[]> {
  try {
    const db = getDb();
    const res = await db.execute(
      sql`SELECT * FROM rivalry_submissions WHERE cycle_id = ${cycleId}::uuid`,
    );
    return rows(res).map(rowToSubmission);
  } catch {
    return [];
  }
}

export async function getSubmission(cycleId: string, teamId: string): Promise<RivalrySubmission | null> {
  try {
    const db = getDb();
    const res = await db.execute(
      sql`SELECT * FROM rivalry_submissions WHERE cycle_id = ${cycleId}::uuid AND team_id = ${teamId} LIMIT 1`,
    );
    const r = rows(res)[0];
    return r ? rowToSubmission(r) : null;
  } catch {
    return null;
  }
}

// Authorization is the caller's responsibility; this function always overwrites if a row exists.
export async function upsertSubmission(sub: Omit<RivalrySubmission, 'reopenedAt'>): Promise<boolean> {
  try {
    const db = getDb();
    const scoresJson = JSON.stringify(sub.scores);
    const existing = await getSubmission(sub.cycleId, sub.teamId);
    if (existing) {
      await db.execute(
        sql`UPDATE rivalry_submissions
            SET scores = ${scoresJson}::jsonb,
                submitted_at = ${sub.submittedAt},
                reopened_at = NULL
            WHERE cycle_id = ${sub.cycleId}::uuid AND team_id = ${sub.teamId}`,
      );
    } else {
      await db.execute(
        sql`INSERT INTO rivalry_submissions (cycle_id, team_id, submitted_at, scores)
            VALUES (${sub.cycleId}::uuid, ${sub.teamId}, ${sub.submittedAt}, ${scoresJson}::jsonb)`,
      );
    }
    return true;
  } catch {
    return false;
  }
}

export async function reopenSubmission(cycleId: string, teamId: string): Promise<boolean> {
  try {
    const db = getDb();
    await db.execute(
      sql`UPDATE rivalry_submissions
          SET reopened_at = NOW()
          WHERE cycle_id = ${cycleId}::uuid AND team_id = ${teamId}`,
    );
    return true;
  } catch {
    return false;
  }
}

export async function deleteSubmission(cycleId: string, teamId: string): Promise<boolean> {
  try {
    const db = getDb();
    await db.execute(
      sql`DELETE FROM rivalry_submissions WHERE cycle_id = ${cycleId}::uuid AND team_id = ${teamId}`,
    );
    return true;
  } catch {
    return false;
  }
}

// ── pairs ────────────────────────────────────────────────────────────────────

export async function getPairsForCycle(cycleId: string): Promise<RivalryPair[]> {
  try {
    const db = getDb();
    const res = await db.execute(
      sql`SELECT * FROM rivalry_pairs WHERE cycle_id = ${cycleId}::uuid ORDER BY combined_score DESC`,
    );
    return rows(res).map(rowToPair);
  } catch {
    return [];
  }
}

export async function storePairs(cycleId: string, pairs: CalculatedPair[]): Promise<boolean> {
  try {
    const db = getDb();
    // Clear any previous proposed pairs for this cycle
    await db.execute(
      sql`DELETE FROM rivalry_pairs WHERE cycle_id = ${cycleId}::uuid AND status = 'proposed'`,
    );
    for (const p of pairs) {
      const bloodFeud = p.isBloodFeud ? 1 : 0;
      await db.execute(
        sql`INSERT INTO rivalry_pairs
            (cycle_id, team_a_id, team_b_id, team_a_score_for_b, team_b_score_for_a, combined_score, is_blood_feud, status)
            VALUES (${cycleId}::uuid, ${p.teamAId}, ${p.teamBId}, ${p.teamAScoreForB}, ${p.teamBScoreForA}, ${p.combinedScore}, ${bloodFeud}, 'proposed')`,
      );
    }
    return true;
  } catch {
    return false;
  }
}

export async function publishPairs(cycleId: string): Promise<boolean> {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    await db.execute(
      sql`UPDATE rivalry_pairs
          SET status = 'active', locked_at = ${now}
          WHERE cycle_id = ${cycleId}::uuid AND status = 'proposed'`,
    );
    return true;
  } catch {
    return false;
  }
}
