import { Redis } from "ioredis"
import type { RedisConfig } from "./config"

/**
 * Redis connection factory with explicit lifecycle: connections are created
 * lazy and connect only when `connect()` is called; owners close them via
 * `disconnect()`. No connection exists at module import.
 */

export function createRedisConnection(config: RedisConfig): Redis {
  return new Redis(config.url, {
    lazyConnect: config.lazyConnect,
    maxRetriesPerRequest: config.maxRetriesPerRequest,
    connectTimeout: config.connectTimeoutSeconds * 1000,
    enableReadyCheck: true,
  })
}
