"use client"

import {
  ArrowLeftIcon,
  BanIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { apiFetch, ApiError } from "@/lib/api-client"
import type { AdminUserDetail } from "@/lib/services/admin-users"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

/**
 * Per-user admin detail (task 08): safe account metadata, role/ban/password
 * actions, destructive delete with explicit consequences, and the visible
 * "browse this user's library" path. Admin edits never transfer ownership.
 */
export function UserDetailView({ user }: { user: AdminUserDetail }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function run<T>(
    key: string,
    action: () => Promise<T>,
    successMessage: string,
  ): Promise<T | null> {
    if (busy) return null
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      const result = await action()
      setNotice(successMessage)
      router.refresh()
      return result
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The operation failed. Try again.")
      return null
    } finally {
      setBusy(null)
    }
  }

  function patch(body: Record<string, unknown>, successMessage: string) {
    return run(
      "patch",
      () =>
        apiFetch(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      successMessage,
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <Button variant="ghost" size="sm" render={<Link href="/admin/users" />} className="mb-4">
        <ArrowLeftIcon aria-hidden />
        All users
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{user.name}</h1>
          <p className="text-muted-foreground text-sm">{user.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role}</Badge>
          {user.banned ? (
            <Badge variant="destructive">disabled</Badge>
          ) : (
            <Badge variant="outline">active</Badge>
          )}
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert className="mt-4">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card className="py-4">
          <CardHeader>
            <CardDescription>Topics</CardDescription>
            <CardTitle className="text-2xl">{user.topicCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="py-4">
          <CardHeader>
            <CardDescription>Questions</CardDescription>
            <CardTitle className="text-2xl">{user.questionCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="py-4">
          <CardHeader>
            <CardDescription>Recordings</CardDescription>
            <CardTitle className="text-2xl">{user.recordingCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Separator className="my-6" />

      <div className="flex flex-col gap-6">
        <Card className="py-4">
          <CardHeader>
            <CardTitle className="text-base">Browse this user&apos;s library</CardTitle>
            <CardDescription>
              Opens their topics and questions in admin mode. Edits keep every resource owned by{" "}
              {user.name}; ownership never transfers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" render={<Link href={`/library?ownerId=${user.id}`} />}>
              Browse library
            </Button>
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardHeader>
            <CardTitle className="text-base">Role</CardTitle>
            <CardDescription>
              Exactly two roles exist. The final active admin can never be demoted.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {user.role === "user" ? (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => patch({ role: "admin" }, `${user.name} is now an administrator.`)}
              >
                {busy === "patch" ? (
                  <LoaderCircleIcon aria-hidden className="animate-spin" />
                ) : (
                  <ShieldCheckIcon aria-hidden />
                )}
                Promote to admin
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => patch({ role: "user" }, `${user.name} is now a normal user.`)}
              >
                Demote to user
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardHeader>
            <CardTitle className="text-base">Access</CardTitle>
            <CardDescription>
              Disabling signs the user out everywhere and blocks sign-in until re-enabled.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {user.banned ? (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => patch({ banned: false }, `${user.name} can sign in again.`)}
              >
                Re-enable access
              </Button>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger
                  render={<Button variant="destructive" disabled={busy !== null} />}
                >
                  <BanIcon aria-hidden />
                  Disable access
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disable {user.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Their sessions end immediately and sign-in is blocked. Their topics,
                      questions, and recordings stay untouched.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => patch({ banned: true }, `${user.name} has been disabled.`)}
                    >
                      Disable
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </CardContent>
        </Card>

        <SetPasswordCard userId={user.id} busy={busy !== null} />

        <Card className="py-4">
          <CardHeader>
            <CardTitle className="text-base">Delete account</CardTitle>
            <CardDescription>
              Permanently removes the account and its library. Recordings still staged or on YouTube
              must be cleaned up first. This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger
                render={<Button variant="destructive" disabled={busy !== null} />}
              >
                <Trash2Icon aria-hidden />
                Delete user
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {user.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The account, sessions, topics, questions, drafts, and cleaned recordings are
                    deleted permanently. You cannot delete your own account.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      const result = await run(
                        "delete",
                        () => apiFetch(`/api/admin/users/${user.id}`, { method: "DELETE" }),
                        "",
                      )
                      if (result !== null) router.push("/admin/users")
                    }}
                  >
                    Delete permanently
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SetPasswordCard({ userId, busy }: { userId: string; busy: boolean }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    const password = String(new FormData(form).get("password") ?? "")
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      await apiFetch(`/api/admin/users/${userId}/set-password`, {
        method: "POST",
        body: JSON.stringify({ newPassword: password }),
      })
      setNotice("Password set. The user must use it on the next sign-in.")
      form.reset()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not set the password. Try again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="py-4">
      <CardHeader>
        <CardTitle className="text-base">Set new password</CardTitle>
        <CardDescription>
          Replaces the current password immediately. The value is never displayed again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          noValidate
        >
          <div className="flex-1">
            <Label htmlFor="set-password-input" className="mb-1.5 block">
              New password
            </Label>
            <Input
              id="set-password-input"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              aria-invalid={!!error}
            />
            {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
            {notice ? <p className="text-muted-foreground mt-1 text-xs">{notice}</p> : null}
          </div>
          <Button type="submit" disabled={pending || busy}>
            {pending ? (
              <LoaderCircleIcon aria-hidden className="animate-spin" />
            ) : (
              <KeyRoundIcon aria-hidden />
            )}
            Set password
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
