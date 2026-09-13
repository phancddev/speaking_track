import { NextResponse } from "next/server"
import { z } from "zod"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireAdmin } from "@/lib/auth/authorization"
import {
  completeConnect,
  getConnectionStatus,
  createConnectUrl,
  disconnect,
  readYoutubeEnv,
} from "@/lib/services/youtube-connection"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * Admin YouTube OAuth endpoints (plan/02 § YouTube administration). The
 * callback validates state + initiating admin session and redirects to the
 * fixed admin settings route — never an arbitrary URL. Status/disconnect
 * never require OAuth environment; only connect/callback do.
 */

const ADMIN_RESULT_PATH = "/admin/youtube"

function resultRedirect(request: Request, outcome: "connected" | string): NextResponse {
  const url = new URL(`${ADMIN_RESULT_PATH}?connect=${encodeURIComponent(outcome)}`, request.url)
  return NextResponse.redirect(url, 302)
}

export const GET = withApi(async (request) => {
  const session = await requireAdmin(request.headers)
  const path = new URL(request.url).pathname

  if (path.endsWith("/connect")) {
    const env = readYoutubeEnv()
    const url = await createConnectUrl(getDb(), env, session.user.id)
    return NextResponse.redirect(url, 302)
  }
  if (path.endsWith("/callback")) {
    const query = new URL(request.url).searchParams
    const parsed = z
      .strictObject({ state: z.string().min(1), code: z.string().min(1) })
      .safeParse({ state: query.get("state"), code: query.get("code") })
    if (!parsed.success) {
      return resultRedirect(request, "invalid-state")
    }
    try {
      await completeConnect(getDb(), readYoutubeEnv(), {
        state: parsed.data.state,
        code: parsed.data.code,
        adminUserId: session.user.id,
      })
      return resultRedirect(request, "connected")
    } catch (cause) {
      const code = (cause as { code?: string }).code ?? "connect-failed"
      return resultRedirect(request, code)
    }
  }
  if (path.endsWith("/status")) {
    return jsonSuccess(await getConnectionStatus(getDb()))
  }
  return jsonSuccess(await getConnectionStatus(getDb()))
})

export const POST = withApi(async (request) => {
  await requireAdmin(request.headers)
  const path = new URL(request.url).pathname
  if (path.endsWith("/disconnect")) {
    return jsonSuccess(await disconnect(getDb()))
  }
  return jsonSuccess(await getConnectionStatus(getDb()))
})
