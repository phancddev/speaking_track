import { NextResponse } from "next/server"
import { z } from "zod"
import { withApi } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { createRecordingUpload } from "@/lib/services/recordings"
import { getDb } from "@/lib/db"
import { getRecordingLimits, getStorage } from "@/lib/storage"

export const dynamic = "force-dynamic"

const Params = z.strictObject({ questionId: z.uuid() })
const Body = z.strictObject({
  mimeType: z.string(),
  sizeBytes: z.number(),
  durationMs: z.number(),
})

function questionIdFrom(request: Request): string | undefined {
  return /\/api\/questions\/([^/]+)\/recordings\/uploads$/.exec(new URL(request.url).pathname)?.[1]
}

export const POST = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const ownerId = resolveOwnerScope(session)
  const { questionId } = Params.parse({ questionId: questionIdFrom(request) })
  const body = Body.parse(await request.json())
  const result = await createRecordingUpload(getDb(), getStorage(), getRecordingLimits(), {
    ownerId,
    questionId,
    mimeType: body.mimeType as Parameters<typeof createRecordingUpload>[3]["mimeType"],
    sizeBytes: body.sizeBytes,
    durationMs: body.durationMs,
  })
  return NextResponse.json({ data: result }, { status: 201 })
})
