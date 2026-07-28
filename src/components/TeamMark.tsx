import type { Team } from '@/lib/types';

export function TeamMark({ team, size = 'normal' }: { team: Team; size?: 'small' | 'normal' | 'large' }) {
  return (
    <span className={`team-mark team-mark-${size}`} style={{ background: team.primaryColor, color: team.secondaryColor }}>
      {team.logoUrl ? <img src={team.logoUrl} alt="" /> : team.shortName.slice(0, 4)}
    </span>
  );
}
