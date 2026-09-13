import { z } from "zod"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { reorderQuestions } from "@/lib/services/topics"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const TopicIdParams = z.strictObject({ topicId: z.uuid() })
const ReorderBody = z.strictObject({ questionIds: z.array(z.uuid()).min(1).max(500) })

function topicIdFrom(request: Request): string | undefined {
  const match = /\/api\/topics\/([^/]+)\/questions\/reorder$/.exec(new URL(request.url).pathname)
  return match?.[1]
}

export const PUT = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { topicId } = TopicIdParams.parse({ topicId: topicIdFrom(request) })
  const { questionIds } = ReorderBody.parse(await request.json())
  return jsonSuccess(await reorderQuestions(getDb(), ownerId, topicId, questionIds))
})
