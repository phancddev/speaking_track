import { and, eq, lt } from "drizzle-orm"
import type { Redis } from "ioredis"
import { AppError } from "@speaking-track/contracts"
import {
  dispatchPendingOutboxEvents,
  insertOutboxEvent,
  recordings,
  youtubeConnections,
  youtubeOauthClients,
  type Db,
} from "@speaking-track/db"
import { createOutboxEventPublisher, createQueueProducer } from "@speaking-track/queue"
import { createStorage, createStorageConfig, type StorageClient } from "@speaking-track/storage"
import {
  createYoutubeClient,
  decryptSecret,
  parseEnvelope,
  type YoutubeClient,
  type TokenTransport,
  type YoutubeHttpTransport,
} from "@speaking-track/youtube"
import {
  handleUpload,
  handlePollProcessing,
  handleDelete,
  handleStorageCleanup,
  handleExpireStaging,
} from "./processors"
import { STAGING_RETENTION_HOURS, youtubeTokenEncryptionKey } from "./config"

/**
 * Worker service composition (task 06): owns the DB handle, queue producer,
 * storage adapter, and the YouTube client bound to the installation's
 * single encrypted connection. Provider interactions run through an
 * injectable transport; tests supply a controlled fake.
 */

export type WorkerServices = {
  handleUpload(input: { recordingId: string }): Promise<void>
  handlePollProcessing(input: { recordingId: string }): Promise<void>
  handleDelete(input: { recordingId: string }): Promise<void>
  handleStorageCleanup(input: { recordingId: string }): Promise<void>
  handleExpireStaging(): Promise<{ expired: number }>
  dispatchOutbox(): Promise<void>
  recoverOnStartup(): Promise<void>
  close(): Promise<void>
}

export function createWorkerServices(input: {
  db: Db
  redis: Redis
  env: Record<string, string | undefined>
  transport?: YoutubeHttpTransport
  tokenTransport?: TokenTransport
}): WorkerServices {
  const { db, redis } = input
  const producer = createQueueProducer({
    url: input.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    maxRetriesPerRequest: null,
    connectTimeoutSeconds: 10,
    commandTimeoutMs: null,
    lazyConnect: true,
  })
  // The producer owns a lazy ioredis connection; BullMQ reconnects on first
  // use. The caller's Redis handle stays separate for workers.
  const storage: StorageClient = createStorage(
    createStorageConfig({
      S3_INTERNAL_ENDPOINT: input.env.S3_INTERNAL_ENDPOINT,
      S3_PUBLIC_ENDPOINT: input.env.S3_PUBLIC_ENDPOINT,
      S3_REGION: input.env.S3_REGION,
      S3_BUCKET: input.env.S3_BUCKET,
      S3_ACCESS_KEY_ID: input.env.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: input.env.S3_SECRET_ACCESS_KEY,
      S3_FORCE_PATH_STYLE: input.env.S3_FORCE_PATH_STYLE,
      PRESIGNED_UPLOAD_TTL_SECONDS: input.env.PRESIGNED_UPLOAD_TTL_SECONDS,
      MAX_RECORDING_BYTES: input.env.MAX_RECORDING_BYTES,
      MAX_STAGING_BYTES: input.env.MAX_STAGING_BYTES,
    }),
  )

  async function loadYoutubeClient(userId: string): Promise<YoutubeClient> {
    const [connection] = await db
      .select()
      .from(youtubeConnections)
      .where(eq(youtubeConnections.id, userId))
    if (!connection || connection.status === "DISCONNECTED") {
      throw new AppError("YOUTUBE_NOT_CONNECTED", "No YouTube channel is connected.")
    }
    const { tokenSourceFromRefreshToken } = await import("@speaking-track/youtube")
    const refreshToken = decryptSecret(
      parseEnvelope(connection.encryptedRefreshToken),
      youtubeTokenEncryptionKey(),
    )
    // Per-user OAuth client credentials from the settings page; the env
    // pair is the fallback for shared-client deployments.
    const [client] = await db
      .select()
      .from(youtubeOauthClients)
      .where(eq(youtubeOauthClients.userId, userId))
    const clientId = client?.clientId ?? input.env.GOOGLE_CLIENT_ID ?? ""
    const clientSecret = client
      ? decryptSecret(parseEnvelope(client.encryptedClientSecret), youtubeTokenEncryptionKey())
      : (input.env.GOOGLE_CLIENT_SECRET ?? "")
    const tokens = tokenSourceFromRefreshToken({
      clientId,
      clientSecret,
      refreshToken,
      tokenTransport: input.tokenTransport,
    })
    return createYoutubeClient(tokens, input.transport)
  }

  const services: WorkerServices = {
    async handleUpload(args) {
      return handleUpload({
        db,
        storage,
        loadYoutubeClient,
        recordingId: args.recordingId,
        producer,
      })
    },
    async handlePollProcessing(args) {
      return handlePollProcessing({
        db,
        loadYoutubeClient,
        recordingId: args.recordingId,
        producer,
      })
    },
    async handleDelete(args) {
      return handleDelete({ db, loadYoutubeClient, recordingId: args.recordingId })
    },
    async handleStorageCleanup(args) {
      return handleStorageCleanup({ db, storage, recordingId: args.recordingId })
    },
    handleExpireStaging() {
      return handleExpireStaging({ db, retentionHours: STAGING_RETENTION_HOURS })
    },
    async dispatchOutbox() {
      await dispatchPendingOutboxEvents(db, { publish: createOutboxEventPublisher(producer) })
    },
    async recoverOnStartup() {
      // 1) Unpublished outbox events: the dispatch loop picks them up.
      // 2) Due processing polls: re-enqueue intents for processing rows.
      const processing = await db
        .select({ id: recordings.id })
        .from(recordings)
        .where(eq(recordings.status, "YOUTUBE_PROCESSING"))
      for (const row of processing) {
        await db.transaction(async (tx) => {
          await insertOutboxEvent(tx, {
            type: "youtube.poll-processing",
            aggregateId: row.id,
            payload: { recordingId: row.id },
            availableAt: new Date(Date.now() + 15_000),
          })
        })
      }
      // 3) Stale YOUTUBE_UPLOADING rows: requeue them; the handler's
      //    compare-and-set keeps duplicate deliveries safe.
      const staleCutoff = new Date(Date.now() - 15 * 60 * 1000)
      const stale = await db
        .select({ id: recordings.id })
        .from(recordings)
        .where(
          and(eq(recordings.status, "YOUTUBE_UPLOADING"), lt(recordings.updatedAt, staleCutoff)),
        )
      for (const row of stale) {
        await db.transaction(async (tx) => {
          await insertOutboxEvent(tx, {
            type: "youtube.upload",
            aggregateId: row.id,
            payload: { recordingId: row.id },
          })
        })
      }
      // 4) DELETE_PENDING rows with pending intents are covered by outbox.
      // 5) Abandoned staging expiry piggybacks on the maintenance queue.
    },
    async close() {
      storage.close()
      await producer.close()
      void redis
    },
  }
  return services
}

export type UploadContext = {
  db: Db
  storage: StorageClient
  loadYoutubeClient: (userId: string) => Promise<YoutubeClient>
  recordingId: string
  producer: ReturnType<typeof createQueueProducer>
}

export type PollContext = {
  db: Db
  loadYoutubeClient: (userId: string) => Promise<YoutubeClient>
  recordingId: string
  producer: ReturnType<typeof createQueueProducer>
}

export type DeleteContext = {
  db: Db
  loadYoutubeClient: (userId: string) => Promise<YoutubeClient>
  recordingId: string
}

export type CleanupContext = {
  db: Db
  storage: StorageClient
  recordingId: string
}

export type ExpireContext = {
  db: Db
  retentionHours: number
}
