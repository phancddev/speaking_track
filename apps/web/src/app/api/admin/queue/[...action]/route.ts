import { jsonSuccess, withApi } from "@/lib/http"
import { requireAdmin } from "@/lib/auth/authorization"
import { getQueueSummary, getRecentFailures } from "@/lib/services/queue-views"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

export const GET = withApi(async (request) => {
  await requireAdmin(request.headers)
  const path = new URL(request.url).pathname
  if (path.endsWith("/summary")) {
    return jsonSuccess(await getQueueSummary(getDb()))
  }
  if (path.endsWith("/failures")) {
    return jsonSuccess(await getRecentFailures(getDb()))
  }
  return jsonSuccess({
    summary: await getQueueSummary(getDb()),
    failures: await getRecentFailures(getDb()),
  })
})
