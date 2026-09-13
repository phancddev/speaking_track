import { z } from "zod"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { deleteRecording } from "@/lib/services/recordings"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const Params = z.strictObject({ recordingId: z.uuid() })

function recordingIdFrom(request: Request): string | undefined {
  return /\/api\/recordings\/([^/]+?)(?:\/[^/]*)?$/.exec(new URL(request.url).pathname)?.[1]
}

export const DELETE = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { recordingId } = Params.parse({ recordingId: recordingIdFrom(request) })
  return jsonSuccess(await deleteRecording(getDb(), { ownerId, recordingId }))
})
