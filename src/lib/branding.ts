export const DEFAULT_EVENT_LOGO = '/panther-nation-draft-2026.webp';

export function eventLogoUrl(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || DEFAULT_EVENT_LOGO;
}
