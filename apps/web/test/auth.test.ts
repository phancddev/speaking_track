import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { createDatabaseConfig, createDbClient, user as userTable } from "@speaking-track/db"
import { AppError } from "@speaking-track/contracts"
import { createAuth } from "@/lib/auth/server"
import { requireAdmin, requireSession } from "@/lib/auth/authorization"
import { assertNotFinalAdmin } from "@/lib/services/admin-guard"
import { safeReturnPath } from "@/lib/return-path"
import { bootstrapAdmin } from "../scripts/bootstrap-admin.mts"
import { createDisposableDatabase, type DisposableDatabase } from "./helpers"

/**
 * Auth/RBAC behavior against a real disposable PostgreSQL database and the
 * real Better Auth handler (task 03 required behavioral tests).
 */

let database: DisposableDatabase
let db: ReturnType<typeof createDbClient>["db"]
let closeDb: () => Promise<void>
let auth: ReturnType<typeof createAuth>

const ORIGIN = "https://localhost"

// Unique client IP per request: Better Auth rate-limits per address, and the
// file signs in many times against the real handler.
let requestCounter = 0

function authRequest(path: string, init?: RequestInit): Request {
  requestCounter += 1
  return new Request(`${ORIGIN}/api/auth${path}`, {
    ...init,
    headers: {
      origin: ORIGIN,
      "x-forwarded-for": `10.99.0.${requestCounter % 250}`,
      ...(init?.headers ?? {}),
    },
  })
}

function cookieFrom(response: Response): string {
  const raw = response.headers.getSetCookie()
  return raw.map((cookie) => cookie.split(";")[0]).join("; ")
}

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
  auth = createAuth(db, { appOrigin: ORIGIN, secret: "a".repeat(40) })
  // requireSession/requireAdmin resolve the process-wide instance; test with
  // the same disposable-database auth instead of process.env-driven config.
  ;(globalThis as Record<string, unknown>)["__speakingTrackAuth"] = auth
  // Bootstrap the first admin here so every test (and -t filtered runs) sees
  // a known account regardless of describe ordering.
  await bootstrapAdmin(db, {
    email: "admin@example.test",
    password: "admin-password-1",
    name: "First Admin",
  })
})
afterAll(async () => {
  if (closeDb) {
    await closeDb()
  }
  if (database) {
    await database.destroy()
  }
})

describe("public sign-up rejection", () => {
  it("rejects a direct POST to the sign-up endpoint without creating a user", async () => {
    const response = await auth.handler(
      authRequest("/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "intruder@example.test",
          password: "password123",
          name: "Intruder",
        }),
      }),
    )
    expect(response.status).toBeGreaterThanOrEqual(400)

    const intruders = await db
      .select()
      .from(userTable)
      .where(eq(userTable.email, "intruder@example.test"))
    expect(intruders).toHaveLength(0)
  })
})

describe("bootstrap command", () => {
  it("creates the first admin once and never resets it on a second run", async () => {
    // beforeAll bootstrapped the first admin; a second run must never reset it.
    const [bootstrapped] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.email, "admin@example.test"))
    expect(bootstrapped).toBeDefined()

    const second = await bootstrapAdmin(db, {
      email: "admin@example.test",
      password: "different-password-attempt",
      name: "Second Attempt",
    })
    expect(second.status).toBe("already-present")
    expect(second.userId).toBe(bootstrapped!.id)

    const admins = await db.select().from(userTable).where(eq(userTable.role, "admin"))
    expect(admins).toHaveLength(1)
    expect(admins[0]!.email).toBe("admin@example.test")

    // The bootstrap account can actually sign in with the ORIGINAL password.
    const login = await auth.handler(
      authRequest("/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.test", password: "admin-password-1" }),
      }),
    )
    expect(login.status).toBe(200)
  })

  it("rejects a short bootstrap password", async () => {
    await expect(
      bootstrapAdmin(db, { email: "weak@example.test", password: "short", name: "Weak" }),
    ).rejects.toThrow(/at least 8 characters/)
  })
})

describe("sign-in behavior", () => {
  it("signs in a valid account and exposes a usable session", async () => {
    const response = await auth.handler(
      authRequest("/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.test", password: "admin-password-1" }),
      }),
    )
    expect(response.status).toBe(200)
    const cookie = cookieFrom(response)
    expect(cookie.toLowerCase()).toContain("better-auth.session_token")

    const session = await requireSession(new Headers({ cookie, "x-test": "1" }) as Headers)
    expect(session.user.email).toBe("admin@example.test")
    expect(session.user.role).toBe("admin")
  })

  it("returns a generic error for a wrong password", async () => {
    const response = await auth.handler(
      authRequest("/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.test", password: "wrong-password" }),
      }),
    )
    expect(response.status).toBeGreaterThanOrEqual(400)
    const body = (await response.json()) as { message?: string }
    expect(JSON.stringify(body)).not.toContain("password is incorrect")
  })

  it("returns a generic error for an unknown account (no existence leak)", async () => {
    const response = await auth.handler(
      authRequest("/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ghost@example.test", password: "whatever-123" }),
      }),
    )
    expect(response.status).toBeGreaterThanOrEqual(400)
  })
})

describe("admin-created accounts", () => {
  it("an authenticated admin creates a user who can sign in; public creation stays blocked", async () => {
    const adminLogin = await auth.handler(
      authRequest("/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.test", password: "admin-password-1" }),
      }),
    )
    const adminCookie = cookieFrom(adminLogin)

    const created = await auth.handler(
      authRequest("/admin/create-user", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({
          email: "member@example.test",
          password: "member-password-1",
          name: "Member",
          role: "user",
        }),
      }),
    )
    expect(created.status).toBe(200)

    const memberLogin = await auth.handler(
      authRequest("/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "member@example.test", password: "member-password-1" }),
      }),
    )
    expect(memberLogin.status).toBe(200)
  })
})

describe("authorization helpers", () => {
  it("requireSession rejects unauthenticated access with AUTH_REQUIRED", async () => {
    await expect(requireSession(new Headers())).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    })
  })

  it("requireAdmin fails for a normal user with ADMIN_REQUIRED", async () => {
    const login = await auth.handler(
      authRequest("/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "member@example.test", password: "member-password-1" }),
      }),
    )
    const cookie = cookieFrom(login)
    await expect(requireAdmin(new Headers({ cookie }))).rejects.toMatchObject({
      code: "ADMIN_REQUIRED",
    })
  })

  it("requireAdmin passes for an admin session", async () => {
    const login = await auth.handler(
      authRequest("/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.test", password: "admin-password-1" }),
      }),
    )
    const session = await requireAdmin(new Headers({ cookie: cookieFrom(login) }))
    expect(session.user.role).toBe("admin")
  })
})

describe("final-active-admin guard", () => {
  it("blocks demotion/removal of the last active admin", async () => {
    const [onlyAdmin] = await db
      .select()
      .from(userTable)
      .where(and(eq(userTable.role, "admin"), eq(userTable.banned, false)))
    expect(onlyAdmin).toBeDefined()

    await expect(
      assertNotFinalAdmin(db, { targetUserId: onlyAdmin!.id, action: "demote" }),
    ).rejects.toMatchObject({ code: "LAST_ADMIN_REQUIRED" })
    await expect(
      assertNotFinalAdmin(db, { targetUserId: onlyAdmin!.id, action: "delete" }),
    ).rejects.toMatchObject({ code: "LAST_ADMIN_REQUIRED" })
  })

  it("allows acting on the last admin once a second active admin exists", async () => {
    const login = await auth.handler(
      authRequest("/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.test", password: "admin-password-1" }),
      }),
    )
    const adminCookie = cookieFrom(login)
    await auth.handler(
      authRequest("/admin/create-user", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({
          email: "admin2@example.test",
          password: "admin2-password-1",
          name: "Second Admin",
          role: "admin",
        }),
      }),
    )

    const [firstAdmin] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.email, "admin@example.test"))
    await expect(
      assertNotFinalAdmin(db, { targetUserId: firstAdmin!.id, action: "demote" }),
    ).resolves.toBeUndefined()

    const [member] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.email, "member@example.test"))
    await expect(
      assertNotFinalAdmin(db, { targetUserId: member!.id, action: "delete" }),
    ).resolves.toBeUndefined()
  })
})

describe("open-redirect prevention", () => {
  it("accepts in-app return paths and rejects external ones", () => {
    expect(safeReturnPath("/library/topics/123")).toBe("/library/topics/123")
    expect(safeReturnPath(null)).toBe("/library")
    expect(safeReturnPath("https://evil.example")).toBe("/library")
    expect(safeReturnPath("//evil.example")).toBe("/library")
    expect(safeReturnPath("/\\evil.example")).toBe("/library")
    expect(safeReturnPath("javascript:alert(1)")).toBe("/library")
  })
})

describe("app error mapping", () => {
  it("AppError carries the stable code contract", () => {
    const error = new AppError("AUTH_REQUIRED", "no session")
    expect(error.code).toBe("AUTH_REQUIRED")
    expect(error).toBeInstanceOf(Error)
  })
})
