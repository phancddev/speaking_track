import { z } from "zod"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { retryRecording } from "@/lib/services/recordings"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const Params = z.strictObject({ recordingId: z.uuid() })

function recordingIdFrom(request: Request): string | undefined {
  return /\/api\/recordings\/([^/]+)\/retry$/.exec(new URL(request.url).pathname)?.[1]
}

export const POST = withApi(async (request) => {
  const session = await requireSession(request.headers)
  // Admin queue retry names the owning user explicitly (task 08).
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { recordingId } = Params.parse({ recordingId: recordingIdFrom(request) })
  return jsonSuccess({ recording: await retryRecording(getDb(), { ownerId, recordingId }) })
})
