import { getDb } from './client';
import { firstRowFromExecute, rowsFromExecute } from './execute-rows';
import { sql } from 'drizzle-orm';
import type {
  PollQuestion,
  PollQuestionOption,
  PollQuestionGridRow,
  PollResponse,
  FormAnswer,
  QuestionType,
  FormQuestionResult,
} from '@/lib/votes/types';
import { parseMcGridAnswer, parseCbGridAnswer } from '@/lib/votes/grid-answers';
import { parseFileAnswer } from '@/lib/votes/file-answer';

// ── helpers ──────────────────────────────────────────────────────────────────

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return String(v);
}

function rowToQuestionOption(r: Record<string, unknown>): PollQuestionOption {
  return {
    id: String(r.id),
    questionId: String(r.question_id),
    text: String(r.text),
    displayOrder: Number(r.display_order ?? 0),
  };
}

function rowToGridRow(r: Record<string, unknown>): PollQuestionGridRow {
  return {
    id: String(r.id),
    questionId: String(r.question_id),
    text: String(r.text),
    displayOrder: Number(r.display_order ?? 0),
  };
}

function rowToQuestion(
  r: Record<string, unknown>,
  options: PollQuestionOption[],
  gridRows: PollQuestionGridRow[] = [],
): PollQuestion {
  const qType = r.question_type as QuestionType;
  return {
    id: String(r.id),
    pollId: String(r.poll_id),
    questionType: qType,
    text: String(r.text),
    description: r.description ? String(r.description) : null,
    required: Boolean(r.required),
    shuffleOptions: Boolean(r.shuffle_options),
    displayOrder: Number(r.display_order ?? 0),
    ratingMin: r.rating_min != null ? Number(r.rating_min) : (qType === 'rating' ? 1 : null),
    ratingMax: r.rating_max != null ? Number(r.rating_max) : (qType === 'rating' ? 10 : null),
    ratingMinLabel: r.rating_min_label ? String(r.rating_min_label) : null,
    ratingMaxLabel: r.rating_max_label ? String(r.rating_max_label) : null,
    maxLength: r.max_length != null ? Number(r.max_length) : null,
    conditionQuestionId: r.condition_question_id ? String(r.condition_question_id) : null,
    conditionOptionId: r.condition_option_id ? String(r.condition_option_id) : null,
    conditionValue: r.condition_value ? String(r.condition_value) : null,
    options,
    gridRows,
  };
}

function rowToAnswer(r: Record<string, unknown>): FormAnswer {
  return {
    questionId: String(r.question_id),
    textAnswer: r.text_answer ? String(r.text_answer) : null,
    ratingValue: r.rating_value != null ? Number(r.rating_value) : null,
    optionIds: Array.isArray(r.option_ids) ? (r.option_ids as string[]) : null,
  };
}

function rowToResponse(r: Record<string, unknown>, answers: FormAnswer[]): PollResponse {
  return {
    id: String(r.id),
    pollId: String(r.poll_id),
    voterId: String(r.voter_id),
    voterDisplay: r.voter_display ? String(r.voter_display) : null,
    submittedAt: toIso(r.submitted_at) ?? new Date().toISOString(),
    answers,
  };
}

// ── Question reads ────────────────────────────────────────────────────────────

export async function getQuestionsForPoll(pollId: string): Promise<PollQuestion[]> {
  try {
    const db = getDb();
    const qRows = await db.execute(sql`
      SELECT * FROM poll_questions WHERE poll_id = ${pollId}::uuid ORDER BY display_order ASC
    `);
    const questions = rowsFromExecute(qRows);
    if (!questions.length) return [];

    // Eager-load all options for these questions in one query
    const ids = questions.map((q) => `'${String(q.id)}'`).join(',');
    const optRows = await db.execute(
      sql.raw(`SELECT * FROM poll_question_options WHERE question_id IN (${ids}) ORDER BY display_order ASC`),
    );
    const allOptions = rowsFromExecute(optRows).map(rowToQuestionOption);

    let allGridRows: PollQuestionGridRow[] = [];
    try {
      const gridRows = await db.execute(
        sql.raw(`SELECT * FROM poll_question_grid_rows WHERE question_id IN (${ids}) ORDER BY display_order ASC`),
      );
      allGridRows = rowsFromExecute(gridRows).map(rowToGridRow);
    } catch {
      allGridRows = [];
    }

    return questions.map((q) => {
      const qid = String(q.id);
      const opts = allOptions.filter((o) => o.questionId === qid);
      const rows = allGridRows.filter((r) => r.questionId === qid);
      return rowToQuestion(q, opts, rows);
    });
  } catch {
    return [];
  }
}

// ── Question writes ───────────────────────────────────────────────────────────

export type QuestionInput = {
  questionType: string;
  text: string;
  description?: string | null;
  required?: boolean;
  shuffleOptions?: boolean;
  displayOrder: number;
  ratingMin?: number | null;
  ratingMax?: number | null;
  ratingMinLabel?: string | null;
  ratingMaxLabel?: string | null;
  maxLength?: number | null;
  conditionQuestionId?: string | null;
  conditionOptionId?: string | null;
  conditionValue?: string | null;
  conditionQuestionIndex?: number;
  conditionOptionIndex?: number;
  options?: { text: string; displayOrder: number }[];
  gridRows?: { text: string; displayOrder: number }[];
};

function maxLengthForInsert(q: QuestionInput): number | null {
  if (q.questionType === 'file_upload') {
    if (q.maxLength != null && q.maxLength > 0) return q.maxLength;
    return 10 * 1024 * 1024;
  }
  return q.maxLength ?? null;
}

function ratingBoundsForInsert(q: QuestionInput): { min: number | null; max: number | null } {
  if (q.questionType === 'rating') {
    return { min: q.ratingMin ?? 1, max: q.ratingMax ?? 10 };
  }
  if (q.questionType === 'number') {
    return { min: q.ratingMin ?? null, max: q.ratingMax ?? null };
  }
  return { min: null, max: null };
}

export async function createQuestions(pollId: string, questions: QuestionInput[]): Promise<PollQuestion[]> {
  if (!questions.length) return [];
  const results: PollQuestion[] = [];
  const db = getDb();
  for (const q of questions) {
    const { min: ratingMin, max: ratingMax } = ratingBoundsForInsert(q);
    const qRows = await db.execute(sql`
      INSERT INTO poll_questions (
        poll_id, question_type, text, description, required, shuffle_options, display_order,
        rating_min, rating_max, rating_min_label, rating_max_label, max_length,
        condition_question_id, condition_option_id, condition_value
      ) VALUES (
        ${pollId}::uuid,
        ${q.questionType}::question_type,
        ${q.text},
        ${q.description ?? null},
        ${q.required ?? true},
        ${q.shuffleOptions ?? false},
        ${q.displayOrder},
        ${ratingMin},
        ${ratingMax},
        ${q.ratingMinLabel ?? null},
        ${q.ratingMaxLabel ?? null},
        ${maxLengthForInsert(q)},
        ${(q.conditionQuestionId ?? null) as string | null}::uuid,
        ${(q.conditionOptionId ?? null) as string | null}::uuid,
        ${q.conditionValue ?? null}
      )
      RETURNING *
    `);
    const qRow = firstRowFromExecute(qRows);
    if (!qRow) {
      throw new Error(`Failed to insert question: ${q.text.slice(0, 80)}`);
    }

    const options: PollQuestionOption[] = [];
    if (q.options?.length) {
      for (const opt of q.options) {
        const oRows = await db.execute(sql`
          INSERT INTO poll_question_options (question_id, text, display_order)
          VALUES (${String(qRow.id)}::uuid, ${opt.text}, ${opt.displayOrder})
          RETURNING *
        `);
        const oRow = firstRowFromExecute(oRows);
        if (oRow) options.push(rowToQuestionOption(oRow));
      }
    } else if (q.questionType === 'yes_no') {
      for (const [idx, text] of ['Yes', 'No'].entries()) {
        const oRows = await db.execute(sql`
          INSERT INTO poll_question_options (question_id, text, display_order)
          VALUES (${String(qRow.id)}::uuid, ${text}, ${idx})
          RETURNING *
        `);
        const oRow = firstRowFromExecute(oRows);
        if (oRow) options.push(rowToQuestionOption(oRow));
      }
    } else if (q.questionType === 'dropdown' && !q.options?.length) {
      // dropdown always needs options; skip auto if empty
    }

    const gridRows: PollQuestionGridRow[] = [];
    if (q.gridRows?.length) {
      for (const row of q.gridRows) {
        const gRows = await db.execute(sql`
          INSERT INTO poll_question_grid_rows (question_id, text, display_order)
          VALUES (${String(qRow.id)}::uuid, ${row.text}, ${row.displayOrder})
          RETURNING *
        `);
        const gRow = firstRowFromExecute(gRows);
        if (gRow) gridRows.push(rowToGridRow(gRow));
      }
    }

    results.push(rowToQuestion(qRow, options, gridRows));
  }
  return results;
}

export async function deletePollQuestions(pollId: string): Promise<boolean> {
  try {
    const db = getDb();
    await db.execute(sql`DELETE FROM poll_questions WHERE poll_id = ${pollId}::uuid`);
    return true;
  } catch {
    return false;
  }
}

export async function replacePollQuestions(pollId: string, questions: QuestionInput[]): Promise<PollQuestion[]> {
  const ok = await deletePollQuestions(pollId);
  if (!ok) return [];
  const created = await createQuestions(pollId, questions);
  if (created.length) {
    await applyQuestionConditions(
      created,
      questions.map((q) => ({
        conditionQuestionIndex: q.conditionQuestionIndex,
        conditionOptionIndex: q.conditionOptionIndex,
        conditionValue: q.conditionValue ?? undefined,
      })),
    );
  }
  return created;
}

/** Resolve condition indices from the builder into FK ids after all questions exist. */
export async function applyQuestionConditions(
  created: PollQuestion[],
  defs: Array<{ conditionQuestionIndex?: number; conditionOptionIndex?: number; conditionValue?: string }>,
): Promise<void> {
  try {
    const db = getDb();
    for (let i = 0; i < created.length; i++) {
      const def = defs[i];
      if (def?.conditionQuestionIndex == null || def.conditionQuestionIndex < 0) continue;
      const parent = created[def.conditionQuestionIndex];
      if (!parent) continue;
      const optionId =
        def.conditionOptionIndex != null && def.conditionOptionIndex >= 0
          ? (parent.options[def.conditionOptionIndex]?.id ?? null)
          : null;
      await db.execute(sql`
        UPDATE poll_questions SET
          condition_question_id = ${parent.id}::uuid,
          condition_option_id = ${optionId}::uuid,
          condition_value = ${def.conditionValue ?? null}
        WHERE id = ${created[i].id}::uuid
      `);
      created[i] = {
        ...created[i],
        conditionQuestionId: parent.id,
        conditionOptionId: optionId,
        conditionValue: def.conditionValue ?? null,
      };
    }
  } catch {
    // best-effort
  }
}

// ── Response reads ────────────────────────────────────────────────────────────

export async function getResponseCount(pollId: string): Promise<number> {
  try {
    const db = getDb();
    const rows = await db.execute(sql`SELECT COUNT(*) as cnt FROM poll_responses WHERE poll_id = ${pollId}::uuid`);
    return Number(firstRowFromExecute(rows)?.cnt ?? 0);
  } catch {
    return 0;
  }
}

export async function getResponseByVoter(pollId: string, voterId: string): Promise<PollResponse | null> {
  try {
    const db = getDb();
    const rRows = await db.execute(sql`
      SELECT * FROM poll_responses WHERE poll_id = ${pollId}::uuid AND voter_id = ${voterId} LIMIT 1
    `);
    const rRow = firstRowFromExecute(rRows);
    if (!rRow) return null;

    const aRows = await db.execute(sql`
      SELECT * FROM poll_response_answers WHERE response_id = ${String(rRow.id)}::uuid
    `);
    const answers = rowsFromExecute(aRows).map(rowToAnswer);
    return rowToResponse(rRow, answers);
  } catch {
    return null;
  }
}

export async function getAllResponses(pollId: string): Promise<PollResponse[]> {
  try {
    const db = getDb();
    const rRows = await db.execute(sql`
      SELECT * FROM poll_responses WHERE poll_id = ${pollId}::uuid ORDER BY submitted_at ASC
    `);
    const responses = rowsFromExecute(rRows);
    if (!responses.length) return [];

    const ids = responses.map((r) => `'${String(r.id)}'`).join(',');
    const aRows = await db.execute(
      sql.raw(`SELECT * FROM poll_response_answers WHERE response_id IN (${ids})`),
    );
    const aRowsTyped = rowsFromExecute(aRows);
    return responses.map((r) => {
      const respId = String(r.id);
      const answers = aRowsTyped
        .filter((a) => String(a.response_id) === respId)
        .map(rowToAnswer);
      return rowToResponse(r, answers);
    });
  } catch {
    return [];
  }
}

// ── Response writes ───────────────────────────────────────────────────────────

export async function upsertResponse(
  pollId: string,
  voterId: string,
  voterDisplay: string,
  answers: FormAnswer[],
): Promise<boolean> {
  try {
    const db = getDb();
    await db.execute(sql`BEGIN`);
    try {
      // Delete existing response (cascade removes answers)
      await db.execute(sql`
        DELETE FROM poll_responses WHERE poll_id = ${pollId}::uuid AND voter_id = ${voterId}
      `);

      // Insert fresh response
      const rRows = await db.execute(sql`
        INSERT INTO poll_responses (poll_id, voter_id, voter_display)
        VALUES (${pollId}::uuid, ${voterId}, ${voterDisplay})
        RETURNING id
      `);
      const responseId = String(firstRowFromExecute(rRows)?.id ?? '');
      if (!responseId) throw new Error('no response id');

      // Insert answers
      for (const a of answers) {
        await db.execute(sql`
          INSERT INTO poll_response_answers (response_id, question_id, text_answer, rating_value, option_ids)
          VALUES (
            ${responseId}::uuid,
            ${a.questionId}::uuid,
            ${a.textAnswer ?? null},
            ${a.ratingValue ?? null},
            ${a.optionIds ? `{${a.optionIds.map((s) => `"${s}"`).join(',')}}` : null}::text[]
          )
        `);
      }

      await db.execute(sql`COMMIT`);
      return true;
    } catch (inner) {
      await db.execute(sql`ROLLBACK`);
      throw inner;
    }
  } catch {
    return false;
  }
}

// ── Form results aggregation ──────────────────────────────────────────────────

export async function buildFormResults(
  questions: PollQuestion[],
  responses: PollResponse[],
  anonymous: boolean,
): Promise<FormQuestionResult[]> {
  const results: FormQuestionResult[] = [];

  for (const q of questions) {
    if (q.questionType === 'section_break') continue;

    const answers = responses.flatMap((r) => r.answers.filter((a) => a.questionId === q.id));

    if (q.questionType === 'rating') {
      const min = q.ratingMin ?? 1;
      const max = q.ratingMax ?? 10;
      const values = answers.map((a) => a.ratingValue).filter((v): v is number => v != null);
      const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
      const dist: { value: number; count: number }[] = [];
      for (let v = min; v <= max; v++) {
        dist.push({ value: v, count: values.filter((x) => x === v).length });
      }
      results.push({ questionId: q.id, type: 'rating', average: Math.round(avg * 10) / 10, distribution: dist, total: values.length });
    } else if (
      q.questionType === 'short_answer' ||
      q.questionType === 'paragraph' ||
      q.questionType === 'date' ||
      q.questionType === 'time' ||
      q.questionType === 'number' ||
      q.questionType === 'email'
    ) {
      const textAnswers: { voterDisplay: string | null; text: string }[] = [];
      for (const resp of responses) {
        const a = resp.answers.find((ra) => ra.questionId === q.id);
        if (a?.textAnswer) {
          textAnswers.push({ voterDisplay: anonymous ? null : resp.voterDisplay, text: a.textAnswer });
        }
      }
      results.push({ questionId: q.id, type: 'text', answers: textAnswers });
    } else if (
      q.questionType === 'multiple_choice' ||
      q.questionType === 'checkboxes' ||
      q.questionType === 'yes_no' ||
      q.questionType === 'dropdown'
    ) {
      const counts = q.options.map((opt) => ({
        optionId: opt.id,
        text: opt.text,
        count: answers.filter((a) => a.optionIds?.includes(opt.id)).length,
      }));
      results.push({ questionId: q.id, type: 'choice', counts, total: answers.filter((a) => a.optionIds?.length).length });
    } else if (q.questionType === 'multiple_choice_grid' || q.questionType === 'checkbox_grid') {
      const isMc = q.questionType === 'multiple_choice_grid';
      const rows = q.gridRows.map((row) => {
        const columnCounts = q.options.map((col) => {
          let count = 0;
          for (const a of answers) {
            const grid = isMc ? parseMcGridAnswer(a.textAnswer) : parseCbGridAnswer(a.textAnswer);
            const picked = grid[row.id];
            if (isMc) {
              if (picked === col.id) count++;
            } else if (Array.isArray(picked) && picked.includes(col.id)) {
              count++;
            }
          }
          return { optionId: col.id, text: col.text, count };
        });
        return { rowId: row.id, text: row.text, columnCounts };
      });
      results.push({
        questionId: q.id,
        type: 'grid',
        gridType: q.questionType,
        rows,
        total: answers.filter((a) => a.textAnswer?.trim()).length,
      });
    } else if (q.questionType === 'file_upload') {
      const files: { voterDisplay: string | null; filename: string; key: string; contentType: string }[] = [];
      for (const resp of responses) {
        const a = resp.answers.find((ra) => ra.questionId === q.id);
        const file = parseFileAnswer(a?.textAnswer);
        if (file) {
          files.push({
            voterDisplay: anonymous ? null : resp.voterDisplay,
            filename: file.filename,
            key: file.key,
            contentType: file.contentType,
          });
        }
      }
      results.push({ questionId: q.id, type: 'file', files });
    }
  }

  return results;
}
