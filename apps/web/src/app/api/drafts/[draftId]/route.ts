import { z } from "zod"
import { AppError, DraftUpdateSchema } from "@speaking-track/contracts"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { deleteDraft, updateDraft } from "@speaking-track/db"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const Params = z.strictObject({ draftId: z.uuid() })

function draftIdFrom(request: Request): string | undefined {
  return /\/api\/drafts\/([^/]+)$/.exec(new URL(request.url).pathname)?.[1]
}

/** Partial update: `title: null` clears the label, omitted fields stay. */
export const PATCH = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { draftId } = Params.parse({ draftId: draftIdFrom(request) })
  const input = DraftUpdateSchema.parse(await request.json())
  const result = await updateDraft(getDb(), {
    draftId,
    ownerId,
    title: input.title,
    content: input.content,
  })
  if (!result.ok) {
    throw new AppError("RESOURCE_NOT_FOUND", "Draft not found.")
  }
  return jsonSuccess({ draft: result.draft })
})

/** Already-deleted drafts report success (`deleted: false`). */
export const DELETE = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { draftId } = Params.parse({ draftId: draftIdFrom(request) })
  const result = await deleteDraft(getDb(), { draftId, ownerId })
  return jsonSuccess(result)
})
