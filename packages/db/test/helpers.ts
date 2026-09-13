import { readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import postgres from "postgres"

/**
 * Integration-test environment support: reads the gitignored repo-root .env
 * (the same file compose interpolates) and provisions a disposable database
 * on the host-bound PostgreSQL instance. Test code only — library packages
 * never read the environment themselves.
 */

export type TestEnv = Record<string, string>

export async function loadRootEnv(): Promise<TestEnv> {
  const raw = await readFile(new URL("../../../.env", import.meta.url), "utf8")
  const env: TestEnv = {}
  for (const line of raw.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) {
      env[match[1] as string] = match[2].replace(/^["']|["']$/g, "")
    }
  }
  return env
}

/** Host-bound admin URL (127.0.0.1) derived from the compose credentials. */
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

/** Creates a uniquely-named empty database for one test file/run. */
export async function createDisposableDatabase(): Promise<DisposableDatabase> {
  const env = await loadRootEnv()
  const database = `speaking_track_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`
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

/** Small generated media-like fixture bytes; never real captured media. */
export function mediaFixture(bytes: number): Uint8Array {
  const buffer = new Uint8Array(bytes)
  for (let index = 0; index < bytes; index += 1) {
    // Deterministic pseudo-media pattern with recognizable WebM-ish header.
    buffer[index] = index === 0 ? 0x1a : index === 1 ? 0x45 : index === 2 ? 0xdf : index % 251
  }
  return buffer
}
