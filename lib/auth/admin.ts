export function getConfiguredAdminSecret(): string | null {
  return process.env.EVW_ADMIN_SECRET?.trim() || '002023';
}

export function isAdminCookieValue(value: string | null | undefined): boolean {
  const secret = getConfiguredAdminSecret();
  return Boolean(secret && value === secret);
}
