import { getTeamLogoPath } from '@/lib/utils/team-utils';
import type { DiscordEmbed } from '@/lib/utils/discord';
import type { TradeBlockReportResult } from '@/lib/server/trade-block-narrative';

const DISCORD_FIELD_MAX = 1024;

function truncateField(text: string, max = DISCORD_FIELD_MAX): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function bulletList(items: string[]): string {
  if (items.length === 0) return '—';
  return items.map((item) => `• ${item}`).join('\n');
}

export function tradeBlockTeamUrl(baseUrl: string, teamName: string): string {
  const root = baseUrl.replace(/\/$/, '');
  return `${root}/trades/block?team=${encodeURIComponent(teamName)}`;
}

export function tradeBlockTeamElementId(teamName: string): string {
  return `trade-block-team-${encodeURIComponent(teamName)}`;
}

export function absoluteAssetUrl(baseUrl: string, path: string): string {
  const root = baseUrl.replace(/\/$/, '');
  return `${root}${path.startsWith('/') ? path : `/${path}`}`;
}

export function buildTradeBlockDiscordEmbed(
  report: TradeBlockReportResult,
  baseUrl: string,
): DiscordEmbed {
  const teamUrl = tradeBlockTeamUrl(baseUrl, report.teamName);
  const logoUrl = absoluteAssetUrl(baseUrl, getTeamLogoPath(report.teamName));

  const fields: NonNullable<DiscordEmbed['fields']> = [];

  if (report.added.length > 0) {
    fields.push({
      name: '📤 Added to block',
      value: truncateField(bulletList(report.added)),
      inline: false,
    });
  }

  if (report.removed.length > 0) {
    fields.push({
      name: '📥 Removed from block',
      value: truncateField(bulletList(report.removed)),
      inline: false,
    });
  }

  if (report.wantsBefore || report.wantsAfter || (report.wantsTagsAdded && report.wantsTagsAdded.length > 0)) {
    const parts: string[] = [];
    if (report.wantsBefore && report.wantsAfter && report.wantsBefore !== report.wantsAfter) {
      parts.push(`**Before:** ${report.wantsBefore}`);
      parts.push(`**After:** ${report.wantsAfter}`);
    } else if (report.wantsAfter) {
      parts.push(report.wantsAfter);
    } else if (report.wantsBefore) {
      parts.push(`_(cleared — was: ${report.wantsBefore})_`);
    }
    if (report.wantsTagsAdded && report.wantsTagsAdded.length > 0) {
      parts.push(`**Seeking:** ${report.wantsTagsAdded.join(', ')}`);
    }
    fields.push({
      name: '🎯 Looking for',
      value: truncateField(parts.join('\n') || '—'),
      inline: false,
    });
  }

  if (report.faabLabel) {
    fields.push({
      name: '💵 FAAB',
      value: report.faabLabel,
      inline: true,
    });
  }

  if (report.contactLabel) {
    fields.push({
      name: '📞 Contact',
      value: report.contactLabel,
      inline: true,
    });
  }

  const descriptionParts = [report.narrative];
  if (report.hashtag) descriptionParts.push(report.hashtag);
  const description = descriptionParts.filter(Boolean).join(' ').trim();

  return {
    title: report.title,
    description: description ? truncateField(description, 4096) : undefined,
    url: teamUrl,
    color: 0xbe161e,
    author: {
      name: report.teamName,
      icon_url: logoUrl,
    },
    thumbnail: { url: logoUrl },
    fields: fields.length > 0 ? fields : undefined,
    timestamp: report.updatedAt,
    footer: { text: 'East v. West · Trade Block' },
  };
}
