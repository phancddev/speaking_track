import { and, eq, sql } from "drizzle-orm"
import {
  canTransitionRecording,
  type RecordingState,
  type YoutubePrivacyStatus,
} from "@speaking-track/contracts"
import type { Db, DbExecutor, DbTx } from "../client"
import { insertOutboxEvent } from "./outbox"
import { recordings, type Recording } from "../schema"

/**
 * Recording state machine service. Every transition is a compare-and-set
 * `UPDATE ... WHERE status = expected RETURNING`; an invalid or stale
 * transition returns INVALID_RECORDING_STATE with no side effects.
 *
 * `STAGING -> QUEUED` additionally creates the `youtube.upload` outbox row
 * in the same transaction, so the state change and the enqueue intent
 * commit or roll back together.
 */

/** Columns a transition may update alongside the status itself. */
export type RecordingTransitionPatch = {
  failureCode?: string | null
  failureMessage?: string | null
  youtubeVideoId?: string | null
  youtubePrivacyStatus?: YoutubePrivacyStatus | null
  youtubeUploadSessionUriEncrypted?: string | null
  attemptCount?: number
  uploadDeferredUntil?: Date | null
  storageKey?: string | null
  youtubeCreatedAt?: Date | null
  readyAt?: Date | null
  deletedAt?: Date | null
}

export type RecordingTransitionResult =
  | { ok: true; recording: Recording }
  | { ok: false; code: "RESOURCE_NOT_FOUND" | "INVALID_RECORDING_STATE" }

export async function getRecording(
  db: DbExecutor,
  recordingId: string,
): Promise<Recording | undefined> {
  const [row] = await db.select().from(recordings).where(eq(recordings.id, recordingId)).limit(1)
  return row
}

/** Distinguishes "row missing" from "row present but not in expected state". */
async function classifyTransitionFailure(
  db: DbExecutor,
  recordingId: string,
): Promise<"RESOURCE_NOT_FOUND" | "INVALID_RECORDING_STATE"> {
  const current = await getRecording(db, recordingId)
  return current ? "INVALID_RECORDING_STATE" : "RESOURCE_NOT_FOUND"
}

/**
 * Compare-and-set transition. Guards the transition table before touching
 * the database, so a structurally invalid transition performs no write and
 * never creates outbox rows.
 */
export async function transitionRecordingStatus(
  db: DbExecutor,
  input: {
    recordingId: string
    expected: RecordingState
    next: RecordingState
    patch?: RecordingTransitionPatch
  },
): Promise<RecordingTransitionResult> {
  if (!canTransitionRecording(input.expected, input.next)) {
    return { ok: false, code: "INVALID_RECORDING_STATE" }
  }
  const [row] = await db
    .update(recordings)
    .set({ status: input.next, ...(input.patch ?? {}) })
    .where(and(eq(recordings.id, input.recordingId), eq(recordings.status, input.expected)))
    .returning()

  if (row) {
    return { ok: true, recording: row }
  }
  return { ok: false, code: await classifyTransitionFailure(db, input.recordingId) }
}

/**
 * Transaction body for STAGING -> QUEUED: applies the compare-and-set and
 * inserts the `youtube.upload` outbox intent. Exported so callers compose
 * it inside a larger transaction (e.g. completion verification).
 */
export async function confirmStagedRecordingTx(
  tx: DbTx,
  recordingId: string,
): Promise<RecordingTransitionResult> {
  const [row] = await tx
    .update(recordings)
    .set({ status: "QUEUED" })
    .where(and(eq(recordings.id, recordingId), eq(recordings.status, "STAGING")))
    .returning()

  if (!row) {
    return { ok: false, code: await classifyTransitionFailure(tx, recordingId) }
  }
  await insertOutboxEvent(tx, {
    type: "youtube.upload",
    aggregateId: recordingId,
    payload: { recordingId },
  })
  return { ok: true, recording: row }
}

/**
 * Completion transition: object metadata was verified, so QUEUED is claimed
 * and the upload intent is recorded atomically. A stale call (already
 * QUEUED, terminal, or missing) is rejected with no outbox side effect;
 * idempotent completion at the API layer re-reads the row instead.
 */
export async function confirmStagedRecording(
  db: Db,
  recordingId: string,
): Promise<RecordingTransitionResult> {
  return db.transaction(async (tx) => confirmStagedRecordingTx(tx, recordingId))
}

/** Transitions an abandoned STAGING row to EXPIRED (retention elapsed). */
export async function expireStagedRecording(
  db: DbExecutor,
  recordingId: string,
): Promise<RecordingTransitionResult> {
  return transitionRecordingStatus(db, {
    recordingId,
    expected: "STAGING",
    next: "EXPIRED",
  })
}

/**
 * Marks a recording FAILED with a stable code and user-safe message.
 * `failureMessage` must never contain tokens or provider response bodies.
 */
export async function failRecording(
  db: DbExecutor,
  input: {
    recordingId: string
    expected: RecordingState
    failureCode: string
    failureMessage: string
    clearUploadSession?: boolean
  },
): Promise<RecordingTransitionResult> {
  return transitionRecordingStatus(db, {
    recordingId: input.recordingId,
    expected: input.expected,
    next: "FAILED",
    patch: {
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      ...(input.clearUploadSession ? { youtubeUploadSessionUriEncrypted: null } : {}),
    },
  })
}

/**
 * Worker takes ownership of an upload attempt: compare-and-set to
 * YOUTUBE_UPLOADING while bumping `attemptCount` in the same write.
 */
export async function beginUploadAttempt(
  db: DbExecutor,
  input: { recordingId: string; expected: RecordingState },
): Promise<RecordingTransitionResult> {
  const current = await getRecording(db, input.recordingId)
  if (!current) {
    return { ok: false, code: "RESOURCE_NOT_FOUND" }
  }
  return transitionRecordingStatus(db, {
    recordingId: input.recordingId,
    expected: input.expected,
    next: "YOUTUBE_UPLOADING",
    patch: { attemptCount: current.attemptCount + 1 },
  })
}

/** Recordings still counting against aggregate staging capacity. */
export const ACTIVE_STAGING_SQL = sql`status not in ('DELETED', 'EXPIRED') and storage_key is not null`
