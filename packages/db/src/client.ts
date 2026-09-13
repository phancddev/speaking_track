import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { ENV_SCHEMAS, configurationErrorFromZodError } from "@speaking-track/contracts"
import { schema, schemaRelations } from "./schema"

/**
 * PostgreSQL client factory for web/worker/CLI processes. No connection is
 * opened at import time — callers construct explicitly via
 * {@link createDbClient} (or {@link createDatabaseConfig} from an env-like
 * record) and own the resulting lifecycle via `close()`.
 */

export type DatabaseConfig = {
  url: string
  maxConnections: number
  idleTimeoutSeconds: number
  connectTimeoutSeconds: number
}

const DATABASE_URL_VARIABLE = "DATABASE_URL"

export function createDatabaseConfig(env: Record<string, string | undefined>): DatabaseConfig {
  const parsed = ENV_SCHEMAS.postgresUrl.safeParse(env[DATABASE_URL_VARIABLE])
  if (!parsed.success) {
    throw configurationErrorFromZodError([DATABASE_URL_VARIABLE], parsed.error)
  }
  return {
    url: parsed.data,
    maxConnections: 10,
    idleTimeoutSeconds: 30,
    connectTimeoutSeconds: 30,
  }
}

export type Db = PostgresJsDatabase<typeof schema>

/** Transaction executor handed to `db.transaction` callbacks. */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0]

/** Anything that can run queries: the root client or an open transaction. */
export type DbExecutor = Db | DbTx

export type DbClient = {
  readonly db: Db
  readonly url: string
  close(): Promise<void>
}

export function createDbClient(config: DatabaseConfig): DbClient {
  const sql = postgres(config.url, {
    max: config.maxConnections,
    idle_timeout: config.idleTimeoutSeconds,
    connect_timeout: config.connectTimeoutSeconds,
    onnotice: () => {
      // Notices (e.g. from DROP/CREATE SCHEMA) are not application output.
    },
  })
  const db = drizzle(sql, { schema })
  void schemaRelations
  return {
    db,
    url: config.url,
    async close() {
      await sql.end({ timeout: 5 })
    },
  }
}

/**
 * Runs `fn` inside one database transaction with the full schema bound.
 * Retries are the caller's concern; domain invariants inside a transaction
 * commit or roll back together.
 */
export async function withTransaction<T>(db: Db, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return db.transaction(fn)
}
