import { z } from "zod"
import { AppError } from "@speaking-track/contracts"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { reorderDrafts } from "@speaking-track/db"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const Params = z.strictObject({ questionId: z.uuid() })
const ReorderBody = z.strictObject({ draftIds: z.array(z.uuid()).min(1).max(200) })

function questionIdFrom(request: Request): string | undefined {
  return /\/api\/questions\/([^/]+)\/drafts\/reorder$/.exec(new URL(request.url).pathname)?.[1]
}

/** Rewrites draft positions; the order must cover every draft exactly once. */
export const PUT = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session, new URL(request.url).searchParams.get("ownerId"))
  const { questionId } = Params.parse({ questionId: questionIdFrom(request) })
  const { draftIds } = ReorderBody.parse(await request.json())
  const result = await reorderDrafts(getDb(), { questionId, ownerId, orderedDraftIds: draftIds })
  if (!result.ok) {
    if (result.reason === "question_not_found") {
      // Foreign and missing questions are indistinguishable by contract.
      throw new AppError("RESOURCE_NOT_FOUND", "Question not found.")
    }
    throw new AppError("VALIDATION_FAILED", "Draft order must list every draft exactly once.", {
      fieldErrors: {
        draftIds: ["The order must contain each draft of this question exactly once."],
      },
    })
  }
  return jsonSuccess({ drafts: result.drafts })
})
