/**
 * @speaking-track/db — Drizzle schema, migrations, PostgreSQL client
 * factory, and transaction-safe domain primitives (recording state machine,
 * durable outbox, staging capacity, owner-invariant writes).
 *
 * Nothing connects at import time: construct clients via createDbClient /
 * createDatabaseConfig and close them explicitly.
 */

export * from "./schema"
export * from "./client"
export * from "./services/recording-state"
export * from "./services/outbox"
export * from "./services/staging"
export * from "./services/records"
