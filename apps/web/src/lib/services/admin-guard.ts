import "server-only"
import { eq } from "drizzle-orm"
import { AppError, RoleSchema } from "@speaking-track/contracts"
import { user as userTable, type Db } from "@speaking-track/db"
import { countActiveAdmins } from "@/lib/auth/server"

/**
 * Final-active-admin protection (plan/02 § Authentication): at least one
 * active admin must always remain. Reusable service guard consumed by the
 * admin user APIs (task 08) and by any role/ban/delete mutation path.
 */

export type AdminGuardAction = "demote" | "ban" | "delete" | "disable"

/**
 * Throws LAST_ADMIN_REQUIRED when `targetUserId` is an active admin and the
 * action would leave zero active admins. A no-op for non-admin targets.
 */
export async function assertNotFinalAdmin(
  db: Db,
  input: { targetUserId: string; action: AdminGuardAction },
): Promise<void> {
  const [target] = await db
    .select({ id: userTable.id, role: userTable.role, banned: userTable.banned })
    .from(userTable)
    .where(eq(userTable.id, input.targetUserId))
    .limit(1)

  if (!target || target.role !== "admin") {
    return
  }

  const activeAdmins = await countActiveAdmins(db)
  const targetIsActiveAdmin = !target.banned
  if (activeAdmins - (targetIsActiveAdmin ? 1 : 0) < 1) {
    throw new AppError(
      "LAST_ADMIN_REQUIRED",
      "At least one active administrator must remain; this action is blocked.",
    )
  }
}

/** Validates that a role mutation uses exactly the two allowed roles. */
export function parseRoleMutation(role: string): "admin" | "user" {
  return RoleSchema.parse(role)
}
