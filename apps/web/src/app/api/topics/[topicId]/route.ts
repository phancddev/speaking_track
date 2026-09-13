import { z } from "zod"
import { TopicUpdateSchema } from "@speaking-track/contracts"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { deleteTopic, getTopic, updateTopic } from "@/lib/services/topics"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const TopicIdParams = z.strictObject({ topicId: z.uuid() })

function ownerIdQuery(request: Request): string | null {
  return new URL(request.url).searchParams.get("ownerId")
}

function paramsFrom(request: Request): Record<string, string | undefined> {
  const match = /\/api\/topics\/([^/]+)(?:\/.*)?$/.exec(new URL(request.url).pathname)
  return { topicId: match?.[1] }
}

export const GET = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, ownerIdQuery(request))
  const { topicId } = TopicIdParams.parse(paramsFrom(request))
  return jsonSuccess(await getTopic(getDb(), ownerId, topicId))
})

export const PATCH = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, ownerIdQuery(request))
  const { topicId } = TopicIdParams.parse(paramsFrom(request))
  const input = TopicUpdateSchema.parse(await request.json())
  return jsonSuccess(await updateTopic(getDb(), ownerId, topicId, input))
})

export const DELETE = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, ownerIdQuery(request))
  const { topicId } = TopicIdParams.parse(paramsFrom(request))
  await deleteTopic(getDb(), ownerId, topicId)
  return jsonSuccess({ deleted: true })
})
