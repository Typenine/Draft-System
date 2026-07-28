export type DraftStatus = 'NOT_STARTED' | 'LIVE' | 'PAUSED' | 'COMPLETED';
export type DraftFormat = 'linear' | 'snake';

export type Team = {
  id: string;
  name: string;
  shortName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  sortOrder: number;
};

export type Player = {
  id: string;
  name: string;
  position: string;
  proTeam: string | null;
  college: string | null;
  rank: number;
};

export type DraftSlot = {
  overall: number;
  round: number;
  pickInRound: number;
  teamId: string;
};

export type DraftPick = {
  overall: number;
  round: number;
  teamId: string;
  playerId: string;
  playerName: string;
  playerPosition: string;
  playerProTeam: string | null;
  madeAt: string;
};

export type DraftSummary = {
  id: string;
  name: string;
  status: DraftStatus;
  rounds: number;
  clockSeconds: number;
  currentOverall: number;
  deadlineTs: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type Branding = {
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
};

export type DraftSettings = {
  rounds: number;
  clockSeconds: number;
  draftFormat: DraftFormat;
  baseOrder: string[];
};

export type DraftState = {
  configured: boolean;
  databaseConfigured?: boolean;
  leagueName?: string;
  branding?: Branding;
  settings?: DraftSettings;
  draft: DraftSummary | null;
  teams: Team[];
  players: Player[];
  slots: DraftSlot[];
  picks: DraftPick[];
  currentTeam: Team | null;
  availablePlayers: Player[];
};

export type Session =
  | { role: 'admin'; exp: number }
  | { role: 'team'; teamId: string; exp: number };

export type SetupTeamInput = {
  id?: string;
  name: string;
  shortName?: string;
  primaryColor?: string;
  secondaryColor?: string;
  logoUrl?: string | null;
  loginCode: string;
};

export type SetupPlayerInput = {
  id?: string;
  name: string;
  position: string;
  proTeam?: string | null;
  college?: string | null;
  rank?: number;
};

export type ArchiveDraft = DraftSummary & {
  picks: DraftPick[];
  slots: DraftSlot[];
};
