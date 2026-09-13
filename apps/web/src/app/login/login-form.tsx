"use client"

import { CircleAlertIcon, LoaderCircleIcon } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { type FormEvent, useState } from "react"
import { authClient } from "@/lib/auth/client"
import { safeReturnPath } from "@/lib/return-path"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = safeReturnPath(searchParams.get("returnTo"))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = new FormData(event.currentTarget)
    const email = String(form.get("email") ?? "")
    const password = String(form.get("password") ?? "")

    setPending(true)
    setError(null)
    const result = await authClient.signIn.email({ email, password })
    if (result.error) {
      // Generic message: never reveal which part was wrong or whether the
      // account exists.
      setError("Invalid email or password.")
      setPending(false)
      return
    }
    router.push(returnTo)
    router.refresh()
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Use the account your administrator created for you.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="grid gap-4">
          {error ? (
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden />
              <AlertTitle>Sign-in failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              placeholder="you@example.com"
              required
              autoFocus
              disabled={pending}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Your password"
              required
              disabled={pending}
            />
          </div>
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? (
              <>
                <LoaderCircleIcon aria-hidden className="animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
          <p className="text-muted-foreground text-center text-xs">
            Accounts are created by an administrator.{" "}
            <Link href="/login" className="text-primary underline-offset-4 hover:underline">
              No sign-up
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
