import { NextResponse } from "next/server"
import { z } from "zod"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireAdmin } from "@/lib/auth/authorization"
import { adminCreateUser, AdminCreateUserInput, listAdminUsers } from "@/lib/services/admin-users"
import { getDb } from "@/lib/db"
import { getAuth } from "@/lib/auth/server"

export const dynamic = "force-dynamic"

const ListQuery = z.strictObject({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

export const GET = withApi(async (request) => {
  await requireAdmin(request.headers)
  const query = ListQuery.parse(Object.fromEntries(new URL(request.url).searchParams))
  return jsonSuccess(await listAdminUsers(getDb(), query))
})

export const POST = withApi(async (request) => {
  const session = await requireAdmin(request.headers)
  const input = AdminCreateUserInput.parse(await request.json())
  const user = await adminCreateUser(getAuth(), { id: session.user.id }, request.headers, input)
  return NextResponse.json({ data: user }, { status: 201 })
})
