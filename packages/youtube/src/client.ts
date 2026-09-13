/**
 * Authenticated YouTube client factory with an injectable HTTP transport
 * (plan/02 § packages/youtube): resumable upload session initiation, upload
 * session status queries, video metadata reads, and video deletion. All
 * request/response bodies flow through the transport so tests can run a
 * controlled fake provider; production uses fetch.
 */

import { refreshAccessToken, type TokenTransport } from "./oauth"

export type YoutubeHttpTransport = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body?: string | Uint8Array
  },
) => Promise<{ status: number; body: string; headers: Record<string, string> }>

export const DEFAULT_HTTP_TRANSPORT: YoutubeHttpTransport = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body as BodyInit | undefined,
  })
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  return { status: response.status, body: await response.text(), headers }
}

export type AccessTokenSource = {
  getAccessToken(): Promise<string>
}

export function tokenSourceFromRefreshToken(input: {
  clientId: string
  clientSecret: string
  refreshToken: string
  tokenTransport?: TokenTransport
}): AccessTokenSource {
  const tokenTransport = input.tokenTransport ?? defaultTokenTransport
  let cached: { token: string; expiresAt: number } | null = null
  return {
    async getAccessToken() {
      if (cached && cached.expiresAt > Date.now() - 60_000) {
        return cached.token
      }
      const refreshed = await refreshAccessToken({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        refreshToken: input.refreshToken,
        transport: tokenTransport,
      })
      cached = {
        token: refreshed.access_token,
        expiresAt: Date.now() + refreshed.expires_in * 1000,
      }
      return refreshed.access_token
    },
  }
}

const defaultTokenTransport: TokenTransport = async (url, init) => {
  const response = await fetch(url, { method: init.method, headers: init.headers, body: init.body })
  return { status: response.status, body: await response.text() }
}

/** Provider call failure carrying status+body for stable classification. */
export class ProviderCallError extends Error {
  readonly providerStatus: number
  readonly providerBody: string

  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = "ProviderCallError"
    this.providerStatus = status
    this.providerBody = body
  }
}

export type YoutubeClient = {
  /** Initiates a resumable upload session; returns the session URI. */
  initResumableUpload(input: {
    title: string
    description: string
    privacyStatus: "unlisted" | "private" | "public"
    categoryId: string
    notifySubscribers: boolean
    embeddable: boolean
    madeForKids: boolean
    contentType: string
    sizeBytes: number
  }): Promise<string>
  /** Queries how many bytes the session already holds (308 response). */
  queryUploadStatus(
    sessionUri: string,
  ): Promise<{ bytesReceived: number; complete: boolean; finalBody?: string }>
  /** Streams the media into an open session. */
  sendMedia(input: {
    sessionUri: string
    contentType: string
    body: string | Uint8Array
    contentRange?: string
  }): Promise<{ status: number; body: string }>
  /** Reads processing status + privacy + embeddable for a video. */
  getVideoStatus(videoId: string): Promise<{
    uploadStatus: string
    privacyStatus: string
    embeddable: boolean
    processingFailure?: boolean
  }>
  /** Deletes a video; already-gone is reported as a 404 status. */
  deleteVideo(videoId: string): Promise<{ status: number }>
  /** Verifies the authorized channel for connect flows. */
  getChannel(): Promise<{ id: string; title: string }>
}

const UPLOAD_INIT_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"

export function createYoutubeClient(
  tokens: AccessTokenSource,
  transport: YoutubeHttpTransport = DEFAULT_HTTP_TRANSPORT,
): YoutubeClient {
  async function authHeaders(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await tokens.getAccessToken()}` }
  }

  return {
    async initResumableUpload(input) {
      const metadata = {
        snippet: {
          title: input.title,
          description: input.description,
          categoryId: input.categoryId,
        },
        status: {
          privacyStatus: input.privacyStatus,
          notifySubscribers: input.notifySubscribers,
          embeddable: input.embeddable,
          selfDeclaredMadeForKids: input.madeForKids,
        },
      }
      const url = new URL(UPLOAD_INIT_URL)
      url.searchParams.set("uploadType", "resumable")
      url.searchParams.set("part", "snippet,status")
      const response = await transport(url.toString(), {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "content-type": "application/json",
          "x-upload-content-type": input.contentType,
          "x-upload-content-length": String(input.sizeBytes),
        },
        body: JSON.stringify(metadata),
      })
      if (response.status !== 200) {
        throw new ProviderCallError(
          `upload session init failed with status ${response.status}`,
          response.status,
          response.body,
        )
      }
      const sessionUri = response.headers["location"]
      if (!sessionUri) {
        throw new Error("upload session init returned no session URI")
      }
      return sessionUri
    },

    async queryUploadStatus(sessionUri) {
      const response = await transport(sessionUri, {
        method: "PUT",
        headers: { "content-range": "bytes */0" },
      })
      if (response.status === 308) {
        const range = response.headers["range"]
        const received = range ? Number(range.split("-")[1]) + 1 : 0
        return { bytesReceived: Number.isFinite(received) ? received : 0, complete: false }
      }
      if (response.status >= 200 && response.status < 300) {
        return { bytesReceived: 0, complete: true, finalBody: response.body }
      }
      if (response.status === 404) {
        throw new Error("upload session expired")
      }
      throw new Error(`upload status query failed with status ${response.status}`)
    },

    async sendMedia(input) {
      const headers: Record<string, string> = { "content-type": input.contentType }
      if (input.contentRange) {
        headers["content-range"] = input.contentRange
      }
      const response = await transport(input.sessionUri, {
        method: "PUT",
        headers,
        body: input.body,
      })
      return { status: response.status, body: response.body }
    },

    async getVideoStatus(videoId) {
      const url = new URL(VIDEOS_URL)
      url.searchParams.set("part", "status,processingDetails")
      url.searchParams.set("id", videoId)
      const response = await transport(url.toString(), {
        method: "GET",
        headers: await authHeaders(),
      })
      if (response.status !== 200) {
        throw new Error(`video status failed with status ${response.status}`)
      }
      const parsed = JSON.parse(response.body) as {
        items?: {
          status?: { uploadStatus?: string; privacyStatus?: string; embeddable?: boolean }
          processingDetails?: { processingFailureReason?: string }
        }[]
      }
      const item = parsed.items?.[0]
      return {
        uploadStatus: item?.status?.uploadStatus ?? "unknown",
        privacyStatus: item?.status?.privacyStatus ?? "unknown",
        embeddable: item?.status?.embeddable ?? false,
        processingFailure: Boolean(item?.processingDetails?.processingFailureReason),
      }
    },

    async deleteVideo(videoId) {
      const url = new URL(`${VIDEOS_URL}/${videoId}`)
      const response = await transport(url.toString(), {
        method: "DELETE",
        headers: await authHeaders(),
      })
      return { status: response.status }
    },

    async getChannel() {
      const url = new URL(CHANNELS_URL)
      url.searchParams.set("part", "snippet")
      url.searchParams.set("mine", "true")
      const response = await transport(url.toString(), {
        method: "GET",
        headers: await authHeaders(),
      })
      if (response.status !== 200) {
        throw new Error(`channel lookup failed with status ${response.status}`)
      }
      const parsed = JSON.parse(response.body) as {
        items?: { id?: string; snippet?: { title?: string } }[]
      }
      const channel = parsed.items?.[0]
      if (!channel?.id || !channel.snippet?.title) {
        throw new Error("no YouTube channel is associated with this Google account")
      }
      return { id: channel.id, title: channel.snippet.title }
    },
  }
}
