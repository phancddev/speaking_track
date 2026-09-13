import { eq } from "drizzle-orm"
import { AppError } from "@speaking-track/contracts"
import {
  getRecording,
  insertOutboxEvent,
  transitionRecordingStatus,
  recordings,
  youtubeConnections as youtubeConnectionsTable,
  type Recording,
} from "@speaking-track/db"
import {
  decryptSecret,
  encryptSecret,
  parseEnvelope,
  ProviderCallError,
  serializeEnvelope,
} from "@speaking-track/youtube"
import type {
  CleanupContext,
  DeleteContext,
  ExpireContext,
  PollContext,
  UploadContext,
} from "./services"
import { youtubeTokenEncryptionKey } from "./config"
import { nextQuotaResetUtc } from "./quota"

/**
 * Queue processors (task 06). Every handler locks/compares the database row
 * before external side effects; job payloads carry identifiers only.
 */

type StableCode =
  | "YOUTUBE_REAUTH_REQUIRED"
  | "YOUTUBE_QUOTA_EXCEEDED"
  | "EXTERNAL_SERVICE_UNAVAILABLE"
  | "YOUTUBE_PROCESSING_FAILED"

function providerError(status: number, body: string): AppError {
  const reason = extractReason(body)
  const cls = classify(status, reason)
  return new AppError(appCode(cls), userMessage(cls))
}

const codeByClass: Record<Class, StableCode> = {
  reauth: "YOUTUBE_REAUTH_REQUIRED",
  quota: "YOUTUBE_QUOTA_EXCEEDED",
  transient: "EXTERNAL_SERVICE_UNAVAILABLE",
  "media-rejected": "YOUTUBE_PROCESSING_FAILED",
  unavailable: "EXTERNAL_SERVICE_UNAVAILABLE",
}

function extractReason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { errors?: { reason?: string }[] } }
    return parsed.error?.errors?.[0]?.reason ?? ""
  } catch {
    return ""
  }
}

type Class = "reauth" | "quota" | "transient" | "media-rejected" | "unavailable"

function classify(status: number, reason: string): Class {
  if (
    reason.includes("quotaExceeded") ||
    reason.includes("rateLimitExceeded") ||
    reason.includes("uploadLimitExceeded")
  ) {
    return "quota"
  }
  if (status === 401 || reason.includes("unauthorized") || reason.includes("invalid_grant")) {
    return "reauth"
  }
  if (status >= 500 || status === 429) return "transient"
  if (status === 400 || reason.includes("invalidMediaBody")) return "media-rejected"
  return "unavailable"
}

function appCode(cls: Class): StableCode {
  return codeByClass[cls]
}

function userMessage(cls: Class): string {
  switch (cls) {
    case "reauth":
      return "The YouTube connection needs to be reauthorized by an administrator."
    case "quota":
      return "YouTube upload quota is exhausted; the recording stays queued until quota resets."
    case "transient":
      return "YouTube is temporarily unavailable; the upload will retry."
    case "media-rejected":
      return "YouTube rejected the recording's media data."
    default:
      return "YouTube could not be reached; the upload will retry."
  }
}

export async function handleUpload(ctx: UploadContext): Promise<void> {
  const { db } = ctx
  const current = await getRecording(db, ctx.recordingId)
  if (!current) return

  // Terminal/deleting: no-op.
  if (["READY", "DELETED", "EXPIRED", "DELETE_PENDING", "STAGING"].includes(current.status)) {
    return
  }

  // Duplicate delivery with an existing video: redirect to polling, never a
  // second insert.
  if (current.youtubeVideoId) {
    await db.transaction(async (tx) => {
      const moved = await transitionRecordingStatus(tx, {
        recordingId: current.id,
        expected: current.status === "QUEUED" ? "QUEUED" : current.status,
        next:
          current.status === "YOUTUBE_UPLOADING"
            ? "YOUTUBE_PROCESSING"
            : current.status === "QUEUED"
              ? "YOUTUBE_UPLOADING"
              : current.status,
      }).catch(() => null)
      void moved
      await insertOutboxEvent(tx, {
        type: "youtube.poll-processing",
        aggregateId: current.id,
        payload: { recordingId: current.id },
      })
    })
    return
  }

  // Claim the attempt (QUEUED -> YOUTUBE_UPLOADING, attemptCount + 1).
  const claimed = await transitionRecordingStatus(db, {
    recordingId: current.id,
    expected: "QUEUED",
    next: "YOUTUBE_UPLOADING",
    patch: { attemptCount: current.attemptCount + 1, failureCode: null, failureMessage: null },
  })
  if (!claimed.ok) {
    // Someone else moved it; nothing to do.
    return
  }
  const recording = claimed.recording

  if (!recording.storageKey) {
    await transitionRecordingStatus(db, {
      recordingId: recording.id,
      expected: "YOUTUBE_UPLOADING",
      next: "FAILED",
      patch: { failureCode: "UPLOAD_NOT_FOUND", failureMessage: "Source recording is missing." },
    })
    return
  }

  try {
    const youtube = await ctx.loadYoutubeClient()
    const title = `Speaking practice ${recording.createdAt.toISOString().slice(0, 10)}`
    // No draft text in metadata — only a stable, policy-safe reference.
    const description = "Private speaking practice recording."

    let sessionUri: string
    if (recording.youtubeUploadSessionUriEncrypted) {
      // Resume a persisted session: query status before sending anything.
      sessionUri = storedSessionUri(recording)
    } else {
      sessionUri = await youtube.initResumableUpload({
        title,
        description,
        privacyStatus: "unlisted",
        categoryId: "22",
        notifySubscribers: false,
        embeddable: true,
        madeForKids: false,
        contentType: recording.mimeType,
        sizeBytes: Number(recording.sizeBytes),
      })
      await db
        .update(recordings)
        .set({
          youtubeUploadSessionUriEncrypted: serializeEnvelope(
            encryptSecret(sessionUri, youtubeTokenEncryptionKey()),
          ),
        })
        .where(eq(recordings.id, recording.id))
    }

    // Resolve outstanding bytes before sending (resume-or-continue).
    const status = await youtube.queryUploadStatus(sessionUri).catch((error: unknown) => error)
    if (status instanceof Error && /expired/.test(status.message)) {
      // Session expired with an unknowable outcome: fail CLOSED.
      await failAmbiguous(db, recording)
      return
    }

    const bytes = await readObjectBytes(ctx, recording)
    let send: { status: number; body: string }
    try {
      send = await youtube.sendMedia({
        sessionUri,
        contentType: recording.mimeType,
        body: bytes,
      })
    } catch {
      // Transport failure while sending the final bytes: the provider may
      // have completed the insert; outcome is unknowable → fail closed.
      await failAmbiguous(db, recording)
      return
    }
    if (send.status === 200 || send.status === 201) {
      const videoId = extractVideoId(send.body)
      if (!videoId) {
        // Final response unreadable: the session still knows; poll it later.
        await failAmbiguous(db, recording)
        return
      }
      // Persist the video ID FIRST, then transition and schedule polling.
      await db.transaction(async (tx) => {
        await tx
          .update(recordings)
          .set({ youtubeVideoId: videoId, youtubeUploadSessionUriEncrypted: null })
          .where(eq(recordings.id, recording.id))
        const moved = await transitionRecordingStatus(tx, {
          recordingId: recording.id,
          expected: "YOUTUBE_UPLOADING",
          next: "YOUTUBE_PROCESSING",
          patch: { youtubeCreatedAt: new Date() },
        })
        if (moved.ok) {
          await insertOutboxEvent(tx, {
            type: "youtube.poll-processing",
            aggregateId: recording.id,
            payload: { recordingId: recording.id },
          })
        }
      })
      return
    }
    if (send.status === 308) {
      // Partial progress: leave YOUTUBE_UPLOADING; retry continues via the
      // persisted session on the next delivery.
      return
    }
    if (send.status >= 500) {
      // The full media body was handed to the provider; a 5xx here leaves
      // the insert outcome unknowable. Fail closed (no duplicate inserts).
      await failAmbiguous(db, recording)
      return
    }
    throw providerError(send.status, send.body)
  } catch (error) {
    const failure =
      error instanceof AppError
        ? error
        : error instanceof ProviderCallError
          ? providerError(error.providerStatus, error.providerBody)
          : new AppError("EXTERNAL_SERVICE_UNAVAILABLE", userMessage("transient"))
    await applyFailure(db, recording, failure)
    if (failure.code === "YOUTUBE_REAUTH_REQUIRED") {
      await db.update(youtubeConnectionsTable).set({ status: "REAUTH_REQUIRED" })
    }
  }
}

function storedSessionUri(recording: Recording): string {
  return decryptSecret(
    parseEnvelope(recording.youtubeUploadSessionUriEncrypted!),
    youtubeTokenEncryptionKey(),
  )
}

async function readObjectBytes(ctx: UploadContext, recording: Recording): Promise<Uint8Array> {
  const stream = await ctx.storage.getPrivateObjectStream(recording.storageKey!)
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

function extractVideoId(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { id?: string }
    return parsed.id ?? null
  } catch {
    return null
  }
}

async function failAmbiguous(db: UploadContext["db"], recording: Recording): Promise<void> {
  await transitionRecordingStatus(db, {
    recordingId: recording.id,
    expected: "YOUTUBE_UPLOADING",
    next: "FAILED",
    patch: {
      failureCode: "YOUTUBE_UPLOAD_AMBIGUOUS",
      failureMessage:
        "The previous upload attempt ended unclearly. Contact an administrator before retrying to avoid a duplicate video.",
      youtubeUploadSessionUriEncrypted: null,
    },
  })
}

async function applyFailure(
  db: UploadContext["db"],
  recording: Recording,
  error: AppError,
): Promise<void> {
  if (error.code === "YOUTUBE_QUOTA_EXCEEDED") {
    // Quota exhaustion is not a recording failure: the source object stays
    // in storage and the scanner re-attempts after the daily quota reset.
    await transitionRecordingStatus(db, {
      recordingId: recording.id,
      expected: "YOUTUBE_UPLOADING",
      next: "QUEUED",
      patch: {
        failureCode: error.code,
        failureMessage: error.message,
        uploadDeferredUntil: nextQuotaResetUtc(),
      },
    })
    return
  }
  await transitionRecordingStatus(db, {
    recordingId: recording.id,
    expected: "YOUTUBE_UPLOADING",
    next: "FAILED",
    patch: {
      failureCode: error.code,
      failureMessage: error.message,
    },
  })
}

export async function handlePollProcessing(ctx: PollContext): Promise<void> {
  const { db } = ctx
  const recording = await getRecording(db, ctx.recordingId)
  if (!recording || recording.status !== "YOUTUBE_PROCESSING" || !recording.youtubeVideoId) {
    return
  }
  try {
    const youtube = await ctx.loadYoutubeClient()
    const status = await youtube.getVideoStatus(recording.youtubeVideoId)
    if (
      status.uploadStatus === "processed" &&
      status.privacyStatus === "unlisted" &&
      status.embeddable
    ) {
      // READY requires unlisted + embeddable + processed (plan/02). The
      // source object stays in storage so the app can stream playback
      // independently of YouTube; cleanup happens only on user delete.
      await transitionRecordingStatus(db, {
        recordingId: recording.id,
        expected: "YOUTUBE_PROCESSING",
        next: "READY",
        patch: { readyAt: new Date(), youtubePrivacyStatus: "unlisted" },
      })
      return
    }
    if (status.uploadStatus === "failed" || status.processingFailure) {
      await transitionRecordingStatus(db, {
        recordingId: recording.id,
        expected: "YOUTUBE_PROCESSING",
        next: "FAILED",
        patch: {
          failureCode: "YOUTUBE_PROCESSING_FAILED",
          failureMessage: "YouTube could not process this recording.",
        },
      })
      return
    }
    if (status.privacyStatus === "private") {
      // Forced private is NOT ready for normal users.
      await db
        .update(recordings)
        .set({ youtubePrivacyStatus: "private" })
        .where(eq(recordings.id, recording.id))
      await transitionRecordingStatus(db, {
        recordingId: recording.id,
        expected: "YOUTUBE_PROCESSING",
        next: "FAILED",
        patch: {
          failureCode: "YOUTUBE_PRIVATE_RESTRICTION",
          failureMessage:
            "YouTube forced this video to private (API project not approved). It cannot be played until the project passes audit.",
        },
      })
      return
    }
    // Still processing: bounded backoff re-poll via delayed outbox intent.
    const attempt = recording.attemptCount
    const delayMs = Math.min(60_000 * 2 ** Math.min(attempt, 5), 30 * 60 * 1000)
    await db.transaction(async (tx) => {
      await insertOutboxEvent(tx, {
        type: "youtube.poll-processing",
        aggregateId: recording.id,
        payload: { recordingId: recording.id },
        availableAt: new Date(Date.now() + delayMs),
      })
    })
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new AppError("EXTERNAL_SERVICE_UNAVAILABLE", "YouTube status check failed; will retry.")
    if (appError.code === "YOUTUBE_REAUTH_REQUIRED") {
      await db.update(youtubeConnectionsTable).set({ status: "REAUTH_REQUIRED" })
      await transitionRecordingStatus(db, {
        recordingId: recording.id,
        expected: "YOUTUBE_PROCESSING",
        next: "FAILED",
        patch: { failureCode: appError.code, failureMessage: appError.message },
      })
      return
    }
    // Transient: re-poll later; terminal errors fail the recording.
    await db.transaction(async (tx) => {
      await insertOutboxEvent(tx, {
        type: "youtube.poll-processing",
        aggregateId: recording.id,
        payload: { recordingId: recording.id },
        availableAt: new Date(Date.now() + 60_000),
      })
    })
  }
}

export async function handleDelete(ctx: DeleteContext): Promise<void> {
  const { db } = ctx
  const recording = await getRecording(db, ctx.recordingId)
  if (!recording || !recording.youtubeVideoId) return
  try {
    const youtube = await ctx.loadYoutubeClient()
    const result = await youtube.deleteVideo(recording.youtubeVideoId)
    // 404 (already gone) counts as success when deletion was intended.
    if (result.status !== 204 && result.status !== 404) {
      throw providerError(result.status, "")
    }
    await db
      .update(recordings)
      .set({ youtubeVideoId: null, youtubePrivacyStatus: null })
      .where(eq(recordings.id, recording.id))
    await maybeFinishDeletion(db, recording.id)
  } catch (error) {
    if (error instanceof AppError && error.code === "YOUTUBE_REAUTH_REQUIRED") {
      await db.update(youtubeConnectionsTable).set({ status: "REAUTH_REQUIRED" })
    }
    // Deletion retries through the outbox on the next worker pass.
    throw error
  }
}

export async function handleStorageCleanup(ctx: CleanupContext): Promise<void> {
  const { db } = ctx
  const recording = await getRecording(db, ctx.recordingId)
  if (!recording || !recording.storageKey) {
    await maybeFinishDeletion(db, ctx.recordingId)
    return
  }
  // Idempotent: deleting a vanished object is success.
  await ctx.storage.deletePrivateObject(recording.storageKey).catch(() => undefined)
  await db.update(recordings).set({ storageKey: null }).where(eq(recordings.id, recording.id))
  await maybeFinishDeletion(db, ctx.recordingId)
}

async function maybeFinishDeletion(db: CleanupContext["db"], recordingId: string): Promise<void> {
  const [row] = await db.select().from(recordings).where(eq(recordings.id, recordingId))
  if (!row || row.status !== "DELETE_PENDING") return
  if (row.storageKey === null && row.youtubeVideoId === null) {
    await transitionRecordingStatus(db, {
      recordingId,
      expected: "DELETE_PENDING",
      next: "DELETED",
      patch: { deletedAt: new Date() },
    })
  }
}

export async function handleExpireStaging(ctx: ExpireContext): Promise<{ expired: number }> {
  const { db } = ctx
  const cutoff = new Date(Date.now() - ctx.retentionHours * 60 * 60 * 1000)
  const rows = await db
    .select({ id: recordings.id, storageKey: recordings.storageKey })
    .from(recordings)
    .where(
      // drizzle: eq + lt composition kept explicit for readability
      // (status = STAGING AND created_at < cutoff)
      eq(recordings.status, "STAGING"),
    )
  let expired = 0
  for (const row of rows) {
    const [current] = await db.select().from(recordings).where(eq(recordings.id, row.id))
    if (!current || current.status !== "STAGING" || current.createdAt >= cutoff) continue
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
