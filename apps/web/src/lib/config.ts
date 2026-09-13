import { z } from "zod"
import { ConfigurationError } from "@speaking-track/contracts"

/**
 * Web runtime configuration. Validated once per process; fails fast on
 * missing/malformed required variables instead of starting half-configured.
 */

const WEB_ENV_SCHEMA = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z
    .string()
    .url()
    .refine((v) => v.startsWith("postgres")),
  REDIS_URL: z
    .string()
    .url()
    .refine((v) => v.startsWith("redis")),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  // Optional additional trusted origins (comma-separated), for deployments
  // reachable over both HTTPS and plain HTTP on the LAN.
  APP_EXTRA_ORIGINS: z.string().optional(),
  // LAN dual-protocol mode: issue session cookies without the Secure flag
  // so they also work over plain HTTP. Leave unset for HTTPS-only deploys.
  AUTH_INSECURE_COOKIES: z.string().optional(),
})
export type WebConfig = {
  nodeEnv: "development" | "test" | "production"
  appOrigin: string
  extraOrigins: string[]
  insecureCookies: boolean
  databaseUrl: string
  redisUrl: string
  betterAuthSecret: string
  betterAuthUrl: string
}

export function createWebConfig(env: Record<string, string | undefined>): WebConfig {
  const parsed = WEB_ENV_SCHEMA.safeParse(env)
  if (!parsed.success) {
    throw new ConfigurationError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    )
  }
  return {
    nodeEnv: parsed.data.NODE_ENV,
    appOrigin: parsed.data.APP_ORIGIN,
    extraOrigins: (parsed.data.APP_EXTRA_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0 && /^https?:\/\//.test(origin)),
    insecureCookies: ["1", "true", "yes"].includes(
      (parsed.data.AUTH_INSECURE_COOKIES ?? "").toLowerCase(),
    ),
    databaseUrl: parsed.data.DATABASE_URL,
    redisUrl: parsed.data.REDIS_URL,
    betterAuthSecret: parsed.data.BETTER_AUTH_SECRET,
    betterAuthUrl: parsed.data.BETTER_AUTH_URL,
  }
}
