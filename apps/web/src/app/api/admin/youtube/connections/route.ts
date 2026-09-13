import { jsonSuccess, withApi } from "@/lib/http"
import { requireAdmin } from "@/lib/auth/authorization"
import { listConnections } from "@/lib/services/youtube-connection"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

/** Admin overview: every user's per-user YouTube connection state. */
export const GET = withApi(async (request) => {
  await requireAdmin(request.headers)
  return jsonSuccess({ connections: await listConnections(getDb()) })
})
