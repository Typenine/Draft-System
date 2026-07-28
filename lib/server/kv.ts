type KVLike = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
  incr: (key: string) => Promise<number>;
  expire?: (key: string, seconds: number) => Promise<unknown>;
  ttl?: (key: string) => Promise<number>;
};

let cached: KVLike | null | undefined;

export async function getKV(): Promise<KVLike | null> {
  if (cached !== undefined) return cached;
  try {
    const mod = await import('@vercel/kv');
    const kv = (mod as unknown as { kv?: KVLike }).kv;
    cached = kv || null;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}
