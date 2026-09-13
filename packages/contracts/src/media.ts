import { z } from "zod"

/**
 * Media contract (plan/02 § Media contract): the recorder picks the first
 * supported candidate from this centrally ordered list using
 * `MediaRecorder.isTypeSupported()`. The selected value, the Blob type, the
 * upload request metadata, the stored object content type, and the YouTube
 * upload content type must all agree — so this list is the single source of
 * truth for every layer.
 *
 * Order: WebM/VP9+Opus, WebM/VP8+Opus, then MP4 where supported.
 */

export const SUPPORTED_RECORDING_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/mp4",
] as const

export type SupportedRecordingMimeType = (typeof SUPPORTED_RECORDING_MIME_TYPES)[number]

export const SupportedRecordingMimeTypeSchema = z.enum(SUPPORTED_RECORDING_MIME_TYPES)

/** File extension used in the private object key for each supported type. */
export const RECORDING_MIME_EXTENSION: Readonly<
  Record<SupportedRecordingMimeType, "webm" | "mp4">
> = {
  "video/webm;codecs=vp9,opus": "webm",
  "video/webm;codecs=vp8,opus": "webm",
  "video/mp4": "mp4",
}

/** Ordered negotiation input: `["video/webm;codecs=vp9,opus", ...]`. */
export function preferredRecordingMimeTypes(
  supported: (mimeType: string) => boolean,
): SupportedRecordingMimeType[] {
  return SUPPORTED_RECORDING_MIME_TYPES.filter((mimeType) => supported(mimeType))
}
