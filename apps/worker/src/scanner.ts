import { and, eq, isNull, lte, or, sql } from "drizzle-orm"
import { insertOutboxEvent, outboxEvents, recordings } from "@speaking-track/db"
import type { Db } from "@speaking-track/db"

/**
 * Independent YouTube upload scanner (deferred-upload model):
 *
 * - Recordings complete into QUEUED and stay in object storage; nothing
 *   forces an immediate upload.
 * - The scanner periodically finds QUEUED recordings whose upload is not
 *   deferred (quota backoff) and without a pending `youtube.upload` outbox
 *   intent, then emits exactly one intent per recording.
 * - On quota exhaustion the processor returns the recording to QUEUED with
 *   `uploadDeferredUntil` set past the next midnight Pacific reset; the
 *   scanner simply skips those rows until then.
 */

export function startUploadScanner(
  db: Db,
  intervalSeconds: number,
  log: (event: string, fields?: Record<string, unknown>) => void,
): { stop(): void } {
  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    void scanOnce(db, log).finally(() => {
      running = false
    })
  }, intervalSeconds * 1000)
  // Do not hold the event loop open on shutdown.
  timer.unref()

  return {
    stop() {
      clearInterval(timer)
    },
  }
}

export async function scanOnce(
  db: Db,
  log: (event: string, fields?: Record<string, unknown>) => void,
): Promise<number> {
  const pending = db.$with("pending_upload").as(
    db
      .select({ aggregateId: outboxEvents.aggregateId })
      .from(outboxEvents)
      .where(
        and(eq(outboxEvents.type, "youtube.upload" as never), isNull(outboxEvents.publishedAt)),
      ),
  )

  const due = await db
    .with(pending)
    .select({ id: recordings.id })
    .from(recordings)
    .where(
      and(
        eq(recordings.status, "QUEUED"),
        sql`${recordings.storageKey} is not null`,
        sql`${recordings.youtubeVideoId} is null`,
        or(isNull(recordings.uploadDeferredUntil), lte(recordings.uploadDeferredUntil, new Date())),
        sql`not exists (select 1 from ${pending} where ${pending.aggregateId} = ${recordings.id})`,
      ),
    )
    .limit(100)

  if (due.length === 0) return 0

  await db.transaction(async (tx) => {
    for (const row of due) {
      await insertOutboxEvent(tx, {
        type: "youtube.upload",
        aggregateId: row.id,
        payload: { recordingId: row.id },
      })
    }
  })
  log("scanner-enqueued-uploads", { count: due.length })
  return due.length
}
