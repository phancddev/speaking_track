"use client"

import {
  CircleAlertIcon,
  CircleCheckIcon,
  Link2OffIcon,
  LoaderCircleIcon,
  PlugZapIcon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { apiFetch, ApiError } from "@/lib/api-client"
import type { ConnectionStatusView } from "@/lib/services/youtube-connection"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

/**
 * YouTube channel settings (task 08): connection status, connect/reconnect
 * via server navigation, disconnect, the unlisted-link disclosure, and
 * distinct blocking notices for disconnected / reauth / quota / private
 * restriction states.
 */

const CONNECT_NOTICE: Record<string, string> = {
  connected: "The YouTube channel is now connected.",
  "invalid-state": "The connection request expired or was invalid. Start again.",
  connect_failed: "Google rejected the connection. Check the OAuth client and try again.",
  YOUTUBE_REAUTH_REQUIRED:
    "Google did not return a reusable refresh token. Revoke this app in your Google account, then reconnect.",
}

export function YoutubeSettingsView({
  status,
  oauthConfigured,
  connectResult,
}: {
  status: ConnectionStatusView
  oauthConfigured: boolean
  connectResult: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function disconnect() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await apiFetch("/api/admin/youtube/disconnect", { method: "POST" })
      router.refresh()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not disconnect. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const connected = status.status === "CONNECTED"
  const notice = connectResult
    ? (CONNECT_NOTICE[connectResult] ?? `Connection result: ${connectResult}.`)
    : null

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">YouTube channel</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        One admin-managed channel receives every uploaded practice recording.
      </p>

      {notice ? (
        <Alert className="mt-4" variant={connectResult === "connected" ? "default" : "destructive"}>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mt-6 py-4">
        <CardHeader>
          <CardTitle className="text-base">Connection</CardTitle>
          <CardDescription>
            {status.channelTitle
              ? `Connected as “${status.channelTitle}”${status.channelId ? ` (${status.channelId})` : ""}.`
              : "No channel is connected yet. Uploading stays queued until a channel is connected."}
          </CardDescription>
          <CardAction>
            {connected ? (
              <Badge>connected</Badge>
            ) : status.status === "REAUTH_REQUIRED" ? (
              <Badge variant="destructive">reauthorization required</Badge>
            ) : (
              <Badge variant="secondary">disconnected</Badge>
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {status.lastVerifiedAt ? (
            <p className="text-muted-foreground text-xs">
              Last verified {new Date(status.lastVerifiedAt).toLocaleString()}
            </p>
          ) : null}

          {!oauthConfigured ? (
            <Alert>
              <CircleAlertIcon aria-hidden />
              <AlertTitle>OAuth client not configured</AlertTitle>
              <AlertDescription>
                Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and{" "}
                <code>GOOGLE_REDIRECT_URI</code> in the environment, then restart the web app before
                connecting.
              </AlertDescription>
            </Alert>
          ) : null}

          {status.status === "REAUTH_REQUIRED" ? (
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden />
              <AlertTitle>Reauthorization required</AlertTitle>
              <AlertDescription>
                The stored refresh token was rejected (revoked or expired). Reconnect to restore
                uploads; affected recordings stop with a retryable failure.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {/* Full-page navigation to the server OAuth redirect; an API
                route is not an app page, so next/link does not apply. */}
            <Button
              render={
                // Full-page navigation to the server OAuth redirect; an API
                // route is not an app page, so next/link does not apply.
                // eslint-disable-next-line @next/next/no-html-link-for-pages
                <a href="/api/admin/youtube/connect" />
              }
              disabled={!oauthConfigured}
              aria-label="Connect or reconnect the YouTube channel"
            >
              <PlugZapIcon aria-hidden />
              {connected ? "Reconnect" : "Connect"}
            </Button>
            {status.status !== "UNCONNECTED" && status.status !== "NOT_CONFIGURED" ? (
              <Button variant="outline" onClick={disconnect} disabled={busy}>
                {busy ? (
                  <LoaderCircleIcon aria-hidden className="animate-spin" />
                ) : (
                  <Link2OffIcon aria-hidden />
                )}
                Disconnect
              </Button>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            Disconnecting removes the stored authorization but never deletes videos already on
            YouTube.
          </p>
        </CardContent>
      </Card>

      <Separator className="my-6" />

      <div className="flex flex-col gap-4">
        <Alert>
          <CircleCheckIcon aria-hidden />
          <AlertTitle>Unlisted links are accessible to anyone who obtains them</AlertTitle>
          <AlertDescription>
            Recordings are uploaded as unlisted videos. Anyone with the video link can watch it;
            application access control cannot revoke a leaked YouTube URL.
          </AlertDescription>
        </Alert>
        <Alert>
          <CircleAlertIcon aria-hidden />
          <AlertTitle>Quota</AlertTitle>
          <AlertDescription>
            YouTube allows a limited number of uploads per day. When the quota is exhausted, queued
            recordings wait and upload automatically after the daily reset (Pacific time).
          </AlertDescription>
        </Alert>
        <Alert>
          <CircleAlertIcon aria-hidden />
          <AlertTitle>API project audit</AlertTitle>
          <AlertDescription>
            Until the API project passes YouTube&apos;s audit, uploads may be forced to private.
            Such recordings are marked failed and are explicitly not playable — connect a project
            with approved access for normal unlisted playback.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  )
}
