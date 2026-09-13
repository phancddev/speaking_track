"use client"

import {
  CircleAlertIcon,
  CircleStopIcon,
  LoaderCircleIcon,
  MicIcon,
  PlayIcon,
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
import type { RecordingView } from "@/lib/services/recordings"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

  async function onUpload() {
    if (!capture || uploading) return
    setUploading(true)
    setUploadProgress(0)
    setUploadError(null)
    const handle = uploadRecordingBlob(
      {
        questionId: question.id,
        blob: capture.blob,
        mimeType: capture.mimeType,
        durationMs: capture.durationMs,
      },
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
            onStop={onStop}
            onUpload={onUpload}
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
  onStop,
  onUpload,
  onDiscard,
  onCancelUpload,
}: {
  recorder: ReturnType<typeof useRecorderController>
  capture: { blob: Blob; mimeType: string; durationMs: number } | null
  uploading: boolean
  uploadProgress: number
  uploadError: string | null
  onStop: () => void
  onUpload: () => void
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
            {recorder.stream && !recorder.recording ? (
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

        {capture && !uploading ? (
          <div className="flex flex-col gap-3">
            <video
              src={recorder.previewUrl ?? undefined}
              controls
              playsInline
              className="aspect-video w-full rounded-md bg-black"
              aria-label="Recording review playback"
            />
            <p className="text-muted-foreground text-xs">
              {Math.round(capture.durationMs / 1000)}s · {capture.mimeType}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={onUpload}>
                <PlayIcon aria-hidden />
                Upload attempt
              </Button>
              <Button variant="outline" onClick={onDiscard}>
                <Trash2Icon aria-hidden />
                Discard
              </Button>
            </div>
          </div>
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

function AttemptsPanel({
  recordings,
  onRetry,
  onDelete,
}: {
  recordings: RecordingView[]
  onRetry: (recordingId: string) => void
  onDelete: (recordingId: string) => void
}) {
  const [playingId, setPlayingId] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Attempts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {recordings.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No attempts yet. Record and upload your first answer above.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {recordings.map((row) => (
              <li key={row.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
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
                    <span className="text-muted-foreground text-xs">
                      {new Date(row.createdAt).toLocaleString()} ·{" "}
                      {Math.round(row.durationMs / 1000)}s
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {row.retryable ? (
                      <Button variant="ghost" size="sm" onClick={() => onRetry(row.id)}>
                        <RotateCcwIcon aria-hidden />
                        Retry
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete attempt from ${new Date(row.createdAt).toLocaleString()}`}
                      onClick={() => onDelete(row.id)}
                    >
                      <Trash2Icon aria-hidden />
                      Delete
                    </Button>
                  </div>
                </div>
                {row.failureCode === "YOUTUBE_UPLOAD_AMBIGUOUS" ? (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    This attempt cannot be retried automatically because the previous upload outcome
                    is unknown. Contact an administrator.
                  </p>
                ) : null}
                {row.failureCode === "YOUTUBE_PRIVATE_RESTRICTION" ? (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    YouTube forced this video to private. It cannot be played until the API project
                    passes YouTube&apos;s audit.
                  </p>
                ) : null}
                {row.failureMessage &&
                row.status === "FAILED" &&
                row.failureCode !== "YOUTUBE_UPLOAD_AMBIGUOUS" &&
                row.failureCode !== "YOUTUBE_PRIVATE_RESTRICTION" ? (
                  <p className="mt-2 text-xs text-muted-foreground">{row.failureMessage}</p>
                ) : null}
                {row.status === "READY" && row.youtubeVideoId ? (
                  <div className="mt-2">
                    {playingId === row.id ? (
                      <div className="aspect-video w-full max-w-md">
                        <iframe
                          className="h-full w-full rounded-md"
                          src={`https://www.youtube-nocookie.com/embed/${row.youtubeVideoId}?rel=0`}
                          title={`Attempt from ${new Date(row.createdAt).toLocaleString()}`}
                          allow="encrypted-media; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setPlayingId(row.id)}>
                        <PlayIcon aria-hidden />
                        Play attempt
                      </Button>
                    )}
                  </div>
                ) : null}
                {NON_TERMINAL_STATES.includes(row.status) ? (
                  <p className="text-muted-foreground mt-2 text-xs">{STATUS_LABELS[row.status]}…</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <Separator className="my-1" />
        <p className="text-muted-foreground text-xs">
          Recordings are transferred to the app&apos;s YouTube channel as unlisted videos once
          processed.
        </p>
      </CardContent>
    </Card>
  )
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}
