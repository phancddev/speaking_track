import type { Metadata } from "next"
import { getConnectionStatus } from "@/lib/services/youtube-connection"
import { getDb } from "@/lib/db"
import { YoutubeSettingsView } from "./youtube-settings-view"

export const metadata: Metadata = {
  title: "YouTube — Speaking Track",
}

export default async function AdminYoutubePage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string }>
}) {
  const params = await searchParams
  const status = await getConnectionStatus(getDb())
  const oauthConfigured =
    Boolean(process.env.GOOGLE_CLIENT_ID) && Boolean(process.env.GOOGLE_CLIENT_SECRET)
  return (
    <YoutubeSettingsView
      status={status}
      oauthConfigured={oauthConfigured}
      connectResult={params.connect ?? null}
    />
  )
}
