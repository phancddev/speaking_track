import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/**
 * Process liveness: answers while the Node process can serve HTTP at all.
 * It intentionally checks nothing else and must stay cheap.
 */
export function GET() {
  return NextResponse.json({
    status: "ok",
    checks: {
      process: "ok",
    },
  })
}
