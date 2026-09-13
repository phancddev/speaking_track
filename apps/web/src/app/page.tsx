import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { getAuth } from "@/lib/auth/server"

/**
 * `/` routes by real session state: authenticated users go to their
 * library, everyone else to login (plan/03 § Route map). Always dynamic —
 * it depends on the request's session cookie.
 */
export const dynamic = "force-dynamic"

export default async function RootPage() {
  const requestHeaders = await headers()
  const session = await getAuth().api.getSession({ headers: requestHeaders })
  redirect(session ? "/library" : "/login")
}
