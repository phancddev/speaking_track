import { AppError } from "@speaking-track/contracts"

/** Typed not-found result for private object operations. */
export class StorageObjectNotFoundError extends Error {
  readonly objectKey: string

  constructor(objectKey: string) {
    super(`private object not found: ${objectKey}`)
    this.name = "StorageObjectNotFoundError"
    this.objectKey = objectKey
  }
}

/** Maps AWS SDK S3 errors to the typed not-found error, rethrowing others. */
export function toStorageError(error: unknown, objectKey: string): Error {
  if (isS3NotFound(error)) {
    return new StorageObjectNotFoundError(objectKey)
  }
  if (error instanceof Error) {
    return error
  }
  return new Error(String(error))
}

function isS3NotFound(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false
  }
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  if (candidate.name === "NotFound" || candidate.name === "NoSuchKey") {
    return true
  }
  return candidate.$metadata?.httpStatusCode === 404
}

/** Rejects unsafe/malformed object keys before any provider call. */
export function assertSafeObjectKey(objectKey: string): void {
  if (
    !/^recordings\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/source\.(webm|mp4)$/.test(
      objectKey,
    )
  ) {
    throw new AppError(
      "VALIDATION_FAILED",
      `unsafe or malformed recording object key: ${objectKey}`,
    )
  }
}
