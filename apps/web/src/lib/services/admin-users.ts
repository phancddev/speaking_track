import "server-only"
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm"
import { z } from "zod"
import { AppError } from "@speaking-track/contracts"
import { questions, recordings, topics, user as userTable, type Db } from "@speaking-track/db"
import type { AppAuth } from "@/lib/auth/server"
import { assertNotFinalAdmin } from "@/lib/services/admin-guard"

/**
 * Admin user management (task 08, plan/02 § Admin users). Mutations wrap
 * Better Auth's admin plugin operations (real services, never raw table
 * writes for auth state) and enforce final-active-admin protection plus
 * destructive-cleanup safety. List/detail queries expose safe fields only:
 * no password hashes, sessions, or internal auth fields ever leave this
 * module.
 */

export type AdminUserView = {
  id: string
  name: string
  email: string
  role: "admin" | "user"
  banned: boolean
  banReason: string | null
  createdAt: string
  updatedAt: string
}

export type AdminUserListItem = AdminUserView & { topicCount: number }

export type AdminUserDetail = AdminUserView & {
  topicCount: number
  questionCount: number
  recordingCount: number
}

export type AdminUserPage = {
  users: AdminUserListItem[]
  total: number
  page: number
  pageSize: number
}

/** Structured admin audit event: actor/target/action/result, never secrets. */
function logAdminAction(
  actor: { id: string },
  action: string,
  target: { id: string } | null,
  result: "ok" | string,
): void {
  console.log(
    JSON.stringify({
      event: "admin.action",
      actorId: actor.id,
      action,
      targetId: target?.id ?? null,
      result,
    }),
  )
}

function toAdminUserView(row: {
  id: string
  name: string
  email: string
  role?: string | null
  banned?: boolean | null
  banReason?: string | null
  createdAt: Date
  updatedAt: Date
}): AdminUserView {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role === "admin" ? "admin" : "user",
    banned: row.banned ?? false,
    banReason: row.banReason ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const USER_COLUMNS = {
  id: userTable.id,
  name: userTable.name,
  email: userTable.email,
  role: userTable.role,
  banned: userTable.banned,
  banReason: userTable.banReason,
  createdAt: userTable.createdAt,
  updatedAt: userTable.updatedAt,
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

export async function listAdminUsers(
  db: Db,
  input: { search?: string; page?: number; pageSize?: number },
): Promise<AdminUserPage> {
  const page = Math.max(1, input.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20))
  const search = input.search?.trim()
  const filter = search
    ? or(
        ilike(userTable.name, `%${escapeLike(search)}%`),
        ilike(userTable.email, `%${escapeLike(search)}%`),
      )
    : undefined

  const rows = await db
    .select(USER_COLUMNS)
    .from(userTable)
    .where(filter)
    .orderBy(desc(userTable.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userTable)
    .where(filter)

  const topicCounts = rows.length
    ? await countTopicsByOwner(
        db,
        rows.map((row) => row.id),
      )
    : new Map<string, number>()

  return {
    users: rows.map((row) => ({
      ...toAdminUserView(row),
      topicCount: topicCounts.get(row.id) ?? 0,
    })),
    total: countRow?.count ?? 0,
    page,
    pageSize,
  }
}

async function countTopicsByOwner(db: Db, ownerIds: string[]): Promise<Map<string, number>> {
  const rows = await db
    .select({ ownerId: topics.ownerId, count: sql<number>`count(*)::int` })
    .from(topics)
    .where(and(inArray(topics.ownerId, ownerIds), sql`${topics.deletedAt} is null`))
    .groupBy(topics.ownerId)
  return new Map(rows.map((row) => [row.ownerId, row.count]))
}

export async function getAdminUser(db: Db, userId: string): Promise<AdminUserDetail> {
  const [row] = await db
    .select(USER_COLUMNS)
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1)
  if (!row) {
    throw new AppError("RESOURCE_NOT_FOUND", "User not found.")
  }
  const [topicCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(topics)
    .where(and(eq(topics.ownerId, userId), sql`${topics.deletedAt} is null`))
  const [questionCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(questions)
    .innerJoin(topics, eq(topics.id, questions.topicId))
    .where(and(eq(topics.ownerId, userId), sql`${questions.deletedAt} is null`))
  const [recordingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recordings)
    .where(eq(recordings.ownerId, userId))
  return {
    ...toAdminUserView(row),
    topicCount: topicCount?.count ?? 0,
    questionCount: questionCount?.count ?? 0,
    recordingCount: recordingCount?.count ?? 0,
  }
}

/**
 * Recordings that still reference external state (a staged object or a
 * remote YouTube video). A user owning any of these cannot be hard-deleted:
 * the database cascade would orphan remote media and staged objects instead
 * of orchestrating the defined deletion intents (plan/01 consistency rules).
 */
export async function countBlockingRecordings(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recordings)
    .where(
      and(
        eq(recordings.ownerId, userId),
        sql`${recordings.status} not in ('DELETED', 'EXPIRED')`,
        or(
          sql`${recordings.storageKey} is not null`,
          sql`${recordings.youtubeVideoId} is not null`,
        ),
      ),
    )
  return row?.count ?? 0
}

// ---------------------------------------------------------------------------
// Better Auth-backed mutations
// ---------------------------------------------------------------------------

/** Maps better-call APIError statuses onto the shared application envelope. */
function mapAuthError(error: unknown): AppError {
  // Application-level guards thrown inside a wrapped call keep their code.
  if (error instanceof AppError) return error
  const apiError = error as { status?: number; body?: { message?: string; code?: string } }
  const status = typeof apiError?.status === "number" ? apiError.status : undefined
  const message = apiError?.body?.message
  if (status === 400 || status === 422) {
    return new AppError("VALIDATION_FAILED", message ?? "The request was invalid.", {
      cause: error,
    })
  }
  if (status === 401) {
    return new AppError("AUTH_REQUIRED", "Sign in to continue.", { cause: error })
  }
  if (status === 403) {
    return new AppError("ADMIN_REQUIRED", "This action requires an administrator account.", {
      cause: error,
    })
  }
  if (status === 404) {
    return new AppError("RESOURCE_NOT_FOUND", "User not found.", { cause: error })
  }
  return new AppError("EXTERNAL_SERVICE_UNAVAILABLE", "The account operation failed. Try again.", {
    cause: error,
  })
}

export const AdminCreateUserInput = z.strictObject({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  role: z.enum(["admin", "user"]).default("user"),
})

export async function adminCreateUser(
  auth: AppAuth,
  actor: { id: string },
  headers: Headers,
  input: z.infer<typeof AdminCreateUserInput>,
): Promise<AdminUserView> {
  try {
    const response = await auth.api.createUser({
      body: { name: input.name, email: input.email, password: input.password, role: input.role },
      headers,
    })
    logAdminAction(actor, "user.create", { id: response.user.id }, "ok")
    return toAdminUserView(response.user)
  } catch (error) {
    const mapped = mapAuthError(error)
    logAdminAction(actor, "user.create", null, mapped.code)
    throw mapped
  }
}

export const AdminUpdateUserInput = z
  .strictObject({
    role: z.enum(["admin", "user"]).optional(),
    banned: z.boolean().optional(),
    banReason: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.role !== undefined || value.banned !== undefined, {
    message: "Provide a role or banned update.",
  })

export async function adminUpdateUser(
  auth: AppAuth,
  db: Db,
  actor: { id: string },
  headers: Headers,
  input: { userId: string } & z.infer<typeof AdminUpdateUserInput>,
): Promise<AdminUserView> {
  const { userId, ...changes } = input

  if (changes.role !== undefined) {
    const [target] = await db
      .select({ role: userTable.role })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1)
    if (!target) throw new AppError("RESOURCE_NOT_FOUND", "User not found.")
    if (target.role === "admin" && changes.role === "user") {
      await assertNotFinalAdmin(db, { targetUserId: userId, action: "demote" })
    }
    try {
      const response = await auth.api.setRole({ body: { userId, role: changes.role }, headers })
      logAdminAction(actor, "user.set-role", { id: userId }, `role=${changes.role}`)
      return toAdminUserView(response.user)
    } catch (error) {
      const mapped = mapAuthError(error)
      logAdminAction(actor, "user.set-role", { id: userId }, mapped.code)
      throw mapped
    }
  }

  // Ban/unban path.
  await assertUserExists(db, userId)
  try {
    if (changes.banned) {
      await assertNotFinalAdmin(db, { targetUserId: userId, action: "ban" })
      const response = await auth.api.banUser({
        body: { userId, banReason: changes.banReason ?? "Disabled by administrator" },
        headers,
      })
      logAdminAction(actor, "user.ban", { id: userId }, "ok")
      return toAdminUserView(response.user)
    }
    const response = await auth.api.unbanUser({ body: { userId }, headers })
    logAdminAction(actor, "user.unban", { id: userId }, "ok")
    return toAdminUserView(response.user)
  } catch (error) {
    const mapped = mapAuthError(error)
    logAdminAction(actor, changes.banned ? "user.ban" : "user.unban", { id: userId }, mapped.code)
    throw mapped
  }
}

async function assertUserExists(db: Db, userId: string): Promise<void> {
  const [row] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1)
  if (!row) throw new AppError("RESOURCE_NOT_FOUND", "User not found.")
}

export const AdminSetPasswordInput = z.strictObject({
  newPassword: z.string().min(8).max(128),
})

export async function adminSetUserPassword(
  auth: AppAuth,
  actor: { id: string },
  headers: Headers,
  input: { userId: string; newPassword: string },
): Promise<{ status: true }> {
  try {
    await auth.api.setUserPassword({
      body: { userId: input.userId, newPassword: input.newPassword },
      headers,
    })
    logAdminAction(actor, "user.set-password", { id: input.userId }, "ok")
    return { status: true }
  } catch (error) {
    const mapped = mapAuthError(error)
    logAdminAction(actor, "user.set-password", { id: input.userId }, mapped.code)
    throw mapped
  }
}

export async function adminDeleteUser(
  auth: AppAuth,
  db: Db,
  actor: { id: string },
  headers: Headers,
  input: { userId: string },
): Promise<{ deleted: true }> {
  // Final-admin protection outranks the self-delete check so deleting the
  // last active admin always reports LAST_ADMIN_REQUIRED.
  await assertUserExists(db, input.userId)
  await assertNotFinalAdmin(db, { targetUserId: input.userId, action: "delete" })
  if (input.userId === actor.id) {
    throw new AppError("VALIDATION_FAILED", "You cannot delete your own account.")
  }

  const blocking = await countBlockingRecordings(db, input.userId)
  if (blocking > 0) {
    throw new AppError(
      "INVALID_RECORDING_STATE",
      `This user owns ${blocking} recording${blocking === 1 ? "" : "s"} still staged or on YouTube. ` +
        "Delete those recordings (and wait for cleanup) before deleting the account.",
    )
  }

  try {
    await auth.api.removeUser({ body: { userId: input.userId }, headers })
    logAdminAction(actor, "user.delete", { id: input.userId }, "ok")
    return { deleted: true }
  } catch (error) {
    const mapped = mapAuthError(error)
    logAdminAction(actor, "user.delete", { id: input.userId }, mapped.code)
    throw mapped
  }
}
