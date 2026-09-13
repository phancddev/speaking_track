import "server-only"
import { randomBytes } from "node:crypto"
import { eq } from "drizzle-orm"
import { AppError, type YoutubeConnectionStatus } from "@speaking-track/contracts"
import {
  user as userTable,
  youtubeConnections,
  youtubeOauthClients,
  type Db,
  type YoutubeConnection,
} from "@speaking-track/db"
import {
  buildAuthorizationUrl,
  createYoutubeClient,
  decryptSecret,
  encryptSecret,
  exchangeAuthorizationCode,
  parseEnvelope,
  serializeEnvelope,
  tokenSourceFromRefreshToken,
  YOUTUBE_SCOPES,
  type YoutubeHttpTransport,
} from "@speaking-track/youtube"

/**
 * Per-user YouTube connection service. Each user:
 *
 * 1. enters their OWN Google OAuth client credentials on the settings page
 *    (stored encrypted in `youtube_oauth_clients`) — or falls back to the
 *    instance-wide GOOGLE_CLIENT_ID/SECRET env pair when set;
 * 2. connects their own Google account, so their recordings upload to their
 *    own channel.
 *
 * The OAuth state is a cryptographically random nonce bound to the
 * initiating user session and stored server-side with an expiry; the
 * callback validates both.
 */

const STATE_TTL_MS = 10 * 60 * 1000

type PendingState = { userId: string; nonce: string; expiresAt: number }

const pendingStates = new Map<string, PendingState>()

export type YoutubeClientConfig = {
  clientId: string
  clientSecret: string
}

function tokenEncryptionKey(env: Record<string, string | undefined> = process.env): string {
  return env.YOUTUBE_TOKEN_ENCRYPTION_KEY ?? ""
}

/** OAuth redirect URI: derived from APP_ORIGIN, env override wins. */
export function redirectUri(env: Record<string, string | undefined> = process.env): string {
  if (env.GOOGLE_REDIRECT_URI) return env.GOOGLE_REDIRECT_URI
  const origin = env.APP_ORIGIN ?? "https://localhost"
  return `${origin.replace(/\/$/, "")}/api/youtube/callback`
}

/**
 * Resolved client credentials for a user: their stored row first, the
 * instance env pair as fallback. Null when neither is configured.
 */
export async function resolveClientConfig(
  db: Db,
  userId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<YoutubeClientConfig | null> {
  const [row] = await db
    .select()
    .from(youtubeOauthClients)
    .where(eq(youtubeOauthClients.userId, userId))
  if (row) {
    const secret = decryptSecret(parseEnvelope(row.encryptedClientSecret), tokenEncryptionKey(env))
    return { clientId: row.clientId, clientSecret: secret }
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
  }
  return null
}

/** Saves (or replaces) the user's own OAuth client credentials. */
export async function saveClientConfig(
  db: Db,
  input: { userId: string; clientId: string; clientSecret: string },
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const encrypted = serializeEnvelope(encryptSecret(input.clientSecret, tokenEncryptionKey(env)))
  const now = new Date()
  await db
    .insert(youtubeOauthClients)
    .values({
      userId: input.userId,
      clientId: input.clientId,
      encryptedClientSecret: encrypted,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: youtubeOauthClients.userId,
      set: {
        clientId: input.clientId,
        encryptedClientSecret: encrypted,
        updatedAt: now,
      },
    })
}

/** Clears the user's stored credentials (falls back to env pair if set). */
export async function clearClientConfig(db: Db, userId: string): Promise<void> {
  await db.delete(youtubeOauthClients).where(eq(youtubeOauthClients.userId, userId))
}

export type ConnectionStatusView = {
  status: YoutubeConnectionStatus | "NOT_CONFIGURED" | "UNCONNECTED"
  channelId: string | null
  channelTitle: string | null
  lastVerifiedAt: string | null
  /** Whether usable OAuth client credentials are available for this user. */
  hasClientConfig: boolean
  /** Redirect URI the user must register in their Google Cloud project. */
  redirectUri: string
}

export async function getConnectionStatus(
  db: Db,
  userId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<ConnectionStatusView> {
  const [connection] = await db
    .select()
    .from(youtubeConnections)
    .where(eq(youtubeConnections.id, userId))
  const config = await resolveClientConfig(db, userId, env)
  const base = {
    hasClientConfig: config !== null,
    redirectUri: redirectUri(env),
  }
  if (!connection) {
    return {
      status: config ? "UNCONNECTED" : "NOT_CONFIGURED",
      channelId: null,
      channelTitle: null,
      lastVerifiedAt: null,
      ...base,
    }
  }
  return {
    status: connection.status,
    channelId: connection.channelId,
    channelTitle: connection.channelTitle,
    lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
    ...base,
  }
}

export async function createConnectUrl(
  db: Db,
  userId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const config = await resolveClientConfig(db, userId, env)
  if (!config) {
    throw new AppError(
      "YOUTUBE_NOT_CONNECTED",
      "Save your Google OAuth client ID and secret first.",
    )
  }
  const nonce = randomBytes(24).toString("base64url")
  const key = randomBytes(12).toString("base64url")
  pendingStates.set(key, { userId, nonce, expiresAt: Date.now() + STATE_TTL_MS })
  pruneStates()

  return buildAuthorizationUrl({
    clientId: config.clientId,
    redirectUri: redirectUri(env),
    state: `${key}.${nonce}`,
    scopes: YOUTUBE_SCOPES,
  })
}

export async function completeConnect(
  db: Db,
  input: { state: string; code: string; userId: string },
  env: Record<string, string | undefined> = process.env,
  transport?: YoutubeHttpTransport,
): Promise<ConnectionStatusView> {
  const [key, nonce] = input.state.split(".") as [string, string | undefined]
  const pending = key ? pendingStates.get(key) : undefined
  if (
    !pending ||
    pending.nonce !== nonce ||
    pending.userId !== input.userId ||
    pending.expiresAt < Date.now()
  ) {
    throw new AppError(
      "VALIDATION_FAILED",
      "The connection request expired or is invalid. Start again.",
    )
  }
  pendingStates.delete(key)

  const config = await resolveClientConfig(db, input.userId, env)
  if (!config) {
    throw new AppError("YOUTUBE_NOT_CONNECTED", "Save your OAuth client credentials first.")
  }

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
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: redirectUri(env),
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
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: tokens.refresh_token,
    }),
  )
  const channel = await client.getChannel()

  const encrypted = serializeEnvelope(encryptSecret(tokens.refresh_token, tokenEncryptionKey(env)))
  const now = new Date()
  await db
    .insert(youtubeConnections)
    .values({
      id: input.userId,
      channelId: channel.id,
      channelTitle: channel.title,
      encryptedRefreshToken: encrypted,
      scope: tokens.scope,
      status: "CONNECTED",
      connectedByUserId: input.userId,
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
        connectedByUserId: input.userId,
        lastVerifiedAt: now,
        updatedAt: now,
      },
    })
  return getConnectionStatus(db, input.userId, env)
}

export async function disconnect(db: Db, userId: string): Promise<ConnectionStatusView> {
  // Removes usable token material; existing YouTube videos stay untouched.
  await db
    .update(youtubeConnections)
    .set({
      status: "DISCONNECTED",
      encryptedRefreshToken: "DISCONNECTED",
      updatedAt: new Date(),
    })
    .where(eq(youtubeConnections.id, userId))
  return getConnectionStatus(db, userId)
}

export type AdminConnectionRow = {
  userId: string
  ownerEmail: string | null
  ownerName: string | null
  status: YoutubeConnectionStatus
  channelId: string | null
  channelTitle: string | null
  hasOwnClient: boolean
  updatedAt: string | null
}

/** Admin overview: every user's connection state plus client-config flag. */
export async function listConnections(db: Db): Promise<AdminConnectionRow[]> {
  const rows = await db
    .select({
      userId: youtubeConnections.id,
      ownerEmail: userTable.email,
      ownerName: userTable.name,
      status: youtubeConnections.status,
      channelId: youtubeConnections.channelId,
      channelTitle: youtubeConnections.channelTitle,
      updatedAt: youtubeConnections.updatedAt,
    })
    .from(youtubeConnections)
    .leftJoin(userTable, eq(userTable.id, youtubeConnections.id))
  const clients = await db.select().from(youtubeOauthClients)
  const ownClientIds = new Set(clients.map((row) => row.userId))
  return rows.map((row) => ({
    userId: row.userId,
    ownerEmail: row.ownerEmail,
    ownerName: row.ownerName,
    status: row.status,
    channelId: row.channelId,
    channelTitle: row.channelTitle,
    hasOwnClient: ownClientIds.has(row.userId),
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }))
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
