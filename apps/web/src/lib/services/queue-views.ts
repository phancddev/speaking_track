import "server-only"
import { and, desc, eq, sql } from "drizzle-orm"
import type { RecordingState } from "@speaking-track/contracts"
import { questions, recordings, user as userTable, type Db } from "@speaking-track/db"

/**
 * Safe aggregate queue views for the admin console (task 06/task 08):
 * counts come from the DATABASE recording states — the domain source of
 * truth — with recent actionable failures joined to real owner/question
 * labels. No BullMQ payload internals, tokens, session URIs, or provider
 * bodies are ever exposed.
 */

export type QueueSummary = {
  countsByState: Record<RecordingState, number>
  total: number
}

const ALL_STATES: RecordingState[] = [
  "STAGING",
  "QUEUED",
  "YOUTUBE_UPLOADING",
  "YOUTUBE_PROCESSING",
  "READY",
  "FAILED",
  "EXPIRED",
  "DELETE_PENDING",
  "DELETED",
]

export async function getQueueSummary(db: Db): Promise<QueueSummary> {
  const rows = await db
    .select({ status: recordings.status, count: sql<number>`count(*)::int` })
    .from(recordings)
    .groupBy(recordings.status)
  const countsByState = Object.fromEntries(ALL_STATES.map((state) => [state, 0])) as Record<
    RecordingState,
    number
  >
  let total = 0
  for (const row of rows) {
    countsByState[row.status] = row.count
    total += row.count
  }
  return { countsByState, total }
}

export type QueueFailureRow = {
  recordingId: string
  ownerId: string
  ownerEmail: string | null
  questionId: string
  questionPrompt: string | null
  status: RecordingState
  failureCode: string | null
  failureMessage: string | null
  attemptCount: number
  updatedAt: string
}

export async function getRecentFailures(db: Db, limit = 20): Promise<QueueFailureRow[]> {
  const rows = await db
    .select({
      recordingId: recordings.id,
      ownerId: recordings.ownerId,
      ownerEmail: userTable.email,
      questionId: recordings.questionId,
      questionPrompt: questions.prompt,
      status: recordings.status,
      failureCode: recordings.failureCode,
      failureMessage: recordings.failureMessage,
      attemptCount: recordings.attemptCount,
      updatedAt: recordings.updatedAt,
    })
    .from(recordings)
    .leftJoin(userTable, eq(userTable.id, recordings.ownerId))
    .leftJoin(questions, eq(questions.id, recordings.questionId))
    .where(and(eq(recordings.status, "FAILED"), sql`${recordings.failureCode} is not null`))
    .orderBy(desc(recordings.updatedAt))
    .limit(limit)

  return rows.map((row) => ({
    recordingId: row.recordingId,
    ownerId: row.ownerId,
    ownerEmail: row.ownerEmail,
    questionId: row.questionId,
    questionPrompt: row.questionPrompt,
    status: row.status,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    attemptCount: row.attemptCount,
    updatedAt: row.updatedAt.toISOString(),
  }))
}
