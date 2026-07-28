type AuthEvent = {
  type: 'login_success' | 'login_fail' | 'login_lock';
  team: string;
  ip: string;
  ok: boolean;
  reason?: string;
};

export async function logAuthEvent(e: AuthEvent): Promise<void> {
  try {
    const { putObjectText } = await import('@/server/storage/r2');
    const key = `logs/auth/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    await putObjectText({ key, text: JSON.stringify({ ts: new Date().toISOString(), ...e }) });
  } catch {
    // best-effort only
  }
}
