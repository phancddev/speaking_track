import type { NextResponse } from "next/server"
import * as recordingsList from "@/app/api/questions/[questionId]/recordings/route"
import * as uploadsCreate from "@/app/api/questions/[questionId]/recordings/uploads/route"
import * as complete from "@/app/api/recordings/[recordingId]/complete/route"
import * as retry from "@/app/api/recordings/[recordingId]/retry/route"
import * as item from "@/app/api/recordings/[recordingId]/route"

/**
 * Test-only route wiring table for the recording endpoints: maps a request
 * path + method to the real Next.js route handler.
 */

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<NextResponse>

const handlers: { pattern: RegExp; method: string; handler: RouteHandler }[] = [
  {
    pattern: /^\/api\/questions\/[^/]+\/recordings$/,
    method: "GET",
    handler: recordingsList.GET as RouteHandler,
  },
  {
    pattern: /^\/api\/questions\/[^/]+\/recordings\/uploads$/,
    method: "POST",
    handler: uploadsCreate.POST as RouteHandler,
  },
  {
    pattern: /^\/api\/recordings\/[^/]+\/complete$/,
    method: "POST",
    handler: complete.POST as RouteHandler,
  },
  {
    pattern: /^\/api\/recordings\/[^/]+\/retry$/,
    method: "POST",
    handler: retry.POST as RouteHandler,
  },
  { pattern: /^\/api\/recordings\/[^/]+$/, method: "DELETE", handler: item.DELETE as RouteHandler },
]

export function routeTable(path: string, method: string): RouteHandler | undefined {
  const clean = path.split("?")[0]!
  return handlers.find((entry) => entry.method === method && entry.pattern.test(clean))?.handler
}
