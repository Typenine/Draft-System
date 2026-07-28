/**
 * Personality Queries — Phase 3
 *
 * Database CRUD for bot settings, team narrative card overrides, and phrase pools.
 *
 * Fallback contract:
 * - All load functions return null / empty array on miss or DB error.
 * - Callers MUST handle null returns by falling back to hardcoded defaults.
 * - These tables may not exist in older deployments — all queries use try/catch.
 * - Never import these directly in hot-path generation code; always dynamic-import
 *   or guard with try/catch at the call site (see newsletter/route.ts pattern).
 */

import { eq } from 'drizzle-orm';
import { getDb } from './client';
import { botSettings, teamNarrativeCards, phrasePools } from './schema';
import type { BotName } from '@/lib/newsletter/types';

// ============ Bot Settings ============

export type BotSettingsRow = typeof botSettings.$inferSelect;
export type BotSettingsInsert = typeof botSettings.$inferInsert;

/**
 * Load admin-edited bot settings for a single bot.
 * Returns null if no row exists OR if DB is unavailable.
 */
export async function loadBotSettings(bot: BotName): Promise<BotSettingsRow | null> {
  try {
    const db = getDb();
    const rows = await db.select().from(botSettings).where(eq(botSettings.bot, bot)).limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Upsert bot settings. Only provided fields are changed; unprovided fields remain
 * at their current DB value (or null/default on first insert).
 */
export async function saveBotSettings(
  bot: BotName,
  data: Omit<BotSettingsInsert, 'bot' | 'updatedAt'>,
): Promise<void> {
  const db = getDb();
  await db
    .insert(botSettings)
    .values({ bot, ...data })
    .onConflictDoUpdate({
      target: botSettings.bot,
      set: {
        ...data,
        updatedAt: new Date(),
      },
    });
}

/**
 * Reset a bot's settings to all-null (hardcoded defaults take over).
 */
export async function resetBotSettings(bot: BotName): Promise<void> {
  const db = getDb();
  await db
    .insert(botSettings)
    .values({
      bot,
      displayName: null,
      roleDescription: null,
      voiceConfig: null,
      signaturePhrases: null,
      bannedPhrases: null,
      safetyBoundaries: null,
      phaseStances: null,
      adminNotes: null,
    })
    .onConflictDoUpdate({
      target: botSettings.bot,
      set: {
        displayName: null,
        roleDescription: null,
        voiceConfig: null,
        signaturePhrases: null,
        bannedPhrases: null,
        safetyBoundaries: null,
        phaseStances: null,
        adminNotes: null,
        updatedAt: new Date(),
      },
    });
}

// ============ Team Narrative Cards ============

export type TeamNarrativeCardRow = typeof teamNarrativeCards.$inferSelect;

/**
 * Load all team narrative card overrides from the DB.
 * Returns [] if none exist or on error.
 */
export async function loadAllTeamNarrativeOverrides(): Promise<TeamNarrativeCardRow[]> {
  try {
    const db = getDb();
    return await db.select().from(teamNarrativeCards);
  } catch {
    return [];
  }
}

/**
 * Load the admin override for a single team.
 * Returns null on miss or error.
 */
export async function loadTeamNarrativeCard(teamName: string): Promise<TeamNarrativeCardRow | null> {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(teamNarrativeCards)
      .where(eq(teamNarrativeCards.teamName, teamName))
      .limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Upsert a team's narrative card override.
 * Fields not included in `cardData` retain their previous values.
 */
export async function saveTeamNarrativeCard(
  teamName: string,
  cardData: TeamNarrativeCardRow['cardData'],
): Promise<void> {
  const db = getDb();
  await db
    .insert(teamNarrativeCards)
    .values({ teamName, cardData })
    .onConflictDoUpdate({
      target: teamNarrativeCards.teamName,
      set: { cardData, updatedAt: new Date() },
    });
}

/**
 * Delete a team's card override (reverts to hardcoded default).
 */
export async function deleteTeamNarrativeCard(teamName: string): Promise<void> {
  const db = getDb();
  await db.delete(teamNarrativeCards).where(eq(teamNarrativeCards.teamName, teamName));
}

// ============ Phrase Pools ============

export type PhrasePoolRow = typeof phrasePools.$inferSelect;

/**
 * Load a single phrase pool by key.
 * Returns null on miss or error.
 */
export async function loadPhrasePool(poolKey: string): Promise<string[] | null> {
  try {
    const db = getDb();
    const rows = await db.select().from(phrasePools).where(eq(phrasePools.poolKey, poolKey)).limit(1);
    return rows[0]?.phrases ?? null;
  } catch {
    return null;
  }
}

/**
 * Load all phrase pools (for the admin UI overview).
 */
export async function loadAllPhrasePools(): Promise<PhrasePoolRow[]> {
  try {
    const db = getDb();
    return await db.select().from(phrasePools);
  } catch {
    return [];
  }
}

/**
 * Upsert a phrase pool.
 */
export async function savePhrasePool(
  poolKey: string,
  phrases: string[],
  adminNotes?: string,
): Promise<void> {
  const db = getDb();
  await db
    .insert(phrasePools)
    .values({ poolKey, phrases, adminNotes })
    .onConflictDoUpdate({
      target: phrasePools.poolKey,
      set: { phrases, adminNotes, updatedAt: new Date() },
    });
}

/**
 * Delete a phrase pool (reverts to empty / hardcoded defaults).
 */
export async function deletePhrasePool(poolKey: string): Promise<void> {
  const db = getDb();
  await db.delete(phrasePools).where(eq(phrasePools.poolKey, poolKey));
}
