import { randomUUID } from "node:crypto"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin } from "better-auth/plugins"
import { and, eq, gt, isNull, or, sql } from "drizzle-orm"
import { ROLES, type Role } from "@speaking-track/contracts"
import { authTables, user as userTable, type Db } from "@speaking-track/db"
import { createWebConfig } from "@/lib/config"
import { getDb } from "@/lib/db"

/**
 * Better Auth server configuration (server-only; never imported from a
 * client component). Email/password sign-in with the admin plugin; public
 * sign-up is disabled server-side (`disableSignUp`), so only authenticated
 * admins can create users, and the bootstrap command can seed the first
 * admin.
 */
export type AppAuth = ReturnType<typeof createAuth>

export function createAuth(db: Db, options: { appOrigin: string; secret: string }) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema: authTables }),
    secret: options.secret,
    trustedOrigins: [options.appOrigin],
    advanced: {
      // The web container sits behind Caddy, which sets x-forwarded-for;
      // rate limiting keys on the real client address instead of one shared
      // fallback bucket.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
      // UUID ids everywhere: recording object keys and admin-browsing query
      // parameters assume UUID-shaped user/session ids.
      generateId: () => randomUUID(),
    },
    emailAndPassword: {
      enabled: true,
      // Server-side rejection of public sign-up (plan/02 § Authentication).
      disableSignUp: true,
      minPasswordLength: 8,
      requireEmailVerification: false,
    },
    rateLimit: {
      enabled: true,
      // Private deployment: sign-in allowance sized for small teams behind
      // one NAT address. Better Auth's default special rule for /sign-in is
      // 3 per 10s per IP, which a household/office NAT can exhaust.
      customRules: {
        "/sign-in/email": { window: 10, max: 20 },
      },
    },
    session: {
      // Session cookies are read on nearly every request; a short cookie
      // cache keeps the database as source of truth while avoiding a user
      // row fetch per navigation.
      cookieCache: { enabled: true, maxAge: 30 },
    },
    databaseHooks: {
      user: {
        create: {
          // Every user row carries a UUID id regardless of which Better Auth
          // path created it (bootstrap, admin create-user, and any future
          // flow all pass through this hook). UUID user ids are a
          // storage-key and admin-browsing contract.
          before: async (user) => {
            if (!user.id) {
              return { data: { ...user, id: randomUUID() } }
            }
            return false
          },
        },
      },
    },
    plugins: [
      admin({
        defaultRole: "user",
        adminRoles: ["admin"],
      }),
    ],
  })
}

/** Shared process-wide auth instance. */
export function getAuth() {
  const globalStore = globalThis as { __speakingTrackAuth?: ReturnType<typeof createAuth> }
  if (globalStore.__speakingTrackAuth) {
    return globalStore.__speakingTrackAuth
  }
  const config = createWebConfig(process.env)
  const auth = createAuth(getDb(), { appOrigin: config.appOrigin, secret: config.betterAuthSecret })
  globalStore.__speakingTrackAuth = auth
  return auth
}

/**
 * Active admin count: role admin, not banned, and no future ban expiry.
 * Shared by the final-admin guard for tasks 03 and 08.
 */
export async function countActiveAdmins(db: Db): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userTable)
    .where(
      and(
        eq(userTable.role, "admin"),
        eq(userTable.banned, false),
        or(isNull(userTable.banExpires), gt(userTable.banExpires, new Date())),
      ),
    )
  return row?.count ?? 0
}

export { ROLES }
export type { Role }
