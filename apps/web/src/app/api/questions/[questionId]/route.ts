import { z } from "zod"
import { QuestionUpdateSchema } from "@speaking-track/contracts"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { deleteQuestion, updateQuestion } from "@/lib/services/topics"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const QuestionIdParams = z.strictObject({ questionId: z.uuid() })

function questionIdFrom(request: Request): string | undefined {
  const match = /\/api\/questions\/([^/]+)(?:\/.*)?$/.exec(new URL(request.url).pathname)
  return match?.[1]
}

export const PATCH = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { questionId } = QuestionIdParams.parse({ questionId: questionIdFrom(request) })
  const input = QuestionUpdateSchema.parse(await request.json())
  return jsonSuccess(await updateQuestion(getDb(), ownerId, questionId, input))
})

export const DELETE = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { questionId } = QuestionIdParams.parse({ questionId: questionIdFrom(request) })
  await deleteQuestion(getDb(), ownerId, questionId)
  return jsonSuccess({ deleted: true })
})
