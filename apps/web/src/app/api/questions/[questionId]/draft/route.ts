import { z } from "zod"
import { DraftUpsertSchema } from "@speaking-track/contracts"
import { AppError } from "@speaking-track/contracts"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession } from "@/lib/auth/authorization"
import { upsertDraft } from "@speaking-track/db"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const Params = z.strictObject({ questionId: z.uuid() })

function questionIdFrom(request: Request): string | undefined {
  return /\/api\/questions\/([^/]+)\/draft$/.exec(new URL(request.url).pathname)?.[1]
}

/**
 * One explicit PUT upserts the complete draft (plan/02 § drafts): empty
 * content is valid; ownership is enforced by the owner-invariant upsert.
 */
export const PUT = withApi(async (request) => {
  await requireSession(request.headers)
  const { questionId } = Params.parse({ questionId: questionIdFrom(request) })
  const input = DraftUpsertSchema.parse(await request.json())
  const result = await upsertDraft(getDb(), { questionId, content: input.content })
  if (!result.ok) {
    // Foreign and missing questions are indistinguishable by contract.
    throw new AppError("RESOURCE_NOT_FOUND", "Question not found.")
  }
  return jsonSuccess({
    saved: true,
    content: result.draft.content,
    updatedAt: result.draft.updatedAt.toISOString(),
  })
})
