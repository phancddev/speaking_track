import "server-only"
import { and, asc, eq, ilike, inArray, isNull, sql } from "drizzle-orm"
import {
  AppError,
  type QuestionCreateInput,
  type QuestionUpdateInput,
  type TopicCreateInput,
  type TopicUpdateInput,
} from "@speaking-track/contracts"
import type { Db, DbExecutor } from "@speaking-track/db"
import {
  questions,
  recordings,
  tags,
  topics,
  topicTags,
  type Question,
  type Topic,
} from "@speaking-track/db"

/**
 * Topics and questions services (plan/02 § topics/questions, plan/04).
 *
 * - Normal-user queries scope ownership in SQL; admins name the target owner
 *   explicitly (the caller resolves the scope via resolveOwnerScope).
 * - Topic tag association updates take the full intended set and synchronize
 *   atomically; foreign tags are rejected as not found without leaking them.
 * - Multi-tag filtering is an intersection: every selected tag must be
 *   attached.
 * - Soft deletes hide rows immediately; descendant cleanup intents are a
 *   later recording-domain concern and are not triggered here.
 */

export type TopicListItem = {
  id: string
  title: string
  description: string | null
  tags: { id: string; name: string; color: string | null }[]
  questionCount: number
}

export type QuestionListItem = {
  id: string
  prompt: string
  position: number
  /** Non-hidden recordings this question has (task: per-question counts). */
  recordingCount: number
  /** When the user marked this question as drafted/practiced. */
  draftedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type TopicDetail = TopicListItem & {
  questions: QuestionListItem[]
}

export async function listTopics(
  db: DbExecutor,
  ownerId: string,
  filters: { q?: string; tagIds?: string[] },
): Promise<TopicListItem[]> {
  const conditions = [eq(topics.ownerId, ownerId), isNull(topics.deletedAt)]
  if (filters.q && filters.q.trim().length > 0) {
    conditions.push(ilike(topics.title, `%${escapeLike(filters.q.trim())}%`))
  }

  let topicRows = await db
    .select()
    .from(topics)
    .where(and(...conditions))
    .orderBy(asc(topics.position), asc(topics.title))

  if (!filters.tagIds || filters.tagIds.length === 0) {
    return hydrateTopicList(db, ownerId, topicRows)
  }

  // Intersection: topics carrying EVERY selected tag (plan/04 deliverable 5).
  const requestedTagIds = [...new Set(filters.tagIds)]
  const matching = await db
    .select({ topicId: topicTags.topicId, tagId: topicTags.tagId })
    .from(topicTags)
    .innerJoin(topics, eq(topics.id, topicTags.topicId))
    .where(
      and(
        eq(topics.ownerId, ownerId),
        isNull(topics.deletedAt),
        inArray(topicTags.tagId, requestedTagIds),
      ),
    )

  const countByTopic = new Map<string, number>()
  for (const row of matching) {
    countByTopic.set(row.topicId, (countByTopic.get(row.topicId) ?? 0) + 1)
  }
  const required = new Set(requestedTagIds).size
  const eligible = new Set(
    [...countByTopic.entries()].filter(([, count]) => count >= required).map(([id]) => id),
  )
  topicRows = topicRows.filter((topic) => eligible.has(topic.id))
  return hydrateTopicList(db, ownerId, topicRows)
}

async function hydrateTopicList(
  db: DbExecutor,
  ownerId: string,
  topicRows: Topic[],
): Promise<TopicListItem[]> {
  if (topicRows.length === 0) return []
  const topicIds = topicRows.map((topic) => topic.id)

  const tagRows = await db
    .select({ topicId: topicTags.topicId, id: tags.id, name: tags.name, color: tags.color })
    .from(topicTags)
    .innerJoin(tags, eq(tags.id, topicTags.tagId))
    .where(and(eq(tags.ownerId, ownerId), inArray(topicTags.topicId, topicIds)))
    .orderBy(asc(tags.normalizedName))

  const countRows = await db
    .select({ topicId: questions.topicId, count: sql<number>`count(*)::int` })
    .from(questions)
    .where(and(inArray(questions.topicId, topicIds), isNull(questions.deletedAt)))
    .groupBy(questions.topicId)

  const tagsByTopic = new Map<string, { id: string; name: string; color: string | null }[]>()
  for (const row of tagRows) {
    const list = tagsByTopic.get(row.topicId) ?? []
    list.push({ id: row.id, name: row.name, color: row.color })
    tagsByTopic.set(row.topicId, list)
  }
  const counts = new Map(countRows.map((row) => [row.topicId, row.count]))

  return topicRows.map((topic) => ({
    id: topic.id,
    title: topic.title,
    description: topic.description,
    tags: tagsByTopic.get(topic.id) ?? [],
    questionCount: counts.get(topic.id) ?? 0,
    createdAt: topic.createdAt,
    updatedAt: topic.updatedAt,
  }))
}

export async function getTopic(
  db: DbExecutor,
  ownerId: string,
  topicId: string,
): Promise<TopicDetail> {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.ownerId, ownerId), isNull(topics.deletedAt)))
    .limit(1)
  if (!topic) {
    throw new AppError("RESOURCE_NOT_FOUND", "Topic not found.")
  }
  const list = await hydrateTopicList(db, ownerId, [topic])
  const questionRows = await listQuestions(db, ownerId, topicId)
  return { ...list[0]!, questions: questionRows }
}

export async function createTopic(
  db: Db,
  ownerId: string,
  input: TopicCreateInput,
): Promise<TopicDetail> {
  const tagIds = input.tagIds ? await assertOwnedTags(db, ownerId, input.tagIds) : []
  const topicId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(topics)
      .values({
        ownerId,
        title: input.title,
        description: input.description ?? null,
        // New topics append after the current max position.
        position: await nextTopicPosition(tx, ownerId),
      })
      .returning({ id: topics.id })
    if (!row) throw new Error("topic insert returned no row")
    if (tagIds.length > 0) {
      await tx.insert(topicTags).values(tagIds.map((tagId) => ({ topicId: row.id, tagId })))
    }
    return row.id
  })
  return getTopic(db, ownerId, topicId)
}

export async function updateTopic(
  db: Db,
  ownerId: string,
  topicId: string,
  input: TopicUpdateInput,
): Promise<TopicDetail> {
  const [existing] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.ownerId, ownerId), isNull(topics.deletedAt)))
    .limit(1)
  if (!existing) {
    throw new AppError("RESOURCE_NOT_FOUND", "Topic not found.")
  }

  const tagIds =
    input.tagIds === undefined ? null : await assertOwnedTags(db, ownerId, input.tagIds)

  await db.transaction(async (tx) => {
    await tx
      .update(topics)
      .set({
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description ?? null }),
        updatedAt: new Date(),
      })
      .where(and(eq(topics.id, topicId), eq(topics.ownerId, ownerId)))
    if (tagIds !== null) {
      await tx.delete(topicTags).where(eq(topicTags.topicId, topicId))
      if (tagIds.length > 0) {
        await tx.insert(topicTags).values(tagIds.map((tagId) => ({ topicId, tagId })))
      }
    }
  })
  return getTopic(db, ownerId, topicId)
}

export async function deleteTopic(db: Db, ownerId: string, topicId: string): Promise<void> {
  const [existing] = await db
    .select({ position: topics.position })
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.ownerId, ownerId), isNull(topics.deletedAt)))
    .limit(1)
  if (!existing) {
    throw new AppError("RESOURCE_NOT_FOUND", "Topic not found.")
  }
  await db.transaction(async (tx) => {
    const result = await tx
      .update(topics)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(topics.id, topicId), eq(topics.ownerId, ownerId), isNull(topics.deletedAt)))
      .returning({ id: topics.id })
    if (result.length === 0) {
      throw new AppError("RESOURCE_NOT_FOUND", "Topic not found.")
    }
    // Close the gap so positions stay dense and stable.
    await tx
      .update(topics)
      .set({ position: sql`${topics.position} - 1`, updatedAt: new Date() })
      .where(
        and(
          eq(topics.ownerId, ownerId),
          isNull(topics.deletedAt),
          sql`${topics.position} > ${existing.position}`,
        ),
      )
  })
}

export async function reorderTopics(
  db: Db,
  ownerId: string,
  orderedTopicIds: string[],
): Promise<TopicListItem[]> {
  const current = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.ownerId, ownerId), isNull(topics.deletedAt)))
  const currentIds = new Set(current.map((row) => row.id))
  const ordered = [...new Set(orderedTopicIds)]

  const duplicates = orderedTopicIds.length !== new Set(orderedTopicIds).size
  const missing = [...currentIds].filter((id) => !ordered.includes(id))
  const foreign = ordered.filter((id) => !currentIds.has(id))
  if (duplicates || missing.length > 0 || foreign.length > 0) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Topic order must list every library topic exactly once.",
      {
        fieldErrors: {
          topicIds: [
            duplicates ? "Duplicate topic IDs are not allowed." : "",
            foreign.length > 0 ? "Some topics do not belong to this library." : "",
            missing.length > 0 ? "Some library topics are missing from the order." : "",
          ].filter(Boolean),
        },
      },
    )
  }

  await db.transaction(async (tx) => {
    for (let index = 0; index < ordered.length; index += 1) {
      await tx
        .update(topics)
        .set({ position: index, updatedAt: new Date() })
        .where(and(eq(topics.id, ordered[index]!), eq(topics.ownerId, ownerId)))
    }
  })
  return listTopics(db, ownerId, {})
}

export async function listQuestions(
  db: DbExecutor,
  ownerId: string,
  topicId: string,
): Promise<QuestionListItem[]> {
  await assertOwnedTopic(db, ownerId, topicId)
  // Join + groupBy (same shape as the proven topic questionCount query):
  // counts visible recordings per question in one pass.
  const rows = await db
    .select({
      id: questions.id,
      prompt: questions.prompt,
      position: questions.position,
      draftedAt: questions.draftedAt,
      createdAt: questions.createdAt,
      updatedAt: questions.updatedAt,
      recordingCount: sql<number>`count(${recordings.id})::int`,
    })
    .from(questions)
    .leftJoin(
      recordings,
      and(
        eq(recordings.questionId, questions.id),
        sql`${recordings.status} not in ('DELETE_PENDING', 'DELETED', 'EXPIRED')`,
      ),
    )
    .where(and(eq(questions.topicId, topicId), isNull(questions.deletedAt)))
    .groupBy(questions.id)
    .orderBy(asc(questions.position), asc(questions.createdAt))
  return rows.map((row) => ({
    id: row.id,
    prompt: row.prompt,
    position: row.position,
    recordingCount: row.recordingCount,
    draftedAt: row.draftedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
}

export async function createQuestion(
  db: Db,
  ownerId: string,
  topicId: string,
  input: QuestionCreateInput,
): Promise<QuestionListItem> {
  await assertOwnedTopic(db, ownerId, topicId)
  const [row] = await db
    .insert(questions)
    .values({
      topicId,
      prompt: input.prompt,
      // Explicit position wins; otherwise append after the current max.
      position: input.position ?? (await nextPosition(db, topicId)),
    })
    .returning()
  if (!row) throw new Error("question insert returned no row")
  return toQuestionView(row)
}

export async function updateQuestion(
  db: Db,
  ownerId: string,
  questionId: string,
  input: QuestionUpdateInput,
): Promise<QuestionListItem> {
  const existing = await loadOwnedQuestion(db, ownerId, questionId)
  if (input.position !== undefined && input.position !== existing.position) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Question position is managed by the reorder endpoint; supply only the prompt here.",
      { fieldErrors: { position: ["Use the topic reorder endpoint to move questions."] } },
    )
  }
  const [row] = await db
    .update(questions)
    .set({ prompt: input.prompt ?? existing.prompt, updatedAt: new Date() })
    .where(and(eq(questions.id, questionId), eq(questions.topicId, existing.topicId)))
    .returning()
  if (!row) throw new Error("question update returned no row")
  return { ...toQuestionView(row), recordingCount: await visibleRecordingCount(db, questionId) }
}

export async function deleteQuestion(db: Db, ownerId: string, questionId: string): Promise<void> {
  const existing = await loadOwnedQuestion(db, ownerId, questionId)
  await db.transaction(async (tx) => {
    await tx
      .update(questions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(questions.id, questionId), isNull(questions.deletedAt)))
    // Close the gap so positions stay dense and stable.
    await tx
      .update(questions)
      .set({ position: sql`${questions.position} - 1` })
      .where(
        and(
          eq(questions.topicId, existing.topicId),
          isNull(questions.deletedAt),
          sql`${questions.position} > ${existing.position}`,
        ),
      )
  })
}

export async function reorderQuestions(
  db: Db,
  ownerId: string,
  topicId: string,
  orderedQuestionIds: string[],
): Promise<QuestionListItem[]> {
  await assertOwnedTopic(db, ownerId, topicId)
  const current = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.topicId, topicId), isNull(questions.deletedAt)))
  const currentIds = new Set(current.map((row) => row.id))
  const ordered = [...new Set(orderedQuestionIds)]

  const duplicates = orderedQuestionIds.length !== new Set(orderedQuestionIds).size
  const missing = [...currentIds].filter((id) => !ordered.includes(id))
  const foreign = ordered.filter((id) => !currentIds.has(id))
  if (duplicates || missing.length > 0 || foreign.length > 0) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Question order must list every topic question exactly once.",
      {
        fieldErrors: {
          questionIds: [
            duplicates ? "Duplicate question IDs are not allowed." : "",
            foreign.length > 0 ? "Some questions do not belong to this topic." : "",
            missing.length > 0 ? "Some topic questions are missing from the order." : "",
          ].filter(Boolean),
        },
      },
    )
  }

  await db.transaction(async (tx) => {
    for (let index = 0; index < ordered.length; index += 1) {
      await tx
        .update(questions)
        .set({ position: index, updatedAt: new Date() })
        .where(and(eq(questions.id, ordered[index]!), eq(questions.topicId, topicId)))
    }
  })
  return listQuestions(db, ownerId, topicId)
}

async function assertOwnedTopic(db: DbExecutor, ownerId: string, topicId: string): Promise<void> {
  const [row] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.ownerId, ownerId), isNull(topics.deletedAt)))
    .limit(1)
  if (!row) {
    throw new AppError("RESOURCE_NOT_FOUND", "Topic not found.")
  }
}

async function assertOwnedTags(
  db: DbExecutor,
  ownerId: string,
  tagIds: string[],
): Promise<string[]> {
  if (tagIds.length === 0) return []
  const unique = [...new Set(tagIds)]
  const rows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.ownerId, ownerId), inArray(tags.id, unique)))
  if (rows.length !== unique.length) {
    // Foreign or missing tags are indistinguishable by contract: not found.
    throw new AppError("RESOURCE_NOT_FOUND", "One or more tags were not found.")
  }
  return rows.map((row) => row.id)
}

/** Marks or clears the per-question "drafted" checkbox. */
export async function setQuestionDrafted(
  db: Db,
  ownerId: string,
  questionId: string,
  drafted: boolean,
): Promise<QuestionListItem> {
  const question = await loadOwnedQuestion(db, ownerId, questionId)
  const [row] = await db
    .update(questions)
    .set({ draftedAt: drafted ? new Date() : null, updatedAt: new Date() })
    .where(eq(questions.id, question.id))
    .returning()
  return { ...toQuestionView(row!), recordingCount: await visibleRecordingCount(db, questionId) }
}

async function loadOwnedQuestion(
  db: DbExecutor,
  ownerId: string,
  questionId: string,
): Promise<Question> {
  const [row] = await db
    .select({ question: questions })
    .from(questions)
    .innerJoin(topics, eq(topics.id, questions.topicId))
    .where(
      and(
        eq(questions.id, questionId),
        eq(topics.ownerId, ownerId),
        isNull(questions.deletedAt),
        isNull(topics.deletedAt),
      ),
    )
    .limit(1)
  if (!row) {
    throw new AppError("RESOURCE_NOT_FOUND", "Question not found.")
  }
  return row.question
}

async function nextPosition(db: DbExecutor, topicId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${questions.position})` })
    .from(questions)
    .where(and(eq(questions.topicId, topicId), isNull(questions.deletedAt)))
  return (row?.max ?? -1) + 1
}

async function nextTopicPosition(db: DbExecutor, ownerId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${topics.position})` })
    .from(topics)
    .where(and(eq(topics.ownerId, ownerId), isNull(topics.deletedAt)))
  return (row?.max ?? -1) + 1
}
function toQuestionView(row: Question): QuestionListItem {
  // Bare-row view: correct for freshly created questions (no recordings
  // yet); update/draft paths override the count with the live value.
  return {
    id: row.id,
    prompt: row.prompt,
    position: row.position,
    recordingCount: 0,
    draftedAt: row.draftedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Non-hidden recordings for one question; update/draft-toggle responses
 * carry the live count so client-side replacements stay accurate.
 */
async function visibleRecordingCount(db: DbExecutor, questionId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recordings)
    .where(
      and(
        eq(recordings.questionId, questionId),
        sql`${recordings.status} not in ('DELETE_PENDING', 'DELETED', 'EXPIRED')`,
      ),
    )
  return row?.count ?? 0
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}
