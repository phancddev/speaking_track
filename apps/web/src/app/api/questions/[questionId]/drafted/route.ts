import { z } from "zod"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { setQuestionDrafted } from "@/lib/services/topics"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const Params = z.strictObject({ questionId: z.uuid() })
const Body = z.strictObject({ drafted: z.boolean() })

function questionIdFrom(request: Request): string | undefined {
  return /\/api\/questions\/([^/]+)\/drafted$/.exec(new URL(request.url).pathname)?.[1]
}

/** Toggles the user's "I drafted this question" checkbox. */
export const PUT = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { questionId } = Params.parse({ questionId: questionIdFrom(request) })
  const input = Body.parse(await request.json())
  return jsonSuccess(await setQuestionDrafted(getDb(), ownerId, questionId, input.drafted))
})
