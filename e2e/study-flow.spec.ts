import { expect, test } from "@playwright/test"
import { createTestUser, signIn, uniqueEmail } from "./helpers"

/**
 * Task 09 scenario 3: tag/topic/question/draft persistence. A fresh user
 * builds study material through the UI, saves a draft, and a reload
 * preserves tags, order, and draft text.
 */
test.describe("study flow persistence", () => {
  test("tags, topics, questions, and drafts survive reload", async ({ page, request }) => {
    const user = await createTestUser(request, {
      name: "Study User",
      email: uniqueEmail("study"),
      password: "study-user-password-1",
    })
    await signIn(page, user.email, user.password)

    // Tags.
    await page.getByRole("button", { name: "Manage tags" }).click()
    for (const tagName of ["Part 1", "Travel"]) {
      await page.getByLabel("New tag").fill(tagName)
      await page.getByRole("button", { name: "Add", exact: true }).click()
      await expect(page.getByRole("dialog").getByText(tagName)).toBeVisible()
    }
    await page.keyboard.press("Escape")

    // Topic with both tags.
    await page.getByRole("button", { name: "Create topic" }).click()
    await page.getByLabel("Title", { exact: true }).fill("Travel topic")
    await page.getByLabel("Part 1").check()
    await page.getByLabel("Travel").check()
    await page.getByRole("button", { name: "Create topic", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Travel topic" })).toBeVisible()

    // Two ordered questions.
    for (const prompt of ["Describe a city you visited.", "Describe your ideal trip."]) {
      await page.locator(`button[aria-haspopup="dialog"]`, { hasText: "Add question" }).click()
      await page.getByLabel("Prompt").fill(prompt)
      await page.getByRole("dialog").getByRole("button", { name: "Add question" }).click()
      await expect(page.getByText(prompt)).toBeVisible()
    }
    // Draft on the first question, then a full reload.
    await page.getByRole("link", { name: "Practice" }).first().click()
    await page.waitForURL(/\/practice\/questions\//)
    const draftText = "Sunset over the old harbor, then street food."
    await page.getByLabel("Draft notes").fill(draftText)
    await page.getByRole("button", { name: "Save draft" }).click()
    await expect(page.getByText(/Saved at/)).toBeVisible()

    await page.reload()
    await expect(page.getByLabel("Draft notes")).toHaveValue(draftText)

    // Library reload preserves filters and content.
    await page.goto("/library")
    await expect(page.getByText("Travel topic")).toBeVisible()
    await expect(page.getByText("2 questions")).toBeVisible()
  })

  test("empty draft saves and reloads as empty", async ({ page, request }) => {
    const user = await createTestUser(request, {
      name: "Draft User",
      email: uniqueEmail("draft"),
      password: "draft-user-password-1",
    })
    await signIn(page, user.email, user.password)
    await page.getByRole("button", { name: "Create topic" }).click()
    await page.getByLabel("Title", { exact: true }).fill("Draft topic")
    await page.getByRole("button", { name: "Create topic", exact: true }).click()
    await page.locator(`button[aria-haspopup="dialog"]`, { hasText: "Add question" }).click()
    await page.getByLabel("Prompt").fill("Draft me.")
    await page.getByRole("dialog").getByRole("button", { name: "Add question" }).click()
    await page.getByRole("link", { name: "Practice" }).first().click()
    await page.waitForURL(/\/practice\/questions\//)
    // Save real content first, then clear it back to empty and save again.
    await page.getByLabel("Draft notes").fill("temporary notes")
    await page.getByRole("button", { name: "Save draft" }).click()
    await expect(page.getByText(/Saved at/)).toBeVisible()
    await page.getByLabel("Draft notes").fill("")
    await page.getByRole("button", { name: "Save draft" }).click()
    await expect(page.getByText(/Saved at/)).toBeVisible()
    await page.reload()
    await expect(page.getByLabel("Draft notes")).toHaveValue("")
  })
})
