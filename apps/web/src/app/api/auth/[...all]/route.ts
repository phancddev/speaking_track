import { toNextJsHandler } from "better-auth/next-js"
import { getAuth } from "@/lib/auth/server"

/**
 * Better Auth HTTP handler (native response contract — plan/02 § Custom
 * HTTP API contract explicitly excludes these endpoints from the shared
 * envelope).
 */
export const { GET, POST } = toNextJsHandler(async (request) => {
  const auth = getAuth()
  return auth.handler(request)
})
