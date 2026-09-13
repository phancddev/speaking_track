import { z } from "zod"

/**
 * Storage contract (plan/02 § Storage contract): private object key format
 * and the presigned upload envelope handed to the browser.
 */

/**
 * Private object key format:
 * `recordings/<ownerId>/<recordingId>/source.<validated-extension>`
 *
 * ownerId/recordingId are UUIDs; the extension is derived from the
 * validated MIME type (webm|mp4). Anything else — traversal segments,
 * arbitrary prefixes, non-UUID ids — is rejected.
 */
export const RECORDING_OBJECT_KEY_PATTERN =
  /^recordings\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/source\.(webm|mp4)$/

export const RecordingObjectKeySchema = z
  .string()
  .regex(RECORDING_OBJECT_KEY_PATTERN, "unsafe or malformed recording object key")

export type RecordingObjectKey = string

/** Presigned upload descriptor returned by the storage adapter. */
export type PresignedUpload = {
  objectKey: string
  url: string
  method: "PUT"
  headers: Record<string, string>
  expiresAt: string
}

export const PresignedUploadSchema = z.strictObject({
  objectKey: RecordingObjectKeySchema,
  url: z.string().url(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
})

/** Presigned playback descriptor for streaming a stored recording. */
export type PresignedPlayback = {
  url: string
  method: "GET"
  expiresAt: string
}

export const PresignedPlaybackSchema = z.strictObject({
  url: z.string().url(),
  method: z.literal("GET"),
  expiresAt: z.string(),
})

/** Object metadata as verified on completion. */
export type PrivateObjectStat = {
  sizeBytes: number
  contentType: string
  etag: string
}
