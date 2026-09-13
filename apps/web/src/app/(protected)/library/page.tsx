import type { Metadata } from "next"
import { headers } from "next/headers"
import { eq } from "drizzle-orm"
import { user as userTable } from "@speaking-track/db"
import { getDb } from "@/lib/db"
import { getAuth } from "@/lib/auth/server"
import { LibraryView } from "./library-view"

export const metadata: Metadata = {
  title: "Library — Speaking Track",
}

/**
 * Admin owner-browsing entry (task 08): `?ownerId=` is honored only for
 * administrators — the library APIs ignore it for normal users anyway — and
 * resolves the target user so the UI can label whose library is displayed.
 */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tagIds?: string; ownerId?: string }>
}) {
  const params = await searchParams
  const tagIds = (params.tagIds ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)

  let ownerId: string | null = null
  let ownerLabel: string | null = null
  const requestedOwner = params.ownerId?.trim() || null
  if (requestedOwner) {
    const session = await getAuth().api.getSession({ headers: await headers() })
    if (session?.user?.role === "admin" && session.user.id !== requestedOwner) {
      const [target] = await getDb()
        .select({ id: userTable.id, name: userTable.name })
        .from(userTable)
        .where(eq(userTable.id, requestedOwner))
        .limit(1)
      if (target) {
        ownerId = target.id
        ownerLabel = target.name
      }
    }
  }

  return (
    <LibraryView
      initialQuery={params.q ?? ""}
      initialTagIds={tagIds}
      ownerId={ownerId}
      ownerLabel={ownerLabel}
    />
  )
}
