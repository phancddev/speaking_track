import type { Metadata } from "next"
import { listConnections } from "@/lib/services/youtube-connection"
import { getDb } from "@/lib/db"
import { YoutubeOverviewView } from "./youtube-overview-view"

export const metadata: Metadata = {
  title: "YouTube connections — Speaking Track",
}

export default async function AdminYoutubePage() {
  const connections = await listConnections(getDb())
  return <YoutubeOverviewView connections={connections} />
}
