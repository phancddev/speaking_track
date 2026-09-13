import "server-only"
import { randomBytes } from "node:crypto"
import { eq } from "drizzle-orm"
import {
  AppError,
  SINGLETON_YOUTUBE_CONNECTION_ID,
  type YoutubeConnectionStatus,
} from "@speaking-track/contracts"
import { youtubeConnections, type Db, type YoutubeConnection } from "@speaking-track/db"
import {
  buildAuthorizationUrl,
  createYoutubeClient,
  encryptSecret,
  exchangeAuthorizationCode,
  serializeEnvelope,
  tokenSourceFromRefreshToken,
  YOUTUBE_SCOPES,
  type YoutubeHttpTransport,
} from "@speaking-track/youtube"

/**
 * Single-channel YouTube connection service (task 06). The OAuth state is a
 * cryptographically random nonce bound to the initiating admin session and
 * stored server-side with an expiry; the callback validates both.
 */

const STATE_TTL_MS = 10 * 60 * 1000

type PendingState = { adminUserId: string; nonce: string; expiresAt: number }

const pendingStates = new Map<string, PendingState>()

export type YoutubeEnv = {
  googleClientId: string
  googleClientSecret: string
  redirectUri: string
  tokenEncryptionKey: string
}

export function readYoutubeEnv(env: Record<string, string | undefined> = process.env): YoutubeEnv {
  const required = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "YOUTUBE_TOKEN_ENCRYPTION_KEY",
  ]
  const missing = required.filter((key) => !env[key])
  if (missing.length > 0) {
    throw new AppError(
      "YOUTUBE_NOT_CONNECTED",
      `YouTube is not configured: missing ${missing.join(", ")}.`,
    )
  }
  return {
    googleClientId: env.GOOGLE_CLIENT_ID!,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET!,
    redirectUri: env.GOOGLE_REDIRECT_URI!,
    tokenEncryptionKey: env.YOUTUBE_TOKEN_ENCRYPTION_KEY!,
  }
}

export type ConnectionStatusView = {
  status: YoutubeConnectionStatus | "NOT_CONFIGURED" | "UNCONNECTED"
  channelId: string | null
  channelTitle: string | null
  lastVerifiedAt: string | null
}

export async function getConnectionStatus(db: Db): Promise<ConnectionStatusView> {
  const [connection] = await db
    .select()
    .from(youtubeConnections)
    .where(eq(youtubeConnections.id, SINGLETON_YOUTUBE_CONNECTION_ID))
  if (!connection) {
    return { status: "UNCONNECTED", channelId: null, channelTitle: null, lastVerifiedAt: null }
  }
  return {
    status: connection.status,
    channelId: connection.channelId,
    channelTitle: connection.channelTitle,
    lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
  }
}

export async function createConnectUrl(
  db: Db,
  env: YoutubeEnv,
  adminUserId: string,
): Promise<string> {
  const nonce = randomBytes(24).toString("base64url")
  const key = randomBytes(12).toString("base64url")
  pendingStates.set(key, { adminUserId, nonce, expiresAt: Date.now() + STATE_TTL_MS })
  pruneStates()

  return buildAuthorizationUrl({
    clientId: env.googleClientId,
    redirectUri: env.redirectUri,
    state: `${key}.${nonce}`,
    scopes: YOUTUBE_SCOPES,
  })
}

export async function completeConnect(
  db: Db,
  env: YoutubeEnv,
  input: { state: string; code: string; adminUserId: string },
  transport?: YoutubeHttpTransport,
): Promise<ConnectionStatusView> {
  const [key, nonce] = input.state.split(".") as [string, string | undefined]
  const pending = key ? pendingStates.get(key) : undefined
  if (
    !pending ||
    pending.nonce !== nonce ||
    pending.adminUserId !== input.adminUserId ||
    pending.expiresAt < Date.now()
  ) {
    throw new AppError(
      "VALIDATION_FAILED",
      "The connection request expired or is invalid. Start again.",
    )
  }
  pendingStates.delete(key)

  const tokenTransport =
    transport ??
    (async (
      url: string,
      init: { method: string; body: string; headers: Record<string, string> },
    ) => {
      const response = await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
      })
      return { status: response.status, body: await response.text() }
    })

  const tokens = await exchangeAuthorizationCode({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: env.redirectUri,
    code: input.code,
    transport: tokenTransport,
  })
  if (!tokens.refresh_token) {
    throw new AppError(
      "YOUTUBE_REAUTH_REQUIRED",
      "Google did not return a reusable refresh token. Revoke the app's access in your Google account and reconnect.",
    )
  }

  const client = createYoutubeClient(
    tokenSourceFromRefreshToken({
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
      refreshToken: tokens.refresh_token,
    }),
  )
  const channel = await client.getChannel()

  const encrypted = serializeEnvelope(encryptSecret(tokens.refresh_token, env.tokenEncryptionKey))
  const now = new Date()
  await db
    .insert(youtubeConnections)
    .values({
      id: SINGLETON_YOUTUBE_CONNECTION_ID,
      channelId: channel.id,
      channelTitle: channel.title,
      encryptedRefreshToken: encrypted,
      scope: tokens.scope,
      status: "CONNECTED",
      connectedByUserId: input.adminUserId,
      lastVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: youtubeConnections.id,
      set: {
        channelId: channel.id,
        channelTitle: channel.title,
        encryptedRefreshToken: encrypted,
        scope: tokens.scope,
        status: "CONNECTED",
        connectedByUserId: input.adminUserId,
        lastVerifiedAt: now,
        updatedAt: now,
      },
    })
  return getConnectionStatus(db)
}

export async function disconnect(db: Db): Promise<ConnectionStatusView> {
  // Removes usable token material; existing YouTube videos stay untouched.
  await db
    .update(youtubeConnections)
    .set({
      status: "DISCONNECTED",
      encryptedRefreshToken: "DISCONNECTED",
      updatedAt: new Date(),
    })
    .where(eq(youtubeConnections.id, SINGLETON_YOUTUBE_CONNECTION_ID))
  return getConnectionStatus(db)
}

function pruneStates(): void {
  const now = Date.now()
  for (const [key, state] of pendingStates) {
    if (state.expiresAt < now) {
      pendingStates.delete(key)
    }
  }
}

export type { YoutubeConnection }
