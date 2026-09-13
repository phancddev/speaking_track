import { z } from "zod"
import { jsonSuccess, withApi } from "@/lib/http"
import { requireAdmin } from "@/lib/auth/authorization"
import { AdminSetPasswordInput, adminSetUserPassword } from "@/lib/services/admin-users"
import { getAuth } from "@/lib/auth/server"

export const dynamic = "force-dynamic"

const UserIdParams = z.strictObject({ userId: z.uuid() })

function userIdFrom(request: Request): string | undefined {
  return /\/api\/admin\/users\/([^/]+)\/set-password$/.exec(new URL(request.url).pathname)?.[1]
}

export const POST = withApi(async (request) => {
  const session = await requireAdmin(request.headers)
  const { userId } = UserIdParams.parse({ userId: userIdFrom(request) })
  const input = AdminSetPasswordInput.parse(await request.json())
  return jsonSuccess(
    await adminSetUserPassword(getAuth(), { id: session.user.id }, request.headers, {
      userId,
      newPassword: input.newPassword,
    }),
  )
})
