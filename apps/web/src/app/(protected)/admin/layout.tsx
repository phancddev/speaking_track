import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { getAuth } from "@/lib/auth/server"

export const dynamic = "force-dynamic"

/**
 * Admin console layout: every /admin page re-verifies the database-backed
 * admin role here. Hiding navigation is never the authorization (task 08);
 * non-admins are redirected to their library.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers()
  const session = await getAuth().api.getSession({ headers: requestHeaders })
  if (!session) {
    redirect("/login")
  }
  if (session.user.role !== "admin") {
    redirect("/library")
  }
  return <>{children}</>
}
