import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { getAuth } from "@/lib/auth/server"
import { getConnectionStatus } from "@/lib/services/youtube-connection"
import { getDb } from "@/lib/db"
import { YoutubeSettingsView } from "./youtube-settings-view"

export const metadata: Metadata = {
  title: "YouTube — Speaking Track",
}

export default async function YoutubeSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string }>
}) {
  const requestHeaders = await headers()
  const session = await getAuth().api.getSession({ headers: requestHeaders })
  if (!session) {
    redirect("/login")
  }
  const params = await searchParams
  const status = await getConnectionStatus(getDb(), session.user.id)
  return <YoutubeSettingsView status={status} connectResult={params.connect ?? null} />
}
