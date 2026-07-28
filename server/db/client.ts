import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  if (!url) {
    throw new Error('DATABASE_URL (or POSTGRES_URL/POSTGRES_PRISMA_URL) is missing. Add it in your environment to enable Postgres.');
  }
  if (_db) return _db;
  const client = neon(url);
  _db = drizzle(client);
  return _db;
}
