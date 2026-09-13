import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isAppError } from "@/lib/http"
import { getAdminUser } from "@/lib/services/admin-users"
import { getDb } from "@/lib/db"
import { UserDetailView } from "./user-detail-view"

export const metadata: Metadata = {
  title: "User detail — Speaking Track",
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId } = await params
  const user = await getAdminUser(getDb(), userId).catch((error: unknown) => {
    if (isAppError(error, "RESOURCE_NOT_FOUND")) notFound()
    throw error
  })
  return <UserDetailView user={user} />
}
