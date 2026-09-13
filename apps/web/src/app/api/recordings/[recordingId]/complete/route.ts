import { z } from "zod"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { completeRecordingUpload } from "@/lib/services/recordings"
import { getDb } from "@/lib/db"
import { getStorage } from "@/lib/storage"

export const dynamic = "force-dynamic"

const Params = z.strictObject({ recordingId: z.uuid() })

function recordingIdFrom(request: Request): string | undefined {
  return /\/api\/recordings\/([^/]+)\/complete$/.exec(new URL(request.url).pathname)?.[1]
}

export const POST = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session)
  const { recordingId } = Params.parse({ recordingId: recordingIdFrom(request) })
  const result = await completeRecordingUpload(getDb(), getStorage(), { ownerId, recordingId })
  return jsonSuccess(result)
})
