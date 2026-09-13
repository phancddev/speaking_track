import { expect, test } from "@playwright/test"
import { adminCredentials, createTestUser, signIn, uniqueEmail } from "./helpers"

/**
 * Task 09 scenario 1: bootstrap/login, public-signup rejection, and the
 * admin role gate — all against the real running stack.
 */
test.describe("authentication and role gate", () => {
  test("wrong credentials show a generic error; correct credentials reach the library", async ({
    page,
  }) => {
    const { email, password } = adminCredentials()
    await page.goto("/login")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password").fill("definitely-wrong-password")
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByText(/invalid email or password/i)).toBeVisible()

    await page.getByLabel("Password").fill(password)
    await page.getByRole("button", { name: "Sign in" }).click()
    await page.waitForURL(/\/library/)
  })

  test("protected routes redirect unauthenticated visitors to login", async ({ page }) => {
    await page.goto("/library")
    await page.waitForURL(/\/login/)
    await expect(page.getByLabel("Email")).toBeVisible()
  })

  test("public sign-up endpoint cannot create an account", async ({ request }) => {
    const attempt = await request.post("/api/auth/sign-up/email", {
      data: { name: "Signup Attempt", email: uniqueEmail("signup"), password: "signup-password-1" },
    })
    expect(attempt.status()).toBeGreaterThanOrEqual(400)
    const body = (await attempt.json().catch(() => ({}))) as { user?: unknown }
    expect(body.user).toBeUndefined()
  })

  test("a normal user cannot reach admin pages or APIs", async ({ page, request }) => {
    const user = await createTestUser(request, {
      name: "Plain User",
      email: uniqueEmail("plain"),
      password: "plain-user-password-1",
    })
    await signIn(page, user.email, user.password)

    for (const path of ["/admin/users", "/admin/youtube", "/admin/queue"]) {
      await page.goto(path)
      await page.waitForURL(/\/library/)
    }
    // The browser context carries the NORMAL user's session (the `request`
    // fixture above holds the admin cookie used to create the account).
    const api = await page.request.get("/api/admin/users")
    expect(api.status()).toBe(403)
  })

  test("the admin sees admin navigation and the users console", async ({ page, request }) => {
    void request
    const { email, password } = adminCredentials()
    await signIn(page, email, password)
    await expect(page.getByRole("link", { name: "Users" })).toBeVisible()
    await page.goto("/admin/users")
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible()
  })

  test("signing out removes access to protected content", async ({ page, request }) => {
    const user = await createTestUser(request, {
      name: "Signout User",
      email: uniqueEmail("signout"),
      password: "signout-user-password-1",
    })
    await signIn(page, user.email, user.password)
    await page.getByRole("button", { name: "Account menu" }).click()
    await page.getByRole("menuitem", { name: /sign out/i }).click()
    await page.waitForURL(/\/login/)
    await page.goto("/library")
    await page.waitForURL(/\/login/)
  })
})
