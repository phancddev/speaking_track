#!/usr/bin/env node
// Applies committed migrations from packages/db/drizzle to the database in
// DATABASE_URL. Safe to re-run: applied migrations are journaled.

import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

async function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL
  }
  // Host convenience: fall back to the repo-root .env (compose containers
  // always have DATABASE_URL injected, so this only aids local runs).
  const envPath = new URL("../../../.env", import.meta.url)
  try {
    const raw = await readFile(envPath, "utf8")
    for (const line of raw.split("\n")) {
      const match = /^DATABASE_URL=(.*)$/.exec(line.trim())
      if (match) {
        return match[1].replace(/^["']|["']$/g, "")
      }
    }
  } catch {
    // No .env — fall through to the error below.
  }
  process.stderr.write(
    "db:migrate: DATABASE_URL is not set. Export it (or put it in the repo-root .env) and retry.\n",
  )
  process.exit(1)
}

const url = await resolveDatabaseUrl()
const sql = postgres(url, { max: 1 })
try {
  const db = drizzle(sql)
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))
  await migrate(db, { migrationsFolder })
  process.stdout.write(`db:migrate: applied pending migrations from ${migrationsFolder}\n`)
} catch (error) {
  process.stderr.write(
    `db:migrate failed: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(1)
} finally {
  await sql.end({ timeout: 5 })
}
