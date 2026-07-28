/**
 * Newsletter Database Queries
 * Handles persistence of bot memory, forecast records, and newsletters
 */

import { eq, and, ne, desc } from 'drizzle-orm';
import { getDb } from './client';
import {
  botMemory,
  forecastRecords,
  pendingPicks,
  newsletters,
  newsletterStaged,
  relationshipMemory,
} from './schema';
import type { BotMemory, BotName, RelationshipMemory } from '@/lib/newsletter/types';

// ============ Bot Memory ============

/**
 * Load bot memory from database
 * BotMemory now includes all enhanced fields as optional, so we always return BotMemory
 */
export async function loadBotMemory(
  bot: BotName,
  season: number
): Promise<BotMemory | null> {
  const db = getDb();
  let row: {
    updatedAt: Date;
    summaryMood: unknown;
    teams: unknown;
    enhancedData?: unknown;
    editorialCorrections?: unknown;
  } | null = null;
  try {
    const rows = await db
      .select()
      .from(botMemory)
      .where(and(eq(botMemory.bot, bot), eq(botMemory.season, season)))
      .limit(1);
    row = rows.length ? rows[0] : null;
  } catch (err) {
    const anyErr = err as { code?: string; message?: string } | undefined;
    const msg = anyErr?.message ?? '';
    const code = anyErr?.code ?? '';
    const missingColumn = code === '42703' ||
      msg.toLowerCase().includes('enhanced_data') ||
      msg.toLowerCase().includes('editorial_corrections');
    if (!missingColumn) throw err;
    // Backward-compat: select only legacy columns (no enhanced_data)
    const rows = await db
      .select({ updatedAt: botMemory.updatedAt, summaryMood: botMemory.summaryMood, teams: botMemory.teams })
      .from(botMemory)
      .where(and(eq(botMemory.bot, bot), eq(botMemory.season, season)))
      .limit(1);
    row = rows.length ? rows[0] : null;
  }

  if (!row) return null;

  const enhancedData = (row.enhancedData as Record<string, unknown> | undefined) || {};
  
  // Check if we have enhanced memory data
  const hasEnhancedData = Object.keys(enhancedData).length > 0;
  
  if (hasEnhancedData) {
    // Return full BotMemory
    return {
      bot,
      season,
      updated_at: row.updatedAt.toISOString(),
      summaryMood: (enhancedData.summaryMood as BotMemory['summaryMood']) || row.summaryMood as BotMemory['summaryMood'],
      lastGeneratedWeek: (enhancedData.lastGeneratedWeek as number) || 0,
      teams: (row.teams || {}) as BotMemory['teams'],
      // Personality evolution
      personality: enhancedData.personality as BotMemory['personality'],
      emotionalState: enhancedData.emotionalState as BotMemory['emotionalState'],
      speechPatterns: enhancedData.speechPatterns as BotMemory['speechPatterns'],
      personalGrowth: enhancedData.personalGrowth as BotMemory['personalGrowth'],
      // Relationships
      deepPlayerRelationships: enhancedData.deepPlayerRelationships as BotMemory['deepPlayerRelationships'],
      deepTeamRelationships: enhancedData.deepTeamRelationships as BotMemory['deepTeamRelationships'],
      partnerDynamics: enhancedData.partnerDynamics as BotMemory['partnerDynamics'],
      // Tracking
      narratives: (enhancedData.narratives as BotMemory['narratives']) || [],
      predictions: (enhancedData.predictions as BotMemory['predictions']) || [],
      predictionStats: (enhancedData.predictionStats as BotMemory['predictionStats']) || {
        correct: 0, wrong: 0, winRate: 0, hotStreak: 0, bestStreak: 0, worstStreak: 0
      },
      hotTakes: (enhancedData.hotTakes as BotMemory['hotTakes']) || [],
      milestones: (enhancedData.milestones as BotMemory['milestones']) || [],
      playerRelationships: (enhancedData.playerRelationships as BotMemory['playerRelationships']) || {},
      favoritePlayers: (enhancedData.favoritePlayers as string[]) || [],
      disappointments: (enhancedData.disappointments as string[]) || [],
      editorialCorrections: (row.editorialCorrections as BotMemory['editorialCorrections']) || [],
    };
  }
  
  // Return basic BotMemory for backward compatibility
  return {
    bot,
    updated_at: row.updatedAt.toISOString(),
    summaryMood: row.summaryMood as BotMemory['summaryMood'],
    teams: (row.teams || {}) as BotMemory['teams'],
  };
}

/**
 * Save bot memory to database
 * Handles both basic BotMemory and BotMemory
 */
export async function saveBotMemory(
  bot: BotName,
  season: number,
  memory: BotMemory | BotMemory
): Promise<void> {
  const db = getDb();

  // Extract enhanced data if present
  const isEnhanced = 'personality' in memory || 'predictions' in memory || 'partnerDynamics' in memory;
  
  // Build enhanced data object with all the extra fields
  const enhancedData: Record<string, unknown> = {};
  if (isEnhanced) {
    const enhanced = memory as BotMemory;
    enhancedData.summaryMood = enhanced.summaryMood;
    enhancedData.lastGeneratedWeek = enhanced.lastGeneratedWeek;
    enhancedData.personality = enhanced.personality;
    enhancedData.emotionalState = enhanced.emotionalState;
    enhancedData.speechPatterns = enhanced.speechPatterns;
    enhancedData.personalGrowth = enhanced.personalGrowth;
    enhancedData.deepPlayerRelationships = enhanced.deepPlayerRelationships;
    enhancedData.deepTeamRelationships = enhanced.deepTeamRelationships;
    enhancedData.partnerDynamics = enhanced.partnerDynamics;
    enhancedData.narratives = enhanced.narratives;
    enhancedData.predictions = enhanced.predictions;
    enhancedData.predictionStats = enhanced.predictionStats;
    enhancedData.hotTakes = enhanced.hotTakes;
    enhancedData.milestones = enhanced.milestones;
    enhancedData.playerRelationships = enhanced.playerRelationships;
    enhancedData.favoritePlayers = enhanced.favoritePlayers;
    enhancedData.disappointments = enhanced.disappointments;
  }

  // Check if exists
  const existing = await db
    .select({ id: botMemory.id })
    .from(botMemory)
    .where(and(eq(botMemory.bot, bot), eq(botMemory.season, season)))
    .limit(1);

  // Map enhanced mood values to basic ones for the database enum
  const dbSummaryMood = (['Focused', 'Fired Up', 'Deflated'].includes(memory.summaryMood) 
    ? memory.summaryMood 
    : 'Focused') as 'Focused' | 'Fired Up' | 'Deflated';

  if (existing.length) {
    // Update
    try {
      await db
        .update(botMemory)
        .set({
          summaryMood: dbSummaryMood,
          teams: memory.teams,
          enhancedData: enhancedData,
          editorialCorrections: (memory.editorialCorrections ?? []) as unknown as Array<Record<string, unknown>>,
          updatedAt: new Date(),
        })
        .where(eq(botMemory.id, existing[0].id));
    } catch (err) {
      const anyErr = err as { code?: string; message?: string } | undefined;
      const msg = anyErr?.message ?? '';
      const code = anyErr?.code ?? '';
      const missingEnhanced = code === '42703' || msg.toLowerCase().includes('enhanced_data') || msg.toLowerCase().includes('editorial_corrections');
      if (!missingEnhanced) throw err;
      // Retry without new columns for legacy schema
      await db
        .update(botMemory)
        .set({
          summaryMood: dbSummaryMood,
          teams: memory.teams,
          updatedAt: new Date(),
        })
        .where(eq(botMemory.id, existing[0].id));
    }
  } else {
    // Insert
    try {
      await db.insert(botMemory).values({
        bot,
        season,
        summaryMood: dbSummaryMood,
        teams: memory.teams,
        enhancedData: enhancedData,
        editorialCorrections: (memory.editorialCorrections ?? []) as unknown as Array<Record<string, unknown>>,
      });
    } catch (err) {
      const anyErr = err as { code?: string; message?: string } | undefined;
      const msg = anyErr?.message ?? '';
      const code = anyErr?.code ?? '';
      const missingEnhanced = code === '42703' || msg.toLowerCase().includes('enhanced_data') || msg.toLowerCase().includes('editorial_corrections');
      if (!missingEnhanced) throw err;
      // Retry without new columns for legacy schema
      await db.insert(botMemory).values({
        bot,
        season,
        summaryMood: dbSummaryMood,
        teams: memory.teams,
      });
    }
  }
}

// ============ Forecast Records ============

export interface ForecastRecordsData {
  entertainer: { w: number; l: number };
  analyst: { w: number; l: number };
}

export async function loadForecastRecords(
  season: number
): Promise<ForecastRecordsData> {
  const db = getDb();
  const rows = await db
    .select()
    .from(forecastRecords)
    .where(eq(forecastRecords.season, season));

  const result: ForecastRecordsData = {
    entertainer: { w: 0, l: 0 },
    analyst: { w: 0, l: 0 },
  };

  for (const row of rows) {
    if (row.bot === 'entertainer') {
      result.entertainer = { w: row.wins, l: row.losses };
    } else if (row.bot === 'analyst') {
      result.analyst = { w: row.wins, l: row.losses };
    }
  }

  return result;
}

export async function saveForecastRecords(
  season: number,
  records: ForecastRecordsData
): Promise<void> {
  const db = getDb();

  for (const bot of ['entertainer', 'analyst'] as const) {
    const data = records[bot];
    const existing = await db
      .select({ id: forecastRecords.id })
      .from(forecastRecords)
      .where(and(eq(forecastRecords.season, season), eq(forecastRecords.bot, bot)))
      .limit(1);

    if (existing.length) {
      await db
        .update(forecastRecords)
        .set({ wins: data.w, losses: data.l, updatedAt: new Date() })
        .where(eq(forecastRecords.id, existing[0].id));
    } else {
      await db.insert(forecastRecords).values({
        season,
        bot,
        wins: data.w,
        losses: data.l,
      });
    }
  }
}

// ============ Pending Picks ============

export interface PendingPicksData {
  week: number;
  picks: Array<{
    matchup_id: string | number;
    team1?: string;
    team2?: string;
    entertainer_pick: string;
    analyst_pick: string;
  }>;
}

export async function loadPendingPicks(
  season: number,
  week: number
): Promise<PendingPicksData | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(pendingPicks)
    .where(and(eq(pendingPicks.season, season), eq(pendingPicks.week, week)));

  if (!rows.length) return null;

  return {
    week,
    picks: rows.map(r => ({
      matchup_id: r.matchupId,
      team1: r.team1 || undefined,
      team2: r.team2 || undefined,
      entertainer_pick: r.entertainerPick || '',
      analyst_pick: r.analystPick || '',
    })),
  };
}

export async function savePendingPicks(
  season: number,
  data: PendingPicksData
): Promise<void> {
  const db = getDb();

  // Delete old picks for this week
  await db
    .delete(pendingPicks)
    .where(and(eq(pendingPicks.season, season), eq(pendingPicks.week, data.week)));

  // Insert new picks
  if (data.picks.length) {
    await db.insert(pendingPicks).values(
      data.picks.map(p => ({
        season,
        week: data.week,
        matchupId: String(p.matchup_id),
        team1: p.team1 || null,
        team2: p.team2 || null,
        entertainerPick: p.entertainer_pick || null,
        analystPick: p.analyst_pick || null,
      }))
    );
  }
}

// ============ Newsletters ============

export interface NewsletterData {
  newsletter: {
    meta: { leagueName: string; week: number; date: string; season: number };
    sections: Array<{ type: string; data: unknown }>;
  };
  html: string;
  generatedAt: string;
}

export type NewsletterStatus = 'draft' | 'published';

// Storage weeks used by weekless/offseason episodes (mirror of run-newsletter.mjs).
const STORAGE_WEEK_TO_TYPE: Record<number, string> = { 900: 'preseason', 901: 'pre_draft', 902: 'post_draft', 903: 'offseason' };

const EPISODE_TITLE_LABELS: Record<string, string> = {
  regular: 'Weekly Recap',
  trade_deadline: 'Trade Deadline',
  playoffs_preview: 'Playoffs Preview',
  playoffs_round: 'Playoff Round',
  championship: 'Championship',
  season_finale: 'Season Finale',
  pre_draft: 'Pre-Draft',
  post_draft: 'Post-Draft Grades',
  preseason: 'Preseason',
  offseason: 'Offseason',
};

/**
 * Auto-generate a human-readable catalog title, e.g.
 * "2026 Wk 12 — Trade Deadline (Jul 4, 9:45 AM)". Weekless episodes omit the week.
 */
export function buildNewsletterTitle(
  season: number,
  week: number,
  episodeType?: string | null,
  generatedAt: Date = new Date()
): string {
  const type = episodeType || STORAGE_WEEK_TO_TYPE[week] || 'regular';
  const label = EPISODE_TITLE_LABELS[type] ?? type;
  const isWeekless = Boolean(STORAGE_WEEK_TO_TYPE[week]) || ['pre_draft', 'post_draft', 'preseason', 'offseason'].includes(type);
  const when = generatedAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${season}${isWeekless ? '' : ` Wk ${week}`} — ${label} (${when})`;
}

export async function loadNewsletter(
  season: number,
  week: number,
  opts?: { includeDrafts?: boolean; episodeType?: string | null }
): Promise<(NewsletterData & { id: string; title: string | null; status: NewsletterStatus }) | null> {
  const db = getDb();
  // Public callers (default) only ever see published newsletters. Admin callers
  // pass includeDrafts:true to view/edit drafts. With multiple saved newsletters
  // per slot, admins get the most recently generated match (optionally narrowed
  // by episodeType); the public path is unique because publish enforces at most
  // one published newsletter per (season, week).
  const conditions = [eq(newsletters.season, season), eq(newsletters.week, week)];
  if (!opts?.includeDrafts) conditions.push(eq(newsletters.status, 'published'));
  if (opts?.episodeType) conditions.push(eq(newsletters.episodeType, opts.episodeType));
  const rows = await db
    .select()
    .from(newsletters)
    .where(and(...conditions))
    .orderBy(desc(newsletters.generatedAt))
    .limit(1);

  if (!rows.length) return null;

  const row = rows[0];
  return {
    id: row.id,
    title: row.title ?? null,
    status: (row.status as NewsletterStatus) ?? 'published',
    newsletter: row.content as NewsletterData['newsletter'],
    html: row.html,
    generatedAt: row.generatedAt.toISOString(),
  };
}

/** Load a single newsletter by its unique id (admin catalog addressing). */
export async function loadNewsletterById(
  id: string
): Promise<(NewsletterData & { id: string; season: number; week: number; title: string | null; status: NewsletterStatus; episodeType: string | null }) | null> {
  const db = getDb();
  const rows = await db.select().from(newsletters).where(eq(newsletters.id, id)).limit(1);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    season: row.season,
    week: row.week,
    title: row.title ?? null,
    status: (row.status as NewsletterStatus) ?? 'published',
    episodeType: row.episodeType ?? null,
    newsletter: row.content as NewsletterData['newsletter'],
    html: row.html,
    generatedAt: row.generatedAt.toISOString(),
  };
}

export async function saveNewsletter(
  season: number,
  week: number,
  leagueName: string,
  content: NewsletterData['newsletter'],
  html: string,
  opts?: { status?: NewsletterStatus; episodeType?: string; title?: string }
): Promise<string> {
  const db = getDb();

  // IMPORTANT: generation paths must NOT autopublish. Default status is 'draft' so
  // that callers who don't opt in stay private. Making a newsletter public is done
  // exclusively via publishNewsletter() (the explicit admin publish action).
  const status: NewsletterStatus = opts?.status ?? 'draft';

  // Every generation creates a new catalog entry. We never delete existing
  // drafts automatically — that would break the catalog / multiple-drafts goal.
  // Old drafts can be deleted explicitly from the Saved Newsletters panel.
  const generatedAt = new Date();
  const inserted = await db.insert(newsletters).values({
    season,
    week,
    leagueName,
    title: opts?.title ?? buildNewsletterTitle(season, week, opts?.episodeType, generatedAt),
    content,
    html,
    status,
    episodeType: opts?.episodeType,
    generatedAt,
    publishedAt: status === 'published' ? new Date() : null,
    updatedAt: new Date(),
  }).returning({ id: newsletters.id });

  return inserted[0]?.id ?? '';
}

/**
 * Flip an existing newsletter from draft → published (the explicit admin action).
 * Idempotent: re-publishing only refreshes updatedAt and never duplicates side
 * effects. Discord is handled by the caller, NOT here.
 */
export async function publishNewsletter(
  season: number,
  week: number,
  opts?: { html?: string; id?: string }
): Promise<{ found: boolean; alreadyPublished: boolean }> {
  const db = getDb();

  // Resolve the target row: by id when given (catalog publish), otherwise the
  // most recently generated newsletter for the slot (legacy behavior).
  const rows = await db
    .select({ id: newsletters.id, season: newsletters.season, week: newsletters.week, status: newsletters.status, publishedAt: newsletters.publishedAt })
    .from(newsletters)
    .where(opts?.id
      ? eq(newsletters.id, opts.id)
      : and(eq(newsletters.season, season), eq(newsletters.week, week)))
    .orderBy(desc(newsletters.generatedAt))
    .limit(1);

  if (!rows.length) return { found: false, alreadyPublished: false };
  const target = rows[0];

  const alreadyPublished = target.status === 'published';

  // "Replace" semantics: the public page shows exactly one newsletter per slot,
  // so publishing this one reverts any other published newsletter for the same
  // (season, week) back to draft. It stays in the catalog and can be re-published.
  await db
    .update(newsletters)
    .set({ status: 'draft', updatedAt: new Date() })
    .where(and(
      eq(newsletters.season, target.season),
      eq(newsletters.week, target.week),
      eq(newsletters.status, 'published'),
      ne(newsletters.id, target.id),
    ));

  await db
    .update(newsletters)
    .set({
      status: 'published',
      // Preserve the original publish time on re-publish.
      publishedAt: target.publishedAt ?? new Date(),
      updatedAt: new Date(),
      ...(opts?.html ? { html: opts.html } : {}),
    })
    .where(eq(newsletters.id, target.id));

  return { found: true, alreadyPublished };
}

/** Rename a saved newsletter in the catalog. */
export async function renameNewsletter(id: string, title: string): Promise<boolean> {
  const db = getDb();
  const trimmed = title.trim().slice(0, 200);
  if (!trimmed) return false;
  const updated = await db
    .update(newsletters)
    .set({ title: trimmed, updatedAt: new Date() })
    .where(eq(newsletters.id, id))
    .returning({ id: newsletters.id });
  return updated.length > 0;
}

/** Delete a single newsletter by id (catalog delete — leaves other saved rows alone). */
export async function deleteNewsletterById(id: string): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(newsletters)
    .where(eq(newsletters.id, id))
    .returning({ id: newsletters.id });
  return deleted.length > 0;
}

/** Record that the published newsletter was announced to Discord. */
export async function markNewsletterDiscordPosted(season: number, week: number): Promise<void> {
  const db = getDb();
  await db
    .update(newsletters)
    .set({ discordPostedAt: new Date() })
    .where(and(eq(newsletters.season, season), eq(newsletters.week, week), eq(newsletters.status, 'published')))
    .catch(() => {});
}

/** Lightweight status read for admin display (no content/html). */
export async function getNewsletterStatusMeta(
  season: number,
  week: number
): Promise<{ status: NewsletterStatus; publishedAt: string | null; discordPostedAt: string | null; updatedAt: string | null } | null> {
  const db = getDb();
  const rows = await db
    .select({
      status: newsletters.status,
      publishedAt: newsletters.publishedAt,
      discordPostedAt: newsletters.discordPostedAt,
      updatedAt: newsletters.updatedAt,
    })
    .from(newsletters)
    .where(and(eq(newsletters.season, season), eq(newsletters.week, week)))
    .limit(1);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    status: (r.status as NewsletterStatus) ?? 'published',
    publishedAt: r.publishedAt?.toISOString() ?? null,
    discordPostedAt: r.discordPostedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt?.toISOString() ?? null,
  };
}

export async function listNewsletterWeeks(
  season: number,
  opts?: { includeDrafts?: boolean }
): Promise<number[]> {
  const db = getDb();
  const where = opts?.includeDrafts
    ? eq(newsletters.season, season)
    : and(eq(newsletters.season, season), eq(newsletters.status, 'published'));
  const rows = await db
    .select({ week: newsletters.week })
    .from(newsletters)
    .where(where);

  return rows.map(r => r.week).sort((a, b) => a - b);
}

export interface NewsletterMeta {
  id: string;
  title: string | null;
  season: number;
  week: number;
  leagueName: string;
  episodeType: string | null;
  status: NewsletterStatus;
  generatedAt: string;
  publishedAt: string | null;
  discordPostedAt: string | null;
  updatedAt: string | null;
}

/**
 * Summary metadata for every saved newsletter in a season — enough to tell drafts
 * apart in the admin list without loading the (heavy) content/html. Public callers
 * (default) only see published; admin passes includeDrafts.
 */
export async function listNewslettersMeta(
  season: number,
  opts?: { includeDrafts?: boolean }
): Promise<NewsletterMeta[]> {
  const db = getDb();
  const where = opts?.includeDrafts
    ? eq(newsletters.season, season)
    : and(eq(newsletters.season, season), eq(newsletters.status, 'published'));
  const rows = await db
    .select({
      id: newsletters.id,
      title: newsletters.title,
      season: newsletters.season,
      week: newsletters.week,
      leagueName: newsletters.leagueName,
      episodeType: newsletters.episodeType,
      status: newsletters.status,
      generatedAt: newsletters.generatedAt,
      publishedAt: newsletters.publishedAt,
      discordPostedAt: newsletters.discordPostedAt,
      updatedAt: newsletters.updatedAt,
    })
    .from(newsletters)
    .where(where);

  return rows
    .map(r => ({
      id: r.id,
      // Legacy rows saved before the title column existed get a computed fallback.
      title: r.title ?? buildNewsletterTitle(r.season, r.week, r.episodeType, r.generatedAt),
      season: r.season,
      week: r.week,
      leagueName: r.leagueName,
      episodeType: r.episodeType ?? null,
      status: (r.status as NewsletterStatus) ?? 'published',
      generatedAt: r.generatedAt.toISOString(),
      publishedAt: r.publishedAt?.toISOString() ?? null,
      discordPostedAt: r.discordPostedAt?.toISOString() ?? null,
      updatedAt: r.updatedAt?.toISOString() ?? null,
    }))
    // Newest first by generation time.
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

/**
 * Load previous newsletter for callbacks/references
 * Returns the newsletter from the previous week if it exists
 */
export async function loadPreviousNewsletter(
  season: number,
  currentWeek: number
): Promise<NewsletterData | null> {
  if (currentWeek <= 1) return null;
  return loadNewsletter(season, currentWeek - 1);
}

/**
 * Extract predictions from a previous newsletter for grading
 */
export function extractPredictionsFromNewsletter(
  newsletter: NewsletterData
): Array<{
  matchupId: string | number;
  team1: string;
  team2: string;
  entertainerPick: string;
  analystPick: string;
}> {
  const predictions: Array<{
    matchupId: string | number;
    team1: string;
    team2: string;
    entertainerPick: string;
    analystPick: string;
  }> = [];
  
  // Find the Forecast section
  const forecastSection = newsletter.newsletter.sections.find(s => s.type === 'Forecast');
  if (!forecastSection || !forecastSection.data) return predictions;
  
  const data = forecastSection.data as {
    picks?: Array<{
      matchup_id: string | number;
      team1: string;
      team2: string;
      bot1_pick: string;
      bot2_pick: string;
    }>;
  };
  
  if (!data.picks) return predictions;
  
  for (const pick of data.picks) {
    predictions.push({
      matchupId: pick.matchup_id,
      team1: pick.team1,
      team2: pick.team2,
      entertainerPick: pick.bot1_pick,
      analystPick: pick.bot2_pick,
    });
  }
  
  return predictions;
}

/**
 * Extract hot takes from a previous newsletter for revisiting
 */
export function extractHotTakesFromNewsletter(
  newsletter: NewsletterData
): Array<{
  bot: 'entertainer' | 'analyst';
  take: string;
  subject: string;
}> {
  const hotTakes: Array<{
    bot: 'entertainer' | 'analyst';
    take: string;
    subject: string;
  }> = [];
  
  // Look through intro and other sections for bold statements
  for (const section of newsletter.newsletter.sections) {
    const data = section.data as { bot1_text?: string; bot2_text?: string };
    
    // Simple heuristic: look for strong language patterns
    const patterns = [
      /I('m| am) calling it/i,
      /mark my words/i,
      /guarantee/i,
      /no way/i,
      /will (definitely|absolutely|certainly)/i,
      /fraud/i,
      /pretender/i,
      /contender/i,
    ];
    
    if (data.bot1_text) {
      for (const pattern of patterns) {
        if (pattern.test(data.bot1_text)) {
          hotTakes.push({
            bot: 'entertainer',
            take: data.bot1_text.slice(0, 200),
            subject: section.type,
          });
          break;
        }
      }
    }
    
    if (data.bot2_text) {
      for (const pattern of patterns) {
        if (pattern.test(data.bot2_text)) {
          hotTakes.push({
            bot: 'analyst',
            take: data.bot2_text.slice(0, 200),
            subject: section.type,
          });
          break;
        }
      }
    }
  }
  
  return hotTakes;
}

export async function deleteNewsletter(season: number, week: number): Promise<boolean> {
  const db = getDb();
  await db
    .delete(newsletters)
    .where(and(eq(newsletters.season, season), eq(newsletters.week, week)));
  
  // Also delete any staged data
  await db
    .delete(newsletterStaged)
    .where(and(eq(newsletterStaged.season, season), eq(newsletterStaged.week, week)));

  return true;
}

// ============ Staged Generation ============

export interface StagedNewsletterData {
  id: string;
  season: number;
  week: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'published';
  startedAt: string | null;
  completedAt: string | null;
  publishedAt: string | null;
  sectionsCompleted: string[];
  currentSection: string | null;
  error: string | null;
  generatedContent: Record<string, { entertainer: string; analyst: string }>;
  derivedData: Record<string, unknown> | null;
}

export async function loadStagedNewsletter(
  season: number,
  week: number
): Promise<StagedNewsletterData | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(newsletterStaged)
    .where(and(eq(newsletterStaged.season, season), eq(newsletterStaged.week, week)))
    .limit(1);

  if (!rows.length) return null;

  const row = rows[0];
  return {
    id: row.id,
    season: row.season,
    week: row.week,
    status: row.status as StagedNewsletterData['status'],
    startedAt: row.startedAt?.toISOString() || null,
    completedAt: row.completedAt?.toISOString() || null,
    publishedAt: row.publishedAt?.toISOString() || null,
    sectionsCompleted: row.sectionsCompleted || [],
    currentSection: row.currentSection || null,
    error: row.error || null,
    generatedContent: (row.generatedContent || {}) as Record<string, { entertainer: string; analyst: string }>,
    derivedData: (row.derivedData || null) as Record<string, unknown> | null,
  };
}

export async function createStagedNewsletter(
  season: number,
  week: number,
  derivedData: Record<string, unknown>
): Promise<string> {
  const db = getDb();

  // Delete existing if any
  await db
    .delete(newsletterStaged)
    .where(and(eq(newsletterStaged.season, season), eq(newsletterStaged.week, week)));

  const result = await db.insert(newsletterStaged).values({
    season,
    week,
    status: 'pending',
    derivedData,
  }).returning({ id: newsletterStaged.id });

  return result[0].id;
}

export async function updateStagedNewsletter(
  season: number,
  week: number,
  updates: {
    status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'published';
    currentSection?: string | null;
    sectionsCompleted?: string[];
    generatedContent?: Record<string, { entertainer: string; analyst: string }>;
    /** Replaces the full derivedData JSON. Use mergeStagedDerivedData for partial updates. */
    derivedData?: Record<string, unknown>;
    error?: string | null;
  }
): Promise<void> {
  const db = getDb();

  // Ensure the row exists before updating — safe to call without a prior createStagedNewsletter
  const existing = await db
    .select({ id: newsletterStaged.id })
    .from(newsletterStaged)
    .where(and(eq(newsletterStaged.season, season), eq(newsletterStaged.week, week)))
    .limit(1);
  if (!existing.length) {
    await db.insert(newsletterStaged).values({ season, week, status: 'pending' }).catch(() => {});
  }

  const setData: Record<string, unknown> = {};

  if (updates.status !== undefined) {
    setData.status = updates.status;
    if (updates.status === 'in_progress' && !updates.currentSection) {
      setData.startedAt = new Date();
    }
    if (updates.status === 'completed') {
      setData.completedAt = new Date();
    }
    if (updates.status === 'published') {
      setData.publishedAt = new Date();
    }
  }
  if (updates.currentSection !== undefined) setData.currentSection = updates.currentSection;
  if (updates.sectionsCompleted !== undefined) setData.sectionsCompleted = updates.sectionsCompleted;
  if (updates.generatedContent !== undefined) setData.generatedContent = updates.generatedContent;
  if (updates.derivedData !== undefined) setData.derivedData = updates.derivedData;
  if (updates.error !== undefined) setData.error = updates.error;

  await db
    .update(newsletterStaged)
    .set(setData)
    .where(and(eq(newsletterStaged.season, season), eq(newsletterStaged.week, week)));
}

/**
 * Merge additional keys into the derivedData JSON without overwriting existing keys.
 * Used by the step endpoint to store section outputs incrementally.
 */
export async function mergeStagedDerivedData(
  season: number,
  week: number,
  patch: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ derivedData: newsletterStaged.derivedData })
    .from(newsletterStaged)
    .where(and(eq(newsletterStaged.season, season), eq(newsletterStaged.week, week)))
    .limit(1);

  const current = (rows[0]?.derivedData as Record<string, unknown>) ?? {};
  const merged = { ...current, ...patch };

  await db
    .update(newsletterStaged)
    .set({ derivedData: merged })
    .where(and(eq(newsletterStaged.season, season), eq(newsletterStaged.week, week)));
}

export async function getStagedNewsletter(
  season: number,
  week: number
): Promise<{
  status: string;
  currentSection: string | null;
  sectionsCompleted: string[];
  startedAt: Date | null;
} | null> {
  const db = getDb();
  const rows = await db
    .select({
      status: newsletterStaged.status,
      currentSection: newsletterStaged.currentSection,
      sectionsCompleted: newsletterStaged.sectionsCompleted,
      startedAt: newsletterStaged.startedAt,
    })
    .from(newsletterStaged)
    .where(and(eq(newsletterStaged.season, season), eq(newsletterStaged.week, week)))
    .limit(1);
  return rows[0] ?? null;
}

// ============ Cross-Season Memory ============

export async function loadPreviousSeasonMemory(
  bot: BotName,
  currentSeason: number
): Promise<BotMemory | null> {
  // Load memory from previous season to carry forward
  return loadBotMemory(bot, currentSeason - 1);
}

export async function initializeSeasonMemory(
  bot: BotName,
  season: number,
  previousMemory: BotMemory | null
): Promise<BotMemory> {
  // If no previous memory, create fresh
  if (!previousMemory) {
    const fresh: BotMemory = {
      bot,
      updated_at: new Date().toISOString(),
      summaryMood: 'Focused',
      teams: {},
    };
    await saveBotMemory(bot, season, fresh);
    return fresh;
  }

  // Decay previous season's memory (reduce extremes, but keep general sentiment)
  const decayedTeams: BotMemory['teams'] = {};
  for (const [teamName, teamData] of Object.entries(previousMemory.teams)) {
    decayedTeams[teamName] = {
      // Decay trust/frustration toward neutral (0) by 50%
      trust: Math.round(teamData.trust * 0.5),
      frustration: Math.round(teamData.frustration * 0.5),
      // Reset mood to Neutral for new season
      mood: 'Neutral',
    };
  }

  const newMemory: BotMemory = {
    bot,
    updated_at: new Date().toISOString(),
    summaryMood: 'Focused', // Fresh start each season
    teams: decayedTeams,
  };

  await saveBotMemory(bot, season, newMemory);
  return newMemory;
}

// ============ Relationship Memory ============

function freshRelationshipMemory(season: number): RelationshipMemory {
  return {
    season: String(season),
    updated_at: new Date().toISOString(),
    prediction_records: { entertainer: { w: 0, l: 0 }, analyst: { w: 0, l: 0 } },
    pushbacks: [],
    themes: { entertainer_tendencies: [], analyst_tendencies: [], persistent_disagreements: [] },
    dynamic: { entertainer_lead_in_predictions: 0, total_pushbacks: 0, last_pushback_week: null, agreements_this_season: 0 },
  };
}

export async function loadRelationshipMemory(season: number): Promise<RelationshipMemory> {
  const db = getDb();
  try {
    const rows = await db
      .select()
      .from(relationshipMemory)
      .where(eq(relationshipMemory.season, season))
      .limit(1);
    if (!rows.length) return freshRelationshipMemory(season);
    const row = rows[0];
    return {
      season: String(season),
      updated_at: row.updatedAt.toISOString(),
      prediction_records: (row.predictionRecords as RelationshipMemory['prediction_records']) ?? { entertainer: { w: 0, l: 0 }, analyst: { w: 0, l: 0 } },
      pushbacks: (row.pushbacks as RelationshipMemory['pushbacks']) ?? [],
      themes: (row.themes as RelationshipMemory['themes']) ?? { entertainer_tendencies: [], analyst_tendencies: [], persistent_disagreements: [] },
      dynamic: (row.dynamic as RelationshipMemory['dynamic']) ?? { entertainer_lead_in_predictions: 0, total_pushbacks: 0, last_pushback_week: null, agreements_this_season: 0 },
    };
  } catch {
    return freshRelationshipMemory(season);
  }
}

export async function saveRelationshipMemory(season: number, memory: RelationshipMemory): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({ id: relationshipMemory.id })
    .from(relationshipMemory)
    .where(eq(relationshipMemory.season, season))
    .limit(1);

  const values = {
    season,
    updatedAt: new Date(),
    predictionRecords: memory.prediction_records,
    pushbacks: memory.pushbacks,
    themes: memory.themes,
    dynamic: memory.dynamic,
  };

  if (existing.length) {
    await db.update(relationshipMemory).set(values).where(eq(relationshipMemory.season, season));
  } else {
    await db.insert(relationshipMemory).values(values);
  }
}
