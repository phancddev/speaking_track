import { NextResponse } from "next/server"
import { z } from "zod"
import { QuestionsBulkCreateSchema } from "@speaking-track/contracts"
import { withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { createQuestions } from "@/lib/services/topics"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const TopicIdParams = z.strictObject({ topicId: z.uuid() })

function topicIdFrom(request: Request): string | undefined {
  const match = /\/api\/topics\/([^/]+)\/questions\/bulk$/.exec(new URL(request.url).pathname)
  return match?.[1]
}

export const POST = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { topicId } = TopicIdParams.parse({ topicId: topicIdFrom(request) })
  const input = QuestionsBulkCreateSchema.parse(await request.json())
  const questions = await createQuestions(getDb(), ownerId, topicId, input)
  return NextResponse.json({ data: questions }, { status: 201 })
})
