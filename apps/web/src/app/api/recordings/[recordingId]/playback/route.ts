import { z } from "zod"
import { AppError, HIDDEN_RECORDING_STATES } from "@speaking-track/contracts"
import { jsonSuccess, withApi } from "@/lib/http"
import { getStorage } from "@/lib/storage"
import { getDb } from "@/lib/db"

import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { loadOwnedRecording } from "@/lib/services/recordings"

export const dynamic = "force-dynamic"

const Params = z.strictObject({ recordingId: z.uuid() })

function recordingIdFrom(request: Request): string | undefined {
  return /\/api\/recordings\/([^/]+)\/playback$/.exec(new URL(request.url).pathname)?.[1]
}

/**
 * Short-lived presigned GET for streaming a stored recording from object
 * storage. The recording stays in storage after YouTube upload, so local
 * playback works even while an upload is deferred for quota reasons.
 */
export const GET = withApi(async (request) => {
  const session = await requireSession(request.headers)
  // Admin queue browsing names the owning user explicitly (task 08).
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { recordingId } = Params.parse({ recordingId: recordingIdFrom(request) })
  const recording = await loadOwnedRecording(getDb(), ownerId, recordingId)
  if (!recording.storageKey || HIDDEN_RECORDING_STATES.includes(recording.status as never)) {
    throw new AppError("RESOURCE_NOT_FOUND", "Recording media is not available.")
  }
  return jsonSuccess(await getStorage().createPresignedPlayback(recording.storageKey))
})
