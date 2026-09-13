import { expect, test } from "@playwright/test"
import { createTestUser, signIn, uniqueEmail } from "./helpers"

/**
 * Task 09 scenario 4: recording direct upload/complete/queue status with
 * deterministic media. The presigned PUT goes through the public MinIO
 * endpoint (Caddy → minio), never through Next.js. The provider boundary
 * is controlled: without YouTube credentials the worker fails the upload
 * with the stable YOUTUBE_NOT_CONNECTED code instead of touching Google.
 */

const MIME = "video/webm;codecs=vp9,opus"

async function createTopicAndQuestion(page: import("@playwright/test").Page): Promise<string> {
  const topic = await page.request.post("/api/topics", { data: { title: "Recording topic" } })
  const topicBody = (await topic.json()) as { data: { id: string } }
  const question = await page.request.post(`/api/topics/${topicBody.data.id}/questions`, {
    data: { prompt: "Speak about your day." },
  })
  const questionBody = (await question.json()) as { data: { id: string } }
  return questionBody.data.id
}

test.describe("recording upload and queue lifecycle", () => {
  test("direct upload, idempotent complete, durable failure state", async ({ page, request }) => {
    test.setTimeout(120_000)
    const user = await createTestUser(request, {
      name: "Recording User",
      email: uniqueEmail("record"),
      password: "record-user-password-1",
    })
    await signIn(page, user.email, user.password)
    const questionId = await createTopicAndQuestion(page)

    // Deterministic media: small generated webm-like payload.
    const bytes = Buffer.alloc(4096, 0x42)

    const create = await page.request.post(`/api/questions/${questionId}/recordings/uploads`, {
      data: { mimeType: MIME, sizeBytes: bytes.byteLength, durationMs: 4200 },
    })
    expect(create.status()).toBe(201)
    const createBody = (await create.json()) as {
      data: {
        recording: { id: string; status: string }
        upload: { url: string; headers: Record<string, string> }
      }
    }
    const recordingId = createBody.data.recording.id
    expect(createBody.data.recording.status).toBe("STAGING")

    // The presigned URL must target the public S3 endpoint, not Next.js.
    const uploadUrl = new URL(createBody.data.upload.url)
    expect(uploadUrl.pathname.startsWith("/speaking-track-staging/")).toBe(true)

    // Direct browser-style PUT to object storage.
    const put = await page.request.fetch(uploadUrl.toString(), {
      method: "PUT",
      headers: { "content-type": MIME },
      data: bytes,
    })
    expect(put.status()).toBeLessThan(300)

    // Completion verifies metadata and queues exactly one intent.
    const complete = await page.request.post(`/api/recordings/${recordingId}/complete`)
    expect(complete.status()).toBe(200)
    const completeBody = (await complete.json()) as { data: { recording: { status: string } } }
    expect(completeBody.data.recording.status).toBe("QUEUED")

    // Repeated completion is idempotent.
    const again = await page.request.post(`/api/recordings/${recordingId}/complete`)
    expect(again.status()).toBe(200)
    const againBody = (await again.json()) as { data: { recording: { status: string } } }
    expect(againBody.data.recording.status).toBe("QUEUED")

    // The worker owns the job from here. Without YouTube credentials the
    // outcome is the stable, controlled YOUTUBE_NOT_CONNECTED failure.
    const deadline = Date.now() + 90_000
    let terminal = ""
    let failureCode = ""
    while (Date.now() < deadline) {
      const list = await page.request.get(`/api/questions/${questionId}/recordings`)
      const listBody = (await list.json()) as {
        data: { id: string; status: string; failureCode: string | null }[]
      }
      const row = listBody.data.find((r) => r.id === recordingId)
      expect(row).toBeDefined()
      if (row!.status === "FAILED" || row!.status === "READY") {
        terminal = row!.status
        failureCode = row!.failureCode ?? ""
        break
      }
      await page.waitForTimeout(2000)
    }
    expect(terminal).toBe("FAILED")
    expect(failureCode).toBe("YOUTUBE_NOT_CONNECTED")

    // The failed recording is retryable (source is still staged) but a
    // second immediate retry keeps failing closed at the provider boundary.
    const retry = await page.request.post(`/api/recordings/${recordingId}/retry`)
    expect(retry.status()).toBe(200)
  })

  test("aborted upload never becomes QUEued", async ({ page, request }) => {
    const user = await createTestUser(request, {
      name: "Abort User",
      email: uniqueEmail("abort"),
      password: "abort-user-password-1",
    })
    await signIn(page, user.email, user.password)
    const questionId = await createTopicAndQuestion(page)

    const create = await page.request.post(`/api/questions/${questionId}/recordings/uploads`, {
      data: { mimeType: MIME, sizeBytes: 2048, durationMs: 1000 },
    })
    const createBody = (await create.json()) as { data: { recording: { id: string } } }

    // No bytes are uploaded; completion must reject instead of queueing.
    const complete = await page.request.post(
      `/api/recordings/${createBody.data.recording.id}/complete`,
    )
    expect(complete.status()).toBeGreaterThanOrEqual(400)
    const list = await page.request.get(`/api/questions/${questionId}/recordings`)
    const listBody = (await list.json()) as { data: { id: string; status: string }[] }
    expect(listBody.data[0]!.status).toBe("STAGING")
  })
})
