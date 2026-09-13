import { NextResponse } from "next/server"
import { TagCreateSchema } from "@speaking-track/contracts"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { createTag, listTags } from "@/lib/services/tags"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

export const GET = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  return jsonSuccess(await listTags(getDb(), ownerId))
})

export const POST = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const input = TagCreateSchema.parse(await request.json())
  const tag = await createTag(getDb(), ownerId, input)
  return NextResponse.json({ data: tag }, { status: 201 })
})
