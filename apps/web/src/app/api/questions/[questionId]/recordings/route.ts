import { z } from "zod"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { listRecordingsForQuestion } from "@/lib/services/recordings"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const Params = z.strictObject({ questionId: z.uuid() })

function questionIdFrom(request: Request): string | undefined {
  return /\/api\/questions\/([^/]+)\/recordings$/.exec(new URL(request.url).pathname)?.[1]
}

export const GET = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { questionId } = Params.parse({ questionId: questionIdFrom(request) })
  return jsonSuccess(await listRecordingsForQuestion(getDb(), { ownerId, questionId }))
})
