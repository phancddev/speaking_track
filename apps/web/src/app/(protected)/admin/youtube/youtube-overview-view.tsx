"use client"

import { CircleCheckIcon, CircleAlertIcon } from "lucide-react"
import type { AdminConnectionRow } from "@/lib/services/youtube-connection"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Admin overview of every user's per-user YouTube connection. Users
 * configure their own OAuth client and connect their own Google account
 * under Settings → YouTube; admins only observe here.
 */

const STATUS_BADGE: Record<string, "default" | "destructive" | "secondary"> = {
  CONNECTED: "default",
  REAUTH_REQUIRED: "destructive",
}

export function YoutubeOverviewView({ connections }: { connections: AdminConnectionRow[] }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">YouTube connections</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Each user uploads through their own Google account. Users set this up themselves under
        Settings → YouTube.
      </p>

      <Alert className="mt-4">
        <CircleCheckIcon aria-hidden />
        <AlertTitle>Per-user model</AlertTitle>
        <AlertDescription>
          There is no shared channel anymore. Recordings a user saves upload to the channel that
          user connected; quota is tracked per Google Cloud project that issued the client
          credentials.
        </AlertDescription>
      </Alert>

      <Card className="mt-6 py-4">
        <CardHeader>
          <CardTitle className="text-base">Connections</CardTitle>
          <CardDescription>
            {connections.length === 0
              ? "No user has connected a YouTube channel yet."
              : `${connections.length} connection${connections.length === 1 ? "" : "s"} on record.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connections.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Own OAuth client</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell>
                      <span className="font-medium">
                        {row.ownerName ?? row.ownerEmail ?? row.userId}
                      </span>
                      {row.ownerEmail && row.ownerName ? (
                        <span className="text-muted-foreground block text-xs">
                          {row.ownerEmail}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {row.channelTitle ? (
                        <>
                          {row.channelTitle}
                          {row.channelId ? (
                            <span className="text-muted-foreground block text-xs">
                              {row.channelId}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[row.status] ?? "secondary"}>{row.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {row.hasOwnClient ? (
                        <CircleCheckIcon aria-hidden className="size-4 text-green-600" />
                      ) : (
                        <CircleAlertIcon aria-hidden className="text-muted-foreground size-4" />
                      )}
                      <span className="sr-only">
                        {row.hasOwnClient ? "own client configured" : "instance client"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
