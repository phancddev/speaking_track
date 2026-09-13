import { z } from "zod"
import { NextResponse } from "next/server"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireSession } from "@/lib/auth/authorization"
import {
  completeConnect,
  createConnectUrl,
  disconnect,
  getConnectionStatus,
} from "@/lib/services/youtube-connection"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * Per-user YouTube OAuth routes (settings page):
 * - GET  /api/youtube/status     connection status for the signed-in user
 * - GET  /api/youtube/connect    begin OAuth with the user's own client
 * - GET  /api/youtube/callback   finish OAuth (validates user-bound state)
 * - POST /api/youtube/disconnect drop the user's stored tokens
 *
 * The callback redirects back to the user settings page — never an
 * arbitrary URL. Client credentials live in youtube_oauth_clients (per
 * user); the GOOGLE_* env pair is only a fallback.
 */

const RESULT_PATH = "/settings/youtube"

function resultRedirect(request: Request, outcome: string): NextResponse {
  const url = new URL(`${RESULT_PATH}?connect=${encodeURIComponent(outcome)}`, request.url)
  return NextResponse.redirect(url, 302)
}

function action(request: Request): string {
  return new URL(request.url).pathname.replace(/^\/api\/youtube\/?/, "").replace(/\/$/, "")
}

export const GET = withApi(async (request) => {
  const session = await requireSession(request.headers)
  const userId = session.user.id
  const name = action(request)

  if (name === "connect") {
    const url = await createConnectUrl(getDb(), userId)
    return NextResponse.redirect(url, 302)
  }
  if (name === "callback") {
    const query = new URL(request.url).searchParams
    const parsed = z
      .strictObject({ state: z.string().min(1), code: z.string().min(1) })
      .safeParse({ state: query.get("state"), code: query.get("code") })
    if (!parsed.success) {
      return resultRedirect(request, "invalid-state")
    }
    try {
      await completeConnect(getDb(), { state: parsed.data.state, code: parsed.data.code, userId })
      return resultRedirect(request, "connected")
    } catch (cause) {
      const code = (cause as { code?: string }).code ?? "connect-failed"
      return resultRedirect(request, code)
    }
  }
  return jsonSuccess(await getConnectionStatus(getDb(), userId))
})

export const POST = withApi(async (request) => {
  const session = await requireSession(request.headers)
  if (action(request) === "disconnect") {
    return jsonSuccess(await disconnect(getDb(), session.user.id))
  }
  return jsonSuccess(await getConnectionStatus(getDb(), session.user.id))
})
