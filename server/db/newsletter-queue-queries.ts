/**
 * Editorial Calendar / Generation Queue queries
 *
 * Plans newsletter episodes by type + scheduled generation time. The runner
 * generates due items into DRAFTS only — queue processing never publishes and
 * never posts Discord.
 */

import { and, or, eq, lt, lte, asc, desc, inArray } from 'drizzle-orm';
import { getDb } from './client';
import { newsletterQueue, newsletterRunnerStatus } from './schema';

export type QueueStatus = 'queued' | 'generating' | 'generated' | 'skipped' | 'failed' | 'published' | 'archived';

// A 'generating' item whose updatedAt is older than this is assumed to be from a
// crashed/killed runner and is reclaimed for regeneration on the next pass.
const STALE_GENERATING_MS = 30 * 60 * 1000;

// Bounded auto-retry: a 'failed' item is re-attempted on subsequent runs until it has
// been tried this many times, then it's left alone (manual Retry resets the count).
export const MAX_QUEUE_ATTEMPTS = 3;

export interface QueueItem {
  id: string;
  season: number;
  week: number | null;
  episodeType: string;
  scheduledFor: string;
  status: QueueStatus;
  note: string | null;
  generatedAt: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

function toQueueItem(row: typeof newsletterQueue.$inferSelect): QueueItem {
  return {
    id: row.id,
    season: row.season,
    week: row.week ?? null,
    episodeType: row.episodeType,
    scheduledFor: row.scheduledFor.toISOString(),
    status: row.status as QueueStatus,
    note: row.note ?? null,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    error: row.error ?? null,
    attempts: row.attempts ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listQueueItems(opts?: { statuses?: QueueStatus[]; season?: number }): Promise<QueueItem[]> {
  const db = getDb();
  const conds = [];
  if (opts?.statuses?.length) conds.push(inArray(newsletterQueue.status, opts.statuses));
  if (opts?.season !== undefined) conds.push(eq(newsletterQueue.season, opts.season));
  const rows = await db
    .select()
    .from(newsletterQueue)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(newsletterQueue.scheduledFor), desc(newsletterQueue.createdAt));
  return rows.map(toQueueItem);
}

export async function createQueueItem(input: {
  season: number;
  week?: number | null;
  episodeType: string;
  scheduledFor: Date;
  note?: string | null;
}): Promise<QueueItem> {
  const db = getDb();
  const rows = await db
    .insert(newsletterQueue)
    .values({
      season: input.season,
      week: input.week ?? null,
      episodeType: input.episodeType,
      scheduledFor: input.scheduledFor,
      note: input.note ?? null,
    })
    .returning();
  return toQueueItem(rows[0]);
}

export async function updateQueueItem(
  id: string,
  patch: { status?: QueueStatus; scheduledFor?: Date; note?: string | null; generatedAt?: Date | null; error?: string | null; attempts?: number }
): Promise<QueueItem | null> {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.scheduledFor !== undefined) set.scheduledFor = patch.scheduledFor;
  if (patch.note !== undefined) set.note = patch.note;
  if (patch.generatedAt !== undefined) set.generatedAt = patch.generatedAt;
  if (patch.error !== undefined) set.error = patch.error;
  if (patch.attempts !== undefined) set.attempts = patch.attempts;
  const rows = await db
    .update(newsletterQueue)
    .set(set)
    .where(eq(newsletterQueue.id, id))
    .returning();
  return rows.length ? toQueueItem(rows[0]) : null;
}

export async function deleteQueueItem(id: string): Promise<boolean> {
  const db = getDb();
  await db.delete(newsletterQueue).where(eq(newsletterQueue.id, id));
  return true;
}

/**
 * Items the runner should process:
 *  - 'queued' items whose scheduled time has arrived;
 *  - 'failed' items that haven't exhausted their retry budget (bounded auto-retry, so a
 *    transient failure self-heals on the next run instead of stranding the item);
 *  - 'generating' items left stranded by a crashed run (updatedAt past the stale window).
 */
// ── Runner heartbeat ──────────────────────────────────────────────────────────
// Written by the scheduled runner on every pass (even when nothing is due) so the
// admin UI can distinguish "runner alive, nothing due" from "runner dead".

const RUNNER_STATUS_ID = 'runner';

export async function recordRunnerHeartbeat(lastResult: string): Promise<void> {
  const db = getDb();
  await db
    .insert(newsletterRunnerStatus)
    .values({ id: RUNNER_STATUS_ID, lastSeenAt: new Date(), lastResult })
    .onConflictDoUpdate({
      target: newsletterRunnerStatus.id,
      set: { lastSeenAt: new Date(), lastResult },
    });
}

export async function getRunnerHeartbeat(): Promise<{ lastSeenAt: string; lastResult: string | null } | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(newsletterRunnerStatus)
    .where(eq(newsletterRunnerStatus.id, RUNNER_STATUS_ID))
    .limit(1);
  if (!rows.length) return null;
  return { lastSeenAt: rows[0].lastSeenAt.toISOString(), lastResult: rows[0].lastResult ?? null };
}

export async function findDueQueueItems(now: Date = new Date()): Promise<QueueItem[]> {
  const db = getDb();
  const staleBefore = new Date(now.getTime() - STALE_GENERATING_MS);
  const rows = await db
    .select()
    .from(newsletterQueue)
    .where(or(
      and(eq(newsletterQueue.status, 'queued'), lte(newsletterQueue.scheduledFor, now)),
      and(eq(newsletterQueue.status, 'failed'), lt(newsletterQueue.attempts, MAX_QUEUE_ATTEMPTS), lte(newsletterQueue.scheduledFor, now)),
      and(eq(newsletterQueue.status, 'generating'), lte(newsletterQueue.updatedAt, staleBefore)),
    ))
    .orderBy(asc(newsletterQueue.scheduledFor));
  return rows.map(toQueueItem);
}
