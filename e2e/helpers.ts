import { expect, type APIRequestContext, type Page } from "@playwright/test"

/**
 * Shared e2e helpers: session bootstrap through the real HTTP surface.
 * The bootstrapped admin (root .env) creates fresh users per scenario via
 * the real admin API during the run; public sign-up must never create
 * accounts. The admin session cookie is cached across calls because the
 * sign-in endpoint rate-limits per IP (production hardening, not a bypass).
 */

export function adminCredentials(): { email: string; password: string } {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL/PASSWORD must be set in .env for e2e")
  }
  return { email, password }
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/library/, { timeout: 20_000 })
}

let cachedAdminCookie: string | null = null

async function adminSignIn(request: APIRequestContext): Promise<string> {
  const { email, password } = adminCredentials()
  const post = () =>
    request.post("/api/auth/sign-in/email", {
      headers: { origin: "https://localhost" },
      data: { email, password },
    })
  let login = await post()
  if (login.status() === 429) {
    // Sign-in is rate-limited per IP; wait out the window and retry once.
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 10_500)
    await promise
    login = await post()
  }
  expect(login.status(), `admin sign-in: ${login.status()}`).toBe(200)
  const cookie = login
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value.split(";")[0])
    .join("; ")
  cachedAdminCookie = cookie
  return cookie
}

export async function createTestUser(
  request: APIRequestContext,
  input: { name: string; email: string; password: string; role?: "admin" | "user" },
): Promise<{ id: string; email: string; password: string }> {
  const create = async (cookie: string) =>
    request.post("/api/admin/users", {
      headers: { cookie, origin: "https://localhost" },
      data: {
        name: input.name,
        email: input.email,
        password: input.password,
        role: input.role ?? "user",
      },
    })

  let created = cachedAdminCookie ? await create(cachedAdminCookie) : null
  if (!created || created.status() === 401 || created.status() === 403) {
    created = await create(await adminSignIn(request))
  }
  expect(created.status(), `create user: ${created.status()}`).toBe(201)
  const body = (await created.json()) as { data: { id: string } }
  return { id: body.data.id, email: input.email, password: input.password }
}
