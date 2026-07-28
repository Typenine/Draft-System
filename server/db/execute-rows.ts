/** Normalize drizzle `db.execute()` results (Neon returns `{ rows }`, not a bare array). */
export function rowsFromExecute<T extends Record<string, unknown> = Record<string, unknown>>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: unknown[] }).rows ?? []) as T[];
}

export function firstRowFromExecute<T extends Record<string, unknown> = Record<string, unknown>>(res: unknown): T | null {
  return rowsFromExecute<T>(res)[0] ?? null;
}
