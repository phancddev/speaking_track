import { NextResponse } from "next/server"
import { z } from "zod"
import { QuestionCreateSchema } from "@speaking-track/contracts"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { createQuestion, listQuestions } from "@/lib/services/topics"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const TopicIdParams = z.strictObject({ topicId: z.uuid() })

function topicIdFrom(request: Request): string | undefined {
  const match = /\/api\/topics\/([^/]+)\/questions$/.exec(new URL(request.url).pathname)
  return match?.[1]
}

export const GET = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session)
  const { topicId } = TopicIdParams.parse({ topicId: topicIdFrom(request) })
  return jsonSuccess(await listQuestions(getDb(), ownerId, topicId))
})

export const POST = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { topicId } = TopicIdParams.parse({ topicId: topicIdFrom(request) })
  const input = QuestionCreateSchema.parse(await request.json())
  const question = await createQuestion(getDb(), ownerId, topicId, input)
  return NextResponse.json({ data: question }, { status: 201 })
})
