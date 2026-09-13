import { z } from "zod"

/**
 * Queue contract (plan/02 § Queue contract). Queue names, job names, the
 * queue each job runs on, and the payload schema for each job. Queue
 * payloads carry identifiers only — never buffers, tokens, or mutable
 * resource snapshots.
 */

export const QUEUES = {
  youtube: "youtube",
  maintenance: "maintenance",
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

export const QUEUE_NAMES = ["youtube", "maintenance"] as const
export const QueueNameSchema = z.enum(QUEUE_NAMES)

export const JOB_NAMES = [
  "youtube.upload",
  "youtube.poll-processing",
  "youtube.delete",
  "storage.cleanup",
  "storage.expire-staging",
  "outbox.dispatch",
] as const

export type JobName = (typeof JOB_NAMES)[number]

export const JobNameSchema = z.enum(JOB_NAMES)

/** The queue each job name is dispatched to. */
export const JOB_QUEUE: Readonly<Record<JobName, QueueName>> = {
  "youtube.upload": QUEUES.youtube,
  "youtube.poll-processing": QUEUES.youtube,
  "youtube.delete": QUEUES.youtube,
  "storage.cleanup": QUEUES.maintenance,
  "storage.expire-staging": QUEUES.maintenance,
  "outbox.dispatch": QUEUES.maintenance,
}

/** Recording-scoped jobs carry exactly `{ recordingId }`. */
export type RecordingJob = { recordingId: string }

export const RecordingJobSchema = z.strictObject({
  recordingId: z.uuid(),
})

/**
 * `storage.expire-staging` and `outbox.dispatch` are maintenance jobs with
 * no user payload; anything beyond an empty object is rejected.
 */
export const EmptyJobSchema = z.strictObject({})

export type EmptyJob = z.infer<typeof EmptyJobSchema>

export const JOB_PAYLOAD_SCHEMAS: Readonly<Record<JobName, z.ZodType>> = {
  "youtube.upload": RecordingJobSchema,
  "youtube.poll-processing": RecordingJobSchema,
  "youtube.delete": RecordingJobSchema,
  "storage.cleanup": RecordingJobSchema,
  "storage.expire-staging": EmptyJobSchema,
  "outbox.dispatch": EmptyJobSchema,
}

/** Outbox payload column shape, validated by the shared payload schema. */
export type OutboxPayload = RecordingJob | EmptyJob
