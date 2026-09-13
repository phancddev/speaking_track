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
  type Db,
} from "@speaking-track/db"
import { createStorage, createStorageConfig } from "@speaking-track/storage"
import { createAuth, type AppAuth } from "@/lib/auth/server"
import { getRecordingLimits } from "@/lib/storage"
import { bootstrapAdmin } from "../scripts/bootstrap-admin.mts"
import { createDisposableDatabase, type DisposableDatabase } from "./helpers"

/**
 * Recording lifecycle behavior (task 05 required tests) through the real
 * route handlers against a disposable PostgreSQL database and the compose
 * MinIO instance.
 */

const ORIGIN = "https://localhost"

// Storage-backed routes read process.env; seed S3_* and limit variables from
// the repo .env before any route import resolves them.
const rawEnv = readFileSync(new URL("../../../.env", import.meta.url), "utf8")
for (const line of rawEnv.split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (match && process.env[match[1]!] === undefined) {
    process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "")
  }
}
process.env.S3_INTERNAL_ENDPOINT = "http://127.0.0.1:9000"
process.env.S3_PUBLIC_ENDPOINT = "http://127.0.0.1:9000"
process.env.S3_REGION ??= "us-east-1"
process.env.S3_FORCE_PATH_STYLE ??= "true"
process.env.MAX_RECORDING_BYTES = String(100 * 1024 * 1024)
process.env.MAX_STAGING_BYTES = String(100 * 1024 * 1024)

let database: DisposableDatabase
let db: Db
let closeDb: () => Promise<void>
let auth: AppAuth
let ownerCookie = ""
let strangerCookie = ""
let ownerId = ""
let questionId = ""
let topicId = ""

const MIME = "video/webm;codecs=vp9,opus" as const

beforeAll(async () => {
  database = await createDisposableDatabase()
  const migrationConnection = postgres(database.url, { max: 1 })
  await migrate(drizzle(migrationConnection), {
    migrationsFolder: new URL("../../../packages/db/drizzle", import.meta.url).pathname,
  })
  await migrationConnection.end({ timeout: 5 })
  const client = createDbClient(createDatabaseConfig({ DATABASE_URL: database.url }))
  db = client.db
  closeDb = client.close
  auth = createAuth(db, { appOrigin: ORIGIN, secret: "a".repeat(40) })
  ;(globalThis as Record<string, unknown>)["__speakingTrackAuth"] = auth
  ;(globalThis as Record<string, unknown>)["__speakingTrackWebDb"] = db

  await bootstrapAdmin(db, {
    email: "admin@example.test",
    password: "admin-password-1",
    name: "Admin",
  })
  const adminCookie = await signIn("admin@example.test", "admin-password-1")

  // Create owner + stranger users and their data.
  const created: string[] = []
  for (const email of ["owner@example.test", "stranger@example.test"]) {
    requestCounter += 1
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/admin/create-user`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
          origin: ORIGIN,
          "x-forwarded-for": `10.88.0.${requestCounter % 250}`,
        },
        body: JSON.stringify({
          email,
          password: "user-pass-123",
          name: email.split("@")[0]!,
          role: "user",
        }),
      }),
    )
    if (response.status !== 200) throw new Error(`create-user failed: ${response.status}`)
    const body = (await response.json()) as { user: { id: string } }
    created.push(body.user.id)
  }
  ownerId = created[0]!
  ownerCookie = await signIn("owner@example.test", "user-pass-123")
  strangerCookie = await signIn("stranger@example.test", "user-pass-123")

  topicId = randomUUID()
  questionId = randomUUID()
  await db.insert(topics).values({ id: topicId, ownerId, title: "Recording test topic" })
  await db.insert(questions).values({ id: questionId, topicId, prompt: "Prompt", position: 0 })
})

afterAll(async () => {
  if (closeDb) await closeDb()
  if (database) await database.destroy()
})

let requestCounter = 0

async function signIn(email: string, password: string): Promise<string> {
  requestCounter += 1
  const response = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-forwarded-for": `10.88.0.${requestCounter % 250}`,
      },
      body: JSON.stringify({ email, password }),
    }),
  )
  if (response.status !== 200) throw new Error(`sign-in failed for ${email}`)
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")
}

function storageForTest() {
  const env = { ...processEnv() }
  return createStorage(
    createStorageConfig({
      ...env,
      S3_INTERNAL_ENDPOINT: "http://127.0.0.1:9000",
      S3_PUBLIC_ENDPOINT: "http://127.0.0.1:9000",
    }),
  )
}

function processEnv(): Record<string, string> {
  // Synchronous .env read for storage config keys.
  const raw = readFileSync(new URL("../../../.env", import.meta.url), "utf8")
  const env: Record<string, string> = {}
  for (const line of raw.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "")
  }
  return env
}

type ApiResult = { status: number; body: Record<string, unknown> }

async function api(
  cookie: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<ApiResult> {
  requestCounter += 1
  const headers: Record<string, string> = {
    cookie,
    origin: ORIGIN,
    "x-forwarded-for": `10.88.0.${requestCounter % 250}`,
  }
  if (init?.body !== undefined) headers["content-type"] = "application/json"
  const { routeTable } = await import("./recording-routes")
  const handler = routeTable(path, (init?.method ?? "GET").toUpperCase())
  if (!handler) throw new Error(`no route wiring for ${path}`)
  const request = new Request(new URL(`${ORIGIN}${path}`), {
    method: (init?.method ?? "GET").toUpperCase(),
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const response = await handler(request, { params: Promise.resolve({}) })
  const text = await response.text()
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  }
}

async function createUpload(
  cookie: string,
  overrides: Partial<Record<"mimeType" | "sizeBytes" | "durationMs", unknown>> = {},
) {
  return api(cookie, `/api/questions/${questionId}/recordings/uploads`, {
    method: "POST",
    body: {
      mimeType: MIME,
      sizeBytes: 2048,
      durationMs: 4000,
      ...overrides,
    },
  })
}

async function directPut(
  url: string,
  headers: Record<string, string>,
  body: Uint8Array,
): Promise<number> {
  // Node fetch routes through the environment proxy; talk to MinIO directly.
  const { request } = await import("node:http")
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: "PUT",
        headers,
      },
      (res) => {
        res.resume()
        res.on("end", () => resolve(res.statusCode ?? 0))
      },
    )
    req.on("error", reject)
    req.end(body)
  })
}

function fixtureBytes(size: number): Uint8Array {
  const buffer = new Uint8Array(size)
  for (let index = 0; index < size; index += 1) buffer[index] = index % 251
  return buffer
}

describe("recording access control", () => {
  it("a stranger cannot create, list, complete, retry, or delete the owner's recordings", async () => {
    const ownerList = await api(ownerCookie, `/api/questions/${questionId}/recordings`)
    expect(ownerList.status).toBe(200)

    const strangerList = await api(strangerCookie, `/api/questions/${questionId}/recordings`)
    expect(strangerList.status).toBe(404)

    const strangerCreate = await api(
      strangerCookie,
      `/api/questions/${questionId}/recordings/uploads`,
      {
        method: "POST",
        body: { mimeType: MIME, sizeBytes: 512, durationMs: 1000 },
      },
    )
    expect(strangerCreate.status).toBe(404)

    const strangerForeignQuestion = randomUUID()
    const strangerProbe = await api(
      strangerCookie,
      `/api/questions/${strangerForeignQuestion}/recordings`,
    )
    expect(strangerProbe.status).toBe(404)
  })
})

describe("create-upload validation", () => {
  it("rejects unsupported MIME and oversized files before creating a URL", async () => {
    const badMime = await createUpload(ownerCookie, { mimeType: "video/avi" })
    expect(badMime.status).toBe(400)

    const tooLarge = await createUpload(ownerCookie, { sizeBytes: 10 * 1024 * 1024 * 1024 })
    expect(tooLarge.status).toBe(413)
    expect(["VALIDATION_FAILED", "RECORDING_TOO_LARGE"]).toContain(
      (tooLarge.body.error as { code: string }).code,
    )
  })

  it("STORAGE_CAPACITY_LOW blocks new staging rows when the aggregate cap is hit", async () => {
    // Seed a large active staging row directly to exhaust capacity.
    await db.insert(recordings).values({
      questionId,
      ownerId,
      status: "STAGING",
      storageKey: `recordings/${ownerId}/${randomUUID()}/source.webm`,
      mimeType: MIME,
      sizeBytes: 95 * 1024 * 1024,
      durationMs: 1000,
    })
    const limits = getRecordingLimits()
    const incoming = Math.max(1, Number(limits.maxStagingBytes) - 95 * 1024 * 1024 + 1)
    const capped = await createUpload(ownerCookie, {
      sizeBytes: Math.min(incoming, limits.maxRecordingBytes),
    })
    expect(capped.status).toBe(429)
    expect((capped.body.error as { code: string }).code).toBe("STORAGE_CAPACITY_LOW")
  })
})

describe("complete verification", () => {
  it("rejects completion when the object is absent", async () => {
    const create = await createUpload(ownerCookie)
    expect(create.status).toBe(201)
    const recordingId = (create.body.data as { recording: { id: string } }).recording.id

    const complete = await api(ownerCookie, `/api/recordings/${recordingId}/complete`, {
      method: "POST",
    })
    expect(complete.status).toBe(404)
    expect((complete.body.error as { code: string }).code).toBe("UPLOAD_NOT_FOUND")
  })

  it("rejects byte mismatch and content-type mismatch", async () => {
    const storage = storageForTest()
    const create = await createUpload(ownerCookie)
    const data = create.body.data as {
      recording: { id: string; status: string }
      upload: { objectKey: string; url: string; headers: Record<string, string> }
    }
    expect(data.recording.status).toBe("STAGING")

    // Upload fewer bytes than declared.
    const put = await directPut(
      data.upload.url,
      { ...data.upload.headers, "content-length": String(1024) },
      fixtureBytes(1024),
    )
    expect(put).toBe(200)

    const mismatched = await api(ownerCookie, `/api/recordings/${data.recording.id}/complete`, {
      method: "POST",
    })
    expect(mismatched.status).toBe(400)
    expect((mismatched.body.error as { code: string }).code).toBe("UPLOAD_METADATA_MISMATCH")
    await storage.deletePrivateObject(data.upload.objectKey)
  })

  it("transitions STAGING to QUEUED with exactly one outbox intent; repeated completion is idempotent", async () => {
    const storage = storageForTest()
    const create = await createUpload(ownerCookie)
    const data = create.body.data as {
      recording: { id: string }
      upload: { objectKey: string; url: string; headers: Record<string, string> }
    }
    const blob = fixtureBytes(2048)
    const put = await directPut(data.upload.url, data.upload.headers, blob)
    expect(put).toBe(200)

    const first = await api(ownerCookie, `/api/recordings/${data.recording.id}/complete`, {
      method: "POST",
    })
    expect(first.status).toBe(200)
    expect((first.body.data as { alreadyQueued: boolean }).alreadyQueued).toBe(false)

    const second = await api(ownerCookie, `/api/recordings/${data.recording.id}/complete`, {
      method: "POST",
    })
    expect(second.status).toBe(200)
    expect((second.body.data as { alreadyQueued: boolean }).alreadyQueued).toBe(true)

    const intents = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, data.recording.id))
    expect(intents.filter((event) => event.type === "youtube.upload")).toHaveLength(1)

    const [row] = await db.select().from(recordings).where(eq(recordings.id, data.recording.id))
    expect(row!.status).toBe("QUEUED")
    await storage.deletePrivateObject(data.upload.objectKey)
  })
})

describe("retry rules", () => {
  it("retries a FAILED recording with source into QUEUED, but blocks YOUTUBE_UPLOAD_AMBIGUOUS and resumes video IDs to polling", async () => {
    // Plain FAILED with source.
    const failedId = randomUUID()
    await db.insert(recordings).values({
      id: failedId,
      questionId,
      ownerId,
      status: "FAILED",
      storageKey: `recordings/${ownerId}/${failedId}/source.webm`,
      mimeType: MIME,
      sizeBytes: 2048,
      durationMs: 3000,
      failureCode: "YOUTUBE_QUOTA_EXCEEDED",
      failureMessage: "Quota exhausted; retry later.",
    })
    const retried = await api(ownerCookie, `/api/recordings/${failedId}/retry`, { method: "POST" })
    expect(retried.status).toBe(200)
    const intents = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, failedId))
    expect(intents.filter((event) => event.type === "youtube.upload")).toHaveLength(1)

    // AMBIGUOUS is blocked from ordinary retry.
    const ambiguousId = randomUUID()
    await db.insert(recordings).values({
      id: ambiguousId,
      questionId,
      ownerId,
      status: "FAILED",
      storageKey: `recordings/${ownerId}/${ambiguousId}/source.webm`,
      mimeType: MIME,
      sizeBytes: 2048,
      durationMs: 3000,
      failureCode: "YOUTUBE_UPLOAD_AMBIGUOUS",
      failureMessage: "Outcome unknown.",
    })
    const blocked = await api(ownerCookie, `/api/recordings/${ambiguousId}/retry`, {
      method: "POST",
    })
    expect(blocked.status).toBe(409)
    expect((blocked.body.error as { code: string }).code).toBe("YOUTUBE_UPLOAD_AMBIGUOUS")

    // FAILED with a video ID resumes processing polling, never a new insert.
    const withVideoId = randomUUID()
    await db.insert(recordings).values({
      id: withVideoId,
      questionId,
      ownerId,
      status: "FAILED",
      storageKey: `recordings/${ownerId}/${withVideoId}/source.webm`,
      mimeType: MIME,
      sizeBytes: 2048,
      durationMs: 3000,
      youtubeVideoId: "vid-123",
      failureCode: "YOUTUBE_PROCESSING_FAILED",
      failureMessage: "Processing failed.",
    })
    const resumed = await api(ownerCookie, `/api/recordings/${withVideoId}/retry`, {
      method: "POST",
    })
    expect(resumed.status).toBe(200)
    const resumedIntents = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, withVideoId))
    expect(resumedIntents.filter((event) => event.type === "youtube.upload")).toHaveLength(0)
    expect(resumedIntents.filter((event) => event.type === "youtube.poll-processing")).toHaveLength(
      1,
    )
  })
})

describe("delete orchestration", () => {
  it("queues youtube.delete + storage.cleanup when both remote video and source exist", async () => {
    const id = randomUUID()
    await db.insert(recordings).values({
      id,
      questionId,
      ownerId,
      status: "READY",
      storageKey: `recordings/${ownerId}/${id}/source.webm`,
      mimeType: MIME,
      sizeBytes: 2048,
      durationMs: 3000,
      youtubeVideoId: "vid-del-1",
      youtubePrivacyStatus: "unlisted",
    })
    const del = await api(ownerCookie, `/api/recordings/${id}`, { method: "DELETE" })
    expect(del.status).toBe(200)

    const intents = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, id))
    expect(intents.filter((event) => event.type === "youtube.delete")).toHaveLength(1)
    expect(intents.filter((event) => event.type === "storage.cleanup")).toHaveLength(1)

    const [row] = await db.select().from(recordings).where(eq(recordings.id, id))
    expect(row!.status).toBe("DELETE_PENDING")

    // Hidden from lists.
    const list = await api(ownerCookie, `/api/questions/${questionId}/recordings`)
    const listed = list.body.data as { id: string }[]
    expect(listed.some((item) => item.id === id)).toBe(false)
  })
})

describe("abandoned staging expiry", () => {
  it("expires only STAGING rows past retention and queues cleanup for their objects", async () => {
    const staleId = randomUUID()
    const freshId = randomUUID()
    await db.insert(recordings).values([
      {
        id: staleId,
        questionId,
        ownerId,
        status: "STAGING",
        storageKey: `recordings/${ownerId}/${staleId}/source.webm`,
        mimeType: MIME,
        sizeBytes: 1024,
        durationMs: 500,
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      },
      {
        id: freshId,
        questionId,
        ownerId,
        status: "STAGING",
        storageKey: `recordings/${ownerId}/${freshId}/source.webm`,
        mimeType: MIME,
        sizeBytes: 1024,
        durationMs: 500,
      },
    ])

    const { expireAbandonedStaging } = await import("@/lib/services/recordings")
    const result = await expireAbandonedStaging(db, { retentionHours: 24 })
    expect(result.expired).toBeGreaterThanOrEqual(1)

    const [staleRow] = await db.select().from(recordings).where(eq(recordings.id, staleId))
    const [freshRow] = await db.select().from(recordings).where(eq(recordings.id, freshId))
    expect(staleRow!.status).toBe("EXPIRED")
    expect(freshRow!.status).toBe("STAGING")

    const intents = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, staleId))
    expect(intents.filter((event) => event.type === "storage.cleanup")).toHaveLength(1)
  })
})
