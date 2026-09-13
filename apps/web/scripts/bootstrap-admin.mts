/**
 * Idempotent admin bootstrap (task 03). Creates the first administrator
 * from environment-supplied credentials ONLY when no active admin exists;
 * a second run reports the existing admin and changes nothing.
 *
 * Inserts through the same schema Better Auth reads (credential account
 * with Better Auth's scrypt password hash), never logs the password, and
 * exits non-zero on validation failures.
 */
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { and, eq, or, isNull, gt } from "drizzle-orm"
import { hashPassword } from "better-auth/crypto"
import {
  account,
  createDatabaseConfig,
  createDbClient,
  user as userTable,
  type Db,
} from "@speaking-track/db"

async function loadEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  const envUrl = new URL("../../../.env", import.meta.url)
  try {
    const raw = await readFile(envUrl, "utf8")
    for (const line of raw.split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (match && env[match[1]!] === undefined) {
        env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "")
      }
    }
  } catch {
    // No root .env; environment variables must carry everything.
  }
  return env
}

type BootstrapOutcome =
  | { status: "created"; userId: string; email: string }
  | { status: "already-present"; userId: string; email: string }

export async function bootstrapAdmin(
  db: Db,
  input: {
    email: string
    password: string
    name: string
  },
): Promise<BootstrapOutcome> {
  const email = input.email.trim().toLowerCase()
  if (input.password.length < 8) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters")
  }
  if (!email.includes("@") || email.length < 3) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL must be a valid email address")
  }

  const [existingAdmin] = await db
    .select({ id: userTable.id, email: userTable.email })
    .from(userTable)
    .where(
      and(
        eq(userTable.role, "admin"),
        eq(userTable.banned, false),
        or(isNull(userTable.banExpires), gt(userTable.banExpires, new Date())),
      ),
    )
    .limit(1)

  if (existingAdmin) {
    // Never overwrite an existing account, even on credential mismatch.
    return { status: "already-present", userId: existingAdmin.id, email: existingAdmin.email }
  }

  const userId = randomUUID()
  const passwordHash = await hashPassword(input.password)
  await db.transaction(async (tx) => {
    await tx.insert(userTable).values({
      id: userId,
      name: input.name.trim() || "Administrator",
      email,
      emailVerified: true,
      role: "admin",
    })
    await tx.insert(account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
    })
  })
  return { status: "created", userId, email }
}

async function main() {
  const env = await loadEnv()
  const missing = ["DATABASE_URL", "BOOTSTRAP_ADMIN_EMAIL", "BOOTSTRAP_ADMIN_PASSWORD"].filter(
    (key) => !env[key],
  )
  if (missing.length > 0) {
    process.stderr.write(`bootstrap:admin: missing ${missing.join(", ")}\n`)
    process.exit(1)
  }

  const client = createDbClient(createDatabaseConfig({ DATABASE_URL: env.DATABASE_URL! }))
  try {
    const outcome = await bootstrapAdmin(client.db, {
      email: env.BOOTSTRAP_ADMIN_EMAIL!,
      password: env.BOOTSTRAP_ADMIN_PASSWORD!,
      name: env.BOOTSTRAP_ADMIN_NAME || "Administrator",
    })
    if (outcome.status === "created") {
      process.stdout.write(
        `${JSON.stringify({ event: "bootstrap-admin-created", userId: outcome.userId })}\n`,
      )
    } else {
      process.stdout.write(
        `${JSON.stringify({
          event: "bootstrap-admin-already-present",
          userId: outcome.userId,
          note: "existing admin left untouched",
        })}\n`,
      )
    }
  } finally {
    await client.close()
  }
}

const invokedDirectly = process.argv[1]?.includes("bootstrap-admin.mts")
if (invokedDirectly) {
  await main()
}
