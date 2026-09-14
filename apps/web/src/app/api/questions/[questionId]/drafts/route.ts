import { z } from "zod"
import { AppError, DraftCreateSchema } from "@speaking-track/contracts"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { createDraft, listDrafts } from "@speaking-track/db"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const Params = z.strictObject({ questionId: z.uuid() })

function questionIdFrom(request: Request): string | undefined {
  return /\/api\/questions\/([^/]+)\/drafts$/.exec(new URL(request.url).pathname)?.[1]
}

/** Lists every draft of one question, ordered by position then age. */
export const GET = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { questionId } = Params.parse({ questionId: questionIdFrom(request) })
  const result = await listDrafts(getDb(), { questionId, ownerId })
  if (!result.ok) {
    // Foreign and missing questions are indistinguishable by contract.
    throw new AppError("RESOURCE_NOT_FOUND", "Question not found.")
  }
  return jsonSuccess({ drafts: result.drafts })
})

/** Appends a draft; empty titles normalize to null, empty content is valid. */
export const POST = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { questionId } = Params.parse({ questionId: questionIdFrom(request) })
  const input = DraftCreateSchema.parse(await request.json())
  const result = await createDraft(getDb(), {
    questionId,
    ownerId,
    title: input.title ?? null,
    content: input.content,
  })
  if (!result.ok) {
    throw new AppError("RESOURCE_NOT_FOUND", "Question not found.")
  }
  return jsonSuccess({ draft: result.draft }, { status: 201 })
})
