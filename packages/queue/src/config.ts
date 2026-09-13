import { ENV_SCHEMAS, configurationErrorFromZodError } from "@speaking-track/contracts"

/**
 * Redis/BullMQ configuration. Nothing here reads the environment or opens a
 * socket; callers pass an env-like record explicitly and own the lifecycle.
 */

export type RedisConfig = {
  url: string
  /** BullMQ requires `maxRetriesPerRequest: null` semantics. */
  maxRetriesPerRequest: null
  connectTimeoutSeconds: number
  commandTimeoutMs: number | null
  lazyConnect: boolean
}

const REDIS_URL_VARIABLE = "REDIS_URL"

export function createRedisConfig(env: Record<string, string | undefined>): RedisConfig {
  const parsed = ENV_SCHEMAS.redisUrl.safeParse(env[REDIS_URL_VARIABLE])
  if (!parsed.success) {
    throw configurationErrorFromZodError([REDIS_URL_VARIABLE], parsed.error)
  }
  return {
    url: parsed.data,
    maxRetriesPerRequest: null,
    connectTimeoutSeconds: 10,
    commandTimeoutMs: null,
    lazyConnect: true,
  }
}
