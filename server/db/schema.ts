import { pgTable, uuid, varchar, text, timestamp, jsonb, pgEnum, index, integer, primaryKey, boolean, uniqueIndex } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('user_role', ['admin', 'user']);
export const suggestionStatusEnum = pgEnum('suggestion_status', ['draft', 'open', 'accepted', 'rejected']);
export const taxiEventEnum = pgEnum('taxi_event', ['add', 'remove', 'promote', 'demote']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }),
  role: roleEnum('role').default('user').notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
}, (t) => ({
  emailIdx: index('users_email_idx').on(t.email),
}));

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  abbrev: varchar('abbrev', { length: 32 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  position: varchar('position', { length: 16 }).notNull(),
  nflTeam: varchar('nfl_team', { length: 16 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  posIdx: index('players_pos_idx').on(t.position),
  nflIdx: index('players_nfl_idx').on(t.nflTeam),
}));

export const suggestions = pgTable('suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  text: text('text').notNull(),
  category: varchar('category', { length: 64 }),
  status: suggestionStatusEnum('status').default('open').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
}, (t) => ({
  userIdx: index('suggestions_user_idx').on(t.userId),
  statusCreatedIdx: index('suggestions_status_created_idx').on(t.status, t.createdAt),
}));

export const taxiSquadMembers = pgTable('taxi_squad_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull(),
  playerId: uuid('player_id').notNull(),
  activeFrom: timestamp('active_from').defaultNow().notNull(),
  activeTo: timestamp('active_to'),
}, (t) => ({
  teamIdx: index('taxi_members_team_idx').on(t.teamId),
  playerIdx: index('taxi_members_player_idx').on(t.playerId),
  activeToIdx: index('taxi_members_active_to_idx').on(t.activeTo),
}));

export const taxiSquadEvents = pgTable('taxi_squad_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull(),
  playerId: uuid('player_id').notNull(),
  eventType: taxiEventEnum('event_type').notNull(),
  eventAt: timestamp('event_at').defaultNow().notNull(),
  meta: jsonb('meta').$type<Record<string, unknown> | null>().default(null),
}, (t) => ({
  teamEventIdx: index('taxi_events_team_at_idx').on(t.teamId, t.eventAt),
  playerEventIdx: index('taxi_events_player_at_idx').on(t.playerId, t.eventAt),
}));

export const mediaFiles = pgTable('media_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerType: varchar('owner_type', { length: 64 }).notNull(),
  ownerId: uuid('owner_id'),
  fileKey: text('file_key').notNull(),
  contentType: varchar('content_type', { length: 128 }),
  url: text('url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const teamPins = pgTable('team_pins', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamSlug: varchar('team_slug', { length: 128 }).notNull().unique(),
  hash: text('hash').notNull(),
  salt: text('salt').notNull(),
  pinVersion: integer('pin_version').default(1).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  slugIdx: index('team_pins_slug_idx').on(t.teamSlug),
}));

export const taxiObservations = pgTable('taxi_observations', {
  team: varchar('team', { length: 255 }).primaryKey(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  players: jsonb('players').$type<Record<string, { firstSeen: string; lastSeen: string; seenCount: number }>>().notNull(),
});

export const userDocs = pgTable('user_docs', {
  userId: varchar('user_id', { length: 64 }).primaryKey(),
  team: varchar('team', { length: 255 }).notNull(),
  version: integer('version').default(0).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  votes: jsonb('votes').$type<Record<string, Record<string, number>> | null>().default(null),
  tradeBlock: jsonb('trade_block').$type<Array<Record<string, unknown>> | null>().default(null),
  tradeWants: jsonb('trade_wants').$type<{ text?: string; positions?: string[] } | null>().default(null),
}, (t) => ({
  userTeamIdx: index('user_docs_team_idx').on(t.team),
}));

export const tradeBlockEvents = pgTable('trade_block_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  team: varchar('team', { length: 255 }).notNull(),
  eventType: varchar('event_type', { length: 32 }).notNull(), // 'added' | 'removed' | 'wants_changed'
  assetType: varchar('asset_type', { length: 32 }), // 'player' | 'pick' | 'faab' | null for wants_changed
  assetId: varchar('asset_id', { length: 255 }), // playerId, 'YEAR-ROUND-ORIGIN', 'faab', or null
  assetLabel: text('asset_label'), // human-readable label
  oldWants: text('old_wants'), // for wants_changed events
  newWants: text('new_wants'), // for wants_changed events
  createdAt: timestamp('created_at').defaultNow().notNull(),
  sentAt: timestamp('sent_at'), // null until posted to Discord
}, (t) => ({
  teamCreatedIdx: index('trade_block_events_team_created_idx').on(t.team, t.createdAt),
  sentAtIdx: index('trade_block_events_sent_at_idx').on(t.sentAt),
}));

// R2 storage config
export const storageModeEnum = pgEnum('storage_mode', ['path', 'vhost']);

export const storageConfig = pgTable('storage_config', {
  id: varchar('id', { length: 16 }).primaryKey(),
  chosenMode: storageModeEnum('chosen_mode'),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  notes: text('notes'),
});

// Taxi Auditor DB (validator)
export const acqViaEnum = pgEnum('acq_via', ['free_agent', 'waiver', 'trade', 'draft', 'other']);
export const runTypeEnum = pgEnum('taxi_run_type', ['wed_warn', 'thu_warn', 'sun_am_warn', 'sun_pm_official', 'admin_rerun']);

export const tenures = pgTable('tenures', {
  teamId: varchar('team_id', { length: 255 }).notNull(),
  playerId: varchar('player_id', { length: 64 }).notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull(),
  acquiredVia: acqViaEnum('acquired_via').notNull(),
  activeSeen: integer('active_seen').default(0).notNull(), // 0=false, 1=true (boolean workaround for drizzle/neon subtlety)
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
}, (t) => ({
  pk: primaryKey({ columns: [t.teamId, t.playerId] }),
}));

export const txnCache = pgTable('txn_cache', {
  week: integer('week').notNull(),
  teamId: varchar('team_id', { length: 255 }).notNull(),
  playerId: varchar('player_id', { length: 64 }).notNull(),
  type: varchar('type', { length: 32 }).notNull(), // add | drop | trade | draft | waiver | free_agent
  direction: varchar('direction', { length: 8 }).notNull(), // in | out
  ts: timestamp('ts', { withTimezone: true }).notNull(),
}, (t) => ({
  wkTeamIdx: index('txn_cache_week_team_idx').on(t.week, t.teamId),
}));

export const taxiSnapshots = pgTable('taxi_snapshots', {
  season: integer('season').notNull(),
  week: integer('week').notNull(),
  runType: runTypeEnum('run_type').notNull(),
  runTs: timestamp('run_ts', { withTimezone: true }).notNull(),
  teamId: varchar('team_id', { length: 255 }).notNull(),
  taxiIds: text('taxi_ids').array().notNull(),
  compliant: integer('compliant').default(1).notNull(), // 1=true, 0=false
  violations: jsonb('violations').$type<Array<{ code: string; detail?: string; players?: string[] }>>().notNull(),
  degraded: integer('degraded').default(0).notNull(),
}, (t) => ({
  pkSnapshot: primaryKey({ columns: [t.season, t.week, t.runType, t.teamId] }),
  teamIdx: index('taxi_snapshots_team_idx').on(t.teamId),
}));

// ============ Newsletter Bot Memory ============

export const botNameEnum = pgEnum('bot_name', ['entertainer', 'analyst']);
export const summaryMoodEnum = pgEnum('summary_mood', ['Focused', 'Fired Up', 'Deflated', 'Chaotic', 'Vindicated']);
export const teamMoodEnum = pgEnum('team_mood', ['Neutral', 'Confident', 'Suspicious', 'Irritated']);

// Bot memory - stores overall bot state and per-team sentiment
// Now includes enhanced memory fields for personality evolution
export const botMemory = pgTable('bot_memory', {
  id: uuid('id').primaryKey().defaultRandom(),
  bot: botNameEnum('bot').notNull(),
  season: integer('season').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  summaryMood: summaryMoodEnum('summary_mood').default('Focused').notNull(),
  // Per-team memory stored as JSONB: { "Team Name": { trust: number, frustration: number, mood: string, ... } }
  teams: jsonb('teams').$type<Record<string, { trust: number; frustration: number; mood: string }>>().default({}).notNull(),
  // Enhanced memory fields stored as JSONB for personality evolution
  // Includes: personality traits, emotional state, speech patterns, partner dynamics, predictions, hot takes, narratives
  enhancedData: jsonb('enhanced_data').$type<Record<string, unknown>>().default({}).notNull(),
  // Editorial corrections from published newsletter diffs — appended on publish, read at generation time
  editorialCorrections: jsonb('editorial_corrections').$type<Array<Record<string, unknown>>>().default([]),
}, (t) => ({
  botSeasonIdx: index('bot_memory_bot_season_idx').on(t.bot, t.season),
}));

// Forecast records - tracks prediction accuracy over the season
export const forecastRecords = pgTable('forecast_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  season: integer('season').notNull(),
  bot: botNameEnum('bot').notNull(),
  wins: integer('wins').default(0).notNull(),
  losses: integer('losses').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  seasonBotIdx: index('forecast_records_season_bot_idx').on(t.season, t.bot),
}));

// Pending picks - stores predictions to grade next week
export const pendingPicks = pgTable('pending_picks', {
  id: uuid('id').primaryKey().defaultRandom(),
  season: integer('season').notNull(),
  week: integer('week').notNull(), // The week these picks are FOR (next week)
  matchupId: varchar('matchup_id', { length: 64 }).notNull(),
  team1: varchar('team1', { length: 255 }),
  team2: varchar('team2', { length: 255 }),
  entertainerPick: varchar('entertainer_pick', { length: 255 }),
  analystPick: varchar('analyst_pick', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  seasonWeekIdx: index('pending_picks_season_week_idx').on(t.season, t.week),
}));

// ============ League Votes ============

export const polls = pgTable('polls', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 50 }).default('draft').notNull(), // draft | open | closed
  eligibilityType: varchar('eligibility_type', { length: 50 }).default('team').notNull(), // team | person
  linkedSuggestionIds: text('linked_suggestion_ids').array(),
  anonymous: boolean('anonymous').default(false).notNull(),
  resultVisibility: varchar('result_visibility', { length: 50 }).default('admin_publish').notNull(), // immediate | all_voted | admin_publish
  deadline: timestamp('deadline'),
  discordNotifiedOpen: boolean('discord_notified_open').default(false).notNull(),
  discordNotifiedReminder: boolean('discord_notified_reminder').default(false).notNull(),
  discordNotifiedClosed: boolean('discord_notified_closed').default(false).notNull(),
  confirmationMessage: text('confirmation_message'),
  responseLimit: integer('response_limit'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  closedAt: timestamp('closed_at'),
}, (t) => ({
  statusIdx: index('polls_status_idx').on(t.status),
}));

export const pollRounds = pgTable('poll_rounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  pollId: uuid('poll_id').notNull().references(() => polls.id, { onDelete: 'cascade' }),
  roundNumber: integer('round_number').notNull(),
  status: varchar('status', { length: 50 }).default('pending').notNull(), // pending | open | closed
  voteType: varchar('vote_type', { length: 50 }).notNull(), // borda | irv | select_one | select_multi | eliminate | yes_no
  survivorCount: integer('survivor_count'), // how many options advance to next round; null = final round
  thresholdType: varchar('threshold_type', { length: 50 }).default('plurality').notNull(), // plurality | majority | supermajority | admin_defined
  thresholdValue: integer('threshold_value'), // for admin_defined or person-vote majority override
  shuffleOptions: boolean('shuffle_options').default(false).notNull(),
  resultsPublishedAt: timestamp('results_published_at'),
  openedAt: timestamp('opened_at'),
  closedAt: timestamp('closed_at'),
}, (t) => ({
  pollRoundIdx: index('poll_rounds_poll_idx').on(t.pollId, t.roundNumber),
}));

export const pollOptions = pgTable('poll_options', {
  id: uuid('id').primaryKey().defaultRandom(),
  roundId: uuid('round_id').notNull().references(() => pollRounds.id, { onDelete: 'cascade' }),
  text: varchar('text', { length: 1000 }).notNull(),
  linkedSuggestionId: varchar('linked_suggestion_id', { length: 255 }),
  carriedFromOptionId: uuid('carried_from_option_id'), // tracks lineage across rounds
  displayOrder: integer('display_order').default(0).notNull(),
}, (t) => ({
  roundIdx: index('poll_options_round_idx').on(t.roundId),
}));

export const pollVotes = pgTable('poll_votes', {
  id: uuid('id').primaryKey().defaultRandom(),
  roundId: uuid('round_id').notNull().references(() => pollRounds.id, { onDelete: 'cascade' }),
  voterId: varchar('voter_id', { length: 255 }).notNull(), // team name (team vote) or userId (person vote)
  voterDisplay: varchar('voter_display', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  uniqueVote: uniqueIndex('poll_votes_round_voter_unique').on(t.roundId, t.voterId),
  roundIdx: index('poll_votes_round_idx').on(t.roundId),
}));

export const pollVoteSelections = pgTable('poll_vote_selections', {
  id: uuid('id').primaryKey().defaultRandom(),
  voteId: uuid('vote_id').notNull().references(() => pollVotes.id, { onDelete: 'cascade' }),
  optionId: uuid('option_id').notNull().references(() => pollOptions.id, { onDelete: 'cascade' }),
  rank: integer('rank'), // borda/irv: 1 = top choice
  selected: boolean('selected').default(false), // select_one/multi/eliminate/yes_no
}, (t) => ({
  voteIdx: index('poll_vote_selections_vote_idx').on(t.voteId),
}));

// Form questions attached to a poll (alongside or instead of voting rounds)
export const pollQuestions = pgTable('poll_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  pollId: uuid('poll_id').notNull().references(() => polls.id, { onDelete: 'cascade' }),
  questionType: varchar('question_type', { length: 50 }).notNull(), // short_answer | paragraph | rating | multiple_choice | checkboxes | section_break
  text: varchar('text', { length: 1000 }).notNull(),
  description: text('description'),
  required: boolean('required').default(true).notNull(),
  shuffleOptions: boolean('shuffle_options').default(false).notNull(),
  displayOrder: integer('display_order').default(0).notNull(),
  ratingMin: integer('rating_min').default(1),
  ratingMax: integer('rating_max').default(10),
  ratingMinLabel: varchar('rating_min_label', { length: 100 }),
  ratingMaxLabel: varchar('rating_max_label', { length: 100 }),
  maxLength: integer('max_length'),
  conditionQuestionId: uuid('condition_question_id'),
  conditionOptionId: uuid('condition_option_id'),
  conditionValue: varchar('condition_value', { length: 255 }),
}, (t) => ({
  pollQuestionsIdx: index('poll_questions_poll_idx').on(t.pollId),
}));

export const pollQuestionOptions = pgTable('poll_question_options', {
  id: uuid('id').primaryKey().defaultRandom(),
  questionId: uuid('question_id').notNull().references(() => pollQuestions.id, { onDelete: 'cascade' }),
  text: varchar('text', { length: 500 }).notNull(),
  displayOrder: integer('display_order').default(0).notNull(),
}, (t) => ({
  pollQuestionOptionsIdx: index('poll_question_options_q_idx').on(t.questionId),
}));

export const pollResponses = pgTable('poll_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  pollId: uuid('poll_id').notNull().references(() => polls.id, { onDelete: 'cascade' }),
  voterId: varchar('voter_id', { length: 255 }).notNull(),
  voterDisplay: varchar('voter_display', { length: 255 }),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
}, (t) => ({
  pollResponsesUq: uniqueIndex('poll_responses_poll_voter_uq').on(t.pollId, t.voterId),
  pollResponsesIdx: index('poll_responses_poll_idx').on(t.pollId),
}));

export const pollResponseAnswers = pgTable('poll_response_answers', {
  id: uuid('id').primaryKey().defaultRandom(),
  responseId: uuid('response_id').notNull().references(() => pollResponses.id, { onDelete: 'cascade' }),
  questionId: uuid('question_id').notNull().references(() => pollQuestions.id, { onDelete: 'cascade' }),
  textAnswer: text('text_answer'),
  ratingValue: integer('rating_value'),
  optionIds: text('option_ids').array(),
}, (t) => ({
  pollResponseAnswersUq: uniqueIndex('poll_response_answers_uq').on(t.responseId, t.questionId),
  pollResponseAnswersIdx: index('poll_response_answers_resp_idx').on(t.responseId),
}));

// Staged newsletter generation - tracks progress of Tuesday→Wednesday builds
export const newsletterStatusEnum = pgEnum('newsletter_status', ['pending', 'in_progress', 'completed', 'failed', 'published']);

export const newsletterStaged = pgTable('newsletter_staged', {
  id: uuid('id').primaryKey().defaultRandom(),
  season: integer('season').notNull(),
  week: integer('week').notNull(),
  status: newsletterStatusEnum('status').default('pending').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  sectionsCompleted: text('sections_completed').array().default([]).notNull(),
  currentSection: varchar('current_section', { length: 64 }),
  error: text('error'),
  // Generated content per section: { "Intro": { entertainer: "...", analyst: "..." }, ... }
  generatedContent: jsonb('generated_content').$type<Record<string, { entertainer: string; analyst: string }>>().default({}).notNull(),
  // Derived data snapshot (so we don't re-fetch)
  derivedData: jsonb('derived_data').$type<Record<string, unknown>>(),
}, (t) => ({
  seasonWeekIdx: index('newsletter_staged_season_week_idx').on(t.season, t.week),
}));

// Generated newsletters - stores the full newsletter content
export const newsletters = pgTable('newsletters', {
  id: uuid('id').primaryKey().defaultRandom(),
  season: integer('season').notNull(),
  week: integer('week').notNull(),
  leagueName: varchar('league_name', { length: 255 }).notNull(),
  // Human-readable title so admins can tell saved newsletters apart in the catalog.
  // Auto-generated on save (season/week/type/date) and renameable from the admin UI.
  title: varchar('title', { length: 200 }),
  // Full newsletter JSON structure
  content: jsonb('content').$type<{
    meta: { leagueName: string; week: number; date: string; season: number };
    sections: Array<{ type: string; data: unknown }>;
  }>().notNull(),
  // Pre-rendered HTML for fast display
  html: text('html').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  // Publish gate: 'draft' rows are NOT publicly visible and never trigger Discord.
  // Autogenerated newsletters are saved as 'draft'; an explicit admin publish flips
  // this to 'published'. Default is 'published' only so legacy/back-filled rows stay
  // visible — generation code always passes status:'draft' explicitly.
  status: varchar('status', { length: 16 }).default('published').notNull(),
  // When the newsletter was made public via an explicit publish action.
  publishedAt: timestamp('published_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  // Episode type (regular, pre_draft, post_draft, preseason, ...) for admin/queue display.
  episodeType: varchar('episode_type', { length: 64 }),
  // Track if newsletter was posted to Discord
  discordPostedAt: timestamp('discord_posted_at', { withTimezone: true }),
}, (t) => ({
  seasonWeekIdx: index('newsletters_season_week_idx').on(t.season, t.week),
  statusIdx: index('newsletters_status_idx').on(t.status),
}));

// Editorial calendar / generation queue — plans newsletter episodes by type and
// scheduled generation time. At the scheduled time the runner generates the
// newsletter and saves it as a DRAFT (never autopublishes, never posts Discord).
export const newsletterQueueStatusEnum = pgEnum('newsletter_queue_status', [
  'queued', 'generating', 'generated', 'skipped', 'failed', 'published', 'archived',
]);

export const newsletterQueue = pgTable('newsletter_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  season: integer('season').notNull(),
  // Nullable: offseason episodes (pre_draft, etc.) have no real week number.
  week: integer('week'),
  episodeType: varchar('episode_type', { length: 64 }).notNull(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  status: newsletterQueueStatusEnum('status').default('queued').notNull(),
  note: text('note'),
  // Set when the queued item has been generated into a draft.
  generatedAt: timestamp('generated_at', { withTimezone: true }),
  error: text('error'),
  // Number of generation attempts. Drives bounded auto-retry of failed items.
  attempts: integer('attempts').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  statusScheduledIdx: index('newsletter_queue_status_scheduled_idx').on(t.status, t.scheduledFor),
}));

// Single-row heartbeat written by the scheduled queue runner (GitHub Actions) on
// every pass. Lets the admin UI show whether the runner is alive — a stale
// heartbeat means queued items will sit unprocessed (disabled workflow schedule,
// missing secrets, or a DATABASE_URL pointing at a different DB).
export const newsletterRunnerStatus = pgTable('newsletter_runner_status', {
  id: varchar('id', { length: 16 }).primaryKey(), // always 'runner'
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  // Compact summary of the last pass, e.g. "processed 2 due item(s)".
  lastResult: text('last_result'),
});

// ============ Observability: generation runs, snapshots, MCP call log ============

// One row per newsletter generation run (staged or sync). Durable record of what
// happened so failures can be diagnosed after Vercel logs expire.
export const generationRuns = pgTable('generation_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Caller-supplied run id (matches the runId used in console logs), unique per run
  runId: varchar('run_id', { length: 64 }).notNull().unique(),
  season: integer('season').notNull(),
  week: integer('week').notNull(),
  episodeType: varchar('episode_type', { length: 64 }).notNull(),
  runType: varchar('run_type', { length: 32 }).default('staged').notNull(), // 'staged' | 'sync' | 'retry'
  status: varchar('status', { length: 32 }).default('running').notNull(), // 'running' | 'completed' | 'failed' | 'blocked'
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  errorSummary: text('error_summary'),
  // The assembled context/source packet the models saw, frozen at job start.
  // Includes enhanced context string, derived data summary, memory snapshots, freshness info.
  contextPacket: jsonb('context_packet'),
  // Final validation result, coverage report, repetition warnings
  validation: jsonb('validation'),
  // Post-generation fact-audit result: extracted claims with risk classification
  factAudit: jsonb('fact_audit'),
  warnings: jsonb('warnings').$type<string[]>().default([]),
  totalSteps: integer('total_steps'),
  completedSteps: integer('completed_steps'),
  failedSteps: jsonb('failed_steps').$type<string[]>().default([]),
}, (t) => ({
  runsSeasonWeekIdx: index('generation_runs_season_week_idx').on(t.season, t.week),
  runsStartedIdx: index('generation_runs_started_idx').on(t.startedAt),
}));

// One row per section generated within a run. Records which provider/model/tier
// wrote it, how long it took, token usage, and any warnings.
export const generationRunSections = pgTable('generation_run_sections', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: varchar('run_id', { length: 64 }).notNull(),
  sectionName: varchar('section_name', { length: 128 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(), // 'ok' | 'failed' | 'retried'
  provider: varchar('provider', { length: 64 }),
  model: varchar('model', { length: 128 }),
  tier: integer('tier'),
  isFallback: boolean('is_fallback').default(false).notNull(),
  durationMs: integer('duration_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  retries: integer('retries').default(0).notNull(),
  warnings: jsonb('warnings').$type<string[]>().default([]),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  runSectionsRunIdx: index('generation_run_sections_run_idx').on(t.runId),
}));

// Full content snapshots taken before each finalize/restore so any version can be recovered.
export const newsletterSnapshots = pgTable('newsletter_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  season: integer('season').notNull(),
  week: integer('week').notNull(),
  runId: varchar('run_id', { length: 64 }),
  actionType: varchar('action_type', { length: 32 }).notNull(), // 'finalize' | 'pre_restore' | 'manual'
  note: text('note'),
  content: jsonb('content').notNull(),
  html: text('html'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  snapshotsSeasonWeekIdx: index('newsletter_snapshots_season_week_idx').on(t.season, t.week, t.createdAt),
}));

// MCP/bot tool call log — what the bot was asked and what came back (sanitized).
export const mcpCallLog = pgTable('mcp_call_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tool: varchar('tool', { length: 128 }).notNull(),
  // Sanitized/truncated args — never auth headers or secrets
  args: jsonb('args'),
  status: varchar('status', { length: 16 }).notNull(), // 'ok' | 'error'
  durationMs: integer('duration_ms'),
  responseBytes: integer('response_bytes'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  mcpLogCreatedIdx: index('mcp_call_log_created_idx').on(t.createdAt),
  mcpLogToolIdx: index('mcp_call_log_tool_idx').on(t.tool),
}));

// Relationship memory — cross-bot shared state: debate pushbacks, themes, prediction lead
export const relationshipMemory = pgTable('relationship_memory', {
  id: uuid('id').primaryKey().defaultRandom(),
  season: integer('season').notNull().unique(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  // Prediction W-L records for each bot
  predictionRecords: jsonb('prediction_records')
    .$type<{ entertainer: { w: number; l: number }; analyst: { w: number; l: number } }>()
    .default({ entertainer: { w: 0, l: 0 }, analyst: { w: 0, l: 0 } })
    .notNull(),
  // Full pushback log
  pushbacks: jsonb('pushbacks')
    .$type<Array<{
      week: number; matchup_id: string; winner_name: string;
      entertainer_stance: string; analyst_stance: string;
      outcome: string; recorded_at: string;
    }>>()
    .default([])
    .notNull(),
  // Inferred recurring themes
  themes: jsonb('themes')
    .$type<{ entertainer_tendencies: string[]; analyst_tendencies: string[]; persistent_disagreements: string[] }>()
    .default({ entertainer_tendencies: [], analyst_tendencies: [], persistent_disagreements: [] })
    .notNull(),
  // Dynamic state
  dynamic: jsonb('dynamic')
    .$type<{ entertainer_lead_in_predictions: number; total_pushbacks: number; last_pushback_week: number | null; agreements_this_season: number }>()
    .default({ entertainer_lead_in_predictions: 0, total_pushbacks: 0, last_pushback_week: null, agreements_this_season: 0 })
    .notNull(),
});

// ============ Phase 3: Admin Personality Settings ============

/**
 * Admin-editable bot personality overrides.
 * Hardcoded defaults in bot-brain.ts remain active when no DB row exists,
 * or when a field is null/absent — always merge, never replace entirely.
 */
export const botSettings = pgTable('bot_settings', {
  bot: botNameEnum('bot').primaryKey(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  displayName: varchar('display_name', { length: 255 }),
  roleDescription: text('role_description'),
  // Voice slider overrides (0-10 each); null fields inherit hardcoded default
  voiceConfig: jsonb('voice_config').$type<{
    sarcasm?: number;
    excitability?: number;
    depth?: number;
    snark?: number;
  } | null>().default(null),
  // Additive phrase lists — merged with hardcoded phrases, not replacing them
  signaturePhrases: jsonb('signature_phrases').$type<{
    openers?: string[];
    closers?: string[];
    verbalTics?: string[];
  } | null>().default(null),
  // Banned phrases fed into guardrails.checkOutput() at runtime
  bannedPhrases: jsonb('banned_phrases').$type<string[] | null>().default(null),
  // Additional safety boundary lines (appended to hardcoded ones)
  safetyBoundaries: jsonb('safety_boundaries').$type<string[] | null>().default(null),
  // Per-phase preferred stance overrides (episodeType → stance label)
  phaseStances: jsonb('phase_stances').$type<Record<string, string> | null>().default(null),
  // Commissioner-only notes (never injected into prompts)
  adminNotes: text('admin_notes'),
});

/**
 * Admin-editable team narrative card overrides.
 * Hardcoded defaults in team-narratives.ts remain as fallback.
 * cardData is merged field-by-field into the hardcoded card.
 */
export const teamNarrativeCards = pgTable('team_narrative_cards', {
  teamName: varchar('team_name', { length: 255 }).primaryKey(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  cardData: jsonb('card_data').$type<{
    archetype?: string;
    era?: 'early' | 'peak' | 'decline' | 'rebuild' | 'unknown';
    historicalArc?: string;
    currentSeasonArc?: string;
    botRelationship?: { entertainerView: string; analystView: string };
    runningJokes?: string[];
    retiredJokes?: string[];
    rivalries?: Array<{ team: string; intensity: 'mild' | 'heated' | 'blood_feud'; notes: string }>;
    sensitivityLevel?: 'low' | 'medium' | 'high';
    achievements?: string[];
    wounds?: string[];
    preferredAngles?: string[];
  }>().notNull().default({}),
});

/**
 * Admin-editable phrase pools.
 * Pool keys: 'banned_global', 'mason_openers', 'westy_closers',
 *             'team:{TeamName}:bits', 'phase:{episodeType}:hints'
 * Banned phrases from 'banned_global' are loaded into guardrails at generation time.
 */
export const phrasePools = pgTable('phrase_pools', {
  poolKey: varchar('pool_key', { length: 128 }).primaryKey(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  phrases: jsonb('phrases').$type<string[]>().default([]).notNull(),
  adminNotes: text('admin_notes'),
});

// ============ Rivalry Selection ============

export const rivalryCycleStatusEnum = pgEnum('rivalry_cycle_status', [
  'not_started', 'open', 'closed', 'calculated', 'published',
]);

export const rivalryPairStatusEnum = pgEnum('rivalry_pair_status', [
  'proposed', 'active', 'archived',
]);

export const rivalryCycles = pgTable('rivalry_cycles', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: rivalryCycleStatusEnum('status').default('not_started').notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  calculatedAt: timestamp('calculated_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const rivalrySubmissions = pgTable('rivalry_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  cycleId: uuid('cycle_id').notNull(),
  teamId: varchar('team_id', { length: 255 }).notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
  scores: jsonb('scores').$type<Array<{ targetTeamId: string; score: number }>>().notNull(),
  reopenedAt: timestamp('reopened_at', { withTimezone: true }),
}, (t) => ({
  cycleTeamIdx: index('rivalry_submissions_cycle_team_idx').on(t.cycleId, t.teamId),
}));

export const rivalryPairs = pgTable('rivalry_pairs', {
  id: uuid('id').primaryKey().defaultRandom(),
  cycleId: uuid('cycle_id').notNull(),
  teamAId: varchar('team_a_id', { length: 255 }).notNull(),
  teamBId: varchar('team_b_id', { length: 255 }).notNull(),
  teamAScoreForB: integer('team_a_score_for_b').notNull(),
  teamBScoreForA: integer('team_b_score_for_a').notNull(),
  combinedScore: integer('combined_score').notNull(),
  isBloodFeud: integer('is_blood_feud').default(0).notNull(),
  status: rivalryPairStatusEnum('status').default('proposed').notNull(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
}, (t) => ({
  cycleIdx: index('rivalry_pairs_cycle_idx').on(t.cycleId),
}));

// Discord notification dedupe - tracks which events have been posted to Discord
export const discordNotificationTypeEnum = pgEnum('discord_notification_type', [
  'trade_accepted',
  'trade_pending',
  'trade_complete',
  'newsletter_published',
  'trade_block_posted',
]);

export const discordNotifications = pgTable('discord_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  notificationType: discordNotificationTypeEnum('notification_type').notNull(),
  // Unique key for deduplication (e.g., transaction_id for trades, season-week for newsletters)
  dedupeKey: varchar('dedupe_key', { length: 255 }).notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true }).defaultNow().notNull(),
  // Optional metadata about the notification
  meta: jsonb('meta').$type<Record<string, unknown>>(),
}, (t) => ({
  typeKeyIdx: index('discord_notifications_type_key_idx').on(t.notificationType, t.dedupeKey),
}));

// Lightweight admin-managed rules for hiding or suppressing specific news items.
// type values:
//   'hide_url'       — suppress any story whose canonical URL matches value
//   'block_match'    — suppress a specific player match; value = "playerId:canonicalUrl" or "playerId" (all)
//   'block_headline' — suppress stories whose normalized title contains value (substring match)
export const newsModeration = pgTable('news_moderation', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: varchar('type', { length: 32 }).notNull(),
  value: text('value').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: text('created_by'),
});

