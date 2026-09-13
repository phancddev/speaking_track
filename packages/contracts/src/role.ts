import { z } from "zod"

/**
 * Roles are exactly `admin` and `user` (plan/01 non-negotiable decisions).
 * The database stores role on the Better Auth user row; application
 * validation constrains writes to these two values.
 */

export const ROLES = ["admin", "user"] as const
export type Role = (typeof ROLES)[number]

export const RoleSchema = z.enum(ROLES)

/** Parses any stored role string into a strict Role or returns null. */
export function parseRole(value: string | null | undefined): Role | null {
  if (value === null || value === undefined) return null
  // Better Auth's admin plugin may persist multi-role values as a
  // comma-separated list; Speaking Track only ever writes single roles and
  // rejects anything else at the application boundary.
  const parsed = RoleSchema.safeParse(value.trim())
  return parsed.success ? parsed.data : null
}
