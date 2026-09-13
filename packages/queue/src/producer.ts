import { Queue } from "bullmq"
import {
  JOB_PAYLOAD_SCHEMAS,
  JOB_QUEUE,
  QUEUES,
  RecordingJobSchema,
  type EmptyJob,
  type JobName,
  type QueueName,
  type RecordingJob,
} from "@speaking-track/contracts"
import { Redis } from "ioredis"
import { createRedisConnection } from "./connection"
import type { RedisConfig } from "./config"
import { deterministicJobId, fromBullmqJobId, toBullmqJobId } from "./job-ids"

/**
 * Producer side of the queue contract only — no worker processors here
 * (those belong to apps/worker, task 06). Nothing is created at import:
 * `createQueueProducer` builds the connection and both queues explicitly.
 */

export type PublishResult = {
  jobId: string
  /** True when a job with this deterministic ID already existed. */
  alreadyPresent: boolean
}

const DEFAULT_JOB_OPTIONS = {
  /**
   * Producer-level retry defaults; upload/delete handlers want exponential
   * backoff (jitter is applied by the worker's backoff strategy in task 06,
   * which may override these options per job).
   */
  attempts: 10,
  backoff: { type: "exponential", delay: 5_000 } as const,
  removeOnComplete: { age: 24 * 60 * 60, count: 5_000 } as const,
  removeOnFail: false as const,
}

export type QueueProducer = {
  readonly redis: Redis
  readonly queues: Readonly<Record<QueueName, Queue>>
  /** Connects the underlying Redis connection (idempotent). */
  connect(): Promise<void>
  /**
   * Validates the payload against the shared schema for `jobName` and adds
   * it to the contract queue. Recording-scoped jobs always reuse their
   * deterministic job ID, so duplicate publishes collapse into one job.
   */
  publish(jobName: JobName, payload: RecordingJob | EmptyJob): Promise<PublishResult>
  /** Closes both queues and the Redis connection. */
  close(): Promise<void>
}

export function createQueueProducer(config: RedisConfig): QueueProducer {
  const redis = createRedisConnection(config)
  const connection = { connection: redis }
  const queues: Record<QueueName, Queue> = {
    [QUEUES.youtube]: new Queue(QUEUES.youtube, {
      ...connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    [QUEUES.maintenance]: new Queue(QUEUES.maintenance, {
      ...connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
  }
  let connected = false

  return {
    redis,
    queues,
    async connect() {
      if (!connected && redis.status === "wait") {
        await redis.connect()
      }
      connected = true
    },
    async publish(jobName, payload) {
      const payloadSchema = JOB_PAYLOAD_SCHEMAS[jobName]
      const parsed = payloadSchema.parse(payload)
      const recordingJob = RecordingJobSchema.safeParse(parsed)
      const contractJobId = recordingJob.success
        ? deterministicJobId(jobName, recordingJob.data.recordingId)
        : null

      const queue = queues[JOB_QUEUE[jobName]]
      // An existing job with the same ID is returned as-is by BullMQ, so a
      // repeated dispatch never creates a duplicate; detect it beforehand so
      // callers can distinguish "enqueued now" from "already present".
      // BullMQ forbids `:` in custom IDs, so look up/add under the mapped
      // Redis-safe ID while reporting the contract ID to callers.
      const bullmqJobId = contractJobId === null ? null : toBullmqJobId(contractJobId)
      const existing = bullmqJobId ? ((await queue.getJob(bullmqJobId)) ?? undefined) : undefined
      const job = await queue.add(jobName, parsed, { jobId: bullmqJobId ?? undefined })
      return {
        jobId: job.id === undefined ? "" : fromBullmqJobId(job.id),
        alreadyPresent: existing !== undefined,
      }
    },
    async close() {
      await Promise.all(Object.values(queues).map((queue) => queue.close()))
      redis.disconnect()
    },
  }
}

/**
 * Adapter from the db package's dispatch boundary to this producer:
 * `dispatchPendingOutboxEvents(db, { publish: createOutboxEventPublisher(producer) })`.
 */
export function createOutboxEventPublisher(
  producer: QueueProducer,
): (event: { type: JobName; payload: unknown }) => Promise<void> {
  return async (event) => {
    const payloadSchema = JOB_PAYLOAD_SCHEMAS[event.type]
    const parsed = payloadSchema.parse(event.payload)
    const recordingJob = RecordingJobSchema.safeParse(parsed)
    await producer.publish(event.type, recordingJob.success ? recordingJob.data : ({} as EmptyJob))
  }
}
