import { z } from "zod"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession } from "@/lib/auth/authorization"
import {
  clearClientConfig,
  getConnectionStatus,
  saveClientConfig,
} from "@/lib/services/youtube-connection"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * Per-user Google OAuth client credentials (settings page form). The secret
 * is encrypted at rest and never returned; GET only reports presence.
 */

const PutBody = z.strictObject({
  clientId: z.string().min(10).max(256),
  clientSecret: z.string().min(10).max(256),
})

export const PUT = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const input = PutBody.parse(await request.json())
  await saveClientConfig(getDb(), { userId: session.user.id, ...input })
  return jsonSuccess(await getConnectionStatus(getDb(), session.user.id))
})

export const DELETE = withApi(async (request) => {
  const session = await requireSession(request.headers)
  await clearClientConfig(getDb(), session.user.id)
  return jsonSuccess(await getConnectionStatus(getDb(), session.user.id))
})
