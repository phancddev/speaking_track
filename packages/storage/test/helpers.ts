import { readFile } from "node:fs/promises"

/**
 * Loads the gitignored repo-root .env for integration tests (MinIO/Redis
 * run via compose with host-bound ports). Test-only; library packages never
 * read the environment themselves.
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

/** Small generated media-like fixture bytes; never real captured media. */
export function mediaFixture(bytes: number): Uint8Array {
  const buffer = new Uint8Array(bytes)
  for (let index = 0; index < bytes; index += 1) {
    buffer[index] = index === 0 ? 0x1a : index === 1 ? 0x45 : index === 2 ? 0xdf : index % 251
  }
  return buffer
}
