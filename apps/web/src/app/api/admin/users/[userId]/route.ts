import { z } from "zod"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireAdmin } from "@/lib/auth/authorization"
import {
  adminDeleteUser,
  adminUpdateUser,
  AdminUpdateUserInput,
  getAdminUser,
} from "@/lib/services/admin-users"
import { getDb } from "@/lib/db"
import { getAuth } from "@/lib/auth/server"

export const dynamic = "force-dynamic"

const UserIdParams = z.strictObject({ userId: z.uuid() })

function userIdFrom(request: Request): string | undefined {
  return /\/api\/admin\/users\/([^/]+?)(?:\/[^/]*)?$/.exec(new URL(request.url).pathname)?.[1]
}

export const GET = withApi(async (request) => {
  await requireAdmin(request.headers)
  const { userId } = UserIdParams.parse({ userId: userIdFrom(request) })
  return jsonSuccess(await getAdminUser(getDb(), userId))
})

export const PATCH = withApi(async (request) => {
  const session = await requireAdmin(request.headers)
  const { userId } = UserIdParams.parse({ userId: userIdFrom(request) })
  const input = AdminUpdateUserInput.parse(await request.json())
  const user = await adminUpdateUser(getAuth(), getDb(), { id: session.user.id }, request.headers, {
    userId,
    ...input,
  })
  return jsonSuccess(user)
})

export const DELETE = withApi(async (request) => {
  const session = await requireAdmin(request.headers)
  const { userId } = UserIdParams.parse({ userId: userIdFrom(request) })
  return jsonSuccess(
    await adminDeleteUser(getAuth(), getDb(), { id: session.user.id }, request.headers, { userId }),
  )
})
