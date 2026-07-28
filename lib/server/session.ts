import { cookies } from 'next/headers';
import { verifySession } from '@/lib/server/auth';
import { canonicalizeTeamName, getUserIdForTeam } from '@/lib/server/user-identity';

export async function requireTeamUser(): Promise<{ team: string; userId: string } | null> {
  try {
    const jar = await cookies();
    const token = jar.get('evw_session')?.value || '';
    const claims = token ? verifySession(token) : null;
    const rawTeam = (claims?.team as string) || (claims?.sub as string) || '';
    const team = rawTeam ? canonicalizeTeamName(rawTeam) : '';
    if (!team) return null;
    const userId = getUserIdForTeam(team);
    return { team, userId };
  } catch {
    return null;
  }
}
