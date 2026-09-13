import { createAuthClient } from "better-auth/react"
import { adminClient } from "better-auth/client/plugins"

/**
 * Browser-side auth client. Used by the login form, account menu, and the
 * admin console (task 08) — all through Better Auth's native endpoints.
 */
export const authClient = createAuthClient({
  plugins: [adminClient()],
})
