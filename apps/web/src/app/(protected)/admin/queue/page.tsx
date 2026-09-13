import type { Metadata } from "next"
import { getQueueSummary, getRecentFailures } from "@/lib/services/queue-views"
import { getDb } from "@/lib/db"
import { QueueView } from "./queue-view"

export const metadata: Metadata = {
  title: "Queue — Speaking Track",
}

export default async function AdminQueuePage() {
  const [summary, failures] = await Promise.all([
    getQueueSummary(getDb()),
    getRecentFailures(getDb()),
  ])
  return <QueueView summary={summary} failures={failures} />
}
