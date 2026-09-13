/**
 * Stable application error codes and the custom HTTP API envelope.
 *
 * Codes are part of the cross-task contract (plan/02 § Stable application
 * error codes) and must never be renamed or repurposed.
 */

export const APP_ERROR_CODES = [
  "AUTH_REQUIRED",
  "ADMIN_REQUIRED",
  "RESOURCE_NOT_FOUND",
  "DUPLICATE_TAG",
  "LAST_ADMIN_REQUIRED",
  "VALIDATION_FAILED",
  "RECORDING_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "STORAGE_CAPACITY_LOW",
  "UPLOAD_NOT_FOUND",
  "UPLOAD_METADATA_MISMATCH",
  "INVALID_RECORDING_STATE",
  "YOUTUBE_NOT_CONNECTED",
  "YOUTUBE_REAUTH_REQUIRED",
  "YOUTUBE_QUOTA_EXCEEDED",
  "YOUTUBE_PRIVATE_RESTRICTION",
  "YOUTUBE_UPLOAD_AMBIGUOUS",
  "YOUTUBE_PROCESSING_FAILED",
  "EXTERNAL_SERVICE_UNAVAILABLE",
] as const

export type AppErrorCode = (typeof APP_ERROR_CODES)[number]

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === "string" && (APP_ERROR_CODES as readonly string[]).includes(value)
}

/**
 * Application-level error carrying a stable code. Services throw (or return)
 * this so HTTP layers can map to the shared status mapping without inventing
 * messages or codes.
 */
export class AppError extends Error {
  readonly code: AppErrorCode
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>

  constructor(
    code: AppErrorCode,
    message: string,
    options?: { fieldErrors?: Record<string, string[]>; cause?: unknown },
  ) {
    super(message, { cause: options?.cause })
    this.name = "AppError"
    this.code = code
    this.fieldErrors = options?.fieldErrors
  }
}

/** `Success<T>` response envelope: `{ data: T }`. */
export type Success<T> = { data: T }

/** `Failure` response envelope (plan/02 § Custom HTTP API contract). */
export type Failure = {
  error: {
    code: AppErrorCode
    message: string
    fieldErrors?: Record<string, string[]>
    requestId: string
  }
}

export function failure(
  code: AppErrorCode,
  message: string,
  requestId: string,
  fieldErrors?: Record<string, string[]>,
): Failure {
  return fieldErrors
    ? { error: { code, message, fieldErrors, requestId } }
    : { error: { code, message, requestId } }
}

/** Field errors shape used by schema-driven 400 responses. */
export type FieldErrors = Record<string, string[]>
