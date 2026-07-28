import { getDb } from '@/server/db/client';
import { discordNotifications } from '@/server/db/schema';
import type { TradeBlockReportResult } from '@/lib/server/trade-block-narrative';

export async function recordTradeBlockWebhookAttempt(params: {
  team: string;
  updatedAt: string;
  success: boolean;
  error?: string;
  report?: TradeBlockReportResult;
}): Promise<void> {
  try {
    const db = getDb();
    await db.insert(discordNotifications).values({
      notificationType: 'trade_block_posted',
      dedupeKey: `${params.team}:${params.updatedAt}`,
      meta: {
        team: params.team,
        success: params.success,
        error: params.error ?? null,
        title: params.report?.title ?? null,
        addedCount: params.report?.added.length ?? 0,
        removedCount: params.report?.removed.length ?? 0,
      },
    });
  } catch (e) {
    console.error('[trade-block-webhook] Failed to record delivery:', e);
  }
}
