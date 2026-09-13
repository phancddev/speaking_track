/**
 * @speaking-track/queue — queue names, job names, payload validation,
 * deterministic job-ID helpers, and typed BullMQ producers with explicit
 * Redis lifecycle. No worker business logic; nothing is created at import.
 */

export * from "./config"
export * from "./connection"
export * from "./job-ids"
export * from "./producer"

// Shared queue contract constants are re-exported for producer consumers.
export {
  QUEUES,
  QUEUE_NAMES,
  JOB_NAMES,
  JOB_QUEUE,
  RecordingJobSchema,
} from "@speaking-track/contracts"
export type { JobName, QueueName, RecordingJob, EmptyJob } from "@speaking-track/contracts"
