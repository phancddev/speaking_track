import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { AppError, type AppErrorCode, failure, type FieldErrors } from "@speaking-track/contracts"

/**
 * Custom HTTP API plumbing (plan/02 § Custom HTTP API contract): request
 * IDs, the shared success/failure envelope, and the code→status mapping.
 * Better Auth endpoints keep their native responses and never pass through
 * here.
 */

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  AUTH_REQUIRED: 401,
  ADMIN_REQUIRED: 403,
  RESOURCE_NOT_FOUND: 404,
  DUPLICATE_TAG: 409,
  LAST_ADMIN_REQUIRED: 409,
  VALIDATION_FAILED: 400,
  RECORDING_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 400,
  STORAGE_CAPACITY_LOW: 429,
  UPLOAD_NOT_FOUND: 404,
  UPLOAD_METADATA_MISMATCH: 400,
  INVALID_RECORDING_STATE: 409,
  YOUTUBE_NOT_CONNECTED: 409,
  YOUTUBE_REAUTH_REQUIRED: 409,
  YOUTUBE_QUOTA_EXCEEDED: 429,
  YOUTUBE_PRIVATE_RESTRICTION: 409,
  YOUTUBE_UPLOAD_AMBIGUOUS: 409,
  YOUTUBE_PROCESSING_FAILED: 409,
  EXTERNAL_SERVICE_UNAVAILABLE: 503,
}

export function requestIdFrom(request: Request): string {
  return request.headers.get("x-request-id") ?? randomUUID()
}

export function jsonSuccess<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init)
}

export function jsonFailure(
  code: AppErrorCode,
  message: string,
  requestId: string,
  options?: { fieldErrors?: FieldErrors; status?: number },
): NextResponse {
  const body = failure(code, message, requestId, options?.fieldErrors)
  return NextResponse.json(body, { status: options?.status ?? STATUS_BY_CODE[code] })
}

/** Narrowing helper: true when the value is an AppError with this code. */
export function isAppError(error: unknown, code: AppErrorCode): boolean {
  return error instanceof AppError && error.code === code
}

export const RESOURCE_NOT_FOUND_CODE = "RESOURCE_NOT_FOUND" as const satisfies AppErrorCode

/** Maps an unknown thrown value onto the failure envelope without leaking internals. */
export function jsonError(error: unknown, requestId: string): NextResponse {
  if (error instanceof AppError) {
    return jsonFailure(error.code, error.message, requestId, {
      fieldErrors: error.fieldErrors
        ? Object.fromEntries(
            Object.entries({ ...error.fieldErrors }).map(([field, messages]) => [
              field,
              [...(messages ?? [])],
            ]),
          )
        : undefined,
    })
  }
  if (error instanceof ZodError) {
    const flat: Record<string, readonly string[] | undefined> = z.flattenError(error).fieldErrors
    const fieldErrors: Record<string, string[]> = {}
    for (const [field, messages] of Object.entries(flat)) {
      fieldErrors[field] = [...(messages ?? [])]
    }
    return jsonFailure("VALIDATION_FAILED", "Request validation failed.", requestId, {
      fieldErrors,
    })
  }
  return jsonFailure(
    "EXTERNAL_SERVICE_UNAVAILABLE",
    "An unexpected error occurred. Reference the request ID when reporting it.",
    requestId,
    { status: 500 },
  )
}

/**
 * Wraps a custom route handler with the envelope contract: any thrown
 * AppError/ZodError becomes the shared failure shape; unexpected errors
 * become a safe 500 with a request ID. Every response carries x-request-id.
 */
export function withApi(
  handler: (request: Request, context: { requestId: string }) => Promise<NextResponse>,
): (request: Request) => Promise<NextResponse> {
  return async (request: Request) => {
    const requestId = requestIdFrom(request)
    try {
      const response = await handler(request, { requestId })
      response.headers.set("x-request-id", requestId)
      return response
    } catch (error) {
      const response = jsonError(error, requestId)
      response.headers.set("x-request-id", requestId)
      console.error(
        JSON.stringify({
          level: "error",
          event: "api-error",
          requestId,
          code: error instanceof AppError ? error.code : "INTERNAL",
        }),
      )
      return response
    }
  }
}
