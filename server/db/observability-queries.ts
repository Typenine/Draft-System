/**
 * Observability Queries
 *
 * Persistence for generation runs, per-section generation metadata,
 * newsletter content snapshots, and MCP tool call logs.
 *
 * DESIGN RULE: observability writes must NEVER break the pipeline.
 * Every function here swallows its own errors and logs a warning instead.
 * Callers can fire-and-forget.
 */

import { desc, eq, and, lt } from 'drizzle-orm';
import { getDb } from './client';
import {
  generationRuns,
  generationRunSections,
  newsletterSnapshots,
  mcpCallLog,
} from './schema';

// ============ Generation Runs ============

export interface StartRunInput {
  runId: string;
  season: number;
  week: number;
  episodeType: string;
  runType?: 'staged' | 'sync' | 'retry';
  contextPacket?: Record<string, unknown>;
  totalSteps?: number;
}

export async function recordRunStart(input: StartRunInput): Promise<void> {
  try {
    const db = getDb();
    await db
      .insert(generationRuns)
      .values({
        runId: input.runId,
        season: input.season,
        week: input.week,
        episodeType: input.episodeType,
        runType: input.runType ?? 'staged',
        status: 'running',
        contextPacket: input.contextPacket ?? null,
        totalSteps: input.totalSteps ?? null,
      })
      .onConflictDoNothing({ target: generationRuns.runId });
  } catch (err) {
    console.warn('[Obs] recordRunStart failed (non-fatal):', err instanceof Error ? err.message : String(err));
  }
}

export interface FinishRunInput {
  runId: string;
  status: 'completed' | 'failed' | 'blocked';
  errorSummary?: string | null;
  validation?: Record<string, unknown> | null;
  warnings?: string[];
  completedSteps?: number;
  failedSteps?: string[];
}

export async function recordRunFinish(input: FinishRunInput): Promise<void> {
  try {
    const db = getDb();
    await db
      .update(generationRuns)
      .set({
        status: input.status,
        finishedAt: new Date(),
        errorSummary: input.errorSummary ?? null,
        ...(input.validation !== undefined ? { validation: input.validation } : {}),
        ...(input.warnings !== undefined ? { warnings: input.warnings } : {}),
        ...(input.completedSteps !== undefined ? { completedSteps: input.completedSteps } : {}),
        ...(input.failedSteps !== undefined ? { failedSteps: input.failedSteps } : {}),
      })
      .where(eq(generationRuns.runId, input.runId));
  } catch (err) {
    console.warn('[Obs] recordRunFinish failed (non-fatal):', err instanceof Error ? err.message : String(err));
  }
}

// ============ Per-section records ============

export interface SectionRecordInput {
  runId: string;
  sectionName: string;
  status: 'ok' | 'failed' | 'retried';
  provider?: string;
  model?: string;
  tier?: number;
  isFallback?: boolean;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  retries?: number;
  warnings?: string[];
  error?: string;
}

export async function recordSectionResult(input: SectionRecordInput): Promise<void> {
  try {
    const db = getDb();
    await db.insert(generationRunSections).values({
      runId: input.runId,
      sectionName: input.sectionName,
      status: input.status,
      provider: input.provider ?? null,
      model: input.model ?? null,
      tier: input.tier ?? null,
      isFallback: input.isFallback ?? false,
      durationMs: input.durationMs ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      retries: input.retries ?? 0,
      warnings: input.warnings ?? [],
      error: input.error ?? null,
    });
  } catch (err) {
    console.warn('[Obs] recordSectionResult failed (non-fatal):', err instanceof Error ? err.message : String(err));
  }
}

// ============ Fact Audit ============

/** Attach a fact-audit result to an existing run. Fire-and-forget safe. */
export async function saveFactAudit(runId: string, audit: Record<string, unknown>): Promise<void> {
  try {
    const db = getDb();
    await db
      .update(generationRuns)
      .set({ factAudit: audit })
      .where(eq(generationRuns.runId, runId));
  } catch (err) {
    console.warn('[Obs] saveFactAudit failed (non-fatal):', err instanceof Error ? err.message : String(err));
  }
}

/** Most recent run for a given newsletter (any status). */
export async function getLatestRunForWeek(season: number, week: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(generationRuns)
    .where(and(eq(generationRuns.season, season), eq(generationRuns.week, week)))
    .orderBy(desc(generationRuns.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

// ============ Read APIs (admin diagnostics) ============

export async function listRecentRuns(limit = 20) {
  const db = getDb();
  return db
    .select()
    .from(generationRuns)
    .orderBy(desc(generationRuns.startedAt))
    .limit(limit);
}

export async function getRunWithSections(runId: string) {
  const db = getDb();
  const [runs, sections] = await Promise.all([
    db.select().from(generationRuns).where(eq(generationRuns.runId, runId)).limit(1),
    db.select().from(generationRunSections).where(eq(generationRunSections.runId, runId)).orderBy(generationRunSections.createdAt),
  ]);
  return { run: runs[0] ?? null, sections };
}

// ============ Newsletter Snapshots ============

const MAX_SNAPSHOTS_PER_NEWSLETTER = 10;

export interface SnapshotInput {
  season: number;
  week: number;
  runId?: string | null;
  actionType: 'finalize' | 'pre_restore' | 'manual';
  note?: string | null;
  content: unknown;
  html?: string | null;
}

/**
 * Store a full content snapshot. Keeps at most MAX_SNAPSHOTS_PER_NEWSLETTER
 * per (season, week) by pruning the oldest.
 */
export async function saveNewsletterSnapshot(input: SnapshotInput): Promise<string | null> {
  try {
    const db = getDb();
    const inserted = await db
      .insert(newsletterSnapshots)
      .values({
        season: input.season,
        week: input.week,
        runId: input.runId ?? null,
        actionType: input.actionType,
        note: input.note ?? null,
        content: input.content as Record<string, unknown>,
        html: input.html ?? null,
      })
      .returning({ id: newsletterSnapshots.id });

    // Prune: keep only the newest N for this newsletter
    const all = await db
      .select({ id: newsletterSnapshots.id, createdAt: newsletterSnapshots.createdAt })
      .from(newsletterSnapshots)
      .where(and(eq(newsletterSnapshots.season, input.season), eq(newsletterSnapshots.week, input.week)))
      .orderBy(desc(newsletterSnapshots.createdAt));

    if (all.length > MAX_SNAPSHOTS_PER_NEWSLETTER) {
      const cutoff = all[MAX_SNAPSHOTS_PER_NEWSLETTER - 1].createdAt;
      await db
        .delete(newsletterSnapshots)
        .where(and(
          eq(newsletterSnapshots.season, input.season),
          eq(newsletterSnapshots.week, input.week),
          lt(newsletterSnapshots.createdAt, cutoff),
        ));
    }

    return inserted[0]?.id ?? null;
  } catch (err) {
    console.warn('[Obs] saveNewsletterSnapshot failed (non-fatal):', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function listSnapshots(season: number, week: number) {
  const db = getDb();
  return db
    .select({
      id: newsletterSnapshots.id,
      runId: newsletterSnapshots.runId,
      actionType: newsletterSnapshots.actionType,
      note: newsletterSnapshots.note,
      createdAt: newsletterSnapshots.createdAt,
    })
    .from(newsletterSnapshots)
    .where(and(eq(newsletterSnapshots.season, season), eq(newsletterSnapshots.week, week)))
    .orderBy(desc(newsletterSnapshots.createdAt));
}

export async function loadSnapshot(id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(newsletterSnapshots)
    .where(eq(newsletterSnapshots.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// ============ MCP Call Log ============

const MAX_LOGGED_ARG_CHARS = 500;

/** Strip anything secret-looking and truncate long values. */
function sanitizeArgs(args: unknown): Record<string, unknown> | null {
  if (args == null || typeof args !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    const keyLower = k.toLowerCase();
    if (keyLower.includes('key') || keyLower.includes('token') || keyLower.includes('secret') || keyLower.includes('auth')) {
      out[k] = '[redacted]';
      continue;
    }
    if (typeof v === 'string' && v.length > MAX_LOGGED_ARG_CHARS) {
      out[k] = v.slice(0, MAX_LOGGED_ARG_CHARS) + '…';
    } else {
      out[k] = v;
    }
  }
  return out;
}

export interface McpCallLogInput {
  tool: string;
  args?: unknown;
  status: 'ok' | 'error';
  durationMs?: number;
  responseBytes?: number;
  error?: string;
}

export async function recordMcpCall(input: McpCallLogInput): Promise<void> {
  try {
    const db = getDb();
    await db.insert(mcpCallLog).values({
      tool: input.tool,
      args: sanitizeArgs(input.args),
      status: input.status,
      durationMs: input.durationMs ?? null,
      responseBytes: input.responseBytes ?? null,
      error: input.error ? input.error.slice(0, 2000) : null,
    });
  } catch (err) {
    console.warn('[Obs] recordMcpCall failed (non-fatal):', err instanceof Error ? err.message : String(err));
  }
}

export async function listRecentMcpCalls(limit = 50, onlyErrors = false) {
  const db = getDb();
  const base = db.select().from(mcpCallLog);
  const query = onlyErrors ? base.where(eq(mcpCallLog.status, 'error')) : base;
  return query.orderBy(desc(mcpCallLog.createdAt)).limit(limit);
}
