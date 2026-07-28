export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';

  const authHeader = req.headers.get('authorization') || '';
  const bearerSecret = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice('bearer '.length).trim()
    : '';
  const headerSecret = req.headers.get('x-cron-secret') || '';

  return bearerSecret === secret || headerSecret === secret;
}
