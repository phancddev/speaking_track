"use client"

import {
  CircleAlertIcon,
  CircleCheckIcon,
  KeyRoundIcon,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

/**
 * Per-user YouTube settings: enter your own Google OAuth client credentials,
 * connect your own Google account, and manage the connection. Recordings you
 * save upload to YOUR channel, independent of other users.
 */

const CONNECT_NOTICE: Record<string, string> = {
  connected: "Your YouTube channel is now connected.",
  "invalid-state": "The connection request expired or was invalid. Start again.",
  connect_failed: "Google rejected the connection. Check the OAuth client and try again.",
  YOUTUBE_REAUTH_REQUIRED:
    "Google did not return a reusable refresh token. Revoke this app in your Google account, then reconnect.",
}

export function YoutubeSettingsView({
  status,
  connectResult,
}: {
  status: ConnectionStatusView
  connectResult: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")

  async function saveCredentials() {
    if (busy) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await apiFetch("/api/youtube/client", {
        method: "PUT",
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
      })
      setSaved(true)
      setClientSecret("")
      router.refresh()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function clearCredentials() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await apiFetch("/api/youtube/client", { method: "DELETE" })
      setSaved(false)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not clear. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await apiFetch("/api/youtube/disconnect", { method: "POST" })
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
        Your recordings upload to your own YouTube channel, using your own Google OAuth client.
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
              : "No channel is connected yet. Your uploads stay queued until you connect."}
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

          {status.status === "REAUTH_REQUIRED" ? (
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden />
              <AlertTitle>Reauthorization required</AlertTitle>
              <AlertDescription>
                The stored refresh token was rejected (revoked or expired). Reconnect to restore
                uploads; affected recordings wait with a retryable failure.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              render={
                // Full-page navigation to the server OAuth redirect; an API
                // route is not an app page, so next/link does not apply.
                // eslint-disable-next-line @next/next/no-html-link-for-pages
                <a href="/api/youtube/connect" />
              }
              disabled={!status.hasClientConfig}
              aria-label="Connect or reconnect your YouTube channel"
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

      <Card className="py-4">
        <CardHeader>
          <CardTitle className="text-base">Your Google OAuth client</CardTitle>
          <CardDescription>
            {status.hasClientConfig
              ? "Credentials are saved. Re-entering replaces them."
              : "Create an OAuth client in your Google Cloud project and paste its credentials here."}
          </CardDescription>
          <CardAction>
            {status.hasClientConfig ? <Badge variant="secondary">configured</Badge> : null}
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="yt-client-id">Client ID</Label>
            <Input
              id="yt-client-id"
              autoComplete="off"
              spellCheck={false}
              placeholder="1234567890-abc.apps.googleusercontent.com"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="yt-client-secret">Client secret</Label>
            <Input
              id="yt-client-secret"
              type="password"
              autoComplete="new-password"
              placeholder="GOCSPX-…"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Stored encrypted on the server and never displayed again.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={saveCredentials}
              disabled={busy || clientId.trim().length < 10 || clientSecret.trim().length < 10}
            >
              <KeyRoundIcon aria-hidden />
              Save credentials
            </Button>
            {status.hasClientConfig ? (
              <Button variant="outline" onClick={clearCredentials} disabled={busy}>
                Clear saved credentials
              </Button>
            ) : null}
          </div>
          {saved ? (
            <p className="text-xs text-green-600 dark:text-green-400" role="status">
              Credentials saved. You can connect now.
            </p>
          ) : null}

          <Separator className="my-2" />

          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium">Setup checklist (one time)</p>
            <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-xs">
              <li>
                Open <span className="font-mono">console.cloud.google.com</span> → create (or pick)
                a project → enable <strong>YouTube Data API v3</strong>.
              </li>
              <li>
                OAuth consent screen: External, add your own Google account as a{" "}
                <strong>test user</strong>.
              </li>
              <li>
                Credentials → Create OAuth client ID → Web application → Authorized redirect URI:
                <br />
                <span className="font-mono break-all rounded bg-muted px-1.5 py-0.5">
                  {status.redirectUri}
                </span>
              </li>
              <li>Copy the client ID and secret into the form above, then press Connect.</li>
            </ol>
          </div>
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
          <AlertTitle>Quota is per Google Cloud project</AlertTitle>
          <AlertDescription>
            YouTube allows a limited number of uploads per day. When your quota is exhausted, your
            queued recordings wait and upload automatically after the daily reset (Pacific time).
            Using your own client keeps your quota separate from other users.
          </AlertDescription>
        </Alert>
        <Alert>
          <CircleAlertIcon aria-hidden />
          <AlertTitle>API project audit</AlertTitle>
          <AlertDescription>
            Until your API project passes YouTube&apos;s audit, uploads may be forced to private.
            Such recordings are marked failed and are explicitly not playable — use a project with
            approved access for normal unlisted playback.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  )
}
