// Mapping canonical team names to Sleeper accounts
// IMPORTANT: Fill CANONICAL_TEAM_BY_USER_ID with your league's Sleeper user_id -> canonical name mapping.
// You can get user_id values from the Sleeper API or temporary console logs we emit in getTeamsData when unknown.

export const CANONICAL_TEAM_BY_USER_ID: Record<string, string> = {
  // 2025 league owners (authoritative across seasons)
  '603801140211027968': 'Belltown Raptors',
  '600107096758870016': 'Double Trouble',
  '604014218504630272': 'Elemental Heroes',
  '869614030313136128': 'Mt. Lebanon Cake Eaters',
  '866793409938104320': 'Belleview Badgers',
  '871107865686020096': 'BeerNeverBrokeMyHeart',
  '603802414381879296': 'Detroit Dawgs',
  '870841561565544448': 'bop pop',
  '234898221262958592': 'Cascade Marauders',
  '866824942002487296': 'Red Pandas',
  '867644621516353536': 'The Lone Ginger',
  '741241996198469632': 'Bimg Bamg Boomg',
};

// Optional: map Sleeper-visible team/display names to your canonical names.
// This helps auto-resolve without user_id when names match or are known aliases.
export const TEAM_ALIASES: Record<string, string> = {
  // Usernames (owner usernames)
  'jbrichards77': 'Belltown Raptors',
  'noahjankowski': 'Double Trouble',
  'jdeschaine4': 'Elemental Heroes',
  'pensrock8711': 'Mt. Lebanon Cake Eaters',
  'typenine': 'Belleview Badgers',
  'mb48': 'BeerNeverBrokeMyHeart',
  'conor1440': 'Detroit Dawgs',
  'jfrank4': 'bop pop',
  'mattminshew15': 'Cascade Marauders',
  'songofthepanda': 'Red Pandas',
  'ryannmidolflynns': 'The Lone Ginger',
  'ryanmidolflynns': 'The Lone Ginger',
  'ratpickle': 'Bimg Bamg Boomg',

  // Prior or alternate team/display names (past seasons)
  'hurts so good': 'Belltown Raptors',
  'the reigning champs': 'Double Trouble',
  'frank gore = hof': 'Belleview Badgers',
  "minshew's maniacs": 'Cascade Marauders',
  'minshews maniacs': 'Cascade Marauders',
  "gardner's ghost": 'Cascade Marauders',
  'gardners ghost': 'Cascade Marauders',
  'k9 minshew ii': 'Cascade Marauders',
  'ryanmi dolflynns': 'The Lone Ginger',
  'the lone ginger': 'The Lone Ginger',
  'the lone gingeer': 'The Lone Ginger',
  'the lone gingerr': 'The Lone Ginger',
  'the lone gingerrr': 'The Lone Ginger',
  'maholmes and watson': 'Bimg Bamg Boomg',
};

// Normalize a name for alias matching
export function normalizeName(s?: string | null): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}