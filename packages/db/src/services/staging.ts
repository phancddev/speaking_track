import { sql } from "drizzle-orm"
import type { DbExecutor } from "../client"
import { recordings } from "../schema"

/**
 * Aggregate staging capacity (plan/02 § Storage contract): active staging
 * bytes are the sum of `sizeBytes` over recordings in PostgreSQL that have
 * not yet been cleaned, expired, or deleted — queried from the database,
 * never from provider-specific disk APIs.
 */

/** Sum of `sizeBytes` for recordings still holding staged objects. */
export async function getActiveStagingBytes(db: DbExecutor): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${recordings.sizeBytes}), 0)::bigint`,
    })
    .from(recordings)
    .where(
      sql`${recordings.storageKey} is not null and ${recordings.status} not in ('DELETED', 'EXPIRED')`,
    )
  return Number(row?.total ?? 0)
}

export type StagingCapacityCheck =
  | { ok: true; activeBytes: number }
  | { ok: false; code: "STORAGE_CAPACITY_LOW"; activeBytes: number }

/**
 * Pre-staging guard for the web layer: an upload of `incomingBytes` is
 * allowed only while the projected total stays within `maxStagingBytes`
 * (`MAX_STAGING_BYTES`). Callers map `ok: false` to STORAGE_CAPACITY_LOW.
 */
export async function checkStagingCapacity(
  db: DbExecutor,
  input: { incomingBytes: number; maxStagingBytes: number },
): Promise<StagingCapacityCheck> {
  const activeBytes = await getActiveStagingBytes(db)
  if (activeBytes + input.incomingBytes > input.maxStagingBytes) {
    return { ok: false, code: "STORAGE_CAPACITY_LOW", activeBytes }
  }
  return { ok: true, activeBytes }
}
