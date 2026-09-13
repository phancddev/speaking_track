"use client"

import { CirclePlusIcon, LoaderCircleIcon, SearchIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { apiFetch, ApiError } from "@/lib/api-client"
import type { AdminUserListItem, AdminUserPage } from "@/lib/services/admin-users"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Admin users console (task 08): server-paginated Data Table with search,
 * create-user dialog, and row links to the per-user detail page. Only safe
 * account fields ever render — no hashes, sessions, or internal auth data.
 */
export function UsersView({
  initialPage,
  initialSearch,
}: {
  initialPage: AdminUserPage
  initialSearch: string
}) {
  const router = useRouter()
  const [search, setSearch] = useState(initialSearch)
  const [page, setPage] = useState<AdminUserPage | null>(initialPage)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  function load(nextSearch: string, nextPage: number) {
    const params = new URLSearchParams()
    if (nextSearch.trim()) params.set("search", nextSearch.trim())
    if (nextPage > 1) params.set("page", String(nextPage))
    const suffix = params.toString()
    setLoading(true)
    apiFetch<AdminUserPage>(`/api/admin/users${suffix ? `?${suffix}` : ""}`)
      .then((data) => {
        setPage(data)
        setError(null)
        router.replace(suffix ? `/admin/users?${suffix}` : "/admin/users", { scroll: false })
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "Could not load users.")
      })
      .finally(() => setLoading(false))
  }

  const current = page ?? initialPage
  const totalPages = Math.max(1, Math.ceil(current.total / current.pageSize))

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-muted-foreground text-sm">
            Create accounts, manage roles, and disable access. Public sign-up is disabled.
          </p>
        </div>
        <CreateUserDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={() => {
            setCreateOpen(false)
            load(search, 1)
          }}
        />
      </div>

      <form
        className="mt-6 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault()
          load(search, 1)
        }}
      >
        <div className="flex-1">
          <Label htmlFor="user-search" className="sr-only">
            Search users
          </Label>
          <Input
            id="user-search"
            placeholder="Search by name or email…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" disabled={loading}>
          <SearchIcon aria-hidden />
          Search
        </Button>
      </form>

      {error ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Could not load users</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Separator className="my-6" />

      {loading && !page ? (
        <Skeleton className="h-64 w-full" />
      ) : current.users.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No users match. Create the first account with “Create user”.
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Topics</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {current.users.map((user) => (
                <UserRow key={user.id} user={user} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {loading ? "Loading…" : `${current.total} user${current.total === 1 ? "" : "s"}`} · page{" "}
          {current.page} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={current.page <= 1 || loading}
            onClick={() => load(search, current.page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={current.page >= totalPages || loading}
            onClick={() => load(search, current.page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

function UserRow({ user }: { user: AdminUserListItem }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{user.name}</TableCell>
      <TableCell>{user.email}</TableCell>
      <TableCell>
        <Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role}</Badge>
      </TableCell>
      <TableCell>
        {user.banned ? (
          <Badge variant="destructive">disabled</Badge>
        ) : (
          <Badge variant="outline">active</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">{user.topicCount}</TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="sm" render={<Link href={`/admin/users/${user.id}`} />}>
          Details
        </Button>
      </TableCell>
    </TableRow>
  )
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    setFieldErrors({})
    try {
      await apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
          role: String(form.get("role") ?? "user"),
        }),
      })
      onCreated()
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message)
        setFieldErrors(cause.fieldErrors ?? {})
      } else {
        setError("Could not create the user. Try again.")
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button disabled={pending} />}>
        {pending ? (
          <LoaderCircleIcon aria-hidden className="animate-spin" />
        ) : (
          <CirclePlusIcon aria-hidden />
        )}
        Create user
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>
            The account can sign in immediately with this password. Passwords are never shown again.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-name">Name</Label>
            <Input
              id="create-name"
              name="name"
              required
              autoComplete="off"
              aria-invalid={!!fieldErrors.name}
            />
            {fieldErrors.name ? (
              <p className="text-destructive text-xs">{fieldErrors.name.join(", ")}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-email">Email</Label>
            <Input id="create-email" name="email" type="email" required autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-password">Password</Label>
            <Input
              id="create-password"
              name="password"
              type="text"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <p className="text-muted-foreground text-xs">At least 8 characters.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-role">Role</Label>
            <select
              id="create-role"
              name="role"
              defaultValue="user"
              className="border-input bg-background ring-offset-background flex h-9 w-full rounded-md border px-3 py-1 text-sm"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
