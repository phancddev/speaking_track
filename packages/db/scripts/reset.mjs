#!/usr/bin/env node
// Destructive database reset for development ONLY.
//
// Guard: refuses to run unless BOTH
//   - ALLOW_DESTRUCTIVE_DB_RESET=1, and
//   - NODE_ENV is unset or a non-production value
// are set. Drops and recreates the public schema, then reapplies all
// committed migrations from zero.

import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

async function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL
  }
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
  return null
}

const nodeEnv = process.env.NODE_ENV ?? "development"
if (process.env.ALLOW_DESTRUCTIVE_DB_RESET !== "1") {
  process.stderr.write(
    [
      "db:reset REFUSED: destructive reset requires ALLOW_DESTRUCTIVE_DB_RESET=1.",
      "This command drops every table in the target database's public schema.",
      "",
    ].join("\n"),
  )
  process.exit(1)
}
if (nodeEnv === "production") {
  process.stderr.write(
    "db:reset REFUSED: NODE_ENV=production (or a production-shaped environment) never permits a destructive reset.\n",
  )
  process.exit(1)
}

const url = await resolveDatabaseUrl()
if (!url) {
  process.stderr.write("db:reset: DATABASE_URL is not set.\n")
  process.exit(1)
}
if (url.includes("@postgres:5432/") === false && /localhost|127\.0\.0\.1/.test(url) === false) {
  // Extra friction: the URL does not point at an obviously local host.
  process.stderr.write(
    `db:reset REFUSED: DATABASE_URL host does not look local. Refusing to drop a remote schema (${url.replace(/:[^:@/]*@/, ":***@")}).\n`,
  )
  process.exit(1)
}

const sql = postgres(url, { max: 1 })
try {
  // Drop BOTH schemas: application tables live in public, and the drizzle
  // migration bookkeeping lives in its own schema. Leaving bookkeeping in
  // place would make the subsequent migrate() treat everything as applied
  // and silently skip creating the tables.
  await sql`drop schema if exists public cascade`
  await sql`create schema public`
  await sql`drop schema if exists drizzle cascade`
  const db = drizzle(sql)
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))
  await migrate(db, { migrationsFolder })
  process.stdout.write(`db:reset: schema recreated and migrations applied from zero.\n`)
} catch (error) {
  process.stderr.write(
    `db:reset failed: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(1)
} finally {
  await sql.end({ timeout: 5 })
}
