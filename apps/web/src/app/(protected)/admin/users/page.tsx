import type { Metadata } from "next"
import { z } from "zod"
import { listAdminUsers } from "@/lib/services/admin-users"
import { getDb } from "@/lib/db"
import { UsersView } from "./users-view"

export const metadata: Metadata = {
  title: "Users — Speaking Track",
}

const ListQuery = z.strictObject({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).catch(1).optional(),
})

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string }>
}) {
  const params = await searchParams
  const query = ListQuery.parse({ search: params.search, page: params.page })
  const page = await listAdminUsers(getDb(), {
    search: query.search,
    page: query.page,
    pageSize: 20,
  })
  return <UsersView initialPage={page} initialSearch={query.search ?? ""} />
}
