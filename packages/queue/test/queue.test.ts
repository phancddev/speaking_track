import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { QUEUES, type JobName } from "@speaking-track/contracts"
import {
  createOutboxEventPublisher,
  createQueueProducer,
  createRedisConfig,
  storageCleanupJobId,
  toBullmqJobId,
  youtubeDeleteJobId,
  youtubePollProcessingJobId,
  youtubeUploadJobId,
  type QueueProducer,
} from "../src/index"
import { loadRootEnv } from "./helpers"

/**
 * Producer behavior against the real Compose Redis. Uses a dedicated Redis
 * logical database so the shared queues are never disturbed; queues are
 * obliterated and connections closed afterwards.
 */

let producer: QueueProducer

beforeAll(async () => {
  const env = await loadRootEnv()
  const url = new URL(env.REDIS_URL as string)
  url.hostname = "127.0.0.1"
  url.pathname = "/15"
  producer = createQueueProducer(createRedisConfig({ REDIS_URL: url.toString() }))
  await producer.connect()
})

afterAll(async () => {
  if (producer) {
    await producer.queues.youtube.obliterate({ force: true })
    await producer.queues.maintenance.obliterate({ force: true })
    await producer.close()
  }
})

describe("deterministic job id helpers", () => {
  it("formats exactly as the shared contract requires", () => {
    const id = "11111111-1111-4111-8111-111111111111"
    expect(youtubeUploadJobId(id)).toBe(`youtube-upload:${id}`)
    expect(youtubePollProcessingJobId(id)).toBe(`youtube-poll:${id}`)
    expect(youtubeDeleteJobId(id)).toBe(`youtube-delete:${id}`)
    expect(storageCleanupJobId(id)).toBe(`storage-cleanup:${id}`)
  })
})

describe("redis configuration validation", () => {
  it("rejects missing or malformed REDIS_URL without opening a socket", () => {
    expect(() => createRedisConfig({})).toThrowError(/REDIS_URL/)
    expect(() => createRedisConfig({ REDIS_URL: "postgres://nope" })).toThrowError(/REDIS_URL/)
    expect(createRedisConfig({ REDIS_URL: "redis://127.0.0.1:6379" }).url).toBe(
      "redis://127.0.0.1:6379",
    )
  })
})

describe("producer", () => {
  it("validates payloads with the shared schemas and rejects unknown jobs", async () => {
    await expect(
      producer.publish("youtube.upload" as JobName, { recordingId: "nope" } as never),
    ).rejects.toBeTruthy()
    await expect(
      producer.publish("storage.expire-staging" as JobName, { recordingId: randomUUID() } as never),
    ).rejects.toBeTruthy()
    await expect(producer.publish("bogus.job" as JobName, {} as never)).rejects.toBeTruthy()
  })

  it("publishes onto the contract queue with the deterministic job id", async () => {
    const recordingId = randomUUID()
    const result = await producer.publish("youtube.upload", { recordingId })
    expect(result.jobId).toBe(youtubeUploadJobId(recordingId))
    expect(result.alreadyPresent).toBe(false)

    const job = await producer.queues.youtube.getJob(toBullmqJobId(result.jobId))
    expect(job?.name).toBe("youtube.upload")
    expect(job?.data).toEqual({ recordingId })
  })

  it("collapses duplicate publishes into one job identity", async () => {
    const recordingId = randomUUID()
    const first = await producer.publish("youtube.upload", { recordingId })
    const second = await producer.publish("youtube.upload", { recordingId })
    expect(second.jobId).toBe(first.jobId)
    expect(second.alreadyPresent).toBe(true)

    const jobs = await producer.queues.youtube.getJobs(
      ["waiting", "delayd", "active", "paused"],
      0,
      -1,
    )
    const matching = jobs.filter((job) => job.id === toBullmqJobId(first.jobId))
    expect(matching).toHaveLength(1)
  })

  it("routes maintenance jobs to the maintenance queue", async () => {
    const recordingId = randomUUID()
    const result = await producer.publish("storage.cleanup", { recordingId })
    expect(result.jobId).toBe(storageCleanupJobId(recordingId))
    const job = await producer.queues.maintenance.getJob(toBullmqJobId(result.jobId))
    expect(job?.name).toBe("storage.cleanup")
  })

  it("exposes queues named exactly youtube and maintenance", () => {
    expect(Object.keys(producer.queues).sort()).toEqual([...Object.keys(QUEUES)].sort())
  })
})

describe("outbox event publisher adapter", () => {
  it("publishes outbox rows through the producer deterministically", async () => {
    const recordingId = randomUUID()
    const publish = createOutboxEventPublisher(producer)
    await publish({ type: "youtube.upload", payload: { recordingId } })
    await publish({ type: "youtube.upload", payload: { recordingId } })

    const job = await producer.queues.youtube.getJob(toBullmqJobId(youtubeUploadJobId(recordingId)))
    expect(job?.data).toEqual({ recordingId })
    const jobs = await producer.queues.youtube.getJobs(["waiting", "active", "paused"], 0, -1)
    expect(
      jobs.filter((entry) => entry.id === toBullmqJobId(youtubeUploadJobId(recordingId))),
    ).toHaveLength(1)
  })

  it("rejects an outbox row with an unexpected payload", async () => {
    const publish = createOutboxEventPublisher(producer)
    await expect(
      publish({ type: "youtube.delete", payload: { bogus: true } as never }),
    ).rejects.toBeTruthy()
  })
})

describe("no import-time side effects", () => {
  it("module import does not open sockets (constructor-only config)", () => {
    const config = createRedisConfig({ REDIS_URL: "redis://127.0.0.1:6379/15" })
    expect(config.lazyConnect).toBe(true)
    expect(config.maxRetriesPerRequest).toBeNull()
  })
})
