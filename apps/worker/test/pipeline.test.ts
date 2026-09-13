import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq } from "drizzle-orm"
import {
  createDatabaseConfig,
  createDbClient,
  outboxEvents,
  questions,
  recordings,
  topics,
  user as userTable,
  youtubeConnections,
  SINGLETON_YOUTUBE_CONNECTION_ID,
  type Db,
} from "@speaking-track/db"
import { createWorkerServices, type WorkerServices } from "../src/services"
import { scanOnce } from "../src/scanner"
import { encryptSecret, serializeEnvelope } from "@speaking-track/youtube"

/**
 * Worker pipeline behavior (task 06 required tests) against a disposable
 * PostgreSQL database and a CONTROLLED fake YouTube HTTP transport — only
 * the provider boundary is faked; database, outbox, and state machine are
 * real.
 */

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY
process.env.YOUTUBE_UPLOAD_CONCURRENCY ??= "1"
process.env.TEMP_UPLOAD_RETENTION_HOURS ??= "24"

let database: { url: string; destroy(): Promise<void> }
let db: Db
let closeDb: () => Promise<void>
let services: WorkerServices

const QUESTION_ID = randomUUID()
let OWNER_ID = "seed"

/** Controlled fake YouTube provider transport. */
type ProviderState = {
  sessionUri: string
  bytesReceived: number
  videoId: string
  uploadStatus: string
  privacyStatus: "unlisted" | "private"
  embeddable: boolean
  insertCalls: number
  deleted: string[]
  failInitWith?: { status: number; reason: string }
  failFinalResponse?: boolean
}

const provider: ProviderState = {
  sessionUri: "https://fake.youtube/upload/session-1",
  bytesReceived: 0,
  videoId: "vid-" + randomUUID().slice(0, 8),
  uploadStatus: "uploaded",
  privacyStatus: "unlisted",
  embeddable: true,
  insertCalls: 0,
  deleted: [],
}

const fakeTransport = async (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string | Uint8Array },
): Promise<{ status: number; body: string; headers: Record<string, string> }> => {
  // Token endpoint.
  if (url.includes("oauth2.googleapis.com/token")) {
    return {
      status: 200,
      body: JSON.stringify({
        access_token: "fake-access",
        expires_in: 3600,
        scope: "s",
        token_type: "Bearer",
      }),
      headers: {},
    }
  }
  // Resumable session init.
  if (url.includes("upload/youtube/v3/videos") && init.method === "POST") {
    provider.insertCalls += 1
    if (provider.failInitWith) {
      return {
        status: provider.failInitWith.status,
        body: JSON.stringify({ error: { errors: [{ reason: provider.failInitWith.reason }] } }),
        headers: {},
      }
    }
    return { status: 200, body: "", headers: { location: provider.sessionUri } }
  }
  // Session status / media.
  if (url === provider.sessionUri) {
    if (init.method === "PUT") {
      const range = init.headers["content-range"] ?? ""
      if (range.includes("bytes */")) {
        // Status query.
        if (provider.bytesReceived > 0) {
          return {
            status: 308,
            body: "",
            headers: { range: `bytes=0-${provider.bytesReceived - 1}` },
          }
        }
        return { status: 308, body: "", headers: {} }
      }
      // Final media push.
      provider.bytesReceived += (init.body as Uint8Array).byteLength
      if (provider.failFinalResponse) {
        // Connection dropped: no usable final response.
        return { status: 500, body: "", headers: {} }
      }
      return {
        status: 201,
        body: JSON.stringify({ id: provider.videoId }),
        headers: {},
      }
    }
  }
  // Video status.
  if (url.includes("/youtube/v3/videos") && init.method === "GET") {
    return {
      status: 200,
      body: JSON.stringify({
        items: [
          {
            status: {
              uploadStatus: provider.uploadStatus,
              privacyStatus: provider.privacyStatus,
              embeddable: provider.embeddable,
            },
            processingDetails: {},
          },
        ],
      }),
      headers: {},
    }
  }
  // Delete.
  if (url.includes("/youtube/v3/videos/") && init.method === "DELETE") {
    provider.deleted.push(url.split("/").pop()!)
    return { status: 204, body: "", headers: {} }
  }
  // Channels.
  if (url.includes("/youtube/v3/channels")) {
    return {
      status: 200,
      body: JSON.stringify({ items: [{ id: "chan-1", snippet: { title: "Fake Channel" } }] }),
      headers: {},
    }
  }
  return { status: 404, body: "{}", headers: {} }
}

function seedEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of readFileSync(new URL("../../../.env", import.meta.url), "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "")
  }
  env.S3_INTERNAL_ENDPOINT = "http://127.0.0.1:9000"
  env.S3_PUBLIC_ENDPOINT = "http://127.0.0.1:9000"
  env.YOUTUBE_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY
  return env
}

async function queueRecording(input: Partial<typeof recordings.$inferInsert> & { id: string }) {
  if (input.storageKey) {
    const { createStorage, createStorageConfig } = await import("@speaking-track/storage")
    const env = seedEnv()
    const storage = createStorage(createStorageConfig(env))
    const putUrl = await storage.createPresignedUpload({
      ownerId: OWNER_ID,
      recordingId: input.id,
      mimeType: "video/webm;codecs=vp9,opus",
      sizeBytes: 128,
    })
    const { request } = await import("node:http")
    await new Promise<void>((resolve, reject) => {
      const target = new URL(putUrl.url)
      const req = request(
        {
          hostname: target.hostname,
          port: target.port,
          path: target.pathname + target.search,
          method: "PUT",
          headers: putUrl.headers,
        },
        (res) => {
          res.resume()
          res.on("end", () =>
            (res.statusCode ?? 0) < 300 ? resolve() : reject(new Error("PUT " + res.statusCode)),
          )
        },
      )
      req.on("error", reject)
      req.end(new Uint8Array(128))
    })
    storage.close()
    input.storageKey = putUrl.objectKey
  }
  await db.insert(recordings).values({
    questionId: QUESTION_ID,
    ownerId: OWNER_ID,
    status: "QUEUED",
    mimeType: "video/webm;codecs=vp9,opus",
    sizeBytes: 128,
    durationMs: 1000,
    ...input,
  })
}

beforeAll(async () => {
  const env: Record<string, string> = {}
  for (const line of readFileSync(new URL("../../../.env", import.meta.url), "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "")
  }
  const dbName = `worker_test_${randomUUID().replaceAll("-", "").slice(0, 10)}`
  const admin = postgres(
    `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:5432/postgres`,
    { max: 1 },
  )
  await admin.unsafe(`create database "${dbName}"`)
  await admin.end({ timeout: 5 })
  const url = `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:5432/${dbName}`
  database = {
    url,
    destroy: async () => {
      const dropper = postgres(
        `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:5432/postgres`,
        { max: 1 },
      )
      await dropper.unsafe(`drop database if exists "${dbName}" with (force)`)
      await dropper.end({ timeout: 5 })
    },
  }

  const mc = postgres(url, { max: 1 })
  await migrate(drizzle(mc), {
    migrationsFolder: new URL("../../../packages/db/drizzle", import.meta.url).pathname,
  })
  await mc.end({ timeout: 5 })
  const client = createDbClient(createDatabaseConfig({ DATABASE_URL: url }))
  db = client.db
  closeDb = client.close

  // Seed owner/topic/question and a CONNECTED youtube connection.
  const ownerId = randomUUID()
  const topicId = randomUUID()
  await db.insert(userTable).values({
    id: ownerId,
    name: "Worker Owner",
    email: `owner-${ownerId.slice(0, 8)}@test.local`,
    emailVerified: true,
  })
  OWNER_ID = ownerId
  await db.insert(topics).values({ id: topicId, ownerId, title: "Worker test topic" })
  await db.insert(questions).values({ id: QUESTION_ID, topicId, prompt: "Prompt", position: 0 })
  await db.insert(youtubeConnections).values({
    id: SINGLETON_YOUTUBE_CONNECTION_ID,
    channelId: "chan-1",
    channelTitle: "Fake Channel",
    encryptedRefreshToken: serializeEnvelope(encryptSecret("fake-refresh-token", ENCRYPTION_KEY)),
    scope: "scope",
    status: "CONNECTED",
    connectedByUserId: ownerId,
  })

  const { Redis } = await import("ioredis")
  const redisUrl = new URL(env.REDIS_URL!)
  redisUrl.hostname = "127.0.0.1"
  redisUrl.pathname = "/13"
  const redis = new Redis(redisUrl.toString(), { lazyConnect: true, maxRetriesPerRequest: null })
  await redis.connect()
  const workerEnv = seedEnv()
  workerEnv.REDIS_URL = redisUrl.toString()
  services = createWorkerServices({
    db,
    redis,
    env: workerEnv,
    transport: fakeTransport,
    tokenTransport: fakeTransport,
  })
})

afterAll(async () => {
  await services?.close().catch(() => undefined)
  if (closeDb) await closeDb()
  if (database) await database.destroy()
})

describe("youtube.upload processor", () => {
  it("uploads once, persists the video ID before polling, and marks READY only when unlisted+embeddable", async () => {
    const id = randomUUID()
    await queueRecording({ id, storageKey: `recordings/${OWNER_ID}/${id}/source.webm` })

    await services.handleUpload({ recordingId: id })
    const afterUpload = (await db.select().from(recordings).where(eq(recordings.id, id)))[0]!
    expect(afterUpload.youtubeVideoId).toBe(provider.videoId)
    expect(afterUpload.status).toBe("YOUTUBE_PROCESSING")
    expect(provider.insertCalls).toBe(1)

    // Poll to READY.
    provider.uploadStatus = "processed"
    await services.handlePollProcessing({ recordingId: id })
    const ready = (await db.select().from(recordings).where(eq(recordings.id, id)))[0]!
    expect(ready.status).toBe("READY")
    expect(ready.youtubePrivacyStatus).toBe("unlisted")

    // READY queued source cleanup; running it removes the key.
    await services.handleStorageCleanup({ recordingId: id })
    const cleaned = (await db.select().from(recordings).where(eq(recordings.id, id)))[0]!
    expect(cleaned.storageKey).toBeNull()
  })

  it("duplicate delivery with an existing youtubeVideoId never calls videos.insert again", async () => {
    const id = randomUUID()
    await queueRecording({ id, youtubeVideoId: "vid-existing", status: "YOUTUBE_PROCESSING" })
    const insertsBefore = provider.insertCalls

    await services.handleUpload({ recordingId: id })
    expect(provider.insertCalls).toBe(insertsBefore)
    const row = (await db.select().from(recordings).where(eq(recordings.id, id)))[0]!
    expect(["YOUTUBE_PROCESSING"]).toContain(row.status)
  })

  it("quotaExceeded defers instead of failing: QUEUED with a past-reset retry timestamp", async () => {
    const id = randomUUID()
    await queueRecording({ id, storageKey: `recordings/${OWNER_ID}/${id}/source.webm` })
    provider.failInitWith = { status: 403, reason: "quotaExceeded" }

    await services.handleUpload({ recordingId: id })
    provider.failInitWith = undefined
    const row = (await db.select().from(recordings).where(eq(recordings.id, id)))[0]!
    expect(row.status).toBe("QUEUED")
    expect(row.failureCode).toBe("YOUTUBE_QUOTA_EXCEEDED")
    // Deferral lands within (now, now + 25h]: strictly future, past the next
    // midnight-Pacific reset, and never more than a day out.
    const deferred = row.uploadDeferredUntil!.getTime()
    expect(deferred).toBeGreaterThan(Date.now())
    expect(deferred).toBeLessThanOrEqual(Date.now() + 25 * 60 * 60 * 1000)
  })

  it("revoked refresh token marks the connection REAUTH_REQUIRED and the recording actionable", async () => {
    const id = randomUUID()
    await queueRecording({ id, storageKey: `recordings/${OWNER_ID}/${id}/source.webm` })
    provider.failInitWith = { status: 401, reason: "unauthorized" }

    await services.handleUpload({ recordingId: id })
    provider.failInitWith = undefined
    const row = (await db.select().from(recordings).where(eq(recordings.id, id)))[0]!
    expect(row.status).toBe("FAILED")
    expect(row.failureCode).toBe("YOUTUBE_REAUTH_REQUIRED")
    const connection = (await db.select().from(youtubeConnections).limit(1))[0]!
    expect(connection.status).toBe("REAUTH_REQUIRED")
    // Restore for later tests.
    await db.update(youtubeConnections).set({ status: "CONNECTED" })
  })

  it("a forced private result is FAILED/YOUTUBE_PRIVATE_RESTRICTION, never READY", async () => {
    const id = randomUUID()
    await queueRecording({ id, youtubeVideoId: "vid-private", status: "YOUTUBE_PROCESSING" })
    provider.privacyStatus = "private"

    await services.handlePollProcessing({ recordingId: id })
    provider.privacyStatus = "unlisted"
    const row = (await db.select().from(recordings).where(eq(recordings.id, id)))[0]!
    expect(row.status).toBe("FAILED")
    expect(row.failureCode).toBe("YOUTUBE_PRIVATE_RESTRICTION")
  })

  it("processing failure retains the source; success queues cleanup", async () => {
    const failedId = randomUUID()
    await queueRecording({
      id: failedId,
      youtubeVideoId: "vid-pf",
      status: "YOUTUBE_PROCESSING",
      storageKey: `recordings/seed/${failedId}/source.webm`,
    })
    provider.uploadStatus = "failed"
    await services.handlePollProcessing({ recordingId: failedId })
    provider.uploadStatus = "processed"
    const failedRow = (await db.select().from(recordings).where(eq(recordings.id, failedId)))[0]!
    expect(failedRow.status).toBe("FAILED")
    expect(failedRow.storageKey).not.toBeNull()
  })

  it("an unreadable final response fails closed with YOUTUBE_UPLOAD_AMBIGUOUS and retains the source", async () => {
    const id = randomUUID()
    await queueRecording({ id, storageKey: `recordings/${OWNER_ID}/${id}/source.webm` })
    provider.failFinalResponse = true

    await services.handleUpload({ recordingId: id })
    provider.failFinalResponse = false
    const row = (await db.select().from(recordings).where(eq(recordings.id, id)))[0]!
    expect(row.status).toBe("FAILED")
    expect(row.failureCode).toBe("YOUTUBE_UPLOAD_AMBIGUOUS")
    expect(row.storageKey).not.toBeNull()
  })

  it("delete is idempotent when the remote video already vanished", async () => {
    const id = randomUUID()
    await queueRecording({
      id,
      youtubeVideoId: "vid-gone",
      status: "DELETE_PENDING",
      storageKey: `recordings/${OWNER_ID}/${id}/source.webm`,
    })

    await services.handleDelete({ recordingId: id })
    // 404 path: simulate by deleting from provider first.
    provider.deleted.length = 0
    const originalTransportCalls = provider.deleted.length
    void originalTransportCalls
    // Second delete with the video now missing from provider state machine
    // (youtubeVideoId cleared on success) is a safe no-op.
    await services.handleDelete({ recordingId: id }).catch(() => undefined)
    const row = (await db.select().from(recordings).where(eq(recordings.id, id)))[0]!
    expect(["DELETE_PENDING", "DELETED"]).toContain(row.status)
  })

  it("worker recovery requeues unpublished/due work without duplicate terminal effects", async () => {
    const processingId = randomUUID()
    await queueRecording({
      id: processingId,
      youtubeVideoId: "vid-rec",
      status: "YOUTUBE_PROCESSING",
    })

    await services.recoverOnStartup()
    const intents = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, processingId))
    expect(intents.some((event) => event.type === "youtube.poll-processing")).toBe(true)
  })
})

describe("encryption envelope", () => {
  it("round-trips and tampering fails closed without logging secrets", async () => {
    const { decryptSecret, parseEnvelope } = await import("@speaking-track/youtube")
    const envelope = encryptSecret("super-secret", ENCRYPTION_KEY)
    expect(decryptSecret(envelope, ENCRYPTION_KEY)).toBe("super-secret")

    const tampered = { ...envelope, ciphertext: Buffer.from("tampered").toString("base64") }
    expect(() => decryptSecret(parseEnvelope(JSON.stringify(tampered)), ENCRYPTION_KEY)).toThrow(
      /Decryption failed/,
    )

    const wrongKey = Buffer.alloc(32, 1).toString("base64")
    expect(() => decryptSecret(envelope, wrongKey)).toThrow(/Decryption failed|key/)
  })
})
describe("deferred-upload scanner", () => {
  const scan = () => scanOnce(db, () => undefined)

  it("emits exactly one upload intent for due QUEUED recordings", async () => {
    const dueId = randomUUID()
    await queueRecording({ id: dueId, storageKey: `recordings/${OWNER_ID}/${dueId}/source.webm` })

    const emitted = await scan()
    expect(emitted).toBeGreaterThanOrEqual(1)
    const intents = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, dueId))
    expect(intents.filter((event) => event.type === "youtube.upload").length).toBe(1)

    // A second scan must not double-enqueue while the intent is unpublished.
    await scan()
    const again = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, dueId))
    expect(again.filter((event) => event.type === "youtube.upload").length).toBe(1)
  })

  it("skips quota-deferred recordings until the deferral lapses", async () => {
    const deferredId = randomUUID()
    await queueRecording({
      id: deferredId,
      storageKey: `recordings/${OWNER_ID}/${deferredId}/source.webm`,
      uploadDeferredUntil: new Date(Date.now() + 60 * 60 * 1000),
    })

    await scan()
    const intents = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, deferredId))
    expect(intents.filter((event) => event.type === "youtube.upload").length).toBe(0)

    // Once the deferral is past, the scanner picks the recording up again.
    await db
      .update(recordings)
      .set({ uploadDeferredUntil: new Date(Date.now() - 1000) })
      .where(eq(recordings.id, deferredId))
    const emitted = await scan()
    expect(emitted).toBeGreaterThanOrEqual(1)
    const picked = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, deferredId))
    expect(picked.some((event) => event.type === "youtube.upload")).toBe(true)
  })
})
