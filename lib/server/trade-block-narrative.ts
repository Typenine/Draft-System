import { TradeAsset, TradeWants } from './user-store';
import { getAllPlayersCached } from '@/lib/utils/sleeper-api';
import {
  formatTradeBlockPickLabel,
  loadPickSlotMap,
  type PickSlotMap,
} from '@/lib/server/draft-slot-order';
import { formatValueTier, getPlayerValuesBySleeperId } from '@/lib/server/trade-values-cache';

export type TradeBlockReportResult = {
  teamName: string;
  title: string;
  narrative: string;
  added: string[];
  removed: string[];
  wantsBefore?: string;
  wantsAfter?: string;
  wantsTagsAdded?: string[];
  faabLabel?: string;
  contactLabel?: string;
  hashtag?: string;
  updatedAt: string;
};

const DEBUG = process.env.TRADE_BLOCK_DEBUG === '1' || process.env.TRADE_BLOCK_DEBUG === 'true';

type DiffResult = {
  addedPlayers: TradeAsset[];
  removedPlayers: TradeAsset[];
  addedPicks: TradeAsset[];
  removedPicks: TradeAsset[];
  faabChanged: boolean;
  faabBefore?: number;
  faabAfter?: number;
  contactChanged: boolean;
  contactBefore?: string;
  contactAfter?: string;
  lookingForChanged: boolean;
  lookingForBefore?: string;
  lookingForAfter?: string;
  tagsChanged: boolean;
  tagsBefore: Set<string>;
  tagsAfter: Set<string>;
  addedPositions: string[];
  removedPositions: string[];
  addedPickTags: string[];
  removedPickTags: string[];
};

type NarrativeContext = {
  teamName: string;
  diff: DiffResult;
  currentPlayers: TradeAsset[];
  baseUrl: string | null;
  updatedAt: string;
  leagueContext?: LeagueMarketContext;
};

type LeagueMarketContext = {
  teamsSeekingPositions: Record<string, number>; // e.g., {"RB": 3, "WR": 2}
  teamsSeekingPickRounds: Record<string, number>; // e.g., {"1st": 4, "2nd": 2}
};

function assetToKey(asset: TradeAsset): string {
  if (asset.type === 'player') return `player:${asset.playerId}`;
  if (asset.type === 'pick') return `pick:${asset.year}-R${asset.round}-${asset.originalTeam ?? 'own'}`;
  if (asset.type === 'faab') return `faab:${asset.amount ?? 0}`;
  return '';
}

async function assetToLabel(
  asset: TradeAsset,
  players: Record<string, { first_name?: string; last_name?: string; position?: string; team?: string }>,
  ownerTeam: string,
  slotMap: PickSlotMap | null,
  playerValues: Map<string, number>,
): Promise<string> {
  if (asset.type === 'player') {
    const player = players[asset.playerId];
    if (player) {
      const name = `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim() || asset.playerId;
      const pos = player.position || '';
      const nfl = player.team || '';
      const meta = [pos, nfl].filter(Boolean).join(', ');
      const base = meta ? `${name} (${meta})` : name;
      const val = playerValues.get(asset.playerId);
      const tier = val != null ? formatValueTier(val) : null;
      return tier ? `${base} · ${tier}` : base;
    }
    return asset.playerId;
  }
  if (asset.type === 'pick') {
    return formatTradeBlockPickLabel(asset, ownerTeam, slotMap);
  }
  if (asset.type === 'faab') {
    return `$${asset.amount ?? 0} FAAB`;
  }
  return 'Unknown';
}

function contactMethodLabel(method: string | undefined): string | undefined {
  if (!method) return undefined;
  const labels: Record<string, string> = {
    text: 'Text message (see trade block page)',
    discord: 'Discord',
    snap: 'Snapchat (see trade block page)',
    sleeper: 'Sleeper DM',
  };
  return labels[method] ?? method;
}

function resolveEmbedTitle(diff: DiffResult): string {
  const faabAdded = diff.faabChanged && diff.faabAfter != null && diff.faabBefore == null;
  const faabRemoved = diff.faabChanged && diff.faabBefore != null && diff.faabAfter == null;
  const hasAdd = diff.addedPlayers.length > 0 || diff.addedPicks.length > 0 || faabAdded;
  const hasRemove = diff.removedPlayers.length > 0 || diff.removedPicks.length > 0 || faabRemoved;
  const wantsOnly =
    !hasAdd &&
    !hasRemove &&
    (diff.lookingForChanged || diff.addedPositions.length > 0 || diff.addedPickTags.length > 0);
  const metaOnly = !hasAdd && !hasRemove && !wantsOnly && (diff.faabChanged || diff.contactChanged);

  if (hasAdd && !hasRemove) return '📤 On the Block';
  if (hasRemove && !hasAdd) return '📥 Off the Block';
  if (hasAdd && hasRemove) return '🔄 Block Updated';
  if (wantsOnly) return '🎯 Wants Updated';
  if (metaOnly) return '📋 Trade Block Updated';
  return '🔔 Trade Block Update';
}

function buildNarrativeOnly(parts: string[]): string {
  return parts.filter(Boolean).join(' ').trim();
}

function pickToLabel(asset: TradeAsset, ownerTeam: string, slotMap: PickSlotMap | null): string {
  if (asset.type !== 'pick') return '';
  return formatTradeBlockPickLabel(asset, ownerTeam, slotMap);
}

const FAAB_TEMPLATES = {
  add: [
    'Sources say {team} are also open to moving ${amount} FAAB.',
    'Per sources, {team} have made ${amount} FAAB available in trade talks.',
  ],
  remove: [
    'Sources say {team} are no longer shopping their FAAB.',
    '{team} have pulled FAAB off the block, per league sources.',
  ],
  update: [
    'Sources say {team} adjusted their FAAB ask to ${amount}.',
    'Per sources, {team} are now listening on ${amount} FAAB.',
  ],
};

const CONTACT_TEMPLATES = [
  'A {team} source says preferred contact is now via {method}.',
  'Per someone close to the {team}, reach out on {method} for trade talks.',
];

const POSITIONAL_TAGS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
const PICK_TAGS = new Set(['1ST', '2ND', '3RD']);

const TEAM_HASHTAGS: Record<string, string> = {
  'Belltown Raptors': '#ClawCrew',
  'Double Trouble': '#DoubleThreat',
  'Elemental Heroes': '#HeroesRise',
  'Mt. Lebanon Cake Eaters': '#TakeTheCake',
  'Belleview Badgers': '#DigDeep',
  'BeerNeverBrokeMyHeart': '#BeerNation',
  'Detroit Dawgs': '#DawgPound',
  'bop pop': '#PopOff',
  'Minshew\'s Maniacs': '#ManiacMode',
  'Red Pandas': '#PandaPower',
  'The Lone Ginger': '#GingerArmy',
  'Bimg Bamg Boomg': '#BimgBamgBoom'
};

function extractTags(wants: TradeWants | null): Set<string> {
  const tags = new Set<string>();
  if (!wants) return tags;
  if (Array.isArray(wants.positions)) {
    wants.positions.forEach((p) => tags.add(p.toUpperCase()));
  }
  return tags;
}

function splitTags(tags: Set<string>): { positional: string[]; picks: string[] } {
  const positional: string[] = [];
  const picks: string[] = [];
  for (const tag of tags) {
    if (POSITIONAL_TAGS.has(tag)) positional.push(tag);
    else if (PICK_TAGS.has(tag)) picks.push(tag);
  }
  return { positional, picks };
}

export async function computeDiff(oldBlock: TradeAsset[], newBlock: TradeAsset[], oldWants: TradeWants | null, newWants: TradeWants | null): Promise<DiffResult> {
  const oldKeys = new Set(oldBlock.map(assetToKey));
  const newKeys = new Set(newBlock.map(assetToKey));

  const addedPlayers: TradeAsset[] = [];
  const removedPlayers: TradeAsset[] = [];
  const addedPicks: TradeAsset[] = [];
  const removedPicks: TradeAsset[] = [];
  let faabBefore: number | undefined;
  let faabAfter: number | undefined;

  for (const asset of newBlock) {
    const key = assetToKey(asset);
    if (!oldKeys.has(key)) {
      if (asset.type === 'player') addedPlayers.push(asset);
      else if (asset.type === 'pick') addedPicks.push(asset);
      else if (asset.type === 'faab') faabAfter = asset.amount;
    } else if (asset.type === 'faab') {
      faabAfter = asset.amount;
    }
  }

  for (const asset of oldBlock) {
    const key = assetToKey(asset);
    if (!newKeys.has(key)) {
      if (asset.type === 'player') removedPlayers.push(asset);
      else if (asset.type === 'pick') removedPicks.push(asset);
      else if (asset.type === 'faab') faabBefore = asset.amount;
    } else if (asset.type === 'faab') {
      faabBefore = asset.amount;
    }
  }

  const faabChanged = faabBefore !== faabAfter && (faabBefore !== undefined || faabAfter !== undefined);

  const oldContact = oldWants?.contactMethod;
  const newContact = newWants?.contactMethod;
  const contactChanged = oldContact !== newContact;

  const oldLookingFor = (oldWants?.text ?? '').trim();
  const newLookingFor = (newWants?.text ?? '').trim();
  const lookingForChanged = oldLookingFor !== newLookingFor;

  const tagsBefore = extractTags(oldWants);
  const tagsAfter = extractTags(newWants);
  const tagsChanged = tagsBefore.size !== tagsAfter.size || [...tagsBefore].some((t) => !tagsAfter.has(t));

  const beforeSplit = splitTags(tagsBefore);
  const afterSplit = splitTags(tagsAfter);
  
  const addedPositions = afterSplit.positional.filter((p) => !beforeSplit.positional.includes(p));
  const removedPositions = beforeSplit.positional.filter((p) => !afterSplit.positional.includes(p));
  const addedPickTags = afterSplit.picks.filter((p) => !beforeSplit.picks.includes(p));
  const removedPickTags = beforeSplit.picks.filter((p) => !afterSplit.picks.includes(p));

  return {
    addedPlayers,
    removedPlayers,
    addedPicks,
    removedPicks,
    faabChanged,
    faabBefore,
    faabAfter,
    contactChanged,
    contactBefore: oldContact,
    contactAfter: newContact,
    lookingForChanged,
    lookingForBefore: oldLookingFor,
    lookingForAfter: newLookingFor,
    tagsChanged,
    tagsBefore,
    tagsAfter,
    addedPositions,
    removedPositions,
    addedPickTags,
    removedPickTags,
  };
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

function pickTemplate<T>(arr: T[], rng: () => number): T {
  const idx = Math.floor(rng() * arr.length);
  return arr[idx];
}

const TEMPLATES = {
  playerAddSingle: [
    "I'm hearing {team} {verb} {player}.",
    "According to sources, {team} {verb} {player}.",
    "Sources tell me {team} {verb} {player}.",
    "Per sources, {team} {verb} {player}.",
    "{team} {verb} {player}, per league sources.",
    "Multiple sources indicate {team} {verb} {player}.",
    "Word around the league is {team} {verb} {player}.",
    "League insiders say {team} {verb} {player}.",
    "From what I'm hearing, {team} {verb} {player}.",
    "Sources close to the situation say {team} {verb} {player}.",
    "I'm told {team} {verb} {player}.",
    "The latest: {team} {verb} {player}, per sources.",
    "Breaking from my sources: {team} {verb} {player}.",
    "League sources confirm {team} {verb} {player}.",
    "Per league insiders, {team} {verb} {player}.",
  ],
  playerAddMultiple: [
    "I'm hearing {team} {verb} {players}.",
    "According to sources, {team} {verb} {players}.",
    "Sources say {team} {verb} {players}.",
    "Per sources, {team} {verb} {players}.",
    "{team} {verb} {players}, according to sources.",
    "Multiple sources tell me {team} {verb} {players}.",
    "Word is {team} {verb} {players}.",
    "League insiders say {team} {verb} {players}.",
    "From what I'm gathering, {team} {verb} {players}.",
    "Sources close to the team indicate {team} {verb} {players}.",
    "I'm told {team} {verb} {players}.",
    "The latest from my sources: {team} {verb} {players}.",
    "Multiple league sources confirm {team} {verb} {players}.",
    "Breaking: {team} {verb} {players}.",
    "League sources say {team} {verb} {players}.",
  ],
  playerRemoveSingle: [
    "Sources say {team} {verb} {player}.",
    "I'm hearing {team} {verb} {player}.",
    "According to sources, {team} {verb} {player}.",
    "League sources indicate {team} {verb} {player}.",
    "{team} {verb} {player}, per sources.",
    "Word around the league is {team} {verb} {player}.",
    "Multiple sources tell me {team} {verb} {player}.",
    "From what I'm hearing, {team} {verb} {player}.",
    "The latest: {team} {verb} {player}.",
    "I'm told {team} {verb} {player}.",
    "Per league sources, {team} {verb} {player}.",
    "League sources confirm {team} {verb} {player}.",
    "Sources tell me {team} {verb} {player}. The decision came after reassessing their roster needs.",
    "I'm hearing {team} {verb} {player}. Per sources, the team had a change of heart on moving him.",
    "Breaking: {team} {verb} {player}. They're now expected to hold onto him for the foreseeable future.",
    "Word is {team} {verb} {player}. League sources say talks cooled off after initial interest.",
  ],
  playerRemoveMultiple: [
    "Sources say {team} {verb} {players}.",
    "I'm hearing {team} {verb} {players}.",
    "Per league sources, {team} {verb} {players}.",
    "{team} {verb} {players}, according to sources.",
    "League insiders say {team} {verb} {players}.",
    "Word is {team} {verb} {players}.",
    "From what I'm gathering, {team} {verb} {players}.",
    "I'm told {team} {verb} {players}.",
    "League sources confirm {team} {verb} {players}.",
    "Breaking: {team} {verb} {players}.",
    "Sources tell me {team} {verb} {players}. The team is taking a different approach moving forward.",
    "I'm hearing {team} {verb} {players}. Per league insiders, they're now committed to this core group.",
    "Word around the league is {team} {verb} {players}. The market didn't develop as expected, per sources.",
  ],
  pickAddSingle: [
    "I'm also hearing {team} {verb} their {pick}.",
    "Sources say {team} {verb} their {pick}.",
    "Additionally, {team} {verb} their {pick}.",
    "{team} {verb} their {pick}, per sources.",
    "On the draft capital front, {team} {verb} their {pick}.",
    "Word is {team} {verb} their {pick} as well.",
    "Sources also indicate {team} {verb} their {pick}.",
    "I'm told {team} {verb} their {pick} too.",
    "Adding to that, {team} {verb} their {pick}.",
    "League sources say {team} {verb} their {pick}.",
    "In terms of picks, {team} {verb} their {pick}.",
    "From what I'm hearing, {team} {verb} their {pick} as well.",
    "Per sources, {team} {verb} their {pick} on top of that.",
  ],
  pickAddMultiple: [
    "I'm also hearing {team} {verb} {picks}.",
    "Sources indicate {team} {verb} {picks}.",
    "{team} {verb} {picks}, per sources.",
    "On the draft capital front, {team} {verb} {picks}.",
    "Word is {team} {verb} {picks} as well.",
    "Additionally, {team} {verb} {picks}.",
    "League sources say {team} {verb} {picks}.",
    "I'm told {team} {verb} {picks} too.",
    "In terms of picks, {team} {verb} {picks}.",
    "From what I'm gathering, {team} {verb} {picks} as well.",
  ],
  pickRemoveSingle: [
    "Sources say {team} {verb} their {pick}.",
    "{team} {verb} their {pick}, according to sources.",
    "I'm hearing {team} {verb} their {pick}.",
    "On the pick front, {team} {verb} their {pick}.",
    "League sources indicate {team} {verb} their {pick}.",
    "Word is {team} {verb} their {pick}.",
    "Per sources, {team} {verb} their {pick}.",
    "In terms of draft capital, {team} {verb} their {pick}.",
  ],
  pickRemoveMultiple: [
    "Sources say {team} {verb} {picks}.",
    "{team} {verb} {picks}, per sources.",
    "I'm hearing {team} {verb} {picks}.",
    "On the draft capital front, {team} {verb} {picks}.",
    "League sources indicate {team} {verb} {picks}.",
    "Word is {team} {verb} {picks}.",
    "In terms of picks, {team} {verb} {picks}.",
  ],
  mixed: [
    "{team} {verbAdd} {added} but {verbRemove} {removed}.",
    "Sources say {team} {verbAdd} {added} while {verbRemove} {removed}.",
    "The latest from my sources: {team} {verbAdd} {added}, though they {verbRemove} {removed}.",
    "Word is {team} {verbAdd} {added} but {verbRemove} {removed}.",
    "League insiders tell me {team} {verbAdd} {added} while {verbRemove} {removed}.",
    "From what I'm gathering, {team} {verbAdd} {added} even as they {verbRemove} {removed}.",
    "Per sources, {team} {verbAdd} {added} but {verbRemove} {removed}.",
    "Breaking: {team} {verbAdd} {added} while {verbRemove} {removed}.",
    "Multiple sources say {team} {verbAdd} {added}, though they {verbRemove} {removed}.",
    "According to league sources, {team} {verbAdd} {added} but {verbRemove} {removed}.",
    "I'm told {team} {verbAdd} {added} even as they {verbRemove} {removed}.",
    "League sources confirm {team} {verbAdd} {added} but {verbRemove} {removed}.",
    "Sources tell me {team} {verbAdd} {added} while {verbRemove} {removed}. The team is recalibrating their approach.",
    "Breaking: {team} {verbAdd} {added} but {verbRemove} {removed}. Per sources, they're being selective about what they'll move.",
    "Word around the league is {team} {verbAdd} {added} even as they {verbRemove} {removed}. The strategy shift is notable.",
  ],
  lookingFor: [
    "A {team} source tells me: \"{wants}.\"",
    "According to a {team} team official: \"{wants}.\"",
    "Per someone close to the {team}: \"{wants}.\"",
    "A {team} insider says: \"{wants}.\"",
    "I'm told by a {team} source: \"{wants}.\"",
    "From a {team} source: \"{wants}.\"",
    "League source with knowledge of the {team}'s thinking: \"{wants}.\"",
    "A {team} team official tells me: \"{wants}.\"",
    "Per a {team} source familiar with their plans: \"{wants}.\"",
    "Source close to the {team}: \"{wants}.\"",
    "{team} official on what they're after: \"{wants}.\"",
    "I'm hearing from a {team} source: \"{wants}.\"",
    "According to someone in the {team}'s front office: \"{wants}.\"",
    "A league source quotes a {team} official: \"{wants}.\"",
    "Per a {team} source with direct knowledge: \"{wants}.\"",
    "Source with knowledge of the {team}'s plans says: \"{wants}.\" The team has been exploring their options.",
    "A {team} official told me today: \"{wants}.\" They've been working the phones.",
    "From a {team} source familiar with the situation: \"{wants}.\" The team is being selective but open to conversations.",
  ],
  tagsPositional: [
    "Sources say the {team} are looking to acquire {positions} in any deal.",
    "I'm hearing the {team} want to add help at {positions}.",
    "League sources indicate the {team} are targeting {positions} as a key need.",
    "Word is the {team} are looking to land {positions} in return.",
    "The {team} are believed to be seeking upgrades at {positions}.",
    "Per sources, the {team} want to bring in {positions} as part of any trade.",
    "From what I'm gathering, the {team} are hoping to acquire {positions}.",
    "Multiple sources say the {team} are looking for {positions} in trade talks.",
    "I'm told the {team} are seeking to bolster {positions}.",
    "The {team} have identified {positions} as areas they're looking to strengthen.",
    "According to league insiders, the {team} are prioritizing {positions}. They've made that clear in discussions with other teams.",
    "Sources say the {team} want to add at {positions}. Per league sources, it's their top priority in any potential deal.",
    "I'm hearing the {team} are looking for {positions} help. Multiple teams know what they're after, per sources.",
  ],
  tagsPicks: [
    "In terms of draft capital, the {team} are looking to acquire {picks} in return.",
    "Sources say the {team} want to get {picks} back in any deal.",
    "I'm hearing the {team} are hoping to land {picks} as part of a trade.",
    "The {team} are believed to be targeting {picks}, per sources.",
    "League sources indicate the {team} are seeking to add {picks}.",
    "Word is the {team} want {picks} included in any package.",
    "From what I'm told, the {team} are looking to bring in {picks}.",
    "The {team}'s focus is on securing {picks}, per league insiders.",
    "I'm hearing the {team} want to stockpile {picks} through trades.",
    "According to sources, the {team} are prioritizing draft capital. They're specifically looking for {picks} in any potential deal.",
    "Sources say the {team} are focused on {picks}. Per league insiders, they're building for the future and want to add premium picks.",
  ],
  tagsCombo: [
    "Sources say the {team} are looking to acquire {positions} and {picks} in return.",
    "I'm hearing the {team} want to bring in {positions} along with {picks}.",
    "The {team} are hoping to land {positions} and also get {picks} back, per sources.",
    "Word is the {team} are seeking {positions} and {picks} in any deal.",
    "According to sources, the {team} are looking for {positions} help and {picks} to come back.",
    "Per league insiders, the {team} want to acquire {positions} and also land {picks}.",
    "I'm told the {team} are hoping to get {positions} in return alongside {picks}.",
    "League sources say the {team} are targeting both {positions} and {picks}. Per sources, they want immediate help plus future assets.",
  ],
  marketContext: [
    "Notably, {count} {plural} currently {verb} {asset}.",
    "Worth noting: {count} {plural} {verb} {asset}.",
  ],
  headliner: [
    "The team also has {headliners} on the block.",
    "Also available: {headliners}.",
    "The team's other notable assets include {headliners}.",
    "Among the other names on the block: {headliners}.",
    "The team is also listening on {headliners}.",
  ],
};

const VERBS_ADD = [
  'have made available',
  'have put on the block',
  'are making available',
  'are listening on',
];

const VERBS_REMOVE = [
  'are pulling back on',
  'are no longer shopping',
  'have taken off the block',
  'are keeping',
  'have decided to hold onto',
  'are reluctant to move',
  'have shut down talks on',
  'are no longer entertaining offers for',
  'have removed from availability',
  'are standing pat on',
  'have closed the door on moving',
  'are backing off talks for',
  'have pulled from trade discussions',
  'are now holding onto',
  'have decided against dealing',
  'are no longer willing to part with',
  'have ended discussions on',
  'are keeping off the market',
];

const VERBS_PICK_ADD = [
  'are making available',
  'are open to moving',
  'are willing to part with',
  'have added to the block',
  'are shopping',
  'are listening on',
  'have put in play',
  'are fielding calls on',
  'are open to dealing',
  'have signaled willingness to move',
  'are entertaining offers for',
  'are willing to discuss',
];

const VERBS_PICK_REMOVE = [
  'are pulling back on',
  'are keeping',
  'are no longer shopping',
  'have taken off the table',
  'are holding onto',
  'have shut down talks on',
  'are no longer willing to move',
  'have removed from availability',
];

const OPENERS = [
  'Breaking news:',
  'Latest intel:',
  'Just in:',
  'Hearing this morning:',
  'Developing story:',
  'Per my sources:',
  'League update:',
  'Trade block news:',
  'Sources across the league tell me:',
  'Getting word that:',
  'Multiple sources confirm:',
  'The latest from around the league:',
  'Big news:',
  'Important development:',
];

const CLOSERS = [
  'More to come as this develops.',
  'Situation remains fluid.',
  'Will monitor closely.',
  'Stay tuned for updates.',
  'Expect more movement soon.',
  'Things are heating up.',
  'Worth watching closely.',
  'Developing situation.',
  'This could get interesting.',
  'Keep an eye on this.',
  'More details to follow.',
];

const TRANSITIONS = [
  'Meanwhile,',
  'Additionally,',
  'In other news,',
  'On another front,',
  'Separately,',
  'Also worth noting:',
  'At the same time,',
  'On a related note,',
];

function formatList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

function formatPickTags(tags: string[]): string[] {
  return tags.map(tag => {
    const upper = tag.toUpperCase();
    if (upper === '1ST') return '1st round picks';
    if (upper === '2ND') return '2nd round picks';
    if (upper === '3RD') return '3rd round picks';
    return `${tag} round picks`;
  });
}

export async function getLeagueMarketContext(): Promise<LeagueMarketContext> {
  const { listAllUserDocs } = await import('@/server/db/queries');
  const allDocs = await listAllUserDocs().catch(() => []);
  
  const teamsSeekingPositions: Record<string, number> = {};
  const teamsSeekingPickRounds: Record<string, number> = {};
  
  for (const doc of allDocs) {
    if (!doc.tradeWants) continue;
    const wants = doc.tradeWants as unknown as TradeWants;
    if (!wants.positions || !Array.isArray(wants.positions)) continue;
    
    for (const pos of wants.positions) {
      const upper = pos.toUpperCase();
      if (upper === '1ST' || upper === '2ND' || upper === '3RD') {
        teamsSeekingPickRounds[upper] = (teamsSeekingPickRounds[upper] || 0) + 1;
      } else if (['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(upper)) {
        teamsSeekingPositions[upper] = (teamsSeekingPositions[upper] || 0) + 1;
      }
    }
  }
  
  return { teamsSeekingPositions, teamsSeekingPickRounds };
}

async function selectHeadliners(
  addedPlayers: TradeAsset[],
  currentPlayers: TradeAsset[],
  removedPlayers: TradeAsset[],
  players: Record<string, { first_name?: string; last_name?: string; position?: string; team?: string }>,
  ownerTeam: string,
  slotMap: PickSlotMap | null,
  playerValues: Map<string, number>,
): Promise<string[]> {
  // Build set of player IDs already mentioned in the message
  const alreadyMentioned = new Set<string>();
  for (const p of addedPlayers) {
    if (p.type === 'player') alreadyMentioned.add(p.playerId);
  }
  for (const p of removedPlayers) {
    if (p.type === 'player') alreadyMentioned.add(p.playerId);
  }
  
  // Filter to only players NOT already mentioned
  const available = currentPlayers.filter((a) => 
    a.type === 'player' && !alreadyMentioned.has(a.playerId)
  );
  
  if (available.length === 0) return [];
  
  const sorted = available.sort((a, b) => {
    if (a.type !== 'player' || b.type !== 'player') return 0;
    return a.playerId.localeCompare(b.playerId);
  });
  
  const candidates = sorted.slice(0, 2);

  const labels: string[] = [];
  for (const asset of candidates) {
    labels.push(await assetToLabel(asset, players, ownerTeam, slotMap, playerValues));
  }
  return labels;
}

export async function buildTradeBlockReport(ctx: NarrativeContext): Promise<TradeBlockReportResult | null> {
  const { teamName, diff, currentPlayers, baseUrl, updatedAt, leagueContext } = ctx;

  const hasPlayerChanges = diff.addedPlayers.length > 0 || diff.removedPlayers.length > 0;
  const hasPickChanges = diff.addedPicks.length > 0 || diff.removedPicks.length > 0;
  const hasTagChanges = diff.addedPositions.length > 0 || diff.removedPositions.length > 0 || diff.addedPickTags.length > 0 || diff.removedPickTags.length > 0;
  const hasAnyChange = hasPlayerChanges || hasPickChanges || diff.faabChanged || diff.lookingForChanged || diff.contactChanged || hasTagChanges;

  if (!hasAnyChange) {
    return null;
  }

  const [players, slotMap, playerValues] = await Promise.all([
    getAllPlayersCached().catch(() => ({} as Record<string, { first_name?: string; last_name?: string; position?: string; team?: string }>)),
    loadPickSlotMap().catch(() => null),
    getPlayerValuesBySleeperId().catch(() => new Map<string, number>()),
  ]);

  const seed = simpleHash(`${teamName}|${updatedAt}|${JSON.stringify(diff)}`);
  const rng = seededRandom(seed);
  
  const useOpener = rng() > 0.6;
  const useCloser = rng() > 0.7;
  const useTransition = hasPickChanges && hasPlayerChanges && rng() > 0.5;

  if (DEBUG) {
    console.log(`[trade-block-narrative][${teamName}] seed: ${seed}`);
    console.log(`[trade-block-narrative][${teamName}] pick slots loaded:`, Boolean(slotMap));
    console.log(`[trade-block-narrative][${teamName}] diff:`, {
      addedPlayers: diff.addedPlayers.length,
      removedPlayers: diff.removedPlayers.length,
      addedPicks: diff.addedPicks.length,
      removedPicks: diff.removedPicks.length,
      lookingForChanged: diff.lookingForChanged,
      addedPositions: diff.addedPositions,
      addedPickTags: diff.addedPickTags,
    });
  }

  const parts: string[] = [];
  const mainNews: string[] = [];
  const contextParts: string[] = [];
  
  if (useOpener) {
    parts.push(pickTemplate(OPENERS, rng));
  }

  const addedPlayerLabels = await Promise.all(diff.addedPlayers.map((a) => assetToLabel(a, players, teamName, slotMap, playerValues)));
  const removedPlayerLabels = await Promise.all(diff.removedPlayers.map((a) => assetToLabel(a, players, teamName, slotMap, playerValues)));
  const addedPickLabels = diff.addedPicks.map(a => pickToLabel(a, teamName, slotMap));
  const removedPickLabels = diff.removedPicks.map(a => pickToLabel(a, teamName, slotMap));

  // MAIN NEWS: Player changes
  if (diff.addedPlayers.length > 0 && diff.removedPlayers.length === 0) {
    const verb = pickTemplate(VERBS_ADD, rng);
    if (diff.addedPlayers.length === 1) {
      const tpl = pickTemplate(TEMPLATES.playerAddSingle, rng);
      const sentence = tpl.replace('{team}', teamName).replace('{verb}', verb).replace('{player}', addedPlayerLabels[0]);
      mainNews.push(sentence);
    } else {
      const tpl = pickTemplate(TEMPLATES.playerAddMultiple, rng);
      const playerList = formatList(addedPlayerLabels);
      const sentence = tpl.replace('{team}', teamName).replace('{verb}', verb).replace('{players}', playerList);
      mainNews.push(sentence);
    }
  } else if (diff.removedPlayers.length > 0 && diff.addedPlayers.length === 0) {
    const verb = pickTemplate(VERBS_REMOVE, rng);
    if (diff.removedPlayers.length === 1) {
      const tpl = pickTemplate(TEMPLATES.playerRemoveSingle, rng);
      const sentence = tpl.replace('{team}', teamName).replace('{verb}', verb).replace('{player}', removedPlayerLabels[0]);
      mainNews.push(sentence);
    } else {
      const tpl = pickTemplate(TEMPLATES.playerRemoveMultiple, rng);
      const playerList = formatList(removedPlayerLabels);
      const sentence = tpl.replace('{team}', teamName).replace('{verb}', verb).replace('{players}', playerList);
      mainNews.push(sentence);
    }
  } else if (diff.addedPlayers.length > 0 && diff.removedPlayers.length > 0) {
    const verbAdd = pickTemplate(VERBS_ADD, rng);
    const verbRemove = pickTemplate(VERBS_REMOVE, rng);
    const tpl = pickTemplate(TEMPLATES.mixed, rng);
    const addedList = formatList(addedPlayerLabels);
    const removedList = formatList(removedPlayerLabels);
    const sentence = tpl.replace('{team}', teamName).replace('{verbAdd}', verbAdd).replace('{added}', addedList).replace('{verbRemove}', verbRemove).replace('{removed}', removedList);
    mainNews.push(sentence);
  }

  // Pick changes (part of main news, use transition if both players and picks changed)
  if (diff.addedPicks.length > 0 && diff.removedPicks.length === 0) {
    if (useTransition && mainNews.length > 0) {
      mainNews.push(pickTemplate(TRANSITIONS, rng));
    }
    const verb = pickTemplate(VERBS_PICK_ADD, rng);
    if (diff.addedPicks.length === 1) {
      const tpl = pickTemplate(TEMPLATES.pickAddSingle, rng);
      mainNews.push(tpl.replace('{team}', teamName).replace('{verb}', verb).replace('{pick}', addedPickLabels[0]));
    } else {
      const tpl = pickTemplate(TEMPLATES.pickAddMultiple, rng);
      const pickList = formatList(addedPickLabels);
      mainNews.push(tpl.replace('{team}', teamName).replace('{verb}', verb).replace('{picks}', pickList));
    }
  } else if (diff.removedPicks.length > 0 && diff.addedPicks.length === 0) {
    if (useTransition && mainNews.length > 0) {
      mainNews.push(pickTemplate(TRANSITIONS, rng));
    }
    const verb = pickTemplate(VERBS_PICK_REMOVE, rng);
    if (diff.removedPicks.length === 1) {
      const tpl = pickTemplate(TEMPLATES.pickRemoveSingle, rng);
      mainNews.push(tpl.replace('{team}', teamName).replace('{verb}', verb).replace('{pick}', removedPickLabels[0]));
    } else {
      const tpl = pickTemplate(TEMPLATES.pickRemoveMultiple, rng);
      const pickList = formatList(removedPickLabels);
      mainNews.push(tpl.replace('{team}', teamName).replace('{verb}', verb).replace('{picks}', pickList));
    }
  }

  // CONTEXT: What they're looking for (provides motive/context)
  if (diff.lookingForChanged && diff.lookingForAfter) {
    const tpl = pickTemplate(TEMPLATES.lookingFor, rng);
    contextParts.push(tpl.replace('{team}', teamName).replace('{wants}', diff.lookingForAfter));
  }

  // Tag changes (what they want - goes with lookingFor in context section)
  if (diff.addedPositions.length > 0 || diff.addedPickTags.length > 0) {
    const hasPositions = diff.addedPositions.length > 0;
    const hasPicks = diff.addedPickTags.length > 0;
    
    if (hasPositions && hasPicks) {
      const tpl = pickTemplate(TEMPLATES.tagsCombo, rng);
      const positionList = formatList(diff.addedPositions);
      const pickList = formatList(formatPickTags(diff.addedPickTags));
      contextParts.push(tpl.replace('{team}', teamName).replace('{positions}', positionList).replace('{picks}', pickList));
    } else if (hasPositions) {
      const tpl = pickTemplate(TEMPLATES.tagsPositional, rng);
      const positionList = formatList(diff.addedPositions);
      contextParts.push(tpl.replace('{team}', teamName).replace('{positions}', positionList));
    } else if (hasPicks) {
      const tpl = pickTemplate(TEMPLATES.tagsPicks, rng);
      const pickList = formatList(formatPickTags(diff.addedPickTags));
      contextParts.push(tpl.replace('{team}', teamName).replace('{picks}', pickList));
    }
  }

  // SUPPORTING DETAILS: Headliners (if context exists) and market intel
  // Only add headliners if we have lookingFor or tags (provides context for what's available)
  if (contextParts.length > 0 && currentPlayers.length > 0) {
    const headliners = await selectHeadliners(diff.addedPlayers, currentPlayers, diff.removedPlayers, players, teamName, slotMap, playerValues);
    if (headliners.length > 0) {
      const headlinerList = formatList(headliners);
      const verb = headliners.length === 1 ? 'is' : 'are';
      const plural = headliners.length === 1 ? '' : 's';
      const tpl = pickTemplate(TEMPLATES.headliner, rng);
      contextParts.push(tpl.replace('{headliners}', headlinerList).replace('{verb}', verb).replace('{plural}', plural));
    }
  }
  
  // Market context (only if we have adds)
  if (leagueContext && (diff.addedPlayers.length > 0 || diff.addedPicks.length > 0) && rng() > 0.4) {
    const marketInsights: string[] = [];
    
    // Check if team is adding players that others want
    if (diff.addedPlayers.length > 0) {
      for (const player of diff.addedPlayers) {
        if (player.type !== 'player') continue;
        const playerData = players[player.playerId];
        if (playerData?.position) {
          const pos = playerData.position.toUpperCase();
          const seekers = leagueContext.teamsSeekingPositions[pos] || 0;
          if (seekers >= 2) {
            const tpl = pickTemplate(TEMPLATES.marketContext, rng);
            const plural = seekers === 1 ? 'team' : 'teams';
            const verb = seekers === 1 ? 'is seeking' : 'are seeking';
            const insight = tpl
              .replace('{count}', String(seekers))
              .replace('{plural}', plural)
              .replace('{verb}', verb)
              .replace('{asset}', pos);
            marketInsights.push(insight);
            break;
          }
        }
      }
    }
    
    // Check if team is adding picks that others want
    if (diff.addedPicks.length > 0 && marketInsights.length === 0) {
      for (const pick of diff.addedPicks) {
        if (pick.type !== 'pick') continue;
        const roundLabel = pick.round === 1 ? '1st' : pick.round === 2 ? '2nd' : pick.round === 3 ? '3rd' : `${pick.round}th`;
        const roundUpper = roundLabel.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const seekers = leagueContext.teamsSeekingPickRounds[roundUpper] || 0;
        if (seekers >= 2) {
          const tpl = pickTemplate(TEMPLATES.marketContext, rng);
          const plural = seekers === 1 ? 'team' : 'teams';
          const verb = seekers === 1 ? 'is seeking' : 'are seeking';
          const insight = tpl
            .replace('{count}', String(seekers))
            .replace('{plural}', plural)
            .replace('{verb}', verb)
            .replace('{asset}', `${roundLabel} round picks`);
          marketInsights.push(insight);
          break;
        }
      }
    }
    
    if (marketInsights.length > 0) {
      contextParts.push(marketInsights[0]);
    }
  }

  // FAAB changes
  if (diff.faabChanged) {
    if (diff.faabAfter != null && diff.faabBefore == null) {
      const tpl = pickTemplate(FAAB_TEMPLATES.add, rng);
      contextParts.push(tpl.replace('{team}', teamName).replace('{amount}', String(diff.faabAfter)));
    } else if (diff.faabAfter == null && diff.faabBefore != null) {
      contextParts.push(pickTemplate(FAAB_TEMPLATES.remove, rng).replace('{team}', teamName));
    } else if (diff.faabAfter != null) {
      contextParts.push(
        pickTemplate(FAAB_TEMPLATES.update, rng)
          .replace('{team}', teamName)
          .replace('{amount}', String(diff.faabAfter)),
      );
    }
  }

  // Contact preference changes (method only — never post phone/snap in Discord)
  if (diff.contactChanged && diff.contactAfter) {
    const method = contactMethodLabel(diff.contactAfter) ?? diff.contactAfter;
    contextParts.push(
      pickTemplate(CONTACT_TEMPLATES, rng).replace('{team}', teamName).replace('{method}', method),
    );
  }
  
  // ASSEMBLE: Main news → Context → Closer
  parts.push(...mainNews);
  parts.push(...contextParts);

  const hasSubstantiveContent =
    hasPlayerChanges ||
    hasPickChanges ||
    hasTagChanges ||
    diff.faabChanged ||
    diff.contactChanged ||
    (diff.lookingForChanged && (diff.lookingForAfter || diff.lookingForBefore));
  
  if (!hasSubstantiveContent || (mainNews.length === 0 && contextParts.length === 0)) {
    if (DEBUG) {
      console.log(`[trade-block-narrative][${teamName}] No substantive content, skipping message`);
    }
    return null;
  }
  
  if (useCloser && rng() > 0.5) {
    parts.push(pickTemplate(CLOSERS, rng));
  }

  const added = [...addedPlayerLabels, ...addedPickLabels];
  if (diff.faabChanged && diff.faabAfter != null && !added.some((l) => l.includes('FAAB'))) {
    added.push(`$${diff.faabAfter} FAAB`);
  }

  const removed = [...removedPlayerLabels, ...removedPickLabels];

  const wantsTagsAdded = [
    ...diff.addedPositions,
    ...formatPickTags(diff.addedPickTags),
  ];

  let faabLabel: string | undefined;
  if (diff.faabChanged) {
    if (diff.faabAfter != null) faabLabel = `$${diff.faabAfter} available`;
    else if (diff.faabBefore != null) faabLabel = 'No longer available';
  } else if (diff.faabAfter != null) {
    faabLabel = `$${diff.faabAfter} on block`;
  }

  const contactLabel =
    diff.contactAfter != null
      ? contactMethodLabel(diff.contactAfter)
      : diff.contactChanged
        ? 'Not specified'
        : undefined;

  const hashtag = TEAM_HASHTAGS[teamName] || undefined;
  const narrative = buildNarrativeOnly(parts);

  const result: TradeBlockReportResult = {
    teamName,
    title: resolveEmbedTitle(diff),
    narrative,
    added,
    removed,
    wantsBefore: diff.lookingForChanged ? diff.lookingForBefore : undefined,
    wantsAfter: diff.lookingForChanged ? diff.lookingForAfter : undefined,
    wantsTagsAdded: wantsTagsAdded.length > 0 ? wantsTagsAdded : undefined,
    faabLabel,
    contactLabel: diff.contactChanged || diff.contactAfter ? contactLabel : undefined,
    hashtag,
    updatedAt,
  };

  if (DEBUG) {
    console.log(`[trade-block-narrative][${teamName}] report:`, result);
  }

  return result;
}

export function getTradeBlockBaseUrl(): string | null {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (siteUrl) return siteUrl.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'https://eastvswest.win';
}
