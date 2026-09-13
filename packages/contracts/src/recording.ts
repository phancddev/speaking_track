import { z } from "zod"

/**
 * Recording lifecycle states and the allowed transition table
 * (plan/02 § Recording state machine). The database is the source of truth;
 * every transition is a compare-and-set on the expected current state.
 */

export const RECORDING_STATES = [
  "STAGING",
  "QUEUED",
  "YOUTUBE_UPLOADING",
  "YOUTUBE_PROCESSING",
  "READY",
  "FAILED",
  "EXPIRED",
  "DELETE_PENDING",
  "DELETED",
] as const

export type RecordingState = (typeof RECORDING_STATES)[number]

export const RecordingStateSchema = z.enum(RECORDING_STATES)

/**
 * Exact transition table from the shared contract:
 *
 * ```text
 * STAGING  -> QUEUED
 * STAGING  -> EXPIRED
 * QUEUED   -> YOUTUBE_UPLOADING
 * QUEUED   -> FAILED
 * FAILED   -> QUEUED                       (manual retry when source exists)
 * any non-DELETED state -> DELETE_PENDING -> DELETED
 * ```
 *
 * `READY`/`EXPIRED`/`FAILED` may also enter from the uploading/processing
 * states as listed below. `DELETED` is terminal.
 */
export const RECORDING_TRANSITIONS: Readonly<Record<RecordingState, readonly RecordingState[]>> = {
  STAGING: ["QUEUED", "EXPIRED", "DELETE_PENDING"],
  QUEUED: ["YOUTUBE_UPLOADING", "FAILED", "DELETE_PENDING"],
  // Quota exhaustion returns to QUEUED with an upload-deferred timestamp so
  // the scanner re-attempts after the daily quota reset.
  YOUTUBE_UPLOADING: ["YOUTUBE_PROCESSING", "FAILED", "QUEUED", "DELETE_PENDING"],
  YOUTUBE_PROCESSING: ["READY", "FAILED", "DELETE_PENDING"],
  READY: ["DELETE_PENDING"],
  FAILED: ["QUEUED", "DELETE_PENDING"],
  EXPIRED: ["DELETE_PENDING"],
  DELETE_PENDING: ["DELETED"],
  DELETED: [],
}

export function canTransitionRecording(from: RecordingState, to: RecordingState): boolean {
  return RECORDING_TRANSITIONS[from].includes(to)
}

/** States whose recording row still holds a live staged object. */
export const STAGED_SOURCE_STATES = [
  "STAGING",
  "QUEUED",
  "YOUTUBE_UPLOADING",
  "YOUTUBE_PROCESSING",
  "READY",
  "FAILED",
  "DELETE_PENDING",
] as const satisfies readonly RecordingState[]

/** States hidden from normal user-facing lists. */
export const HIDDEN_RECORDING_STATES = ["DELETE_PENDING", "DELETED", "EXPIRED"] as const
