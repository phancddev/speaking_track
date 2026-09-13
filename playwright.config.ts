import { readFileSync } from "node:fs"
import { defineConfig } from "@playwright/test"

// End-to-end tests run against the Caddy-fronted compose stack at
// https://localhost by default (E2E_BASE_URL overrides). Credentials come
// from the gitignored root .env: the bootstrapped admin creates all other
// accounts through the real admin API during the run.
function loadRootEnv(): Record<string, string> {
  try {
    const env: Record<string, string> = {}
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (match) env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "")
    }
    return env
  } catch {
    return {}
  }
}

const env = { ...loadRootEnv(), ...process.env } as Record<string, string>

// Test workers read credentials through process.env.
for (const key of ["BOOTSTRAP_ADMIN_EMAIL", "BOOTSTRAP_ADMIN_PASSWORD", "E2E_BASE_URL"]) {
  if (env[key]) process.env[key] = env[key]
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: env.E2E_BASE_URL ?? "https://localhost",
    // The local stack serves a self-signed Caddy certificate.
    ignoreHTTPSErrors: true,
  },
})
