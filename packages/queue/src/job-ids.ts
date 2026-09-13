import type { JobName } from "@speaking-track/contracts"

/**
 * Deterministic BullMQ job IDs (plan/02 § Queue contract). A repeated
 * dispatch of the same intent resolves to the same job identity, which is
 * what makes duplicate outbox publishing safe.
 */

export const YOUTUBE_UPLOAD_JOB_ID_PREFIX = "youtube-upload" as const
export const YOUTUBE_POLL_JOB_ID_PREFIX = "youtube-poll" as const
export const YOUTUBE_DELETE_JOB_ID_PREFIX = "youtube-delete" as const
export const STORAGE_CLEANUP_JOB_ID_PREFIX = "storage-cleanup" as const

export function youtubeUploadJobId(recordingId: string): string {
  return `${YOUTUBE_UPLOAD_JOB_ID_PREFIX}:${recordingId}`
}

export function youtubePollProcessingJobId(recordingId: string): string {
  return `${YOUTUBE_POLL_JOB_ID_PREFIX}:${recordingId}`
}

export function youtubeDeleteJobId(recordingId: string): string {
  return `${YOUTUBE_DELETE_JOB_ID_PREFIX}:${recordingId}`
}

export function storageCleanupJobId(recordingId: string): string {
  return `${STORAGE_CLEANUP_JOB_ID_PREFIX}:${recordingId}`
}

/** Deterministic ID for a recording-scoped job; null for maintenance jobs. */
export function deterministicJobId(jobName: JobName, recordingId: string): string | null {
  switch (jobName) {
    case "youtube.upload":
      return youtubeUploadJobId(recordingId)
    case "youtube.poll-processing":
      return youtubePollProcessingJobId(recordingId)
    case "youtube.delete":
      return youtubeDeleteJobId(recordingId)
    case "storage.cleanup":
      return storageCleanupJobId(recordingId)
    default:
      return null
  }
}

/**
 * BullMQ (>= 5.42 / 6.x) rejects `:` inside custom job IDs because its
 * Redis keys use colon-separated segments. The shared contract fixes the
 * LOGICAL identity format (`youtube-upload:<recordingId>`); this bijective
 * mapping swaps that single separator for `-` when talking to BullMQ. Every
 * contract ID has exactly one colon between a fixed prefix and a UUID, so
 * distinct contract IDs always map to distinct BullMQ IDs.
 */
export function toBullmqJobId(contractJobId: string): string {
  return contractJobId.replaceAll(":", "-")
}

/** Inverse of {@link toBullmqJobId} for contract IDs handed back by BullMQ. */
export function fromBullmqJobId(bullmqJobId: string): string {
  return bullmqJobId.replace(
    /^(youtube-upload|youtube-poll|youtube-delete|storage-cleanup)-/,
    "$1:",
  )
}
