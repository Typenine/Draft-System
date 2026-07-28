import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const teamRoomPath = resolve(process.cwd(), 'src/app/draft/room/team/page.tsx');
let teamRoom = await readFile(teamRoomPath, 'utf8');
teamRoom = teamRoom.replace(
  'allTeams={TEAM_NAMES}',
  'allTeams={Array.from(new Set((draft?.allSlots || []).map((slot) => slot.team)))}',
);
if (teamRoom.includes('TEAM_NAMES')) {
  throw new Error('[standalone-adapter] Static East v. West team names remain in the standalone team room.');
}
if (!teamRoom.includes('allTeams={Array.from(new Set((draft?.allSlots || [])')) {
  throw new Error('[standalone-adapter] Dynamic trade-center team list was not applied.');
}
await writeFile(teamRoomPath, teamRoom, 'utf8');
