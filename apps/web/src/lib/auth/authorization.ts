import "server-only"
import { AppError, parseRole, type Role } from "@speaking-track/contracts"
import { getAuth } from "./server"

/**
 * Authorization helpers (plan/02 § Authorization helpers). Server-only:
 * every protected page/API loads the database-backed session through these
 * functions; optimistic cookie redirects elsewhere are UX sugar, never
 * authorization.
 */

export type AppSession = {
  session: { id: string; expiresAt: Date }
  user: { id: string; name: string; email: string; role: Role }
}

export type AdminSession = AppSession & { user: AppSession["user"] & { role: "admin" } }

function toAppSession(
  raw: {
    session: { id: string; expiresAt: Date }
    user: { id: string; name: string; email: string; role?: string | null }
  } | null,
): AppSession | null {
  if (!raw) return null
  const role = parseRole(raw.user.role ?? undefined)
  return {
    session: { id: raw.session.id, expiresAt: new Date(raw.session.expiresAt) },
    user: { id: raw.user.id, name: raw.user.name, email: raw.user.email, role: role ?? "user" },
  }
}

/** Resolves the database-backed session or throws AUTH_REQUIRED (401). */
export async function requireSession(requestHeaders: Headers): Promise<AppSession> {
  const auth = getAuth()
  const raw = await auth.api.getSession({ headers: requestHeaders })
  const session = toAppSession(raw)
  if (!session) {
    throw new AppError("AUTH_REQUIRED", "Sign in to continue.")
  }
  return session
}

/** Resolves the session and requires the admin role (ADMIN_REQUIRED/403). */
export async function requireAdmin(requestHeaders: Headers): Promise<AdminSession> {
  const session = await requireSession(requestHeaders)
  if (session.user.role !== "admin") {
    throw new AppError("ADMIN_REQUIRED", "This action requires an administrator account.")
  }
  return session as AdminSession
}

/**
 * Owner scope for data access: a normal user is always scoped to their own
 * id (client-supplied ownerId is ignored); an admin may explicitly name
 * another owner, and absence means the admin's own data.
 */
export function resolveOwnerScope(session: AppSession, requestedOwnerId?: string | null): string {
  if (session.user.role === "admin") {
    return requestedOwnerId ?? session.user.id
  }
  return session.user.id
}

/**
 * Ownership check for a loaded resource: admins pass; any other user must
 * be the owner. Mismatch maps to RESOURCE_NOT_FOUND so foreign resources
 * are indistinguishable from missing ones.
 */
export function assertOwnerOrAdmin(session: AppSession, ownerId: string): void {
  if (session.user.role === "admin") return
  if (session.user.id !== ownerId) {
    throw new AppError("RESOURCE_NOT_FOUND", "Resource not found.")
  }
}
