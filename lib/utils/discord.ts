/**
 * Discord Webhook Utilities
 * Shared helpers for posting to Discord with proper rate limiting and error handling.
 */

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  timestamp?: string;
  footer?: { text: string; icon_url?: string };
  thumbnail?: { url: string };
  image?: { url: string };
  author?: { name: string; url?: string; icon_url?: string };
}

export interface DiscordWebhookPayload {
  content?: string;
  embeds?: DiscordEmbed[];
  allowed_mentions?: { parse: string[] };
}

export interface DiscordWebhookHealth {
  configured: boolean;
  reachable: boolean;
  status?: number;
  error?: string;
}

const CANONICAL_SITE_URL = 'https://east-v-west.com';

/** Normalize production URL configuration before it is placed in a Discord embed. */
export function normalizeSiteUrl(siteUrl?: string): string {
  const value = siteUrl?.trim();
  if (!value) return CANONICAL_SITE_URL;

  const hasProtocol = /^https?:\/\//i.test(value);
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/i.test(value);
  const candidate = hasProtocol ? value : `${isLocal ? 'http' : 'https'}://${value}`;

  try {
    return new URL(candidate).origin;
  } catch {
    return CANONICAL_SITE_URL;
  }
}

type NewsletterLinkSelector = {
  newsletterId?: string;
  season?: number;
  week?: number;
  episodeType?: string | null;
  title?: string | null;
};

/** Build a stable link to one published issue. */
export function buildNewsletterUrl(
  siteUrl: string,
  selector?: string | NewsletterLinkSelector,
): string {
  const url = new URL('/newsletter', normalizeSiteUrl(siteUrl));
  const options = typeof selector === 'string' ? { newsletterId: selector } : selector;

  if (options?.newsletterId) {
    url.searchParams.set('issue', options.newsletterId);
  } else if (options) {
    if (Number.isFinite(options.season)) url.searchParams.set('season', String(options.season));
    if (Number.isFinite(options.week)) url.searchParams.set('week', String(options.week));
    if (options.episodeType) url.searchParams.set('type', options.episodeType);
    if (options.title?.trim()) url.searchParams.set('title', options.title.trim());
  }

  return url.toString();
}

/**
 * Check that a Discord webhook exists and is reachable without posting a message.
 * Discord supports GET on webhook URLs, so this is safe for surprise announcements.
 */
export async function verifyDiscordWebhook(webhookUrl?: string): Promise<DiscordWebhookHealth> {
  if (!webhookUrl) {
    return { configured: false, reachable: false, error: 'Webhook is not configured' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(webhookUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        configured: true,
        reachable: false,
        status: res.status,
        error: `Discord returned HTTP ${res.status}`,
      };
    }

    return { configured: true, reachable: true, status: res.status };
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Post to a Discord webhook with one rate-limit retry. */
export async function postToDiscordWebhook(
  webhookUrl: string,
  payload: DiscordWebhookPayload,
): Promise<{ success: boolean; error?: string }> {
  const safePayload: DiscordWebhookPayload = {
    ...payload,
    allowed_mentions: { parse: [] },
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(safePayload),
    });

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      const retryAfter = (data as { retry_after?: number }).retry_after || 5;
      console.log(`[Discord] Rate limited, waiting ${retryAfter}s...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));

      const retry = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(safePayload),
      });

      if (!retry.ok) {
        const text = await retry.text().catch(() => '');
        return { success: false, error: `Retry failed: HTTP ${retry.status}: ${text.slice(0, 200)}` };
      }
      return { success: true };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { success: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const NEWSLETTER_CONTENTS: Record<string, string[]> = {
  pre_draft: ['Draft outlook', 'Two-round mock drafts', 'Team needs', 'Pre-draft trade analysis'],
  post_draft: ['Team-by-team draft grades', 'Best values', 'Biggest reaches', 'Final draft verdict'],
  preseason: ['Preseason power rankings', 'Season preview', 'Contenders and sleepers', 'Predictions'],
  offseason: ['League news', 'Trades and roster moves', 'Team outlooks', 'What comes next'],
  trade_deadline: ['Trade grades', 'Deadline winners and losers', 'Power rankings', 'Playoff outlook'],
  playoffs_preview: ['Playoff matchups', 'Title odds', 'Key players', 'Predictions'],
  playoffs_round: ['Playoff recaps', 'Turning points', 'Updated title outlook', 'Next-round predictions'],
  championship: ['Championship recap', 'Season-defining moments', 'Final awards', 'Champion reaction'],
  season_finale: ['Season recap', 'Awards', 'Final power rankings', 'Offseason outlook'],
  regular: ['Matchup recaps', 'Power rankings', 'Trade analysis', 'Next-week predictions'],
};

const NEWSLETTER_LABELS: Record<string, string> = {
  pre_draft: 'Pre-Draft Newsletter',
  post_draft: 'Post-Draft Grades',
  preseason: 'Preseason Preview',
  offseason: 'Offseason Update',
  trade_deadline: 'Trade Deadline Newsletter',
  playoffs_preview: 'Playoffs Preview',
  playoffs_round: 'Playoff Newsletter',
  championship: 'Championship Newsletter',
  season_finale: 'Season Finale',
  regular: 'Weekly Newsletter',
};

/** Build an episode-aware newsletter announcement embed. */
export function buildNewsletterEmbed(options: {
  season: number;
  week: number;
  siteUrl: string;
  newsletterId?: string;
  episodeType?: string | null;
  title?: string | null;
  highlights?: string[];
}): DiscordEmbed {
  const { season, week, newsletterId, episodeType = 'regular', title, highlights } = options;
  const normalizedType = episodeType || 'regular';
  const newsletterUrl = buildNewsletterUrl(options.siteUrl, {
    newsletterId,
    season,
    week,
    episodeType: normalizedType,
    title,
  });
  const isWeekless = ['pre_draft', 'post_draft', 'preseason', 'offseason'].includes(normalizedType);
  const label = NEWSLETTER_LABELS[normalizedType] ?? 'Newsletter';
  const contents = NEWSLETTER_CONTENTS[normalizedType] ?? NEWSLETTER_CONTENTS.regular;
  const fallbackTitle = isWeekless ? `${season} ${label}` : `${label}: Week ${week}`;
  const issueTitle = title?.trim() || fallbackTitle;

  const description = highlights && highlights.length > 0
    ? highlights.map(highlight => `• ${highlight}`).join('\n')
    : 'A new East v. West issue is live and ready to read.';

  return {
    title: `📰 ${issueTitle}`,
    description,
    url: newsletterUrl,
    color: 0xbe161e,
    fields: [
      {
        name: '📊 What\'s Inside',
        value: contents.map(item => `• ${item}`).join('\n'),
        inline: true,
      },
      {
        name: '🔗 Read This Issue',
        value: `[Open ${issueTitle}](${newsletterUrl})`,
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: `Season ${season} • East v. West`,
    },
  };
}

/** Build a trade notification embed. */
export function buildTradeEmbed(options: {
  isComplete: boolean;
  teams: Array<{ name: string; gets: string[]; gives: string[] }>;
  week: number;
  siteUrl: string;
  timestamp?: Date;
}): DiscordEmbed {
  const { isComplete, teams, week, siteUrl, timestamp } = options;
  const fields: DiscordEmbed['fields'] = [];

  for (const team of teams) {
    const gets = team.gets.length > 0 ? team.gets.join('\n') : 'Nothing';
    const gives = team.gives.length > 0 ? team.gives.join('\n') : 'Nothing';
    fields.push({ name: `📥 ${team.name} receives`, value: gets, inline: true });
    fields.push({ name: `📤 ${team.name} sends`, value: gives, inline: true });
    fields.push({ name: '\u200B', value: '\u200B', inline: true });
  }

  return {
    title: isComplete ? '✅ Trade Completed' : '🔔 Trade Accepted',
    description: `A trade has been ${isComplete ? 'completed' : 'accepted'} in the league!`,
    color: isComplete ? 0x00ff00 : 0xffaa00,
    fields,
    timestamp: (timestamp || new Date()).toISOString(),
    footer: { text: `Week ${week} • View all trades` },
    url: `${normalizeSiteUrl(siteUrl)}/transactions`,
  };
}
