import { readFile } from "node:fs/promises"

/**
 * Loads the gitignored repo-root .env for integration tests (Redis runs via
 * compose with host-bound ports). Test-only; library packages never read
 * the environment themselves.
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
