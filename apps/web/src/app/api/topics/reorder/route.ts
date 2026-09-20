import { z } from "zod"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { reorderTopics } from "@/lib/services/topics"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const ReorderBody = z.strictObject({ topicIds: z.array(z.uuid()).min(1).max(500) })

export const PUT = withApi(async (request) => {
  const session = await requireSession(request.headers)
  // Admin browsing reorders the named owner's library; normal users are
  // always session-scoped regardless of the query parameter.
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { topicIds } = ReorderBody.parse(await request.json())
  return jsonSuccess(await reorderTopics(getDb(), ownerId, topicIds))
})
