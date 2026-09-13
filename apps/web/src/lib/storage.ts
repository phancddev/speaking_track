import "server-only"
import { createStorage, createStorageConfig, type StorageClient } from "@speaking-track/storage"

/**
 * Process-wide storage adapter and recording limits, validated from the
 * environment once per process. Presigned URLs are signed for the
 * browser-reachable public endpoint; server operations use the internal
 * endpoint (both live on the validated storage config).
 */

export function getStorage(): StorageClient {
  const globalStore = globalThis as {
    __speakingTrackStorage?: StorageClient
    __speakingTrackStorageKey?: string
  }
  const envKey = [
    process.env.S3_INTERNAL_ENDPOINT,
    process.env.S3_PUBLIC_ENDPOINT,
    process.env.S3_BUCKET,
    process.env.S3_REGION,
  ].join("|")
  if (globalStore.__speakingTrackStorage && globalStore.__speakingTrackStorageKey === envKey) {
    return globalStore.__speakingTrackStorage
  }
  const storage = createStorage(
    createStorageConfig({
      S3_INTERNAL_ENDPOINT: process.env.S3_INTERNAL_ENDPOINT,
      S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT,
      S3_REGION: process.env.S3_REGION,
      S3_BUCKET: process.env.S3_BUCKET,
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
      S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
      PRESIGNED_UPLOAD_TTL_SECONDS: process.env.PRESIGNED_UPLOAD_TTL_SECONDS,
      MAX_RECORDING_BYTES: process.env.MAX_RECORDING_BYTES,
      MAX_STAGING_BYTES: process.env.MAX_STAGING_BYTES,
    }),
  )
  globalStore.__speakingTrackStorage = storage
  globalStore.__speakingTrackStorageKey = envKey
  return storage
}

export type RecordingLimits = {
  maxRecordingBytes: number
  maxStagingBytes: number
  maxDurationMs: number
}

export function getRecordingLimits(
  env: Record<string, string | undefined> = process.env,
): RecordingLimits {
  const maxRecordingBytes = Number(env.MAX_RECORDING_BYTES ?? 0)
  const maxStagingBytes = Number(env.MAX_STAGING_BYTES ?? 0)
  if (!Number.isInteger(maxRecordingBytes) || maxRecordingBytes <= 0) {
    throw new Error("MAX_RECORDING_BYTES must be a positive integer")
  }
  if (!Number.isInteger(maxStagingBytes) || maxStagingBytes <= 0) {
    throw new Error("MAX_STAGING_BYTES must be a positive integer")
  }
  return {
    maxRecordingBytes,
    maxStagingBytes,
    // Default 30 minutes; configurable through MAX_RECORDING_DURATION_MS.
    maxDurationMs: positiveIntOrDefault(env.MAX_RECORDING_DURATION_MS, 30 * 60 * 1000),
  }
}

function positiveIntOrDefault(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}
