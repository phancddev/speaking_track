"use client"

import {
  CircleAlertIcon,
  CircleStopIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  MicIcon,
  PlayIcon,
  ScissorsIcon,
  Trash2Icon,
  RotateCcwIcon,
  VideoIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import type { RecordingState } from "@speaking-track/contracts"
import { apiFetch, ApiError } from "@/lib/api-client"
import { useRecorderController } from "@/lib/media/use-recorder-controller"
import { uploadRecordingBlob } from "@/lib/media/upload-transport"
import { trimRecording } from "@/lib/media/trim"
import type { RecordingView } from "@/lib/services/recordings"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

/**
 * Practice workspace (task 07 / plan/03 § Practice workspace): two-column
 * desktop layout (draft + recorder/attempts), stacked on mobile. Draft
 * saves are explicit; recorder states compose the media controller; attempt
 * polling is grouped, visibility-aware, and stops when all are terminal.
 */

type QuestionSummary = {
  id: string
  prompt: string
  position: number
  topicId: string
  topicTitle: string
}

const STATUS_LABELS: Record<RecordingState, string> = {
  STAGING: "Uploading to storage",
  QUEUED: "Queued for YouTube",
  YOUTUBE_UPLOADING: "Uploading to YouTube",
  YOUTUBE_PROCESSING: "YouTube processing",
  READY: "Ready",
  FAILED: "Failed",
  EXPIRED: "Expired",
  DELETE_PENDING: "Deleting",
  DELETED: "Deleted",
}

const NON_TERMINAL_STATES: RecordingState[] = [
  "STAGING",
  "QUEUED",
  "YOUTUBE_UPLOADING",
  "YOUTUBE_PROCESSING",
]

export function PracticeWorkspace({
  question,
  initialDraft,
  initialRecordings,
}: {
  question: QuestionSummary
  initialDraft: string
  initialRecordings: RecordingView[]
}) {
  const pathname = usePathname()

  // ---- Draft editor state -------------------------------------------------
  const [draft, setDraft] = useState(initialDraft)
  const [savedDraft, setSavedDraft] = useState(initialDraft)
  const [draftSaving, setDraftSaving] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const dirty = draft !== savedDraft

  const saveDraft = useCallback(async () => {
    if (draftSaving) return
    setDraftSaving(true)
    setDraftError(null)
    try {
      const result = await apiFetch<{ saved: boolean; updatedAt: string }>(
        `/api/questions/${question.id}/draft`,
        { method: "PUT", body: JSON.stringify({ content: draft }) },
      )
      setSavedDraft(draft)
      setSavedAt(new Date(result.updatedAt).toLocaleTimeString())
    } catch (cause) {
      // Failure keeps the editor content intact and retryable.
      setDraftError(
        cause instanceof ApiError ? cause.message : "Could not save the draft. Try again.",
      )
    } finally {
      setDraftSaving(false)
    }
  }, [draft, draftSaving, question.id])

  // ---- Recorder state -----------------------------------------------------
  const recorder = useRecorderController()
  const [capture, setCapture] = useState<{
    blob: Blob
    mimeType: string
    durationMs: number
  } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [trimming, setTrimming] = useState(false)
  const [trimError, setTrimError] = useState<string | null>(null)
  const uploadRef = useRef<{ abort: () => void } | null>(null)

  // ---- Attempts state -----------------------------------------------------
  const [recordings, setRecordings] = useState(initialRecordings)

  const reloadRecordings = useCallback(async () => {
    try {
      const list = await apiFetch<RecordingView[]>(`/api/questions/${question.id}/recordings`)
      setRecordings(list)
    } catch {
      // Polling failures keep the last known list; next tick retries.
    }
  }, [question.id])

  // Grouped polling: pauses when hidden, stops when all terminal.
  useEffect(() => {
    const hasNonTerminal = recordings.some((row) => NON_TERMINAL_STATES.includes(row.status))
    if (!hasNonTerminal) return
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void reloadRecordings()
      }
    }, 5000)
    const onVisible = () => {
      if (document.visibilityState === "visible") void reloadRecordings()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [recordings, reloadRecordings])

  // ---- Route-change cleanup + dirty guard ---------------------------------
  useEffect(() => {
    return () => {
      recorder.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  useEffect(() => {
    if (!dirty && !recorder.recording) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty, recorder.recording])

  async function onStop() {
    const result = await recorder.stop()
    if (result) {
      setCapture(result)
    }
  }

  async function uploadCapture(blob: Blob, mimeType: string, durationMs: number) {
    setUploading(true)
    setUploadProgress(0)
    setUploadError(null)
    const handle = uploadRecordingBlob(
      { questionId: question.id, blob, mimeType, durationMs },
      { onProgress: (sent, total) => setUploadProgress(Math.round((sent / total) * 100)) },
    )
    uploadRef.current = handle
    const outcome = await handle.done
    setUploading(false)
    uploadRef.current = null
    if (outcome.ok) {
      recorder.reset()
      setCapture(null)
      await reloadRecordings()
    } else {
      setUploadError(outcome.error)
    }
  }

  async function onUpload() {
    if (!capture || uploading || trimming) return
    await uploadCapture(capture.blob, capture.mimeType, capture.durationMs)
  }

  async function onTrimUpload(startSec: number, endSec: number) {
    if (!capture || uploading || trimming) return
    setTrimming(true)
    setTrimError(null)
    try {
      const result = await trimRecording(capture.blob, startSec, endSec)
      await uploadCapture(result.blob, capture.mimeType, result.durationMs)
    } catch (cause) {
      setTrimError(
        cause instanceof Error ? cause.message : "Trimming failed. Try again or upload untrimmed.",
      )
    } finally {
      setTrimming(false)
    }
  }

  async function onRetry(recordingId: string) {
    try {
      await apiFetch(`/api/recordings/${recordingId}/retry`, { method: "POST" })
      await reloadRecordings()
    } catch (cause) {
      setUploadError(cause instanceof ApiError ? cause.message : "Retry failed.")
    }
  }

  async function onDelete(recordingId: string) {
    try {
      await apiFetch(`/api/recordings/${recordingId}`, { method: "DELETE" })
      await reloadRecordings()
    } catch (cause) {
      setUploadError(cause instanceof ApiError ? cause.message : "Delete failed.")
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="text-muted-foreground mb-2 text-sm">
        <Link href="/library" className="hover:underline">
          Library
        </Link>
        <span aria-hidden> / </span>
        <Link href={`/library/topics/${question.topicId}`} className="hover:underline">
          {question.topicTitle}
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Question {question.position + 1}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Question and draft" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Question</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">{question.prompt}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-lg font-semibold">Draft</CardTitle>
              <div className="flex items-center gap-2">
                {savedAt ? (
                  <span className="text-muted-foreground text-xs">Saved at {savedAt}</span>
                ) : null}
                <Button size="sm" onClick={() => void saveDraft()} disabled={draftSaving || !dirty}>
                  {draftSaving ? (
                    <>
                      <LoaderCircleIcon aria-hidden className="animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save draft"
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Label htmlFor="draft-content" className="sr-only">
                Draft notes
              </Label>
              <Textarea
                id="draft-content"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={12}
                maxLength={100000}
                placeholder="Plan your answer…"
                aria-description={dirty ? "Unsaved changes" : undefined}
              />
              {draftError ? (
                <Alert variant="destructive">
                  <CircleAlertIcon aria-hidden />
                  <AlertTitle>Save failed</AlertTitle>
                  <AlertDescription>{draftError}</AlertDescription>
                </Alert>
              ) : null}
              {dirty ? <p className="text-muted-foreground text-xs">Unsaved changes</p> : null}
            </CardContent>
          </Card>
        </section>

        <section aria-label="Recorder and attempts" className="flex flex-col gap-4">
          <RecorderPanel
            recorder={recorder}
            capture={capture}
            uploading={uploading}
            uploadProgress={uploadProgress}
            uploadError={uploadError}
            trimming={trimming}
            trimError={trimError}
            onStop={onStop}
            onUpload={onUpload}
            onTrimUpload={onTrimUpload}
            onDiscard={() => {
              recorder.reset()
              setCapture(null)
              setUploadError(null)
            }}
            onCancelUpload={() => uploadRef.current?.abort()}
          />

          <AttemptsPanel recordings={recordings} onRetry={onRetry} onDelete={onDelete} />
        </section>
      </div>
    </div>
  )
}

function RecorderPanel({
  recorder,
  capture,
  uploading,
  uploadProgress,
  uploadError,
  trimming,
  trimError,
  onStop,
  onUpload,
  onTrimUpload,
  onDiscard,
  onCancelUpload,
}: {
  recorder: ReturnType<typeof useRecorderController>
  capture: { blob: Blob; mimeType: string; durationMs: number } | null
  uploading: boolean
  uploadProgress: number
  uploadError: string | null
  trimming: boolean
  trimError: string | null
  onStop: () => void
  onUpload: () => void
  onTrimUpload: (startSec: number, endSec: number) => void
  onDiscard: () => void
  onCancelUpload: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Recorder</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {uploadError ? (
          <Alert variant="destructive">
            <CircleAlertIcon aria-hidden />
            <AlertTitle>Upload problem</AlertTitle>
            <AlertDescription>{uploadError}</AlertDescription>
          </Alert>
        ) : null}

        {recorder.permission === "idle" && !capture ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-muted-foreground text-sm">
              Your camera and microphone are used for practice recordings and are uploaded to this
              app&apos;s YouTube channel after review.
            </p>
            <Button onClick={recorder.requestPermission}>
              <VideoIcon aria-hidden />
              Enable camera and microphone
            </Button>
          </div>
        ) : null}

        {recorder.permission === "requesting" ? (
          <p className="text-muted-foreground text-sm" role="status">
            Waiting for browser permission…
          </p>
        ) : null}

        {recorder.permission === "denied" || recorder.permission === "unavailable" ? (
          <Alert>
            <CircleAlertIcon aria-hidden />
            <AlertTitle>
              {recorder.permission === "denied"
                ? "Permission blocked"
                : "No camera or microphone found"}
            </AlertTitle>
            <AlertDescription>
              {recorder.permission === "denied"
                ? "Allow camera and microphone access in your browser's site settings, then try again."
                : "Connect a camera and microphone, or use a device that has them."}
            </AlertDescription>
          </Alert>
        ) : null}

        {recorder.permission === "granted" && !capture ? (
          <div className="flex flex-col gap-3">
            {recorder.stream ? (
              <video
                muted
                playsInline
                autoPlay
                ref={(element) => {
                  if (element && element.srcObject !== recorder.stream) {
                    element.srcObject = recorder.stream
                  }
                }}
                className="aspect-video w-full rounded-md bg-black"
                aria-label="Camera preview"
              />
            ) : null}
            {recorder.recording ? (
              <p
                className="text-sm font-medium text-red-600 dark:text-red-400"
                role="timer"
                aria-live="off"
              >
                ● Recording {formatElapsed(recorder.elapsedMs)}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {!recorder.recording ? (
                <Button onClick={recorder.start} disabled={!recorder.mimeType}>
                  <MicIcon aria-hidden />
                  Start recording
                </Button>
              ) : (
                <Button variant="destructive" onClick={onStop}>
                  <CircleStopIcon aria-hidden />
                  Stop recording
                </Button>
              )}
            </div>
          </div>
        ) : null}

        {capture && !uploading && !trimming ? (
          <TrimPanel
            capture={capture}
            previewUrl={recorder.previewUrl}
            trimError={trimError}
            onUpload={onUpload}
            onTrimUpload={onTrimUpload}
            onDiscard={onDiscard}
          />
        ) : null}

        {trimming ? (
          <p className="text-sm" role="status">
            <LoaderCircleIcon aria-hidden className="mr-2 inline animate-spin" />
            Trimming video…
          </p>
        ) : null}

        {uploading ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm" role="status">
              Uploading… {uploadProgress}%
            </p>
            <progress
              value={uploadProgress}
              max={100}
              aria-label="Upload progress"
              className="h-2 w-full"
            />
            <Button variant="outline" size="sm" onClick={onCancelUpload}>
              Cancel upload
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function TrimPanel({
  capture,
  previewUrl,
  trimError,
  onUpload,
  onTrimUpload,
  onDiscard,
}: {
  capture: { blob: Blob; mimeType: string; durationMs: number }
  previewUrl: string | null
  trimError: string | null
  onUpload: () => void
  onTrimUpload: (startSec: number, endSec: number) => void
  onDiscard: () => void
}) {
  const totalSec = Math.max(1, Math.round(capture.durationMs / 1000))
  const [startSec, setStartSec] = useState(0)
  const [endSec, setEndSec] = useState(totalSec)
  const selected = endSec - startSec
  const hasSelection = startSec > 0 || endSec < totalSec

  return (
    <div className="flex flex-col gap-3">
      <video
        src={previewUrl ?? undefined}
        controls
        playsInline
        className="aspect-video w-full rounded-md bg-black"
        aria-label="Recording review playback"
      />
      <p className="text-muted-foreground text-xs">
        {totalSec}s · {capture.mimeType} · {formatBytes(capture.blob.size)}
      </p>

      <div className="flex flex-col gap-2 rounded-md border p-3">
        <p className="text-sm font-medium">Trim before saving (cuts at nearest keyframe)</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="trim-start" className="w-12 shrink-0 text-xs">
              Start
            </Label>
            <input
              id="trim-start"
              type="range"
              min={0}
              max={Math.max(0, endSec - 1)}
              step={1}
              value={startSec}
              onChange={(event) => setStartSec(Number(event.target.value))}
              className="w-full"
              aria-label="Trim start position in seconds"
            />
            <span className="text-muted-foreground w-8 shrink-0 text-right text-xs tabular-nums">
              {startSec}s
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="trim-end" className="w-12 shrink-0 text-xs">
              End
            </Label>
            <input
              id="trim-end"
              type="range"
              min={Math.min(totalSec, startSec + 1)}
              max={totalSec}
              step={1}
              value={endSec}
              onChange={(event) => setEndSec(Number(event.target.value))}
              className="w-full"
              aria-label="Trim end position in seconds"
            />
            <span className="text-muted-foreground w-8 shrink-0 text-right text-xs tabular-nums">
              {endSec}s
            </span>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          Keeping {selected}s of {totalSec}s
        </p>
      </div>

      {trimError ? (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {trimError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {hasSelection ? (
          <Button onClick={() => onTrimUpload(startSec, endSec)}>
            <ScissorsIcon aria-hidden />
            Trim & upload ({selected}s)
          </Button>
        ) : null}
        <Button variant={hasSelection ? "outline" : "default"} onClick={onUpload}>
          <PlayIcon aria-hidden />
          Upload attempt
        </Button>
        <Button variant="outline" onClick={onDiscard}>
          <Trash2Icon aria-hidden />
          Discard
        </Button>
      </div>
    </div>
  )
}

function AttemptsPanel({
  recordings,
  onRetry,
  onDelete,
}: {
  recordings: RecordingView[]
  onRetry: (recordingId: string) => void
  onDelete: (recordingId: string) => void
}) {
  const [playing, setPlaying] = useState<RecordingView | null>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">
          Attempts
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {recordings.length > 0
              ? `${recordings.length} video${recordings.length === 1 ? "" : "s"}`
              : null}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {recordings.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No attempts yet. Record and upload your first answer above.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {recordings.map((row) => (
              <li key={row.id} className="overflow-hidden rounded-md border">
                <button
                  type="button"
                  className="bg-muted group relative block w-full"
                  disabled={!row.playable}
                  onClick={() => setPlaying(row)}
                  aria-label={`Play attempt from ${new Date(row.createdAt).toLocaleString()}`}
                >
                  <AttemptThumbnail recordingId={row.id} />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex size-12 items-center justify-center rounded-full bg-black/60 text-white transition group-hover:bg-black/80">
                      <PlayIcon aria-hidden className="size-6" />
                    </span>
                  </span>
                  <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white tabular-nums">
                    {Math.round(row.durationMs / 1000)}s
                  </span>
                </button>
                <div className="flex flex-col gap-1 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        row.status === "READY"
                          ? "default"
                          : row.status === "FAILED"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {STATUS_LABELS[row.status]}
                    </Badge>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {formatBytes(row.sizeBytes)}
                    </span>
                    <span className="text-muted-foreground ml-auto text-xs">
                      {new Date(row.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {NON_TERMINAL_STATES.includes(row.status) ? (
                    <p className="text-muted-foreground text-xs">{STATUS_LABELS[row.status]}…</p>
                  ) : null}
                  {row.status === "QUEUED" && row.uploadDeferredUntil ? (
                    <p className="text-muted-foreground text-xs">
                      Upload deferred until {new Date(row.uploadDeferredUntil).toLocaleTimeString()}{" "}
                      (quota) — still playable here.
                    </p>
                  ) : null}
                  {row.failureMessage && row.status === "FAILED" ? (
                    <p className="text-muted-foreground line-clamp-2 text-xs">
                      {row.failureMessage}
                    </p>
                  ) : null}
                  <div className="mt-1 flex gap-1">
                    {row.retryable ? (
                      <Button variant="ghost" size="sm" onClick={() => onRetry(row.id)}>
                        <RotateCcwIcon aria-hidden />
                        Retry
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      aria-label={`Delete attempt from ${new Date(row.createdAt).toLocaleString()}`}
                      onClick={() => onDelete(row.id)}
                    >
                      <Trash2Icon aria-hidden />
                      Delete
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Separator className="my-1" />
        <p className="text-muted-foreground text-xs">
          Recordings stay playable here from storage and are transferred to your YouTube channel as
          unlisted videos once processed.
        </p>
      </CardContent>
      <AttemptPlayerDialog attempt={playing} onClose={() => setPlaying(null)} />
    </Card>
  )
}

function AttemptPlayerDialog({
  attempt,
  onClose,
}: {
  attempt: RecordingView | null
  onClose: () => void
}) {
  const [storedUrl, setStoredUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const resetKey = attempt?.id ?? "none"
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  useEffect(() => {
    if (!attempt?.playable) return
    let cancelled = false
    void (async () => {
      try {
        const result = await apiFetch<{ url: string }>(`/api/recordings/${attempt.id}/playback`)
        if (!cancelled) {
          setStoredUrl(result.url)
          setLoadedFor(resetKey)
        }
      } catch {
        if (!cancelled) setError("Could not start playback. Try again.")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [attempt, resetKey])

  // The freshly-fetched URL applies only while the dialog shows the same
  // attempt; switching attempts discards it without an extra render hop.
  const url = loadedFor === resetKey ? storedUrl : null

  if (!attempt) return null
  return (
    <Dialog open={attempt !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Attempt · {new Date(attempt.createdAt).toLocaleString()}</DialogTitle>
          <DialogDescription>
            {Math.round(attempt.durationMs / 1000)}s · {formatBytes(attempt.sizeBytes)} ·{" "}
            {STATUS_LABELS[attempt.status]}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : url ? (
          <video
            src={url}
            controls
            autoPlay
            playsInline
            className="aspect-video w-full rounded-md bg-black"
            aria-label="Attempt playback"
          />
        ) : (
          <div className="bg-muted flex aspect-video w-full items-center justify-center rounded-md">
            <LoaderCircleIcon aria-hidden className="animate-spin" />
          </div>
        )}
        {attempt.status === "READY" && attempt.youtubeVideoId ? (
          <a
            className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
            href={`https://www.youtube.com/watch?v=${attempt.youtubeVideoId}`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLinkIcon aria-hidden className="size-4" />
            Open on YouTube
          </a>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function AttemptThumbnail({ recordingId }: { recordingId: string }) {
  // Thumbnails are ALWAYS captured from the stored video so every attempt
  // looks the same whether or not YouTube has processed it (abandoned
  // uploads never get a YouTube thumbnail).
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await apiFetch<{ url: string }>(`/api/recordings/${recordingId}/playback`)
        const video = document.createElement("video")
        video.muted = true
        video.preload = "auto"
        // Cross-origin video (presigned S3 host) taints the canvas unless
        // the request is made in CORS mode; MinIO answers with the calling
        // origin, so this both loads and allows toDataURL.
        video.crossOrigin = "anonymous"
        video.src = result.url
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve()
          video.onerror = () => reject(new Error("thumbnail load failed"))
        })
        const target = Math.min(1, (video.duration || 2) / 2)
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve()
          video.currentTime = target
        })
        const canvas = document.createElement("canvas")
        canvas.width = 320
        canvas.height = Math.round((320 / (video.videoWidth || 320)) * (video.videoHeight || 180))
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height)
        if (!cancelled) setSrc(canvas.toDataURL("image/jpeg", 0.7))
      } catch {
        // Thumbnails are decorative; failures just render the placeholder.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [recordingId])

  return (
    <div className="bg-muted relative aspect-video w-full overflow-hidden" aria-hidden>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="text-muted-foreground flex h-full items-center justify-center">
          <VideoIcon aria-hidden className="size-6" />
        </div>
      )}
    </div>
  )
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes
  let unit = -1
  do {
    value /= 1024
    unit += 1
  } while (value >= 1024 && unit < units.length - 1)
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}
