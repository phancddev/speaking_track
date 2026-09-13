/** Worker runtime configuration (task 06), validated from the environment. */

export const UPLOAD_CONCURRENCY = positiveIntOrDefault(process.env.YOUTUBE_UPLOAD_CONCURRENCY, 1)

/** How often the deferred-upload scanner looks for pending QUEUED uploads. */
export const UPLOAD_SCAN_INTERVAL_SECONDS = positiveIntOrDefault(
  process.env.YOUTUBE_SCAN_INTERVAL_SECONDS,
  300,
)

export function youtubeTokenEncryptionKey(): string {
  return process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY ?? ""
}

export const STAGING_RETENTION_HOURS = positiveIntOrDefault(
  process.env.TEMP_UPLOAD_RETENTION_HOURS,
  24,
)

export const MAX_RECORDING_BYTES = positiveIntOrDefault(
  process.env.MAX_RECORDING_BYTES,
  500 * 1024 * 1024,
)

export function positiveIntOrDefault(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}
