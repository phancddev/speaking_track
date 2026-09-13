"use client"

import { LoaderCircleIcon, RefreshCcwIcon, RotateCcwIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { apiFetch, ApiError } from "@/lib/api-client"
import type { QueueSummary, QueueFailureRow } from "@/lib/services/queue-views"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Admin queue console (task 08): aggregate counts come from the database —
 * the domain source of truth — and recent failures expose only safe codes,
 * messages, and labels. Retry goes through the recording retry endpoint and
 * respects recording-state eligibility; no raw BullMQ controls exist.
 */

const STATE_ORDER = [
  "STAGING",
  "QUEUED",
  "YOUTUBE_UPLOADING",
  "YOUTUBE_PROCESSING",
  "READY",
  "FAILED",
  "EXPIRED",
  "DELETE_PENDING",
  "DELETED",
] as const

const STATE_LABELS: Record<string, string> = {
  STAGING: "Staging",
  QUEUED: "Queued",
  YOUTUBE_UPLOADING: "Uploading",
  YOUTUBE_PROCESSING: "Processing",
  READY: "Ready",
  FAILED: "Failed",
  EXPIRED: "Expired",
  DELETE_PENDING: "Deleting",
  DELETED: "Deleted",
}

export function QueueView({
  summary,
  failures,
}: {
  summary: QueueSummary
  failures: QueueFailureRow[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function retry(row: QueueFailureRow) {
    if (busy) return
    setBusy(row.recordingId)
    setError(null)
    setNotice(null)
    try {
      await apiFetch(`/api/recordings/${row.recordingId}/retry?ownerId=${row.ownerId}`, {
        method: "POST",
      })
      setNotice(`Recording ${row.recordingId.slice(0, 8)}… was re-queued.`)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not retry the recording.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
          <p className="text-muted-foreground text-sm">
            Recording states from the database. {summary.total} recording
            {summary.total === 1 ? "" : "s"} total.
          </p>
        </div>
        <Button variant="outline" onClick={() => router.refresh()}>
          <RefreshCcwIcon aria-hidden />
          Refresh
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Retry failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert className="mt-4">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {STATE_ORDER.map((state) => (
          <Card key={state} className="py-3">
            <CardHeader>
              <CardDescription>{STATE_LABELS[state]}</CardDescription>
              <CardTitle className="text-xl tabular-nums">{summary.countsByState[state]}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Separator className="my-6" />

      <Card className="py-4">
        <CardHeader>
          <CardTitle className="text-base">Recent failures</CardTitle>
          <CardDescription>
            Newest first. Retry is offered only where the recording state allows it; ambiguous
            uploads never retry automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {failures.length === 0 ? (
            <p className="text-muted-foreground text-sm">No failed recordings. 🎉</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Owner</TableHead>
                    <TableHead>Question</TableHead>
                    <TableHead>Failure</TableHead>
                    <TableHead className="text-right">Attempts</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {failures.map((row) => (
                    <TableRow key={row.recordingId}>
                      <TableCell>
                        {row.ownerEmail ? (
                          <Link
                            href={`/admin/users?search=${encodeURIComponent(row.ownerEmail)}`}
                            className="hover:underline"
                          >
                            {row.ownerEmail}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">unknown</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="max-w-[16rem] truncate"
                        title={row.questionPrompt ?? undefined}
                      >
                        {row.questionPrompt ?? (
                          <span className="text-muted-foreground">deleted question</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="destructive">{row.failureCode}</Badge>
                        {row.failureMessage ? (
                          <p className="text-muted-foreground mt-1 max-w-[20rem] truncate text-xs">
                            {row.failureMessage}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.attemptCount}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {new Date(row.updatedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.failureCode === "YOUTUBE_UPLOAD_AMBIGUOUS" ? (
                          <span
                            className="text-muted-foreground text-xs"
                            title="Ambiguous uploads never retry automatically"
                          >
                            blocked
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => retry(row)}
                          >
                            {busy === row.recordingId ? (
                              <LoaderCircleIcon aria-hidden className="animate-spin" />
                            ) : (
                              <RotateCcwIcon aria-hidden />
                            )}
                            Retry
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
