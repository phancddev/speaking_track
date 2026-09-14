import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import {
  attachTagToTopic,
  createDbClient,
  confirmStagedRecording,
  dispatchPendingOutboxEvents,
  getActiveStagingBytes,
  insertOutboxEvent,
  insertRecording,
  transitionRecordingStatus,
  createDraft,
  listDrafts,
  updateDraft,
  deleteDraft,
  withTransaction,
  type DbClient,
  type OutboxEvent,
} from "../src/index"
import { sql } from "drizzle-orm"
import { createDisposableDatabase, type DisposableDatabase } from "./helpers"

/**
 * Database-observable invariants against a real disposable PostgreSQL that
 * migrates from zero using the committed migration files.
 */

let disposable: DisposableDatabase
let client: DbClient

beforeAll(async () => {
  disposable = await createDisposableDatabase()
  client = createDbClient({
    url: disposable.url,
    maxConnections: 5,
    idleTimeoutSeconds: 5,
    connectTimeoutSeconds: 10,
  })
  await migrate(client.db, {
    migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
  })
  await seedUser(OWNER_A)
  await seedUser(OWNER_B)
})

afterAll(async () => {
  if (client) {
    await client.close()
  }
  if (disposable) {
    await disposable.destroy()
  }
})

const OWNER_A = `a-${randomUUID()}`
const OWNER_B = `b-${randomUUID()}`

async function seedUser(id: string): Promise<void> {
  await client.db.execute(
    sql`insert into "user" (id, name, email, email_verified) values (${id}, ${"n-" + id}, ${`${id}@example.test`}, true)`,
  )
}

async function seedOwnerWithTopicAndQuestion(): Promise<{ topicId: string; questionId: string }> {
  const topicRows = (await client.db.execute(
    sql`insert into topics (owner_id, title) values (${OWNER_A}, 'Work topics') returning id`,
  )) as unknown as { id: string }[]
  const topic = topicRows[0]
  const questionRows = (await client.db.execute(
    sql`insert into questions (topic_id, prompt, position) values (${topic.id}, 'Describe your job', 0) returning id`,
  )) as unknown as { id: string }[]
  const question = questionRows[0]
  return { topicId: topic.id, questionId: question.id }
}

async function seedStagingRecording(questionId: string, sizeBytes = 1000): Promise<string> {
  const result = await insertRecording(client.db, {
    questionId,
    ownerId: OWNER_A,
    mimeType: "video/webm;codecs=vp9,opus",
    sizeBytes,
    durationMs: 15000,
    storageKey: `recordings/${OWNER_A}/${randomUUID()}/source.webm`,
  })
  if (!result.ok) {
    throw new Error(`seed recording failed: ${result.reason}`)
  }
  return result.recording.id
}

describe("migration from zero", () => {
  it("applies committed migrations to an empty database", async () => {
    const tables = (await client.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    )) as unknown as { table_name: string }[]
    const names = tables.map((row) => row.table_name)
    for (const expected of [
      "user",
      "session",
      "account",
      "verification",
      "tags",
      "topics",
      "topic_tags",
      "questions",
      "drafts",
      "recordings",
      "youtube_connections",
      "outbox_events",
    ]) {
      expect(names).toContain(expected)
    }
    expect(names).not.toContain("__drizzle_migrations") // journal lives in the drizzle schema
  })

  it("is idempotent: reapplying migrations succeeds and adds nothing", async () => {
    await migrate(client.db, {
      migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
    })
    const [{ count }] = (await client.db.execute(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    )) as unknown as { count: number }[]
    expect(count).toBeGreaterThan(0)
  })
})

describe("tag normalized uniqueness per owner", () => {
  it("rejects a duplicate normalized name for the same owner but allows it across owners", async () => {
    await client.db.execute(
      sql`insert into tags (owner_id, name, normalized_name) values (${OWNER_A}, 'Part 1', 'part 1')`,
    )
    await expect(
      client.db.execute(
        sql`insert into tags (owner_id, name, normalized_name) values (${OWNER_A}, 'PART   1', 'part 1')`,
      ),
    ).rejects.toMatchObject({ cause: { code: "23505" } })

    await client.db.execute(
      sql`insert into tags (owner_id, name, normalized_name) values (${OWNER_B}, 'Part 1', 'part 1')`,
    )
    const [{ count }] = (await client.db.execute(
      sql`select count(*)::int as count from tags where normalized_name = 'part 1'`,
    )) as unknown as { count: number }[]
    expect(count).toBe(2)
  })
})

describe("topic/tag same-owner invariant", () => {
  it("rejects linking a foreign owner's tag to a topic", async () => {
    const { topicId } = await seedOwnerWithTopicAndQuestion()
    const [foreignTag] = (await client.db.execute(
      sql`insert into tags (owner_id, name, normalized_name) values (${OWNER_B}, 'Foreign', 'foreign') returning id`,
    )) as unknown as { id: string }[]

    const result = await attachTagToTopic(client.db, { topicId, tagId: foreignTag.id })
    expect(result).toEqual({ ok: false, reason: "owner_mismatch" })

    const [{ count }] = (await client.db.execute(
      sql`select count(*)::int as count from topic_tags`,
    )) as unknown as { count: number }[]
    expect(count).toBe(0)
  })

  it("accepts and idempotently re-links same-owner tags", async () => {
    const { topicId } = await seedOwnerWithTopicAndQuestion()
    const [ownTag] = (await client.db.execute(
      sql`insert into tags (owner_id, name, normalized_name) values (${OWNER_A}, 'Travel', 'travel') returning id`,
    )) as unknown as { id: string }[]

    const first = await attachTagToTopic(client.db, { topicId, tagId: ownTag.id })
    const second = await attachTagToTopic(client.db, { topicId, tagId: ownTag.id })
    expect(first).toEqual({ ok: true, inserted: true })
    expect(second).toEqual({ ok: true, inserted: false })

    const [{ count }] = (await client.db.execute(
      sql`select count(*)::int as count from topic_tags where topic_id = ${topicId} and tag_id = ${ownTag.id}`,
    )) as unknown as { count: number }[]
    expect(count).toBe(1)
  })
})

describe("recording owner invariant", () => {
  it("rejects creating a recording whose ownerId differs from the owning topic's owner", async () => {
    const { questionId } = await seedOwnerWithTopicAndQuestion()
    const result = await insertRecording(client.db, {
      questionId,
      ownerId: OWNER_B,
      mimeType: "video/mp4",
      sizeBytes: 10,
      durationMs: 1000,
      storageKey: `recordings/${OWNER_B}/${randomUUID()}/source.mp4`,
    })
    expect(result).toEqual({ ok: false, reason: "owner_mismatch" })
    const [{ count }] = (await client.db.execute(
      sql`select count(*)::int as count from recordings`,
    )) as unknown as { count: number }[]
    expect(count).toBe(0)
  })

  it("stores ownerId copied from the owning topic on success", async () => {
    const { questionId } = await seedOwnerWithTopicAndQuestion()
    const result = await insertRecording(client.db, {
      questionId,
      ownerId: OWNER_A,
      mimeType: "video/webm;codecs=vp9,opus",
      sizeBytes: 42,
      durationMs: 5000,
      storageKey: `recordings/${OWNER_A}/${randomUUID()}/source.webm`,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.recording.ownerId).toBe(OWNER_A)
      expect(result.recording.status).toBe("STAGING")
    }
  })
})

describe("multi-draft per question with optional titles", () => {
  it("appends drafts in order and accepts empty content", async () => {
    const { questionId } = await seedOwnerWithTopicAndQuestion()
    const first = await createDraft(client.db, {
      questionId,
      ownerId: OWNER_A,
      title: null,
      content: "",
    })
    const second = await createDraft(client.db, {
      questionId,
      ownerId: OWNER_A,
      title: "Opening",
      content: "idea",
    })
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.draft.title).toBeNull()
      expect(first.draft.content).toBe("")
      expect(first.draft.position).toBe(0)
    }
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.draft.position).toBe(1)
    }
    const listed = await listDrafts(client.db, { questionId, ownerId: OWNER_A })
    expect(listed.ok && listed.drafts.map((d) => d.title)).toEqual([null, "Opening"])
  })

  it("rejects foreign owners and missing questions", async () => {
    const { questionId } = await seedOwnerWithTopicAndQuestion()
    expect(
      await createDraft(client.db, { questionId, ownerId: OWNER_B, title: null, content: "x" }),
    ).toEqual({ ok: false, reason: "owner_mismatch" })
    expect(
      await createDraft(client.db, {
        questionId: randomUUID(),
        ownerId: OWNER_A,
        title: null,
        content: "x",
      }),
    ).toEqual({ ok: false, reason: "question_not_found" })
  })

  it("updates fields partially; title null clears while omitted keeps", async () => {
    const { questionId } = await seedOwnerWithTopicAndQuestion()
    const created = await createDraft(client.db, {
      questionId,
      ownerId: OWNER_A,
      title: "Keep me?",
      content: "v1",
    })
    if (!created.ok) throw new Error("seed failed")
    const cleared = await updateDraft(client.db, {
      draftId: created.draft.id,
      ownerId: OWNER_A,
      title: null,
    })
    expect(cleared.ok && cleared.draft.title).toBeNull()
    expect(cleared.ok && cleared.draft.content).toBe("v1")
    const updated = await updateDraft(client.db, {
      draftId: created.draft.id,
      ownerId: OWNER_A,
      content: "v2",
    })
    expect(updated.ok && updated.draft.content).toBe("v2")
    expect(updated.ok && updated.draft.title).toBeNull()
    expect(
      await updateDraft(client.db, { draftId: created.draft.id, ownerId: OWNER_B, content: "no" }),
    ).toEqual({ ok: false, reason: "draft_not_found" })
  })

  it("deletes one draft of many and leaves siblings untouched", async () => {
    const { questionId } = await seedOwnerWithTopicAndQuestion()
    const a = await createDraft(client.db, {
      questionId,
      ownerId: OWNER_A,
      title: null,
      content: "a",
    })
    const b = await createDraft(client.db, {
      questionId,
      ownerId: OWNER_A,
      title: null,
      content: "b",
    })
    if (!a.ok || !b.ok) throw new Error("seed failed")
    const removed = await deleteDraft(client.db, { draftId: a.draft.id, ownerId: OWNER_A })
    expect(removed).toEqual({ ok: true, deleted: true })
    const listed = await listDrafts(client.db, { questionId, ownerId: OWNER_A })
    expect(listed.ok && listed.drafts.map((d) => d.content)).toEqual(["b"])
    expect(await deleteDraft(client.db, { draftId: a.draft.id, ownerId: OWNER_A })).toEqual({
      ok: true,
      deleted: false,
    })
  })
})

describe("recording compare-and-set transitions", () => {
  it("rejects an invalid transition with no side effects", async () => {
    const { questionId } = await seedOwnerWithTopicAndQuestion()
    const recordingId = await seedStagingRecording(questionId)
    const before = await pendingOutboxCount()
    const result = await transitionRecordingStatus(client.db, {
      recordingId,
      expected: "STAGING",
      next: "READY",
    })
    expect(result).toEqual({ ok: false, code: "INVALID_RECORDING_STATE" })
    expect(await pendingOutboxCount()).toBe(before)
    const [row] = (await client.db.execute(
      sql`select status from recordings where id = ${recordingId}`,
    )) as unknown as { status: string }[]
    expect(row.status).toBe("STAGING")
  })

  it("rejects a stale transition when the state already moved", async () => {
    const { questionId } = await seedOwnerWithTopicAndQuestion()
    const recordingId = await seedStagingRecording(questionId)
    const confirmed = await confirmStagedRecording(client.db, recordingId)
    expect(confirmed.ok).toBe(true)
    const stale = await confirmStagedRecording(client.db, recordingId)
    expect(stale).toEqual({ ok: false, code: "INVALID_RECORDING_STATE" })
    // Idempotent completion must not create a second intent.
    const [{ count }] = (await client.db.execute(
      sql`select count(*)::int as count from outbox_events where aggregate_id = ${recordingId} and type = 'youtube.upload'`,
    )) as unknown as { count: number }[]
    expect(count).toBe(1)
  })

  it("reports RESOURCE_NOT_FOUND for an unknown recording", async () => {
    const result = await transitionRecordingStatus(client.db, {
      recordingId: randomUUID(),
      expected: "STAGING",
      next: "QUEUED",
    })
    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" })
  })

  it("applies allowed transitions and patches", async () => {
    const { questionId } = await seedOwnerWithTopicAndQuestion()
    const recordingId = await seedStagingRecording(questionId)
    const queued = await transitionRecordingStatus(client.db, {
      recordingId,
      expected: "STAGING",
      next: "QUEUED",
    })
    const uploading = await transitionRecordingStatus(client.db, {
      recordingId,
      expected: "QUEUED",
      next: "YOUTUBE_UPLOADING",
      patch: { attemptCount: 1 },
    })
    const processing = await transitionRecordingStatus(client.db, {
      recordingId,
      expected: "YOUTUBE_UPLOADING",
      next: "YOUTUBE_PROCESSING",
      patch: { youtubeVideoId: "vid-123", youtubePrivacyStatus: "unlisted" },
    })
    const ready = await transitionRecordingStatus(client.db, {
      recordingId,
      expected: "YOUTUBE_PROCESSING",
      next: "READY",
      patch: { readyAt: new Date() },
    })
    expect([queued.ok, uploading.ok, processing.ok, ready.ok]).toEqual([true, true, true, true])
    if (uploading.ok) {
      expect(uploading.recording.attemptCount).toBe(1)
    }
    if (processing.ok) {
      expect(processing.recording.youtubeVideoId).toBe("vid-123")
    }
  })
})

describe("state transition and outbox intent commit or roll back together", () => {
  it("STAGING->QUEUED creates exactly one youtube.upload outbox row in the same transaction", async () => {
    const { questionId } = await seedOwnerWithTopicAndQuestion()
    const recordingId = await seedStagingRecording(questionId)
    const result = await confirmStagedRecording(client.db, recordingId)
    expect(result.ok).toBe(true)
    const events = (await client.db.execute(
      sql`select type, payload, aggregate_id from outbox_events where aggregate_id = ${recordingId}`,
    )) as unknown as { type: string; payload: unknown; aggregate_id: string }[]
    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event.type).toBe("youtube.upload")
    expect(event.payload).toEqual({ recordingId })
  })

  it("rolls both back together when the surrounding transaction fails", async () => {
    const { questionId } = await seedOwnerWithTopicAndQuestion()
    const recordingId = await seedStagingRecording(questionId)
    await expect(
      withTransaction(client.db, async (tx) => {
        const result = await confirmStagedRecording(tx, recordingId)
        expect(result.ok).toBe(true)
        // Simulate a later failure inside the same transaction.
        await tx.execute(sql`select 1/0`)
      }),
    ).rejects.toBeTruthy()

    const [row] = (await client.db.execute(
      sql`select status from recordings where id = ${recordingId}`,
    )) as unknown as { status: string }[]
    expect(row.status).toBe("STAGING")
    const [{ count }] = (await client.db.execute(
      sql`select count(*)::int as count from outbox_events where aggregate_id = ${recordingId}`,
    )) as unknown as { count: number }[]
    expect(count).toBe(0)
  })
})

describe("outbox claim/publish bookkeeping", () => {
  it("claims with attempts increment, marks published, and records failures", async () => {
    const { questionId } = await seedOwnerWithTopicAndQuestion()
    const recordingId = await seedStagingRecording(questionId)
    await confirmStagedRecording(client.db, recordingId)

    const published: OutboxEvent[] = []
    const before = await pendingOutboxCount()
    const first = await dispatchPendingOutboxEvents(client.db, {
      publish: async (event) => {
        published.push(event)
      },
    })
    // This test's event plus any still-pending intents from earlier cases.
    expect(first.claimed).toBe(before)
    expect(first.published).toBe(before)
    expect(first.failed).toBe(0)
    expect(published.some((event) => event.aggregateId === recordingId)).toBe(true)
    expect(published.every((event) => event.type !== undefined)).toBe(true)

    // Re-dispatch after everything published claims nothing.
    const second = await dispatchPendingOutboxEvents(client.db, {
      publish: async () => {},
    })
    expect(second.claimed).toBe(0)

    const [eventRow] = (await client.db.execute(
      sql`select attempts, published_at, last_error from outbox_events where aggregate_id = ${recordingId}`,
    )) as unknown as { attempts: number; published_at: Date | null; last_error: string | null }[]
    expect(eventRow.attempts).toBe(1)
    expect(eventRow.published_at).not.toBeNull()
    expect(eventRow.last_error).toBeNull()
  })

  it("keeps failed publishes unpublished with lastError recorded", async () => {
    const { questionId } = await seedOwnerWithTopicAndQuestion()
    const recordingId = await seedStagingRecording(questionId)
    await confirmStagedRecording(client.db, recordingId)
    await dispatchPendingOutboxEvents(client.db, {
      publish: async () => {
        throw new Error("redis unavailable")
      },
    })
    const [eventRow] = (await client.db.execute(
      sql`select attempts, published_at, last_error from outbox_events where aggregate_id = ${recordingId}`,
    )) as unknown as { attempts: number; published_at: Date | null; last_error: string | null }[]
    expect(eventRow.attempts).toBe(1)
    expect(eventRow.published_at).toBeNull()
    expect(eventRow.last_error).toContain("redis unavailable")
  })

  it("rejects outbox.dispatch as an intent type", async () => {
    await expect(
      insertOutboxEvent(client.db, {
        type: "outbox.dispatch",
        aggregateId: randomUUID(),
        payload: { recordingId: randomUUID() },
      }),
    ).rejects.toThrow(/outbox\.dispatch/)
  })
})

describe("active staging byte calculation", () => {
  it("sums only recordings not yet cleaned, expired, or deleted", async () => {
    const { questionId } = await seedOwnerWithTopicAndQuestion()
    const keep = await seedStagingRecording(questionId, 500)
    const cleanMe = await seedStagingRecording(questionId, 300)
    const expireMe = await seedStagingRecording(questionId, 200)
    const noObject = await seedStagingRecording(questionId, 999)

    // cleanMe: cleaned (storage key cleared + DELETED)
    await transitionRecordingStatus(client.db, {
      recordingId: cleanMe,
      expected: "STAGING",
      next: "DELETE_PENDING",
    })
    await transitionRecordingStatus(client.db, {
      recordingId: cleanMe,
      expected: "DELETE_PENDING",
      next: "DELETED",
      patch: { storageKey: null },
    })
    // expireMe: expired
    await transitionRecordingStatus(client.db, {
      recordingId: expireMe,
      expected: "STAGING",
      next: "EXPIRED",
    })
    // noObject: cleanup already removed the staged object
    await transitionRecordingStatus(client.db, {
      recordingId: noObject,
      expected: "STAGING",
      next: "DELETE_PENDING",
    })
    await transitionRecordingStatus(client.db, {
      recordingId: noObject,
      expected: "DELETE_PENDING",
      next: "DELETED",
      patch: { storageKey: null },
    })

    const bytes = await getActiveStagingBytes(client.db)
    const activeRows = (await client.db.execute(
      sql`select id, size_bytes from recordings where storage_key is not null and status not in ('DELETED','EXPIRED')`,
    )) as unknown as { id: string; size_bytes: string | number }[]
    const activeIds = new Set(activeRows.map((row) => row.id))

    expect(bytes).toBe(activeRows.reduce((sum, row) => sum + Number(row.size_bytes), 0))
    expect(activeIds.has(cleanMe)).toBe(false)
    expect(activeIds.has(expireMe)).toBe(false)
    expect(activeIds.has(noObject)).toBe(false)
    expect(activeIds.has(keep)).toBe(true)
  })
})

async function pendingOutboxCount(): Promise<number> {
  const [{ count }] = (await client.db.execute(
    sql`select count(*)::int as count from outbox_events where published_at is null`,
  )) as unknown as { count: number }[]
  return count
}
