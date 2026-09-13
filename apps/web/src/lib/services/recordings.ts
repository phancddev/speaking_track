import "server-only"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import {
  AppError,
  createRecordingUploadRequestSchema,
  type RecordingState,
  type SupportedRecordingMimeType,
} from "@speaking-track/contracts"
import {
  checkStagingCapacity,
  confirmStagedRecordingTx,
  insertRecording,
  insertOutboxEvent,
  transitionRecordingStatus,
  type Db,
  type DbTx,
} from "@speaking-track/db"
import { questions, recordings, topics, type Recording } from "@speaking-track/db"
import type { StorageClient } from "@speaking-track/storage"

/**
 * Recording application services (plan/02 § Recordings, task 05).
 *
 * Lifecycle: create-upload (STAGING + presigned PUT) → browser PUTs directly
 * to storage → complete verifies metadata and atomically claims QUEUED with
 * a youtube.upload outbox row → worker owns it from there.
 */

export type RecordingLimits = {
  maxRecordingBytes: number
  maxStagingBytes: number
  maxDurationMs: number
}

export type RecordingView = {
  id: string
  questionId: string
  status: RecordingState
  mimeType: SupportedRecordingMimeType
  sizeBytes: number
  durationMs: number
  youtubeVideoId: string | null
  youtubePrivacyStatus: string | null
  failureCode: string | null
  failureMessage: string | null
  attemptCount: number
  embeddable: boolean
  retryable: boolean
  createdAt: string
  updatedAt: string
}

function toRecordingView(row: Recording): RecordingView {
  const retryable =
    row.status === "FAILED" &&
    row.failureCode !== "YOUTUBE_UPLOAD_AMBIGUOUS" &&
    row.storageKey !== null
  return {
    id: row.id,
    questionId: row.questionId,
    status: row.status,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    durationMs: row.durationMs,
    youtubeVideoId: row.youtubeVideoId,
    youtubePrivacyStatus: row.youtubePrivacyStatus,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    attemptCount: row.attemptCount,
    // Embeddable only when READY: YouTube processed AND effective unlisted.
    embeddable: row.status === "READY" && row.youtubePrivacyStatus === "unlisted",
    retryable,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export type CreateUploadResult = {
  recording: RecordingView
  upload: {
    objectKey: string
    url: string
    method: "PUT"
    headers: Record<string, string>
    expiresAt: string
  }
}

export async function createRecordingUpload(
  db: Db,
  storage: StorageClient,
  limits: RecordingLimits,
  input: {
    ownerId: string
    questionId: string
    mimeType: SupportedRecordingMimeType
    sizeBytes: number
    durationMs: number
  },
): Promise<CreateUploadResult> {
  const parsed = createRecordingUploadRequestSchema({
    maxRecordingBytes: limits.maxRecordingBytes,
    maxDurationMs: limits.maxDurationMs,
  }).safeParse({
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    durationMs: input.durationMs,
  })
  if (!parsed.success) {
    const oversize = parsed.error.issues.some((issue) => issue.message.includes("size limit"))
    throw new AppError(
      oversize ? "RECORDING_TOO_LARGE" : "UNSUPPORTED_MEDIA_TYPE",
      oversize
        ? "The recording exceeds the configured size limit."
        : "The recording media type or duration is not supported.",
    )
  }
  const request = parsed.data

  // Ownership check in SQL (join topics) happens inside insertRecording.
  const capacity = await checkStagingCapacity(db, {
    incomingBytes: request.sizeBytes,
    maxStagingBytes: limits.maxStagingBytes,
  })
  if (!capacity.ok) {
    throw new AppError(
      "STORAGE_CAPACITY_LOW",
      "Staging storage is near capacity. Retry after pending uploads are processed.",
    )
  }

  const created = await insertRecording(db, {
    questionId: input.questionId,
    ownerId: input.ownerId,
    mimeType: request.mimeType,
    sizeBytes: request.sizeBytes,
    durationMs: request.durationMs,
    storageKey: "pending",
  })
  if (!created.ok) {
    throw new AppError("RESOURCE_NOT_FOUND", "Question not found.")
  }
  const recording = created.recording

  const upload = await storage.createPresignedUpload({
    ownerId: input.ownerId,
    recordingId: recording.id,
    mimeType: request.mimeType,
    sizeBytes: request.sizeBytes,
  })
  await db
    .update(recordings)
    .set({ storageKey: upload.objectKey })
    .where(eq(recordings.id, recording.id))

  return { recording: toRecordingView({ ...recording, storageKey: upload.objectKey }), upload }
}

export type CompleteResult = { recording: RecordingView; alreadyQueued: boolean }

export async function completeRecordingUpload(
  db: Db,
  storage: StorageClient,
  input: { ownerId: string; recordingId: string },
): Promise<CompleteResult> {
  const recording = await loadOwnedRecording(db, input.ownerId, input.recordingId)

  // Idempotent: after QUEUED (or later), return current state without a new
  // outbox intent.
  if (recording.status !== "STAGING") {
    if (
      recording.status === "DELETE_PENDING" ||
      recording.status === "DELETED" ||
      recording.status === "EXPIRED"
    ) {
      throw new AppError("INVALID_RECORDING_STATE", "This upload can no longer be completed.")
    }
    return { recording: toRecordingView(recording), alreadyQueued: true }
  }

  if (!recording.storageKey) {
    throw new AppError("UPLOAD_NOT_FOUND", "The staged object is missing.")
  }
  const stat = await storage.statPrivateObject(recording.storageKey).catch(() => null)
  if (!stat) {
    throw new AppError(
      "UPLOAD_NOT_FOUND",
      "The uploaded object was not found. Upload again before completing.",
    )
  }
  if (stat.sizeBytes !== Number(recording.sizeBytes) || stat.contentType !== recording.mimeType) {
    throw new AppError(
      "UPLOAD_METADATA_MISMATCH",
      "The uploaded object does not match the declared size or media type.",
    )
  }

  const result = await db.transaction(async (tx) => confirmStagedRecordingTx(tx, recording.id))
  if (!result.ok) {
    throw new AppError(
      result.code === "RESOURCE_NOT_FOUND" ? "UPLOAD_NOT_FOUND" : result.code,
      "The upload could not be completed; it may already be queued.",
    )
  }
  return { recording: toRecordingView(result.recording), alreadyQueued: false }
}

export async function retryRecording(
  db: Db,
  input: { ownerId: string; recordingId: string },
): Promise<RecordingView> {
  const recording = await loadOwnedRecording(db, input.ownerId, input.recordingId)
  if (recording.status !== "FAILED") {
    throw new AppError("INVALID_RECORDING_STATE", "Only failed recordings can be retried.")
  }
  if (recording.failureCode === "YOUTUBE_UPLOAD_AMBIGUOUS") {
    // Fail closed: an ambiguous provider outcome must never trigger a
    // second insert (plan/02 state machine).
    throw new AppError(
      "YOUTUBE_UPLOAD_AMBIGUOUS",
      "This recording cannot be retried automatically because the previous upload outcome is unknown.",
    )
  }
  if (!recording.storageKey) {
    throw new AppError("UPLOAD_NOT_FOUND", "The source recording is no longer available.")
  }

  return db.transaction(async (tx) => {
    // A recording with a video ID resumes status handling instead of a new
    // insert; otherwise queue a fresh upload.
    let row: Recording | undefined
    if (recording.youtubeVideoId) {
      // A video already exists: resume status handling (polling), never a
      // second insert. The worker's upload handler will detect the video ID
      // and redirect to polling, so re-entering through QUEUED is the
      // contract's resumption path.
      const resumed = await transitionRecordingStatus(tx, {
        recordingId: recording.id,
        expected: "FAILED",
        next: "QUEUED",
      })
      if (!resumed.ok) throw new AppError(resumed.code, "Retry failed.")
      row = resumed.recording
      await insertOutboxEvent(tx, {
        type: "youtube.poll-processing",
        aggregateId: recording.id,
        payload: { recordingId: recording.id },
      })
    } else {
      const requeued = await transitionRecordingStatus(tx, {
        recordingId: recording.id,
        expected: "FAILED",
        next: "QUEUED",
      })
      if (!requeued.ok) throw new AppError(requeued.code, "Retry failed.")
      row = requeued.recording
      await insertOutboxEvent(tx, {
        type: "youtube.upload",
        aggregateId: recording.id,
        payload: { recordingId: recording.id },
      })
    }
    return toRecordingView(row)
  })
}

export async function deleteRecording(
  db: Db,
  input: { ownerId: string; recordingId: string },
): Promise<{ deleted: true }> {
  const recording = await loadOwnedRecording(db, input.ownerId, input.recordingId)
  if (recording.status === "DELETED" || recording.status === "DELETE_PENDING") {
    return { deleted: true }
  }

  await db.transaction(async (tx) => {
    const hidden = await transitionRecordingStatus(tx, {
      recordingId: recording.id,
      expected: recording.status,
      next: "DELETE_PENDING",
    })
    if (!hidden.ok) throw new AppError(hidden.code, "Delete failed; retry.")

    // YouTube deletion intent when a remote video exists.
    if (recording.youtubeVideoId) {
      await insertOutboxEvent(tx, {
        type: "youtube.delete",
        aggregateId: recording.id,
        payload: { recordingId: recording.id },
      })
    }
    // Storage cleanup intent when a staged source exists.
    if (recording.storageKey) {
      await insertOutboxEvent(tx, {
        type: "storage.cleanup",
        aggregateId: recording.id,
        payload: { recordingId: recording.id },
      })
    }
  })
  return { deleted: true }
}

export async function listRecordingsForQuestion(
  db: Db,
  input: { ownerId: string; questionId: string },
): Promise<RecordingView[]> {
  const [question] = await db
    .select({ id: questions.id })
    .from(questions)
    .innerJoin(topics, eq(topics.id, questions.topicId))
    .where(
      and(
        eq(questions.id, input.questionId),
        eq(topics.ownerId, input.ownerId),
        isNull(questions.deletedAt),
        isNull(topics.deletedAt),
      ),
    )
    .limit(1)
  if (!question) {
    throw new AppError("RESOURCE_NOT_FOUND", "Question not found.")
  }
  const rows = await db
    .select()
    .from(recordings)
    .where(and(eq(recordings.questionId, input.questionId), eq(recordings.ownerId, input.ownerId)))
    .orderBy(desc(recordings.createdAt))
  return rows
    .filter((row) => row.status !== "DELETED" && row.status !== "DELETE_PENDING")
    .map(toRecordingView)
}

export async function expireAbandonedStaging(
  db: Db,
  input: { retentionHours: number },
): Promise<{ expired: number }> {
  const cutoff = new Date(Date.now() - input.retentionHours * 60 * 60 * 1000)
  const rows = await db
    .select({ id: recordings.id, storageKey: recordings.storageKey })
    .from(recordings)
    .where(
      and(
        eq(recordings.status, "STAGING"),
        sql`${recordings.createdAt} < ${cutoff.toISOString()}::timestamptz`,
      ),
    )
  let expired = 0
  for (const row of rows) {
    const result = await transitionRecordingStatus(db, {
      recordingId: row.id,
      expected: "STAGING",
      next: "EXPIRED",
      patch: { storageKey: null },
    })
    if (result.ok) {
      expired += 1
      if (row.storageKey) {
        await db.transaction(async (tx) => {
          await insertOutboxEvent(tx, {
            type: "storage.cleanup",
            aggregateId: row.id,
            payload: { recordingId: row.id },
          })
        })
      }
    }
  }
  return { expired }
}

export async function loadOwnedRecording(
  db: Db | DbTx,
  ownerId: string,
  recordingId: string,
): Promise<Recording> {
  const [row] = await db
    .select()
    .from(recordings)
    .where(and(eq(recordings.id, recordingId), eq(recordings.ownerId, ownerId)))
    .limit(1)
  if (!row) {
    // Foreign or missing recordings are indistinguishable.
    throw new AppError("RESOURCE_NOT_FOUND", "Recording not found.")
  }
  return row
}

export { toRecordingView }
export type { StorageClient }
