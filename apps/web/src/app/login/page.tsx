import type { Metadata } from "next"
import { Suspense } from "react"
import { LoginForm } from "./login-form"

export const metadata: Metadata = {
  title: "Sign in — Speaking Track",
}

export default function LoginPage() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  )
}
