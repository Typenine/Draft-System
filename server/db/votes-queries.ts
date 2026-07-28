import { getDb } from './client';
import { firstRowFromExecute, rowsFromExecute } from './execute-rows';
import { sql } from 'drizzle-orm';
import type {
  Poll,
  PollRound,
  PollOption,
  PollVote,
  PollVoteSelection,
  PollStatus,
  RoundStatus,
  BallotSelection,
} from '@/lib/votes/types';

// ── helpers ──────────────────────────────────────────────────────────────────

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return String(v);
}

function rowToPoll(r: Record<string, unknown>): Poll {
  return {
    id: String(r.id),
    title: String(r.title),
    description: r.description ? String(r.description) : null,
    status: (r.status as Poll['status']) ?? 'draft',
    eligibilityType: (r.eligibility_type as Poll['eligibilityType']) ?? 'team',
    linkedSuggestionIds: Array.isArray(r.linked_suggestion_ids) ? (r.linked_suggestion_ids as string[]) : null,
    anonymous: Boolean(r.anonymous),
    resultVisibility: (r.result_visibility as Poll['resultVisibility']) ?? 'admin_publish',
    deadline: toIso(r.deadline),
    discordNotifiedOpen: Boolean(r.discord_notified_open),
    discordNotifiedReminder: Boolean(r.discord_notified_reminder),
    discordNotifiedClosed: Boolean(r.discord_notified_closed),
    confirmationMessage: r.confirmation_message ? String(r.confirmation_message) : null,
    responseLimit: r.response_limit != null ? Number(r.response_limit) : null,
    resultsPublishedAt: toIso(r.results_published_at),
    createdAt: toIso(r.created_at) ?? new Date().toISOString(),
    closedAt: toIso(r.closed_at),
  };
}

function rowToRound(r: Record<string, unknown>): PollRound {
  return {
    id: String(r.id),
    pollId: String(r.poll_id),
    roundNumber: Number(r.round_number),
    status: (r.status as PollRound['status']) ?? 'pending',
    voteType: (r.vote_type as PollRound['voteType']),
    survivorCount: r.survivor_count != null ? Number(r.survivor_count) : null,
    thresholdType: (r.threshold_type as PollRound['thresholdType']) ?? 'plurality',
    thresholdValue: r.threshold_value != null ? Number(r.threshold_value) : null,
    shuffleOptions: Boolean(r.shuffle_options),
    resultsPublishedAt: toIso(r.results_published_at),
    openedAt: toIso(r.opened_at),
    closedAt: toIso(r.closed_at),
  };
}

function rowToOption(r: Record<string, unknown>): PollOption {
  return {
    id: String(r.id),
    roundId: String(r.round_id),
    text: String(r.text),
    linkedSuggestionId: r.linked_suggestion_id ? String(r.linked_suggestion_id) : null,
    carriedFromOptionId: r.carried_from_option_id ? String(r.carried_from_option_id) : null,
    displayOrder: Number(r.display_order ?? 0),
  };
}

function rowToVote(r: Record<string, unknown>): PollVote {
  return {
    id: String(r.id),
    roundId: String(r.round_id),
    voterId: String(r.voter_id),
    voterDisplay: r.voter_display ? String(r.voter_display) : null,
    createdAt: toIso(r.created_at) ?? new Date().toISOString(),
  };
}

function rowToSelection(r: Record<string, unknown>): PollVoteSelection {
  return {
    id: String(r.id),
    voteId: String(r.vote_id),
    optionId: String(r.option_id),
    rank: r.rank != null ? Number(r.rank) : null,
    selected: r.selected != null ? Boolean(r.selected) : null,
  };
}

// ── Poll reads ────────────────────────────────────────────────────────────────

export async function getPollById(id: string): Promise<Poll | null> {
  try {
    const db = getDb();
    const rows = await db.execute(sql`SELECT * FROM polls WHERE id = ${id}::uuid LIMIT 1`);
    const r = firstRowFromExecute(rows);
    return r ? rowToPoll(r) : null;
  } catch {
    return null;
  }
}

export async function listPolls(includeDraft = false): Promise<Poll[]> {
  try {
    const db = getDb();
    const rows = includeDraft
      ? await db.execute(sql`SELECT * FROM polls ORDER BY created_at DESC`)
      : await db.execute(sql`SELECT * FROM polls WHERE status != 'draft' ORDER BY created_at DESC`);
    return rowsFromExecute(rows).map(rowToPoll);
  } catch {
    return [];
  }
}

export async function getRoundsForPoll(pollId: string): Promise<PollRound[]> {
  try {
    const db = getDb();
    const rows = await db.execute(sql`SELECT * FROM poll_rounds WHERE poll_id = ${pollId}::uuid ORDER BY round_number ASC`);
    return rowsFromExecute(rows).map(rowToRound);
  } catch {
    return [];
  }
}

export async function getCurrentOpenRound(pollId: string): Promise<PollRound | null> {
  try {
    const db = getDb();
    const rows = await db.execute(sql`SELECT * FROM poll_rounds WHERE poll_id = ${pollId}::uuid AND status = 'open' ORDER BY round_number ASC LIMIT 1`);
    const r = firstRowFromExecute(rows);
    return r ? rowToRound(r) : null;
  } catch {
    return null;
  }
}

export async function getOptionsForRound(roundId: string): Promise<PollOption[]> {
  try {
    const db = getDb();
    const rows = await db.execute(sql`SELECT * FROM poll_options WHERE round_id = ${roundId}::uuid ORDER BY display_order ASC`);
    return rowsFromExecute(rows).map(rowToOption);
  } catch {
    return [];
  }
}

export async function getVoteCount(roundId: string): Promise<number> {
  try {
    const db = getDb();
    const rows = await db.execute(sql`SELECT COUNT(*) as cnt FROM poll_votes WHERE round_id = ${roundId}::uuid`);
    return Number(firstRowFromExecute(rows)?.cnt ?? 0);
  } catch {
    return 0;
  }
}

export async function getVoterIds(roundId: string): Promise<string[]> {
  try {
    const db = getDb();
    const rows = await db.execute(sql`SELECT voter_id FROM poll_votes WHERE round_id = ${roundId}::uuid`);
    return rowsFromExecute(rows).map((r) => String(r.voter_id));
  } catch {
    return [];
  }
}

export async function getMyVote(
  roundId: string,
  voterId: string,
): Promise<(PollVote & { selections: PollVoteSelection[] }) | null> {
  try {
    const db = getDb();
    const voteRows = await db.execute(sql`SELECT * FROM poll_votes WHERE round_id = ${roundId}::uuid AND voter_id = ${voterId} LIMIT 1`);
    const voteRow = firstRowFromExecute(voteRows);
    if (!voteRow) return null;
    const vote = rowToVote(voteRow);
    const selRows = await db.execute(sql`SELECT * FROM poll_vote_selections WHERE vote_id = ${vote.id}::uuid ORDER BY rank ASC NULLS LAST`);
    const selections = rowsFromExecute(selRows).map(rowToSelection);
    return { ...vote, selections };
  } catch {
    return null;
  }
}

export async function getAllVotesWithSelections(
  roundId: string,
): Promise<Array<PollVote & { selections: PollVoteSelection[] }>> {
  try {
    const db = getDb();
    const voteRows = await db.execute(sql`SELECT * FROM poll_votes WHERE round_id = ${roundId}::uuid ORDER BY created_at ASC`);
    const votes = rowsFromExecute(voteRows).map(rowToVote);
    const result: Array<PollVote & { selections: PollVoteSelection[] }> = [];
    for (const vote of votes) {
      const selRows = await db.execute(sql`SELECT * FROM poll_vote_selections WHERE vote_id = ${vote.id}::uuid ORDER BY rank ASC NULLS LAST`);
      const selections = rowsFromExecute(selRows).map(rowToSelection);
      result.push({ ...vote, selections });
    }
    return result;
  } catch {
    return [];
  }
}

// ── Poll writes ───────────────────────────────────────────────────────────────

export async function createPoll(data: {
  title: string;
  description?: string | null;
  eligibilityType: string;
  linkedSuggestionIds?: string[] | null;
  anonymous: boolean;
  resultVisibility: string;
  deadline?: string | null;
  confirmationMessage?: string | null;
  responseLimit?: number | null;
}): Promise<Poll | null> {
  try {
    const db = getDb();
    const rows = await db.execute(sql`
      INSERT INTO polls (title, description, eligibility_type, linked_suggestion_ids, anonymous, result_visibility, deadline, confirmation_message, response_limit)
      VALUES (
        ${data.title},
        ${data.description ?? null},
        ${data.eligibilityType}::eligibility_type,
        ${data.linkedSuggestionIds ? `{${data.linkedSuggestionIds.map((s) => `"${s}"`).join(',')}}` : null}::text[],
        ${data.anonymous},
        ${data.resultVisibility}::result_visibility,
        ${data.deadline ? new Date(data.deadline) : null},
        ${data.confirmationMessage ?? null},
        ${data.responseLimit ?? null}
      )
      RETURNING *
    `);
    const r = firstRowFromExecute(rows);
    return r ? rowToPoll(r) : null;
  } catch (err) {
    console.error('[createPoll]', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function updatePollStatus(id: string, status: PollStatus, closedAt?: string): Promise<boolean> {
  try {
    const db = getDb();
    if (closedAt) {
      await db.execute(sql`UPDATE polls SET status = ${status}::poll_status, closed_at = ${new Date(closedAt)} WHERE id = ${id}::uuid`);
    } else {
      await db.execute(sql`UPDATE polls SET status = ${status}::poll_status WHERE id = ${id}::uuid`);
    }
    return true;
  } catch {
    return false;
  }
}

export async function updatePollFormMetadata(
  id: string,
  data: {
    title?: string;
    description?: string | null;
    deadline?: string | null;
    anonymous?: boolean;
    resultVisibility?: string;
    confirmationMessage?: string | null;
    responseLimit?: number | null;
    linkedSuggestionIds?: string[] | null;
  },
): Promise<boolean> {
  try {
    const db = getDb();
    const poll = await getPollById(id);
    if (!poll) return false;
    await db.execute(sql`
      UPDATE polls SET
        title = ${data.title ?? poll.title},
        description = ${data.description !== undefined ? data.description : poll.description},
        deadline = ${data.deadline !== undefined ? (data.deadline ? new Date(data.deadline) : null) : (poll.deadline ? new Date(poll.deadline) : null)},
        anonymous = ${data.anonymous !== undefined ? data.anonymous : poll.anonymous},
        result_visibility = ${(data.resultVisibility !== undefined ? data.resultVisibility : poll.resultVisibility)}::result_visibility,
        confirmation_message = ${data.confirmationMessage !== undefined ? data.confirmationMessage : poll.confirmationMessage},
        response_limit = ${data.responseLimit !== undefined ? data.responseLimit : poll.responseLimit},
        linked_suggestion_ids = ${data.linkedSuggestionIds !== undefined ? (data.linkedSuggestionIds ? `{${data.linkedSuggestionIds.map((s) => `"${s}"`).join(',')}}` : null) : (poll.linkedSuggestionIds ? `{${poll.linkedSuggestionIds.map((s) => `"${s}"`).join(',')}}` : null)}::text[]
      WHERE id = ${id}::uuid
    `);
    return true;
  } catch {
    return false;
  }
}

export async function publishPollSurveyResults(id: string): Promise<boolean> {
  try {
    const db = getDb();
    await db.execute(sql`UPDATE polls SET results_published_at = NOW() WHERE id = ${id}::uuid`);
    return true;
  } catch {
    return false;
  }
}

export async function markDiscordNotified(id: string, field: 'open' | 'reminder' | 'closed'): Promise<boolean> {
  try {
    const db = getDb();
    const col = field === 'open' ? 'discord_notified_open' : field === 'reminder' ? 'discord_notified_reminder' : 'discord_notified_closed';
    await db.execute(sql.raw(`UPDATE polls SET ${col} = true WHERE id = '${id}'`));
    return true;
  } catch {
    return false;
  }
}

export async function deletePoll(id: string): Promise<boolean> {
  try {
    const db = getDb();
    await db.execute(sql`DELETE FROM polls WHERE id = ${id}::uuid`);
    return true;
  } catch {
    return false;
  }
}

// ── Round writes ──────────────────────────────────────────────────────────────

export async function createRound(data: {
  pollId: string;
  roundNumber: number;
  voteType: string;
  survivorCount?: number | null;
  thresholdType: string;
  thresholdValue?: number | null;
  shuffleOptions?: boolean;
}): Promise<PollRound | null> {
  try {
    const db = getDb();
    const rows = await db.execute(sql`
      INSERT INTO poll_rounds (poll_id, round_number, vote_type, survivor_count, threshold_type, threshold_value, shuffle_options)
      VALUES (
        ${data.pollId}::uuid,
        ${data.roundNumber},
        ${data.voteType}::vote_type,
        ${data.survivorCount ?? null},
        ${data.thresholdType}::threshold_type,
        ${data.thresholdValue ?? null},
        ${data.shuffleOptions ?? false}
      )
      RETURNING *
    `);
    const r = firstRowFromExecute(rows);
    return r ? rowToRound(r) : null;
  } catch (err) {
    console.error('[createRound]', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function updateRoundStatus(
  id: string,
  status: RoundStatus,
  timestamps?: { openedAt?: string; closedAt?: string },
): Promise<boolean> {
  try {
    const db = getDb();
    if (timestamps?.openedAt) {
      await db.execute(sql`UPDATE poll_rounds SET status = ${status}::round_status, opened_at = ${new Date(timestamps.openedAt)} WHERE id = ${id}::uuid`);
    } else if (timestamps?.closedAt) {
      await db.execute(sql`UPDATE poll_rounds SET status = ${status}::round_status, closed_at = ${new Date(timestamps.closedAt)} WHERE id = ${id}::uuid`);
    } else {
      await db.execute(sql`UPDATE poll_rounds SET status = ${status}::round_status WHERE id = ${id}::uuid`);
    }
    return true;
  } catch {
    return false;
  }
}

export async function publishRoundResults(id: string): Promise<boolean> {
  try {
    const db = getDb();
    await db.execute(sql`UPDATE poll_rounds SET results_published_at = NOW() WHERE id = ${id}::uuid`);
    return true;
  } catch {
    return false;
  }
}

export async function getRoundById(id: string): Promise<PollRound | null> {
  try {
    const db = getDb();
    const rows = await db.execute(sql`SELECT * FROM poll_rounds WHERE id = ${id}::uuid LIMIT 1`);
    const r = firstRowFromExecute(rows);
    return r ? rowToRound(r) : null;
  } catch {
    return null;
  }
}

// ── Option writes ─────────────────────────────────────────────────────────────

export async function createOptions(
  options: Array<{
    roundId: string;
    text: string;
    linkedSuggestionId?: string | null;
    carriedFromOptionId?: string | null;
    displayOrder: number;
  }>,
): Promise<PollOption[]> {
  const created: PollOption[] = [];
  try {
    const db = getDb();
    for (const opt of options) {
      const rows = await db.execute(sql`
        INSERT INTO poll_options (round_id, text, linked_suggestion_id, carried_from_option_id, display_order)
        VALUES (
          ${opt.roundId}::uuid,
          ${opt.text},
          ${opt.linkedSuggestionId ?? null},
          ${opt.carriedFromOptionId ? sql`${opt.carriedFromOptionId}::uuid` : sql`NULL`},
          ${opt.displayOrder}
        )
        RETURNING *
      `);
      const r = firstRowFromExecute(rows);
      if (r) created.push(rowToOption(r));
    }
  } catch {}
  return created;
}

// ── Vote writes ───────────────────────────────────────────────────────────────

export async function upsertVote(
  roundId: string,
  voterId: string,
  voterDisplay: string | null,
  selections: BallotSelection[],
): Promise<boolean> {
  const db = getDb();
  try {
    await db.execute(sql`BEGIN`);

    // Delete existing vote (cascades to selections)
    await db.execute(sql`DELETE FROM poll_votes WHERE round_id = ${roundId}::uuid AND voter_id = ${voterId}`);

    // Insert fresh vote
    const voteRows = await db.execute(sql`
      INSERT INTO poll_votes (round_id, voter_id, voter_display)
      VALUES (${roundId}::uuid, ${voterId}, ${voterDisplay})
      RETURNING id
    `);
    const voteId = String(firstRowFromExecute(voteRows)?.id ?? '');
    if (!voteId) { await db.execute(sql`ROLLBACK`); return false; }

    // Insert selections
    for (const sel of selections) {
      await db.execute(sql`
        INSERT INTO poll_vote_selections (vote_id, option_id, rank, selected)
        VALUES (
          ${voteId}::uuid,
          ${sel.optionId}::uuid,
          ${sel.rank ?? null},
          ${sel.selected ?? false}
        )
      `);
    }

    await db.execute(sql`COMMIT`);
    return true;
  } catch {
    try { await db.execute(sql`ROLLBACK`); } catch {}
    return false;
  }
}

// ── Suggestion integration ────────────────────────────────────────────────────

export async function updateSuggestionVoteTag(
  suggestionId: string,
  tag: 'voted_on' | 'vote_passed' | 'vote_failed',
): Promise<boolean> {
  try {
    const db = getDb();
    // Guard: ensure vote_tag column exists (matches existing pattern in queries.fixed.ts)
    await db.execute(sql`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS vote_tag varchar(50)`);
    await db.execute(sql`UPDATE suggestions SET vote_tag = ${tag} WHERE id = ${suggestionId}::uuid`);
    return true;
  } catch {
    return false;
  }
}
