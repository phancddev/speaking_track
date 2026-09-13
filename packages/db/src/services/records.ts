import { and, eq, sql } from "drizzle-orm"
import type { SupportedRecordingMimeType } from "@speaking-track/contracts"
import type { DbExecutor } from "../client"
import {
  drafts,
  questions,
  recordings,
  tags,
  topics,
  topicTags,
  type Draft,
  type Recording,
} from "../schema"

/**
 * Owner-invariant repository primitives shared by the feature services.
 *
 * Each write enforces the ownership invariant from plan/02 in a single
 * atomic statement (INSERT ... SELECT with a matching-owner predicate), so
 * there is no read-then-write window in which a mismatched owner can be
 * persisted.
 */

export type OwnershipFailure = { ok: false; reason: "question_not_found" | "owner_mismatch" }

export type CreateRecordingInput = {
  questionId: string
  /** Must equal the owning topic's owner; enforced atomically below. */
  ownerId: string
  mimeType: SupportedRecordingMimeType
  sizeBytes: number
  durationMs: number
  storageKey: string
  expiresAt?: Date | null
}

export type CreateRecordingResult = { ok: true; recording: Recording } | OwnershipFailure

/**
 * Creates a STAGING recording row whose `ownerId` is guaranteed to equal the
 * owning topic's owner: the INSERT only fires when the joined topic owner
 * matches. The client cannot influence the owner through this path.
 */
export async function insertRecording(
  db: DbExecutor,
  input: CreateRecordingInput,
): Promise<CreateRecordingResult> {
  const inserted = await db.execute(sql`
    insert into recordings (question_id, owner_id, status, storage_key, mime_type, size_bytes, duration_ms, staged_at, expires_at)
    select q.id, t.owner_id, 'STAGING', ${input.storageKey}, ${input.mimeType}, ${input.sizeBytes}, ${input.durationMs}, now(), ${input.expiresAt ?? null}
    from questions q
    join topics t on t.id = q.topic_id
    where q.id = ${input.questionId}
      and q.deleted_at is null
      and t.deleted_at is null
      and t.owner_id = ${input.ownerId}
    returning id
  `)

  const rows = inserted as unknown as { id: string }[]
  const row = rows[0]
  if (row) {
    const [recording] = await db.select().from(recordings).where(eq(recordings.id, row.id)).limit(1)
    if (recording) {
      return { ok: true, recording }
    }
  }
  return { ok: false, reason: await classifyRecordingFailure(db, input) }
}

async function classifyRecordingFailure(
  db: DbExecutor,
  input: { questionId: string; ownerId: string },
): Promise<"question_not_found" | "owner_mismatch"> {
  const found = await db.execute(sql`
    select t.owner_id as owner_id
    from questions q
    join topics t on t.id = q.topic_id
    where q.id = ${input.questionId} and q.deleted_at is null and t.deleted_at is null
  `)
  const foundRows = found as unknown as { owner_id: string }[]
  const row = foundRows[0]
  if (!row) {
    return "question_not_found"
  }
  return row.owner_id === input.ownerId ? "question_not_found" : "owner_mismatch"
}

export type AttachTagResult =
  | { ok: true; inserted: boolean }
  | { ok: false; reason: "topic_not_found" | "tag_not_found" | "owner_mismatch" }

/**
 * Links a tag to a topic only when topic and tag belong to the same owner
 * (plan/02 § topicTags). Idempotent: re-attaching an existing link reports
 * `inserted: false` instead of failing.
 */
export async function attachTagToTopic(
  db: DbExecutor,
  input: { topicId: string; tagId: string },
): Promise<AttachTagResult> {
  const inserted = await db.execute(sql`
    insert into topic_tags (topic_id, tag_id)
    select t.id, g.id
    from topics t
    join tags g on g.id = ${input.tagId}
    where t.id = ${input.topicId}
      and t.deleted_at is null
      and t.owner_id = g.owner_id
    on conflict do nothing
    returning topic_id
  `)
  if ((inserted as unknown as unknown[]).length > 0) {
    return { ok: true, inserted: true }
  }

  const existing = await db
    .select({ topicId: topicTags.topicId })
    .from(topicTags)
    .where(and(eq(topicTags.topicId, input.topicId), eq(topicTags.tagId, input.tagId)))
    .limit(1)
  if (existing.length > 0) {
    return { ok: true, inserted: false }
  }
  return { ok: false, reason: await classifyAttachFailure(db, input) }
}

async function classifyAttachFailure(
  db: DbExecutor,
  input: { topicId: string; tagId: string },
): Promise<"topic_not_found" | "tag_not_found" | "owner_mismatch"> {
  const [topic] = await db
    .select({ ownerId: topics.ownerId })
    .from(topics)
    .where(and(eq(topics.id, input.topicId), sql`${topics.deletedAt} is null`))
    .limit(1)
  if (!topic) {
    return "topic_not_found"
  }
  const [tag] = await db
    .select({ ownerId: tags.ownerId })
    .from(tags)
    .where(eq(tags.id, input.tagId))
    .limit(1)
  if (!tag) {
    return "tag_not_found"
  }
  return topic.ownerId === tag.ownerId ? "topic_not_found" : "owner_mismatch"
}

export type UpsertDraftResult =
  { ok: true; draft: Draft } | { ok: false; reason: "question_not_found" }

/**
 * Upserts the one draft belonging to a question (PK = questionId). Empty
 * content is valid. A missing question is reported instead of surfacing a
 * raw FK violation.
 */
export async function upsertDraft(
  db: DbExecutor,
  input: { questionId: string; content: string },
): Promise<UpsertDraftResult> {
  const [question] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.id, input.questionId), sql`${questions.deletedAt} is null`))
    .limit(1)
  if (!question) {
    return { ok: false, reason: "question_not_found" }
  }
  const upserted = await db
    .insert(drafts)
    .values({ questionId: input.questionId, content: input.content, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: drafts.questionId,
      set: { content: input.content, updatedAt: new Date() },
    })
    .returning()
  const draft = upserted[0]
  if (!draft) {
    throw new Error("draft upsert returned no row")
  }
  return { ok: true, draft }
}
