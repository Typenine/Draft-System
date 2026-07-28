import { getDb } from './client';
import { storageConfig } from './schema';
import { eq } from 'drizzle-orm';

export async function getStorageConfig() {
  const db = getDb();
  const [row] = await db.select().from(storageConfig).where(eq(storageConfig.id, 'r2')).limit(1);
  return row || null;
}

export async function setStorageConfig(params: { chosenMode: 'path' | 'vhost' | null; lastVerifiedAt?: Date | null; notes?: string | null }) {
  const db = getDb();
  const data = {
    id: 'r2' as const,
    chosenMode: params.chosenMode ?? null,
    lastVerifiedAt: params.lastVerifiedAt ?? null,
    notes: params.notes ?? null,
  };
  const [row] = await db
    .insert(storageConfig)
    .values(data)
    .onConflictDoUpdate({ target: storageConfig.id, set: { chosenMode: data.chosenMode, lastVerifiedAt: data.lastVerifiedAt, notes: data.notes } })
    .returning();
  return row;
}
