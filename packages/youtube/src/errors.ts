/**
 * Provider error classification (task 06): raw YouTube/Google API failures
 * map to stable application error codes so workers, admin UI, and users see
 * consistent, actionable categories. Never surface provider bodies.
 */

export type YoutubeErrorClass =
  | "reauth"
  | "quota"
  | "transient"
  | "media-rejected"
  | "private-restriction"
  | "processing-failed"
  | "unavailable"

export const ERROR_CLASS_BY_CODE: Record<YoutubeErrorClass, string> = {
  reauth: "YOUTUBE_REAUTH_REQUIRED",
  quota: "YOUTUBE_QUOTA_EXCEEDED",
  transient: "EXTERNAL_SERVICE_UNAVAILABLE",
  "media-rejected": "YOUTUBE_PROCESSING_FAILED",
  "private-restriction": "YOUTUBE_PRIVATE_RESTRICTION",
  "processing-failed": "YOUTUBE_PROCESSING_FAILED",
  unavailable: "EXTERNAL_SERVICE_UNAVAILABLE",
}

export type ProviderErrorInput = {
  status?: number
  reason?: string
  message?: string
}

export function classifyProviderError(error: ProviderErrorInput): YoutubeErrorClass {
  const reason = error.reason ?? ""
  const status = error.status ?? 0

  if (
    reason.includes("quotaExceeded") ||
    reason.includes("rateLimitExceeded") ||
    reason.includes("uploadLimitExceeded") ||
    reason.includes("dailyLimitExceeded")
  ) {
    return "quota"
  }
  if (
    reason.includes("invalid_grant") ||
    reason.includes("refresh_token_invalid") ||
    reason.includes("unauthorized") ||
    status === 401
  ) {
    return "reauth"
  }
  if (
    status >= 500 ||
    status === 429 ||
    reason.includes("backendError") ||
    reason.includes("internalError")
  ) {
    return "transient"
  }
  if (reason.includes("invalidMediaBody") || reason.includes("badRequest") || status === 400) {
    return "media-rejected"
  }
  if (status === 403) {
    return "private-restriction"
  }
  return "unavailable"
}

/** Parses a Google JSON error body into classification inputs. */
export function providerErrorFromBody(status: number, body: string): ProviderErrorInput {
  try {
    const parsed = JSON.parse(body) as {
      error?: { errors?: { reason?: string }[]; message?: string }
    }
    const first = parsed.error?.errors?.[0]
    return { status, reason: first?.reason ?? "", message: parsed.error?.message }
  } catch {
    return { status }
  }
}
