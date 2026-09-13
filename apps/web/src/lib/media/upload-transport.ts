"use client"

import { apiFetch } from "@/lib/api-client"

/**
 * Direct browser → object-storage transport (task 05). The media body never
 * passes through Next.js: create-upload returns a short-lived presigned PUT
 * which this client executes with byte progress and abort support, then
 * completes verification server-side. Aborting never claims completion.
 */

export type PresignedUploadDescriptor = {
  objectKey: string
  url: string
  method: "PUT"
  headers: Record<string, string>
  expiresAt: string
}

export type UploadHandle = {
  abort: () => void
  done: Promise<{ ok: true } | { ok: false; error: string }>
}

export function uploadRecordingBlob(
  input: {
    questionId: string
    blob: Blob
    mimeType: string
    durationMs: number
  },
  callbacks: {
    onProgress?: (bytesSent: number, totalBytes: number) => void
  } = {},
): UploadHandle {
  const controller = new AbortController()
  const done = (async () => {
    try {
      const create = await apiFetch<{
        recording: { id: string }
        upload: PresignedUploadDescriptor
      }>(`/api/questions/${input.questionId}/recordings/uploads`, {
        method: "POST",
        body: JSON.stringify({
          mimeType: input.mimeType,
          sizeBytes: input.blob.size,
          durationMs: input.durationMs,
        }),
      })

      // XHR gives upload progress; fetch does not.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open("PUT", create.upload.url, true)
        for (const [header, value] of Object.entries(create.upload.headers)) {
          xhr.setRequestHeader(header, value)
        }
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            callbacks.onProgress?.(event.loaded, event.total)
          }
        })
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`Upload failed (HTTP ${xhr.status}).`))
        })
        xhr.addEventListener("error", () =>
          reject(new Error("Upload failed. Check your connection.")),
        )
        xhr.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
        controller.signal.addEventListener("abort", () => xhr.abort())
        xhr.send(input.blob)
      })

      callbacks.onProgress?.(input.blob.size, input.blob.size)
      await apiFetch(`/api/recordings/${create.recording.id}/complete`, { method: "POST" })
      return { ok: true as const }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        return { ok: false as const, error: "Upload cancelled." }
      }
      const message = cause instanceof Error ? cause.message : "Upload failed."
      return { ok: false as const, error: message }
    }
  })()

  return { abort: () => controller.abort(), done }
}
