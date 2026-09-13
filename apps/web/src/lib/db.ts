import "server-only"
import { createDatabaseConfig, createDbClient, type Db } from "@speaking-track/db"
import { createWebConfig } from "@/lib/config"

/**
 * Process-wide database handle for route handlers and server components.
 * The client is created lazily (never at import) and survives dev reloads.
 */
export function getDb(): Db {
  const globalStore = globalThis as { __speakingTrackWebDb?: Db }
  if (globalStore.__speakingTrackWebDb) {
    return globalStore.__speakingTrackWebDb
  }
  const config = createWebConfig(process.env)
  const client = createDbClient(createDatabaseConfig({ DATABASE_URL: config.databaseUrl }))
  globalStore.__speakingTrackWebDb = client.db
  return client.db
}

export const getWebDb = getDb
