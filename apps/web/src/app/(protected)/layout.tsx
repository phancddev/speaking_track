import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { getAuth } from "@/lib/auth/server"
import { AppShell } from "@/components/app-shell"

/**
 * Protected layout: every page under this group performs a database-backed
 * session check here (plan/02 § Authorization helpers). Unauthenticated
 * visitors are redirected to /login.
 */
export const dynamic = "force-dynamic"

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers()
  const session = await getAuth().api.getSession({ headers: requestHeaders })
  if (!session) {
    redirect("/login")
  }

  return (
    <AppShell
      user={{
        name: session.user.name,
        email: session.user.email,
        role: session.user.role === "admin" ? "admin" : "user",
      }}
    >
      {children}
    </AppShell>
  )
}
