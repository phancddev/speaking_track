import { randomUUID } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq } from "drizzle-orm"
import {
  createDatabaseConfig,
  createDbClient,
  questions,
  recordings,
  topics,
  user as userTable,
  type Db,
} from "@speaking-track/db"
import { createAuth, type AppAuth } from "@/lib/auth/server"
import { bootstrapAdmin } from "../scripts/bootstrap-admin.mts"
import { createDisposableDatabase, type DisposableDatabase } from "./helpers"

/**
 * Admin console behavior (task 08 required tests): role gates on admin APIs,
 * admin-created accounts, two-role validation, final-admin protection,
 * password reset, destructive-cleanup-safe user deletion, and explicit
 * owner-scoped library browsing — all through the real route handlers.
 */

const ORIGIN = "https://localhost"

let database: DisposableDatabase
let db: Db
let closeDb: () => Promise<void>
let auth: AppAuth

let adminCookie = ""
let adminId = ""
let userCookie = ""
let userId = ""

beforeAll(async () => {
  database = await createDisposableDatabase()
  const migrationConnection = postgres(database.url, { max: 1 })
  await migrate(drizzle(migrationConnection), {
    migrationsFolder: new URL("../../../packages/db/drizzle", import.meta.url).pathname,
  })
  await migrationConnection.end({ timeout: 5 })
  const client = createDbClient(createDatabaseConfig({ DATABASE_URL: database.url }))
  db = client.db
  closeDb = client.close
  auth = createAuth(db, { appOrigin: ORIGIN, secret: "b".repeat(40) })
  ;(globalThis as Record<string, unknown>)["__speakingTrackAuth"] = auth
  ;(globalThis as Record<string, unknown>)["__speakingTrackWebDb"] = db

  await bootstrapAdmin(db, {
    email: "admin@example.test",
    password: "admin-password-1",
    name: "Admin",
  })
  const [adminRow] = await db
    .select()
    .from(userTable)
    .where(eq(userTable.email, "admin@example.test"))
  adminId = adminRow!.id
  adminCookie = await signIn("admin@example.test", "admin-password-1")

  const created = await api(adminCookie, "/api/admin/users", {
    method: "POST",
    body: {
      name: "Normal User",
      email: "user@example.test",
      password: "user-password-1",
      role: "user",
    },
  })
  expect(created.status).toBe(201)
  userId = (created.body.data as { id: string }).id
  userCookie = await signIn("user@example.test", "user-password-1")
})

afterAll(async () => {
  if (closeDb) await closeDb()
  if (database) await database.destroy()
})

let requestCounter = 0

async function signIn(email: string, password: string): Promise<string> {
  requestCounter += 1
  const response = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-forwarded-for": `10.78.0.${requestCounter % 250}`,
      },
      body: JSON.stringify({ email, password }),
    }),
  )
  if (response.status !== 200) throw new Error(`sign-in failed for ${email}: ${response.status}`)
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")
}

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

async function routeTable(): Promise<Record<string, RouteHandler>> {
  const usersRoute = await import("@/app/api/admin/users/route")
  const userItemRoute = await import("@/app/api/admin/users/[userId]/route")
  const setPasswordRoute = await import("@/app/api/admin/users/[userId]/set-password/route")
  const youtubeRoute = await import("@/app/api/admin/youtube/connections/route")
  const queueRoute = await import("@/app/api/admin/queue/[...action]/route")
  const topicsRoute = await import("@/app/api/topics/route")
  const topicItemRoute = await import("@/app/api/topics/[topicId]/route")
  return {
    "GET /api/admin/users": usersRoute.GET as RouteHandler,
    "POST /api/admin/users": usersRoute.POST as RouteHandler,
    "GET /api/admin/users/:id": userItemRoute.GET as RouteHandler,
    "PATCH /api/admin/users/:id": userItemRoute.PATCH as RouteHandler,
    "DELETE /api/admin/users/:id": userItemRoute.DELETE as RouteHandler,
    "POST /api/admin/users/:id/set-password": setPasswordRoute.POST as RouteHandler,
    "GET /api/admin/youtube/connections": youtubeRoute.GET as RouteHandler,
    "GET /api/admin/queue/summary": queueRoute.GET as RouteHandler,
    "GET /api/admin/queue/failures": queueRoute.GET as RouteHandler,
    "GET /api/topics": topicsRoute.GET as RouteHandler,
    "POST /api/topics": topicsRoute.POST as RouteHandler,
    "PATCH /api/topics/:id": topicItemRoute.PATCH as RouteHandler,
  }
}

async function api(
  cookie: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: Record<string, unknown> }> {
  requestCounter += 1
  const headers: Record<string, string> = {
    cookie,
    origin: ORIGIN,
    "x-forwarded-for": `10.78.0.${requestCounter % 250}`,
  }
  if (init?.body !== undefined) headers["content-type"] = "application/json"
  const routes = await routeTable()
  const method = (init?.method ?? "GET").toUpperCase()
  const routePath = path.split("?")[0]!
  const routeKey = Object.keys(routes).find((key) => {
    const [routeMethod, template] = key.split(" ") as [string, string]
    if (routeMethod !== method) return false
    const pattern = template.replaceAll(":id", "[^/]+")
    return new RegExp(`^${pattern}$`).test(routePath)
  })
  const handler = routeKey ? routes[routeKey] : undefined
  if (!handler) throw new Error(`no test route wiring for ${method} ${routePath}`)
  const request = new Request(new URL(`${ORIGIN}${path}`), {
    method,
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const response = await handler(request, { params: Promise.resolve({}) })
  const text = await response.text()
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  }
}

describe("admin API role gate", () => {
  it("rejects a normal user from every admin endpoint", async () => {
    for (const path of [
      "/api/admin/users",
      "/api/admin/youtube/connections",
      "/api/admin/queue/summary",
      "/api/admin/queue/failures",
    ]) {
      const result = await api(userCookie, path)
      expect(result.status, path).toBe(403)
      expect((result.body.error as { code: string }).code).toBe("ADMIN_REQUIRED")
    }
  })

  it("does not leak another user's detail to a normal user", async () => {
    const result = await api(userCookie, `/api/admin/users/${adminId}`)
    expect(result.status).toBe(403)
  })
})

describe("admin user management", () => {
  it("lists users with safe fields only", async () => {
    const result = await api(adminCookie, "/api/admin/users?search=user@example")
    expect(result.status).toBe(200)
    const data = result.body.data as { users: Record<string, unknown>[]; total: number }
    expect(data.total).toBe(1)
    const row = data.users[0]!
    expect(row.email).toBe("user@example.test")
    for (const forbidden of ["password", "hashedPassword", "session", "encryptedRefreshToken"]) {
      expect(row).not.toHaveProperty(forbidden)
    }
  })

  it("rejects an invalid role value", async () => {
    const result = await api(adminCookie, "/api/admin/users", {
      method: "POST",
      body: { name: "X", email: "x@example.test", password: "long-enough-1", role: "superuser" },
    })
    expect(result.status).toBe(400)
    expect((result.body.error as { code: string }).code).toBe("VALIDATION_FAILED")
  })

  it("admin-created user can sign in with the bootstrap password", async () => {
    // userCookie was already established in beforeAll via the created user.
    const again = await signIn("user@example.test", "user-password-1")
    expect(again).toContain("better-auth")
  })

  it("set-password replaces the credential and never returns it", async () => {
    const result = await api(adminCookie, `/api/admin/users/${userId}/set-password`, {
      method: "POST",
      body: { newPassword: "replacement-password-1" },
    })
    expect(result.status).toBe(200)
    expect(JSON.stringify(result.body)).not.toContain("replacement-password-1")
    const oldPassword = await signIn("user@example.test", "user-password-1").catch(() => "failed")
    expect(oldPassword).toBe("failed")
    const fresh = await signIn("user@example.test", "replacement-password-1")
    expect(fresh).toContain("better-auth")
  })

  it("ban blocks sign-in and unban restores it", async () => {
    const ban = await api(adminCookie, `/api/admin/users/${userId}`, {
      method: "PATCH",
      body: { banned: true, banReason: "testing" },
    })
    expect(ban.status).toBe(200)
    const blocked = await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-forwarded-for": "10.78.1.1",
        },
        body: JSON.stringify({ email: "user@example.test", password: "replacement-password-1" }),
      }),
    )
    expect([401, 403]).toContain(blocked.status)

    const unban = await api(adminCookie, `/api/admin/users/${userId}`, {
      method: "PATCH",
      body: { banned: false },
    })
    expect(unban.status).toBe(200)
    const restored = await signIn("user@example.test", "replacement-password-1")
    expect(restored).toContain("better-auth")
  })
})

describe("final-active-admin protection", () => {
  it("blocks deleting the final admin", async () => {
    const result = await api(adminCookie, `/api/admin/users/${adminId}`, { method: "DELETE" })
    expect(result.status).toBe(409)
    expect((result.body.error as { code: string }).code).toBe("LAST_ADMIN_REQUIRED")
  })

  it("blocks demoting the final admin", async () => {
    const result = await api(adminCookie, `/api/admin/users/${adminId}`, {
      method: "PATCH",
      body: { role: "user" },
    })
    expect(result.status).toBe(409)
    expect((result.body.error as { code: string }).code).toBe("LAST_ADMIN_REQUIRED")
  })

  it("blocks banning the final admin", async () => {
    const result = await api(adminCookie, `/api/admin/users/${adminId}`, {
      method: "PATCH",
      body: { banned: true },
    })
    expect(result.status).toBe(409)
    expect((result.body.error as { code: string }).code).toBe("LAST_ADMIN_REQUIRED")
  })

  it("allows demoting an admin once a second admin exists", async () => {
    const promote = await api(adminCookie, `/api/admin/users/${userId}`, {
      method: "PATCH",
      body: { role: "admin" },
    })
    expect(promote.status).toBe(200)

    const demote = await api(adminCookie, `/api/admin/users/${userId}`, {
      method: "PATCH",
      body: { role: "user" },
    })
    expect(demote.status).toBe(200)
    expect((demote.body.data as { role: string }).role).toBe("user")
  })
})

describe("destructive user deletion safety", () => {
  it("blocks deleting a user whose recordings still need external cleanup", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ id: randomUUID(), ownerId: userId, title: "T" })
      .returning()
    const [question] = await db
      .insert(questions)
      .values({ id: randomUUID(), topicId: topic!.id, prompt: "Q", position: 0 })
      .returning()
    await db.insert(recordings).values({
      questionId: question!.id,
      ownerId: userId,
      status: "QUEUED",
      storageKey: `recordings/${userId}/${randomUUID()}/source.webm`,
      mimeType: "video/webm;codecs=vp9,opus",
      sizeBytes: 10,
      durationMs: 1000,
    })

    const blocked = await api(adminCookie, `/api/admin/users/${userId}`, { method: "DELETE" })
    expect(blocked.status).toBe(409)
    expect((blocked.body.error as { code: string }).code).toBe("INVALID_RECORDING_STATE")

    // Terminal + cleaned recordings no longer block deletion.
    await db
      .update(recordings)
      .set({ status: "DELETED", storageKey: null })
      .where(eq(recordings.ownerId, userId))
    const allowed = await api(adminCookie, `/api/admin/users/${userId}`, { method: "DELETE" })
    expect(allowed.status).toBe(200)
    const [gone] = await db.select().from(userTable).where(eq(userTable.id, userId))
    expect(gone).toBeUndefined()
  })
})

describe("admin owner-scoped library browsing", () => {
  it("lets the admin list and edit another user's library without taking ownership", async () => {
    // Fresh second user + own topic via their own session.
    const created = await api(adminCookie, "/api/admin/users", {
      method: "POST",
      body: {
        name: "Owner B",
        email: "b@example.test",
        password: "owner-b-password-1",
        role: "user",
      },
    })
    const ownerBId = (created.body.data as { id: string }).id
    const ownerBCookie = await signIn("b@example.test", "owner-b-password-1")
    const topicResult = await api(ownerBCookie, "/api/topics", {
      method: "POST",
      body: { title: "B's topic" },
    })
    const topicId = (topicResult.body.data as { id: string }).id

    // Admin sees it only when naming the owner explicitly.
    const own = await api(adminCookie, "/api/topics")
    expect((own.body.data as { id: string }[]).some((t) => t.id === topicId)).toBe(false)
    const browsed = await api(adminCookie, `/api/topics?ownerId=${ownerBId}`)
    expect((browsed.body.data as { id: string }[]).some((t) => t.id === topicId)).toBe(true)

    // Admin edits it through the owner-scoped API; ownership stays with B.
    const patched = await api(adminCookie, `/api/topics/${topicId}?ownerId=${ownerBId}`, {
      method: "PATCH",
      body: { title: "Renamed by admin" },
    })
    expect(patched.status).toBe(200)
    const [row] = await db.select().from(topics).where(eq(topics.id, topicId))
    expect(row?.ownerId).toBe(ownerBId)
    expect(row?.title).toBe("Renamed by admin")

    // A normal user cannot use ownerId to reach B's data.
    const foreign = await api(userCookie, `/api/topics?ownerId=${ownerBId}`)
    expect((foreign.body.data as { id: string }[]).some((t) => t.id === topicId)).toBe(false)
  })
})

describe("queue and youtube admin views", () => {
  it("returns an aggregate summary keyed by recording state", async () => {
    const result = await api(adminCookie, "/api/admin/queue/summary")
    expect(result.status).toBe(200)
    const data = result.body.data as { countsByState: Record<string, number>; total: number }
    expect(data.countsByState).toHaveProperty("READY")
    expect(data.countsByState).toHaveProperty("FAILED")
    expect(data.total).toBeGreaterThanOrEqual(0)
  })

  it("failure rows join real owner emails and question prompts", async () => {
    const result = await api(adminCookie, "/api/admin/queue/failures")
    expect(result.status).toBe(200)
    const rows = result.body.data as {
      ownerEmail: string | null
      questionPrompt: string | null
      failureCode: string | null
    }[]
    // No row may carry a raw UUID where an email/prompt belongs.
    for (const row of rows) {
      if (row.ownerEmail !== null) expect(row.ownerEmail).toMatch(/@/)
    }
    expect(JSON.stringify(result.body)).not.toMatch(
      /storageKey|presigned|sessionUri|encryptedRefreshToken/,
    )
  })

  it("lists per-user youtube connections (empty by default)", async () => {
    const result = await api(adminCookie, "/api/admin/youtube/connections")
    expect(result.status).toBe(200)
    const data = result.body.data as { connections: unknown[] }
    expect(Array.isArray(data.connections)).toBe(true)
    expect(JSON.stringify(result.body)).not.toMatch(/encryptedRefreshToken|clientSecret/)
  })
})
