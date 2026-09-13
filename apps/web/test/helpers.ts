import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import postgres from "postgres"

/**
 * Web integration-test environment support: reads the gitignored repo-root
 * .env and provisions a disposable database on the host-bound compose
 * PostgreSQL, mirroring packages/db/test/helpers.ts (test-only).
 */

export type TestEnv = Record<string, string>

export async function loadRootEnv(): Promise<TestEnv> {
  const raw = await readFile(new URL("../../../.env", import.meta.url), "utf8")
  const env: TestEnv = {}
  for (const line of raw.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "")
  }
  return env
}

export function hostAdminUrl(env: TestEnv): string {
  return `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:5432/postgres`
}

export function hostUrlForDatabase(env: TestEnv, database: string): string {
  return `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:5432/${database}`
}

export type DisposableDatabase = {
  database: string
  url: string
  destroy(): Promise<void>
}

export async function createDisposableDatabase(): Promise<DisposableDatabase> {
  const env = await loadRootEnv()
  const database = `web_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`
  const admin = postgres(hostAdminUrl(env), { max: 1 })
  try {
    await admin.unsafe(`create database "${database}"`)
  } finally {
    await admin.end({ timeout: 5 })
  }
  return {
    database,
    url: hostUrlForDatabase(env, database),
    async destroy() {
      const dropper = postgres(hostAdminUrl(env), { max: 1 })
      try {
        await dropper.unsafe(`drop database if exists "${database}" with (force)`)
      } finally {
        await dropper.end({ timeout: 5 })
      }
    },
  }
}
