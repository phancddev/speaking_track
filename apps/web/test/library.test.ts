import { randomUUID } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq } from "drizzle-orm"
import {
  createDatabaseConfig,
  createDbClient,
  user as userTable,
  type Db,
} from "@speaking-track/db"
import { createAuth, type AppAuth } from "@/lib/auth/server"
import { bootstrapAdmin } from "../scripts/bootstrap-admin.mts"
import { createDisposableDatabase, type DisposableDatabase } from "./helpers"

/**
 * Library domain behavior (task 04 required tests) exercised through the
 * real route handlers with real sessions on a disposable PostgreSQL DB.
 */

const ORIGIN = "https://localhost"

let database: DisposableDatabase
let db: Db
let closeDb: () => Promise<void>
let auth: AppAuth

let adminCookie = ""
let userACookie = ""
let userBCookie = ""
let userBId = ""

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
  ;(globalThis as Record<string, unknown>)["__speakingTrackAuth"] = auth
  ;(globalThis as Record<string, unknown>)["__speakingTrackWebDb"] = db

  await bootstrapAdmin(db, {
    email: "admin@example.test",
    password: "admin-password-1",
    name: "Admin",
  })

  adminCookie = await signIn("admin@example.test", "admin-password-1")

  // The admin creates two normal users through Better Auth's admin plugin.
  const { userB } = await createUsersViaAdmin()
  userBId = userB
  userACookie = await signIn("a@example.test", "user-x-password-1")
  userBCookie = await signIn("b@example.test", "user-x-password-1")
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
        "x-forwarded-for": `10.77.0.${requestCounter % 250}`,
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

async function createUsersViaAdmin() {
  const created: string[] = []
  for (const [email, name] of [
    ["a@example.test", "User A"],
    ["b@example.test", "User B"],
  ] as const) {
    requestCounter += 1
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/admin/create-user`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
          origin: ORIGIN,
          "x-forwarded-for": `10.77.0.${requestCounter % 250}`,
        },
        body: JSON.stringify({ email, password: "user-x-password-1", name, role: "user" }),
      }),
    )
    if (response.status !== 200) throw new Error(`create-user failed: ${response.status}`)
    const body = (await response.json()) as { user: { id: string } }
    created.push(body.user.id)
  }
  const [rowB] = await db.select().from(userTable).where(eq(userTable.email, "b@example.test"))
  void created
  return { userB: rowB!.id }
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
    "x-forwarded-for": `10.77.0.${requestCounter % 250}`,
  }
  if (init?.body !== undefined) headers["content-type"] = "application/json"
  const { routes, params } = await routeTable()
  const method = (init?.method ?? "GET").toUpperCase()
  // Route lookup matches the bare path against :id templates; the request
  // URL keeps its query string.
  const routePath = path.split("?")[0]!
  const routeKey = Object.keys(routes).find((key) => {
    const [routeMethod, template] = key.split(" ") as [string, string]
    if (routeMethod !== method) return false
    const pattern = template.replaceAll(":id", "[^/]+")
    return new RegExp(`^${pattern}$`).test(routePath)
  })
  const handler = routeKey ? routes[routeKey] : undefined
  if (!handler) throw new Error(`no test route wiring for ${method} ${routePath}`)
  const url = new URL(`${ORIGIN}${path}`)
  const request = new Request(url, {
    method,
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  void params
  const response = await handler(request, { params: Promise.resolve(params(path)) })
  const text = await response.text()
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  }
}

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

async function routeTable(): Promise<{
  routes: Record<string, RouteHandler>
  params: (path: string) => Record<string, string>
}> {
  const tagsRoute = await import("@/app/api/tags/route")
  const tagItemRoute = await import("@/app/api/tags/[tagId]/route")
  const topicsRoute = await import("@/app/api/topics/route")
  const topicItemRoute = await import("@/app/api/topics/[topicId]/route")
  const questionsRoute = await import("@/app/api/topics/[topicId]/questions/route")
  const questionItemRoute = await import("@/app/api/questions/[questionId]/route")
  const reorderRoute = await import("@/app/api/topics/[topicId]/questions/reorder/route")

  const routes: Record<string, RouteHandler> = {
    "GET /api/tags": tagsRoute.GET as RouteHandler,
    "POST /api/tags": tagsRoute.POST as RouteHandler,
    "PATCH /api/tags/:id": tagItemRoute.PATCH as RouteHandler,
    "DELETE /api/tags/:id": tagItemRoute.DELETE as RouteHandler,
    "GET /api/topics": topicsRoute.GET as RouteHandler,
    "POST /api/topics": topicsRoute.POST as RouteHandler,
    "GET /api/topics/:id": topicItemRoute.GET as RouteHandler,
    "PATCH /api/topics/:id": topicItemRoute.PATCH as RouteHandler,
    "DELETE /api/topics/:id": topicItemRoute.DELETE as RouteHandler,
    "GET /api/topics/:id/questions": questionsRoute.GET as RouteHandler,
    "POST /api/topics/:id/questions": questionsRoute.POST as RouteHandler,
    "PATCH /api/questions/:id": questionItemRoute.PATCH as RouteHandler,
    "DELETE /api/questions/:id": questionItemRoute.DELETE as RouteHandler,
    "PUT /api/topics/:id/questions/reorder": reorderRoute.PUT as RouteHandler,
  }

  const params = (path: string): Record<string, string> => {
    const parts = path.split("/").filter(Boolean)
    if (parts[0] === "api" && parts[1] === "tags" && parts[2]) return { tagId: parts[2] }
    if (parts[1] === "topics" && parts[2] && parts[3] === "questions" && parts[4] === "reorder") {
      return { topicId: parts[2] }
    }
    if (parts[1] === "topics" && parts[2]) return { topicId: parts[2] }
    if (parts[1] === "questions" && parts[2]) return { questionId: parts[2] }
    return {}
  }

  return { routes, params }
}

function apiPath(template: string, id: string): string {
  return template.replace(":id", id)
}

describe("tag ownership and uniqueness", () => {
  it("creates identically named tags for two owners and rejects a duplicate for one owner with 409", async () => {
    const a1 = await api(userACookie, "/api/tags", { method: "POST", body: { name: "Travel" } })
    expect(a1.status).toBe(201)
    const b1 = await api(userBCookie, "/api/tags", { method: "POST", body: { name: "travel" } })
    expect(b1.status).toBe(201)

    const a2 = await api(userACookie, "/api/tags", { method: "POST", body: { name: "  TRAVEL " } })
    expect(a2.status).toBe(409)
    expect((a2.body.error as { code: string }).code).toBe("DUPLICATE_TAG")
  })

  it("normalizes whitespace and case in the stored name", async () => {
    const created = await api(userACookie, "/api/tags", {
      method: "POST",
      body: { name: "  Part   1 " },
    })
    expect(created.status).toBe(201)
    expect((created.body.data as { name: string }).name).toBe("Part   1")
  })

  it("user A cannot read, update, or delete user B's tag by guessed ID", async () => {
    const listB = await api(userBCookie, "/api/tags")
    const bTag = (listB.body.data as { id: string }[]).find((tag) => tag.id.length > 0)
    if (!bTag) throw new Error("user B should own at least one tag")

    const patch = await api(userACookie, apiPath("/api/tags/:id", bTag.id), {
      method: "PATCH",
      body: { name: "Hijacked" },
    })
    expect(patch.status).toBe(404)

    const del = await api(userACookie, apiPath("/api/tags/:id", bTag.id), { method: "DELETE" })
    expect(del.status).toBe(404)

    const listA = await api(userACookie, "/api/tags")
    expect((listA.body.data as { id: string }[]).some((tag) => tag.id === bTag.id)).toBe(false)
  })

  it("admin can rename another user's tag and ownership stays with that user", async () => {
    const listB = await api(userBCookie, "/api/tags")
    const travelB = (listB.body.data as { id: string; name: string }[]).find(
      (tag) => tag.name === "travel",
    )!
    const patched = await api(
      adminCookie,
      `${apiPath("/api/tags/:id", travelB.id)}?ownerId=${userBId}`,
      { method: "PATCH", body: { name: "travel-renamed" } },
    )
    expect(patched.status).toBe(200)

    const after = await api(userBCookie, "/api/tags")
    expect(
      (after.body.data as { name: string }[]).some((tag) => tag.name === "travel-renamed"),
    ).toBe(true)
  })
})

describe("topics with tags", () => {
  it("attaches only same-owner tags; a foreign tag is not found", async () => {
    const listA = await api(userACookie, "/api/tags")
    const tagA = (listA.body.data as { id: string; name: string }[]).find(
      (tag) => tag.name === "Travel",
    )!

    const created = await api(userACookie, "/api/topics", {
      method: "POST",
      body: { title: "Hometown", tagIds: [tagA.id] },
    })
    expect(created.status).toBe(201)
    expect((created.body.data as { tags: unknown[] }).tags).toHaveLength(1)

    const foreign = await api(userACookie, "/api/topics", {
      method: "POST",
      body: { title: "Evil topic", tagIds: [randomUUID()] },
    })
    expect(foreign.status).toBe(404)
  })

  it("multi-tag filtering intersects, not unions", async () => {
    const listA = await api(userACookie, "/api/tags")
    const byName = new Map(
      (listA.body.data as { id: string; name: string }[]).map((tag) => [tag.name, tag.id]),
    )
    const work = await api(userACookie, "/api/tags", { method: "POST", body: { name: "Work" } })
    const workId = (work.body.data as { id: string }).id
    const travelId = byName.get("Travel")!

    await api(userACookie, "/api/topics", {
      method: "POST",
      body: { title: "Both tags", tagIds: [travelId, workId] },
    })
    await api(userACookie, "/api/topics", {
      method: "POST",
      body: { title: "Only travel", tagIds: [travelId] },
    })

    const both = await api(userACookie, `/api/topics?tagIds=${travelId},${workId}`)
    const titles = (both.body.data as { title: string }[]).map((topic) => topic.title)
    expect(titles).toContain("Both tags")
    expect(titles).not.toContain("Only travel")
    expect(titles).not.toContain("Hometown")

    const single = await api(userACookie, `/api/topics?tagIds=${travelId}`)
    const singleTitles = (single.body.data as { title: string }[]).map((t) => t.title)
    expect(singleTitles).toContain("Only travel")
    expect(singleTitles).toContain("Both tags")
  })

  it("case-insensitive title search works", async () => {
    const found = await api(userACookie, "/api/topics?q=BOTH")
    expect((found.body.data as { title: string }[]).map((t) => t.title)).toContain("Both tags")
  })

  it("user A cannot read user B's topic by guessed ID; admin can with ownerId", async () => {
    // Create one topic for B to have a concrete ID to probe with.
    const topicBCreate = await api(userBCookie, "/api/topics", {
      method: "POST",
      body: { title: "B private topic" },
    })
    const topicBId = (topicBCreate.body.data as { id: string }).id

    const listB = await api(userBCookie, "/api/topics")
    expect((listB.body.data as unknown[]).length).toBeGreaterThan(0)

    const own = await api(userACookie, "/api/topics")
    const topicA = (own.body.data as { id: string; title: string }[]).find(
      (topic) => topic.title === "Hometown",
    )!
    void topicA

    const patchA = await api(userACookie, apiPath("/api/topics/:id", topicBId), {
      method: "PATCH",
      body: { title: "Hijacked" },
    })
    expect(patchA.status).toBe(404)

    const readA = await api(userACookie, apiPath("/api/topics/:id", topicBId))
    expect(readA.status).toBe(404)

    const adminRead = await api(adminCookie, `/api/topics?ownerId=${userBId}`)
    expect(
      (adminRead.body.data as { title: string }[]).some((t) => t.title === "B private topic"),
    ).toBe(true)

    const adminPatch = await api(
      adminCookie,
      `${apiPath("/api/topics/:id", topicBId)}?ownerId=${userBId}`,
      { method: "PATCH", body: { title: "B topic (admin edit)" } },
    )
    expect(adminPatch.status).toBe(200)

    // Ownership never transfers on admin edit: B still sees it under B's session.
    const listBAfter = await api(userBCookie, "/api/topics")
    expect(
      (listBAfter.body.data as { title: string }[]).some((t) => t.title === "B topic (admin edit)"),
    ).toBe(true)
  })
})

describe("question ordering", () => {
  it("creates questions at the end by default and reorders atomically", async () => {
    const topic = await api(userACookie, "/api/topics", {
      method: "POST",
      body: { title: "Ordering topic" },
    })
    const topicId = (topic.body.data as { id: string }).id

    const q1 = await api(userACookie, apiPath("/api/topics/:id/questions", topicId), {
      method: "POST",
      body: { prompt: "First" },
    })
    const q2 = await api(userACookie, apiPath("/api/topics/:id/questions", topicId), {
      method: "POST",
      body: { prompt: "Second" },
    })
    const q3 = await api(userACookie, apiPath("/api/topics/:id/questions", topicId), {
      method: "POST",
      body: { prompt: "Third" },
    })
    const id1 = (q1.body.data as { id: string }).id
    const id2 = (q2.body.data as { id: string }).id
    const id3 = (q3.body.data as { id: string }).id

    const initial = await api(userACookie, apiPath("/api/topics/:id/questions", topicId))
    expect((initial.body.data as { prompt: string }[]).map((q) => q.prompt)).toEqual([
      "First",
      "Second",
      "Third",
    ])

    const reordered = await api(
      userACookie,
      apiPath("/api/topics/:id/questions/reorder", topicId),
      { method: "PUT", body: { questionIds: [id3, id1, id2] } },
    )
    expect(reordered.status).toBe(200)
    expect((reordered.body.data as { prompt: string }[]).map((q) => q.prompt)).toEqual([
      "Third",
      "First",
      "Second",
    ])

    // Duplicate IDs rejected with no partial position updates.
    const dup = await api(userACookie, apiPath("/api/topics/:id/questions/reorder", topicId), {
      method: "PUT",
      body: { questionIds: [id1, id1, id2, id3] },
    })
    expect(dup.status).toBe(400)
    const afterDup = await api(userACookie, apiPath("/api/topics/:id/questions", topicId))
    expect((afterDup.body.data as { prompt: string }[]).map((q) => q.prompt)).toEqual([
      "Third",
      "First",
      "Second",
    ])

    // Foreign/missing questions rejected without partial updates.
    const foreign = await api(userACookie, apiPath("/api/topics/:id/questions/reorder", topicId), {
      method: "PUT",
      body: { questionIds: [id1, randomUUID()] },
    })
    expect(foreign.status).toBe(400)
    const afterForeign = await api(userACookie, apiPath("/api/topics/:id/questions", topicId))
    expect((afterForeign.body.data as { prompt: string }[]).map((q) => q.prompt)).toEqual([
      "Third",
      "First",
      "Second",
    ])
  })

  it("deleting a question keeps sibling positions dense", async () => {
    const topic = await api(userACookie, "/api/topics", {
      method: "POST",
      body: { title: "Deletion topic" },
    })
    const topicId = (topic.body.data as { id: string }).id
    const created = await Promise.all(
      ["Q1", "Q2", "Q3"].map((prompt) =>
        api(userACookie, apiPath("/api/topics/:id/questions", topicId), {
          method: "POST",
          body: { prompt },
        }),
      ),
    )
    const ids = created.map((r) => (r.body.data as { id: string }).id)

    const del = await api(userACookie, apiPath("/api/questions/:id", ids[1]!), { method: "DELETE" })
    expect(del.status).toBe(200)

    const list = await api(userACookie, apiPath("/api/topics/:id/questions", topicId))
    const questions = list.body.data as { prompt: string; position: number }[]
    expect(questions.map((q) => q.prompt)).toEqual(["Q1", "Q3"])
    expect(questions.map((q) => q.position)).toEqual([0, 1])
  })
})

describe("soft deletes and tag removal", () => {
  it("deleting a tag removes associations but keeps topics", async () => {
    const listA = await api(userACookie, "/api/tags")
    const work = (listA.body.data as { id: string; name: string }[]).find(
      (tag) => tag.name === "Work",
    )!

    const del = await api(userACookie, apiPath("/api/tags/:id", work.id), { method: "DELETE" })
    expect(del.status).toBe(200)

    const topics = await api(userACookie, "/api/topics?q=Both tags")
    const bothTags = (topics.body.data as { title: string; tags: { name: string }[] }[])[0]!
    expect(bothTags).toBeDefined()
    expect(bothTags.tags.some((tag) => tag.name === "Work")).toBe(false)
  })

  it("deleted topics and questions disappear from normal reads", async () => {
    const topic = await api(userACookie, "/api/topics", {
      method: "POST",
      body: { title: "Doomed topic" },
    })
    const topicId = (topic.body.data as { id: string }).id
    const question = await api(userACookie, apiPath("/api/topics/:id/questions", topicId), {
      method: "POST",
      body: { prompt: "Doomed question" },
    })
    const questionId = (question.body.data as { id: string }).id

    const del = await api(userACookie, apiPath("/api/topics/:id", topicId), { method: "DELETE" })
    expect(del.status).toBe(200)

    const read = await api(userACookie, apiPath("/api/topics/:id", topicId))
    expect(read.status).toBe(404)
    const listed = await api(userACookie, "/api/topics?q=Doomed")
    expect((listed.body.data as unknown[]).length).toBe(0)

    const questionRead = await api(userACookie, apiPath("/api/questions/:id", questionId), {
      method: "PATCH",
      body: { prompt: "edit after delete" },
    })
    expect(questionRead.status).toBe(404)
  })

  it("unauthenticated access is rejected with 401", async () => {
    const noSession = await api("", "/api/tags")
    expect(noSession.status).toBe(401)
    expect((noSession.body.error as { code: string }).code).toBe("AUTH_REQUIRED")
  })
})
