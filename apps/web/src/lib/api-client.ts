"use client"

/**
 * Thin fetch wrapper around the custom API envelope (plan/02). Throws
 * ApiError with the stable code and user-safe message on failure; returns
 * parsed data on success.
 */

export type ApiErrorShape = {
  code: string
  message: string
  fieldErrors?: Record<string, string[]>
  requestId: string
}

export class ApiError extends Error {
  readonly code: string
  readonly fieldErrors?: Record<string, string[]>
  readonly requestId: string

  constructor(shape: ApiErrorShape) {
    super(shape.message)
    this.name = "ApiError"
    this.code = shape.code
    this.fieldErrors = shape.fieldErrors
    this.requestId = shape.requestId
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const payload = (await response.json().catch(() => null)) as
    { data: T } | { error: ApiErrorShape } | null
  if (!response.ok || !payload || "error" in payload) {
    const shape =
      payload && "error" in payload
        ? payload.error
        : {
            code: "EXTERNAL_SERVICE_UNAVAILABLE",
            message: "The request failed. Try again.",
            requestId: "unknown",
          }
    throw new ApiError(shape)
  }
  return payload.data
}

/**
 * Appends the admin owner-browsing scope (`?ownerId=`) to an API path.
 * Harmless for normal users: the server ignores `ownerId` unless the
 * session is an administrator.
 */
export function withOwner(path: string, ownerId: string | null | undefined): string {
  if (!ownerId) return path
  const url = new URL(path, "https://app.local")
  url.searchParams.set("ownerId", ownerId)
  return `${url.pathname}${url.search}`
}
