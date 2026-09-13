import { z } from "zod"
import { ENV_SCHEMAS, configurationErrorFromZodError } from "@speaking-track/contracts"

/**
 * S3-compatible storage provider configuration. The presigned URLs handed
 * to the browser must be signed for the PUBLIC endpoint hostname, while
 * server-side operations (stat/stream/delete) use the INTERNAL endpoint —
 * the two endpoints are configured separately.
 */

const STORAGE_VARIABLES = {
  internalEndpoint: "S3_INTERNAL_ENDPOINT",
  publicEndpoint: "S3_PUBLIC_ENDPOINT",
  region: "S3_REGION",
  bucket: "S3_BUCKET",
  accessKeyId: "S3_ACCESS_KEY_ID",
  secretAccessKey: "S3_SECRET_ACCESS_KEY",
  forcePathStyle: "S3_FORCE_PATH_STYLE",
  presignedUploadTtlSeconds: "PRESIGNED_UPLOAD_TTL_SECONDS",
  maxRecordingBytes: "MAX_RECORDING_BYTES",
  maxStagingBytes: "MAX_STAGING_BYTES",
} as const

const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/

const STORAGE_ENV_SCHEMA = z.object({
  [STORAGE_VARIABLES.internalEndpoint]: ENV_SCHEMAS.httpUrl,
  [STORAGE_VARIABLES.publicEndpoint]: ENV_SCHEMAS.httpUrl,
  [STORAGE_VARIABLES.region]: ENV_SCHEMAS.nonEmptyString,
  [STORAGE_VARIABLES.bucket]: z.string().regex(BUCKET_NAME_PATTERN, "must be a valid bucket name"),
  [STORAGE_VARIABLES.accessKeyId]: ENV_SCHEMAS.nonEmptyString,
  [STORAGE_VARIABLES.secretAccessKey]: ENV_SCHEMAS.nonEmptyString,
  [STORAGE_VARIABLES.forcePathStyle]: ENV_SCHEMAS.boolean,
  [STORAGE_VARIABLES.presignedUploadTtlSeconds]: ENV_SCHEMAS.positiveInt.pipe(
    z.number().int().max(604800, "presigned URLs cannot exceed the SigV4 7-day maximum"),
  ),
  [STORAGE_VARIABLES.maxRecordingBytes]: ENV_SCHEMAS.positiveInt,
  [STORAGE_VARIABLES.maxStagingBytes]: ENV_SCHEMAS.positiveInt,
})

export type StorageConfig = {
  internalEndpoint: string
  publicEndpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
  presignedUploadTtlSeconds: number
  maxRecordingBytes: number
  maxStagingBytes: number
}

export function createStorageConfig(env: Record<string, string | undefined>): StorageConfig {
  const parsed = STORAGE_ENV_SCHEMA.safeParse(env)
  if (!parsed.success) {
    throw configurationErrorFromZodError(Object.values(STORAGE_VARIABLES), parsed.error)
  }
  const value = parsed.data
  return {
    internalEndpoint: value[STORAGE_VARIABLES.internalEndpoint],
    publicEndpoint: value[STORAGE_VARIABLES.publicEndpoint],
    region: value[STORAGE_VARIABLES.region],
    bucket: value[STORAGE_VARIABLES.bucket],
    accessKeyId: value[STORAGE_VARIABLES.accessKeyId],
    secretAccessKey: value[STORAGE_VARIABLES.secretAccessKey],
    forcePathStyle: value[STORAGE_VARIABLES.forcePathStyle],
    presignedUploadTtlSeconds: value[STORAGE_VARIABLES.presignedUploadTtlSeconds],
    maxRecordingBytes: value[STORAGE_VARIABLES.maxRecordingBytes],
    maxStagingBytes: value[STORAGE_VARIABLES.maxStagingBytes],
  }
}

export type { STORAGE_VARIABLES as StorageEnvVariableNames }
export { STORAGE_VARIABLES }
