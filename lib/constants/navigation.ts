export type UserNavItem = {
  id: string;
  label: string;
  href?: string;
  /** Short helper shown under the link in dropdown menus */
  description?: string;
  /** Section heading inside a parent dropdown (e.g. "Playoffs") */
  group?: string;
  children?: UserNavItem[];
};

export const HISTORY_TAB_IDS = [
  'champions',
  'brackets',
  'leaderboards',
  'weekly-highs',
  'franchises',
  'records',
] as const;

export const DRAFT_VIEW_IDS = ['next', '2028', 'past', 'team-prospect-draftboard'] as const;
export const DRAFT_NEXT_TAB_IDS = ['airbnb', 'travel', 'order'] as const;

export const USER_NAV_CONFIG: UserNavItem[] = [
  { id: 'home', label: 'Home', href: '/' },
  {
    id: 'league',
    label: 'League',
    children: [
      { id: 'league.teams', label: 'Teams', href: '/teams' },
      { id: 'league.rosters', label: 'Rosters', href: '/rosters', description: 'Every team roster in one view' },
      { id: 'league.standings', label: 'Standings', href: '/standings' },
      { id: 'league.rules', label: 'Rules', href: '/rules' },
      { id: 'league.rivalries', label: 'Rivalries', href: '/rivalries', description: 'Rivalry pairings & selection' },
      { id: 'league.votes', label: 'Votes', href: '/votes', description: 'League polls and official votes' },
    ],
  },
  {
    id: 'history',
    label: 'History',
    children: [
      { id: 'history.champions', label: 'Champions', href: '/history?tab=champions', group: 'Playoffs' },
      { id: 'history.brackets', label: 'Brackets', href: '/history?tab=brackets', group: 'Playoffs' },
      { id: 'history.leaderboards', label: 'Leaderboards', href: '/history?tab=leaderboards', group: 'Stats & Records' },
      { id: 'history.weekly-highs', label: 'Weekly Highs', href: '/history?tab=weekly-highs', group: 'Stats & Records' },
      { id: 'history.franchises', label: 'Franchises', href: '/history?tab=franchises', group: 'Stats & Records' },
      { id: 'history.records', label: 'Records', href: '/history?tab=records', group: 'Stats & Records' },
    ],
  },
  {
    id: 'draft',
    label: 'Draft',
    children: [
      {
        id: 'draft.live-room',
        label: 'Draft Room',
        href: '/draft/room',
        description: 'Live clock, picks, and queue',
        group: 'Live',
      },
      {
        id: 'draft.next',
        label: 'Next Draft Hub',
        href: '/draft?view=next',
        description: 'Travel, lodging, and draft order',
        group: '2027 Draft',
        children: [
          { id: 'draft.next.airbnb', label: 'Airbnb Info', href: '/draft?view=next&next=airbnb' },
          { id: 'draft.next.travel', label: 'Flights & Arrivals', href: '/draft?view=next&next=travel' },
          { id: 'draft.next.order', label: 'Draft Order', href: '/draft?view=next&next=order' },
        ],
      },
      { id: 'draft.2028', label: '2028 Draft', href: '/draft?view=2028', group: 'Other Drafts' },
      { id: 'draft.past', label: 'Previous Drafts', href: '/draft?view=past', group: 'Other Drafts' },
      {
        id: 'draft.team-prospect-draftboard',
        label: 'Prospect Draftboards',
        href: '/draft?view=team-prospect-draftboard',
        group: 'Other Drafts',
      },
    ],
  },
  {
    id: 'transactions',
    label: 'Transactions',
    children: [
      {
        id: 'transactions.free-agency',
        label: 'Free Agency & Waivers',
        href: '/transactions',
        group: 'Roster Moves',
      },
      { id: 'transactions.trades', label: 'Trade History', href: '/trades', group: 'Trades' },
      { id: 'transactions.trade-block', label: 'Trade Block', href: '/trades/block', group: 'Trades' },
      {
        id: 'transactions.trade-analyzer',
        label: 'Trade Analyzer',
        href: '/trades/analyzer',
        description: 'Compare and build trades',
        group: 'Trades',
      },
    ],
  },
  {
    id: 'media',
    label: 'Media',
    children: [
      { id: 'media.podcast', label: 'Podcast', href: '/podcast' },
      { id: 'media.newsletter', label: 'Newsletter', href: '/newsletter' },
    ],
  },
  { id: 'suggestions', label: 'Suggestions', href: '/suggestions' },
];
