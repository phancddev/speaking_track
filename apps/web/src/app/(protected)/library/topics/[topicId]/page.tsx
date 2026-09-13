import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { eq } from "drizzle-orm"
import { user as userTable } from "@speaking-track/db"
import { getDb } from "@/lib/db"
import { isAppError, RESOURCE_NOT_FOUND_CODE } from "@/lib/http"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { getTopic } from "@/lib/services/topics"
import { listTags } from "@/lib/services/tags"
import { TopicDetailView } from "./topic-detail-view"

/**
 * Topic detail page: server-rendered with an owner-authorized database
 * composition; a missing or foreign topic resolves to the same safe
 * not-found behavior. Admin owner-browsing works through `?ownerId=`.
 */
export default async function TopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ topicId: string }>
  searchParams: Promise<{ ownerId?: string }>
}) {
  const { topicId } = await params
  const { ownerId: requestedOwner } = await searchParams
  const requestHeaders = await headers()
  const session = await requireSession(requestHeaders)
  // Admin browsing names the target owner; normal users are always
  // session-scoped regardless of the query parameter.
  const ownerId = resolveOwnerScope(session, requestedOwner?.trim() || null)

  let ownerLabel: string | null = null
  if (session.user.role === "admin" && ownerId !== session.user.id) {
    const [target] = await getDb()
      .select({ name: userTable.name })
      .from(userTable)
      .where(eq(userTable.id, ownerId))
      .limit(1)
    ownerLabel = target?.name ?? null
  }

  const tags = await listTags(getDb(), ownerId)
  const topic = await getTopic(getDb(), ownerId, topicId).catch((error: unknown) => {
    if (isAppError(error, RESOURCE_NOT_FOUND_CODE)) {
      notFound()
    }
    throw error
  })
  return (
    <TopicDetailView
      initialTopic={topic}
      tags={tags}
      ownerId={session.user.role === "admin" && ownerId !== session.user.id ? ownerId : null}
      ownerLabel={ownerLabel}
    />
  )
}
