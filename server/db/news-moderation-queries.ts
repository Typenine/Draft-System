import { getDb } from './client';
import { newsModeration } from './schema';
import { eq } from 'drizzle-orm';

export type NewsModerationRule = {
  id: string;
  type: string;
  value: string;
  reason: string | null;
  createdAt: Date;
  createdBy: string | null;
};

export async function getNewsModerationRules(): Promise<NewsModerationRule[]> {
  const db = getDb();
  return db.select().from(newsModeration).orderBy(newsModeration.createdAt);
}

export async function addNewsModerationRule(params: {
  type: 'hide_url' | 'block_match' | 'block_headline';
  value: string;
  reason?: string;
  createdBy?: string;
}): Promise<NewsModerationRule> {
  const db = getDb();
  const [row] = await db
    .insert(newsModeration)
    .values({
      type: params.type,
      value: params.value,
      reason: params.reason ?? null,
      createdBy: params.createdBy ?? null,
    })
    .returning();
  return row as NewsModerationRule;
}

export async function deleteNewsModerationRule(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(newsModeration).where(eq(newsModeration.id, id)).returning();
  return result.length > 0;
}
