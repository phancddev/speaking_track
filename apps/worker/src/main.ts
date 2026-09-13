import { writeFileSync } from "node:fs"
import { QUEUES } from "@speaking-track/contracts"
import { Worker, type Processor, type Job } from "bullmq"
import { createDatabaseConfig, createDbClient, type Db } from "@speaking-track/db"
import { createRedisConfig } from "@speaking-track/queue"
import { Redis } from "ioredis"
import { createWorkerServices, type WorkerServices } from "./services"
import { UPLOAD_CONCURRENCY, UPLOAD_SCAN_INTERVAL_SECONDS } from "./config"
import { startUploadScanner } from "./scanner"

/**
 * apps/worker entry point (task 06): BullMQ processors for
 * youtube.upload / youtube.poll-processing / youtube.delete /
 * storage.cleanup, the outbox dispatcher loop, startup recovery, and
 * graceful shutdown.
 */

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ ts: new Date().toISOString(), level: "info", service: "worker", event, ...fields })}\n`,
  )
}

function logError(event: string, fields: Record<string, unknown> = {}): void {
  process.stderr.write(
    `${JSON.stringify({ ts: new Date().toISOString(), level: "error", service: "worker", event, ...fields })}\n`,
  )
}
const shutdownSignals: NodeJS.Timeout[] = []
const scannerTimers: { stop(): void }[] = []
const workers: Worker[] = []
let services: WorkerServices | null = null
let db: Db | null = null
let redis: Redis | null = null
let dispatcherTimer: NodeJS.Timeout | undefined
let shuttingDown = false
const startedAt = Date.now()

async function main(): Promise<void> {
  const env = process.env
  db = createDbClient(createDatabaseConfig({ DATABASE_URL: env.DATABASE_URL })).db
  const redisConfig = createRedisConfig({ REDIS_URL: env.REDIS_URL })
  redis = new Redis(redisConfig.url, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  })
  await redis.connect()
  services = createWorkerServices({ db, redis, env })

  // Startup recovery before processors start taking work.
  await services.recoverOnStartup()

  workers.push(
    new Worker(QUEUES.youtube, youtubeProcessor, {
      connection: redis,
      concurrency: UPLOAD_CONCURRENCY,
    }),
    new Worker(QUEUES.maintenance, maintenanceProcessor, { connection: redis, concurrency: 4 }),
  )

  // Outbox dispatch loop: poll pending intents frequently; jobs are
  // idempotent by deterministic ID, so overlap is safe.
  dispatcherTimer = setInterval(() => {
    void services?.dispatchOutbox().catch((error: unknown) => {
      logError("outbox-dispatch-failed", { message: (error as Error).message })
    })
  }, 2000)
  shutdownSignals.push(dispatcherTimer)

  // Deferred-upload scanner: periodically re-emits youtube.upload intents
  // for QUEUED recordings (initial delivery plus quota-reset retries).
  const scanner = startUploadScanner(db, UPLOAD_SCAN_INTERVAL_SECONDS, log)
  scannerTimers.push(scanner)

  log("startup", {
    pid: process.pid,
    node: process.version,
    registeredProcessors: workers.length,
    dependencyChecks: ["postgres", "redis"],
    uploadConcurrency: UPLOAD_CONCURRENCY,
  })
  writeHeartbeat()
  const heartbeat = setInterval(writeHeartbeat, 10_000)
  shutdownSignals.push(heartbeat)
}

function writeHeartbeat(): void {
  const file = process.env.WORKER_HEARTBEAT_FILE
  if (file) {
    writeFileSync(file, `${new Date().toISOString()}\n`)
  }
}

const youtubeProcessor: Processor = async (job: Job) => {
  if (!services) return
  switch (job.name) {
    case "youtube.upload":
      return services.handleUpload(job.data as { recordingId: string })
    case "youtube.poll-processing":
      return services.handlePollProcessing(job.data as { recordingId: string })
    case "youtube.delete":
      return services.handleDelete(job.data as { recordingId: string })
    default:
      logError("unknown-youtube-job", { name: job.name, jobId: job.id })
  }
}

const maintenanceProcessor: Processor = async (job: Job) => {
  if (!services) return
  switch (job.name) {
    case "storage.cleanup":
      return services.handleStorageCleanup(job.data as { recordingId: string })
    case "storage.expire-staging":
      return services.handleExpireStaging()
    case "outbox.dispatch":
      return services.dispatchOutbox()
    default:
      logError("unknown-maintenance-job", { name: job.name, jobId: job.id })
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    process.exit(1)
  }
  shuttingDown = true
  log("shutdown-start", {
    signal,
    activeJobs: workers.reduce(
      (sum, worker) => sum + ((worker as unknown as { active?: number }).active ?? 0),
      0,
    ),
  })
  for (const timer of shutdownSignals) {
    clearInterval(timer)
  }
  for (const scanner of scannerTimers) {
    scanner.stop()
  }
  clearInterval(dispatcherTimer)
  // Stop intake, let active handlers settle within the window.
  await Promise.allSettled(workers.map((worker) => worker.close()))
  await services?.close()
  await redis?.quit().catch(() => undefined)
  log("shutdown-complete", { signal, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) })
  process.exit(0)
}

process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("uncaughtException", (error) => {
  logError("uncaught-exception", { message: error.message })
  process.exit(1)
})
process.on("unhandledRejection", (reason) => {
  logError("unhandled-rejection", { reason: String(reason) })
  process.exit(1)
})

void main().catch((error: unknown) => {
  logError("startup-failed", { message: (error as Error).message })
  process.exit(1)
})
