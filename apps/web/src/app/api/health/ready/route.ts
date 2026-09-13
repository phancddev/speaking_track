import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/**
 * Readiness: reports only the dependencies this process actually verifies.
 *
 * The foundation baseline initializes no database, Redis, or storage client,
 * so readiness currently covers process initialization only. Database
 * connectivity is added to these checks when packages/db lands (task 02) —
 * until then the endpoint must not claim dependency health it does not test.
 */
export function GET() {
  return NextResponse.json({
    status: "ok",
    checks: {
      process: "ok",
    },
  })
}
