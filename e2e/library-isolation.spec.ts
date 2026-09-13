import { expect, test, type Browser } from "@playwright/test"
import { adminCredentials, createTestUser, signIn, uniqueEmail } from "./helpers"

/**
 * Task 09 scenario 2: cross-user library isolation plus explicit admin
 * owner access. Each user operates from a separate browser context (as in
 * real life); neither can observe the other, and the admin operates on B's
 * library only by naming B — ownership never transfers.
 */
test.describe("cross-user isolation and admin owner access", () => {
  test("users are isolated by ownership; admin browses explicitly", async ({
    browser,
    request,
  }: {
    browser: Browser
    request: import("@playwright/test").APIRequestContext
  }) => {
    const userA = await createTestUser(request, {
      name: "Iso User A",
      email: uniqueEmail("iso-a"),
      password: "iso-user-a-password-1",
    })
    const userB = await createTestUser(request, {
      name: "Iso User B",
      email: uniqueEmail("iso-b"),
      password: "iso-user-b-password-1",
    })

    // User A creates a private topic through the UI.
    const contextA = await browser.newContext({ ignoreHTTPSErrors: true })
    const pageA = await contextA.newPage()
    await signIn(pageA, userA.email, userA.password)
    await pageA.getByRole("button", { name: "Create topic" }).click()
    await pageA.getByLabel("Title", { exact: true }).fill("A's secret topic")
    await pageA.getByRole("dialog").getByRole("button", { name: "Create topic" }).click()
    await expect(pageA.getByRole("heading", { name: "A's secret topic" })).toBeVisible()
    const topicId = pageA.url().split("/").pop()!.split("?")[0]!
    await contextA.close()

    // User B never sees A's topic and cannot open it by URL.
    const contextB = await browser.newContext({ ignoreHTTPSErrors: true })
    const pageB = await contextB.newPage()
    await signIn(pageB, userB.email, userB.password)
    await expect(pageB.getByText("A's secret topic")).toHaveCount(0)
    await pageB.goto(`/library/topics/${topicId}`)
    await expect(pageB.getByText(/could not be found|not found/i)).toBeVisible()

    // The admin names B explicitly: the browse banner is visible, B's
    // library is empty, and A's topic stays absent.
    const contextAdmin = await browser.newContext({ ignoreHTTPSErrors: true })
    const pageAdmin = await contextAdmin.newPage()
    const { email, password } = adminCredentials()
    await signIn(pageAdmin, email, password)
    await pageAdmin.goto(`/library?ownerId=${userB.id}`)
    await expect(pageAdmin.getByText("Browsing Iso User B's library")).toBeVisible()
    await expect(pageAdmin.getByText("A's secret topic")).toHaveCount(0)

    // Admin edits B's library by creating a topic for B; ownership stays B.
    await pageAdmin.getByRole("button", { name: "Create topic" }).click()
    await pageAdmin.getByLabel("Title", { exact: true }).fill("Created by admin for B")
    await pageAdmin.getByRole("dialog").getByRole("button", { name: "Create topic" }).click()
    await expect(pageAdmin.getByRole("heading", { name: "Created by admin for B" })).toBeVisible()
    const owned = await request.get(`/api/topics?ownerId=${userB.id}`)
    expect(owned.status()).toBe(200)
    const ownedBody = (await owned.json()) as { data: { title: string }[] }
    expect(ownedBody.data?.some((t) => t.title === "Created by admin for B")).toBe(true)
    const ownList = await request.get("/api/topics")
    expect(ownList.status()).toBe(200)
    const ownBody = (await ownList.json()) as { data: { title: string }[] }
    expect(ownBody.data?.some((t) => t.title === "Created by admin for B")).toBe(false)
    await contextAdmin.close()
  })

  test("identically named tags do not collide across users", async ({ browser, request }) => {
    const userA = await createTestUser(request, {
      name: "Tag User A",
      email: uniqueEmail("tag-a"),
      password: "tag-user-a-password-1",
    })
    const userB = await createTestUser(request, {
      name: "Tag User B",
      email: uniqueEmail("tag-b"),
      password: "tag-user-b-password-1",
    })

    for (const user of [userA, userB]) {
      const context = await browser.newContext({ ignoreHTTPSErrors: true })
      const page = await context.newPage()
      await signIn(page, user.email, user.password)
      await page.getByRole("button", { name: "Manage tags" }).click()
      await page.getByLabel("New tag").fill("Part 1")
      await page.getByRole("button", { name: "Add", exact: true }).click()
      await expect(page.getByRole("dialog").getByText("Part 1")).toBeVisible()
      await page.keyboard.press("Escape")
      await context.close()
    }
  })
})
