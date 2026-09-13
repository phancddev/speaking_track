import { NextResponse } from "next/server"
import { z } from "zod"
import { TopicCreateSchema } from "@speaking-track/contracts"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { createTopic, listTopics } from "@/lib/services/topics"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const ListQuery = z.strictObject({
  q: z.string().trim().max(200).optional(),
  tagIds: z
    .string()
    .trim()
    .optional()
    .transform((value) =>
      value && value.length > 0
        ? value
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        : undefined,
    ),
  ownerId: z.uuid().optional(),
})

export const GET = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const query = ListQuery.parse(Object.fromEntries(new URL(request.url).searchParams))
  // Admin browsing names the target owner explicitly; absence means the
  // admin's own library. Normal users are always session-scoped.
  const ownerId = resolveOwnerScope(session, query.ownerId)
  const tagIdList = (query.tagIds ?? []).map((id) => z.uuid().parse(id))
  return jsonSuccess(await listTopics(getDb(), ownerId, { q: query.q, tagIds: tagIdList }))
})

export const POST = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const input = TopicCreateSchema.parse(await request.json())
  const topic = await createTopic(getDb(), ownerId, input)
  return NextResponse.json({ data: topic }, { status: 201 })
})
