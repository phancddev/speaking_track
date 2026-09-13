import { z } from "zod"
import { TagUpdateSchema } from "@speaking-track/contracts"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { deleteTag, updateTag } from "@/lib/services/tags"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const TagIdParams = z.strictObject({ tagId: z.uuid() })

function tagIdFrom(request: Request): string | undefined {
  return /\/api\/tags\/([^/]+)/.exec(new URL(request.url).pathname)?.[1]
}

function ownerIdQuery(request: Request): string | null {
  return new URL(request.url).searchParams.get("ownerId")
}

export const PATCH = withApi(async (request) => {
  const session = await requireSession(request.headers)
  // Admin cross-user browsing names the target owner; normal users are
  // session-scoped regardless of what they pass.
  const ownerId = resolveOwnerScope(session, ownerIdQuery(request))
  const { tagId } = TagIdParams.parse({ tagId: tagIdFrom(request) })
  const input = TagUpdateSchema.parse(await request.json())
  return jsonSuccess(await updateTag(getDb(), ownerId, tagId, input))
})

export const DELETE = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, ownerIdQuery(request))
  const { tagId } = TagIdParams.parse({ tagId: tagIdFrom(request) })
  await deleteTag(getDb(), ownerId, tagId)
  return jsonSuccess({ deleted: true })
})
