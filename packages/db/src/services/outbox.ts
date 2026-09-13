import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm"
import { RecordingJobSchema, type JobName, type OutboxPayload } from "@speaking-track/contracts"
import type { Db, DbExecutor } from "../client"
import { outboxEvents, type OutboxEvent } from "../schema"

/**
 * Durable outbox bridging PostgreSQL and Redis (plan/02 § outboxEvents and
 * plan/01 consistency rules).
 *
 * A domain transaction changes state and inserts an outbox row. A dispatcher
 * claims due rows with `FOR UPDATE SKIP LOCKED`, publishes through an
 * injected producer using deterministic BullMQ job IDs, and marks the row
 * published. Duplicate dispatch is safe because job IDs and workers are
 * idempotent.
 */

/** Publisher injected by the caller; concrete producers live in @speaking-track/queue. */
export type OutboxPublishFn = (event: OutboxEvent) => Promise<void>

/** Inserts an outbox intent. Call inside the same transaction as the state change. */
export async function insertOutboxEvent(
  db: DbExecutor,
  event: {
    type: JobName
    aggregateId: string
    payload: OutboxPayload
    availableAt?: Date
  },
): Promise<OutboxEvent> {
  if (event.type === "outbox.dispatch") {
    throw new Error(
      "outbox.dispatch is the dispatcher maintenance job; it is never an outbox intent",
    )
  }
  const payload = RecordingJobSchema.safeParse(event.payload)
  if (!payload.success) {
    throw new Error(`outbox payload for ${event.type} must be a RecordingJob`)
  }
  const inserted = await db
    .insert(outboxEvents)
    .values({
      type: event.type,
      aggregateId: event.aggregateId,
      payload: payload.data,
      availableAt: event.availableAt ?? new Date(),
    })
    .returning()
  const row = inserted[0]
  if (!row) {
    throw new Error("outbox insert returned no row")
  }
  return row
}

export async function countPendingOutboxEvents(db: DbExecutor): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outboxEvents)
    .where(isNull(outboxEvents.publishedAt))
  return row?.count ?? 0
}

/**
 * Claims up to `limit` due, unpublished events using
 * `FOR UPDATE SKIP LOCKED`, so concurrent dispatchers never block each other
 * or double-claim. Claiming increments `attempts` and commits before any
 * publish I/O: a crash between claim and publish leaves the row claimable
 * again, and the deterministic job ID absorbs the duplicate publish.
 */
async function claimDueEvents(db: Db, limit: number): Promise<OutboxEvent[]> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .select()
      .from(outboxEvents)
      .where(and(isNull(outboxEvents.publishedAt), lte(outboxEvents.availableAt, new Date())))
      .orderBy(asc(outboxEvents.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true })

    if (claimed.length === 0) {
      return []
    }
    await tx
      .update(outboxEvents)
      .set({ attempts: sql`${outboxEvents.attempts} + 1` })
      .where(
        inArray(
          outboxEvents.id,
          claimed.map((event) => event.id),
        ),
      )
    return claimed
  })
}

export type OutboxDispatchResult = {
  claimed: number
  published: number
  failed: number
  errors: { eventId: string; message: string }[]
}

/**
 * Dispatches pending outbox events through the injected publisher.
 *
 * For each claimed event: publish, then mark `publishedAt`; on failure,
 * record `lastError` and leave the row unpublished for a later attempt.
 * Invoked by the worker's `outbox.dispatch` maintenance job:
 *
 * ```ts
 * const result = await dispatchPendingOutboxEvents(db, {
 *   publish: createOutboxEventPublisher(producer),
 * })
 * ```
 */
export async function dispatchPendingOutboxEvents(
  db: Db,
  options: { publish: OutboxPublishFn; limit?: number },
): Promise<OutboxDispatchResult> {
  const limit = options.limit ?? 100
  const events = await claimDueEvents(db, limit)
  const result: OutboxDispatchResult = {
    claimed: events.length,
    published: 0,
    failed: 0,
    errors: [],
  }

  for (const event of events) {
    try {
      await options.publish(event)
      await db
        .update(outboxEvents)
        .set({ publishedAt: new Date(), lastError: null })
        .where(eq(outboxEvents.id, event.id))
      result.published += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.failed += 1
      result.errors.push({ eventId: event.id, message })
      await db
        .update(outboxEvents)
        .set({ lastError: message.slice(0, 2000) })
        .where(eq(outboxEvents.id, event.id))
    }
  }
  return result
}
