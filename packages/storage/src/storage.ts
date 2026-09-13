import type { Readable } from "node:stream"
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import {
  AppError,
  RECORDING_MIME_EXTENSION,
  SupportedRecordingMimeTypeSchema,
  type PresignedUpload,
  type PrivateObjectStat,
  type SupportedRecordingMimeType,
} from "@speaking-track/contracts"
import type { StorageConfig } from "./config"
import { StorageObjectNotFoundError, assertSafeObjectKey, toStorageError } from "./errors"

/**
 * Private S3-compatible object operations for recording staging.
 *
 * - The bucket is never made public; access happens through short-lived
 *   presigned operations only.
 * - Presigned PUTs are signed for the PUBLIC endpoint hostname (browser
 *   reachable); stat/stream/delete use the INTERNAL endpoint.
 * - A client can never nominate an arbitrary bucket key: keys are generated
 *   from (ownerId, recordingId, mimeType) alone.
 *
 * Nothing connects at import time; construct via `createStorage(config)`.
 */

export type CreateUploadInput = {
  ownerId: string
  recordingId: string
  mimeType: SupportedRecordingMimeType
  sizeBytes: number
}

export type StorageClient = {
  readonly config: StorageConfig
  /** Deterministic private object key for a recording's source object. */
  objectKeyFor(input: {
    ownerId: string
    recordingId: string
    mimeType: SupportedRecordingMimeType
  }): string
  createPresignedUpload(input: CreateUploadInput): Promise<PresignedUpload>
  statPrivateObject(objectKey: string): Promise<PrivateObjectStat>
  getPrivateObjectStream(objectKey: string): Promise<NodeJS.ReadableStream>
  deletePrivateObject(objectKey: string): Promise<void>
  close(): void
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** `recordings/<ownerId>/<recordingId>/source.<validated-extension>` */
export function recordingObjectKeyFor(input: {
  ownerId: string
  recordingId: string
  mimeType: SupportedRecordingMimeType
}): string {
  const extension = RECORDING_MIME_EXTENSION[input.mimeType]
  return `recordings/${input.ownerId}/${input.recordingId}/source.${extension}`
}

export function createStorage(config: StorageConfig): StorageClient {
  const sharedOptions = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle,
  }
  // Server-side data-plane client: internal endpoint.
  const apiClient = new S3Client({ ...sharedOptions, endpoint: config.internalEndpoint })
  // Signing-only client: presigned URLs must carry the public hostname.
  const signingClient = new S3Client({ ...sharedOptions, endpoint: config.publicEndpoint })

  return {
    config,
    objectKeyFor: (input) => recordingObjectKeyFor(input),

    async createPresignedUpload(input) {
      const mimeType = SupportedRecordingMimeTypeSchema.safeParse(input.mimeType)
      if (!mimeType.success) {
        throw new AppError(
          "UNSUPPORTED_MEDIA_TYPE",
          `unsupported recording media type: ${String(input.mimeType)}`,
        )
      }
      if (!UUID_PATTERN.test(input.ownerId) || !UUID_PATTERN.test(input.recordingId)) {
        throw new AppError("VALIDATION_FAILED", "ownerId and recordingId must be UUIDs")
      }
      if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
        throw new AppError("VALIDATION_FAILED", "sizeBytes must be a positive integer")
      }
      if (input.sizeBytes > config.maxRecordingBytes) {
        throw new AppError(
          "RECORDING_TOO_LARGE",
          `recording of ${input.sizeBytes} bytes exceeds the configured maximum of ${config.maxRecordingBytes} bytes`,
        )
      }

      const objectKey = recordingObjectKeyFor({ ...input, mimeType: mimeType.data })
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        // The signed request pins the exact content type; the browser must
        // send it verbatim or the provider rejects the PUT.
        ContentType: mimeType.data,
      })
      const url = await getSignedUrl(signingClient, command, {
        expiresIn: config.presignedUploadTtlSeconds,
        // Keep content-type inside SignedHeaders so a PUT that swaps the
        // media type fails the signature instead of storing a mismatched
        // object.
        unhoistableHeaders: new Set(["content-type"]),
        signableHeaders: new Set(["content-type"]),
      })
      return {
        objectKey,
        url,
        method: "PUT",
        headers: { "Content-Type": mimeType.data },
        expiresAt: new Date(Date.now() + config.presignedUploadTtlSeconds * 1000).toISOString(),
      }
    },

    async statPrivateObject(objectKey) {
      assertSafeObjectKey(objectKey)
      try {
        const head = await apiClient.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }),
        )
        return {
          sizeBytes: head.ContentLength ?? 0,
          contentType: head.ContentType ?? "",
          etag: (head.ETag ?? "").replace(/^"|"$/g, ""),
        }
      } catch (error) {
        throw toStorageError(error, objectKey)
      }
    },

    async getPrivateObjectStream(objectKey) {
      assertSafeObjectKey(objectKey)
      try {
        const response = await apiClient.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }),
        )
        if (!response.Body) {
          throw new StorageObjectNotFoundError(objectKey)
        }
        return response.Body as Readable
      } catch (error) {
        if (error instanceof StorageObjectNotFoundError) {
          throw error
        }
        throw toStorageError(error, objectKey)
      }
    },

    async deletePrivateObject(objectKey) {
      assertSafeObjectKey(objectKey)
      // S3 deletes are idempotent: a missing object counts as deleted.
      await apiClient.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }))
    },

    close() {
      apiClient.destroy()
      signingClient.destroy()
    },
  }
}
