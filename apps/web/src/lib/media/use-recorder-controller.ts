"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  preferredRecordingMimeTypes,
  type SupportedRecordingMimeType,
} from "@speaking-track/contracts"

/**
 * Headless browser media utilities (task 05): getUserMedia gating, MIME
 * negotiation, MediaRecorder lifecycle, monotonic elapsed time, and Blob
 * URL management. Every track and object URL is released on stop/discard/
 * error/unmount. No server rows are created here — that happens on upload.
 */

export type PermissionState = "idle" | "requesting" | "granted" | "denied" | "unavailable"

export type RecorderController = {
  permission: PermissionState
  stream: MediaStream | null
  previewUrl: string | null
  recording: boolean
  elapsedMs: number
  mimeType: SupportedRecordingMimeType | null
  error: string | null
  /** Frame flips applied to the preview and baked into recordings. */
  flipH: boolean
  flipV: boolean
  requestPermission: () => void
  toggleFlipH: () => void
  toggleFlipV: () => void
  start: () => void
  stop: () => Promise<RecordingCapture | null>
  reset: () => void
}

export type RecordingCapture = {
  blob: Blob
  mimeType: SupportedRecordingMimeType
  durationMs: number
}

function negotiateMimeType(): SupportedRecordingMimeType | null {
  if (typeof MediaRecorder === "undefined") return null
  const supported = preferredRecordingMimeTypes((candidate) => {
    try {
      return MediaRecorder.isTypeSupported(candidate)
    } catch {
      return false
    }
  })
  return supported[0] ?? null
}

export function useRecorderController(): RecorderController {
  const [permission, setPermission] = useState<PermissionState>("idle")
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [mimeType, setMimeType] = useState<SupportedRecordingMimeType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  /** Live canvas pipeline (flip baking); torn down with the recorder. */
  const pipelineRef = useRef<{ stop: () => void } | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const localUrlRef = useRef<string | null>(null)
  const durationRef = useRef(0)

  const releaseStream = useCallback(() => {
    stream?.getTracks().forEach((track) => track.stop())
  }, [stream])

  const releaseLocalUrl = useCallback(() => {
    if (localUrlRef.current) {
      URL.revokeObjectURL(localUrlRef.current)
      localUrlRef.current = null
    }
  }, [])

  const teardownRecorder = useCallback(() => {
    pipelineRef.current?.stop()
    pipelineRef.current = null
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop()
    }
    recorderRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      // Unmount: stop every track and revoke every URL (UI contract).
      teardownRecorder()
      releaseStream()
      releaseLocalUrl()
    }
  }, [teardownRecorder, releaseStream, releaseLocalUrl])

  const requestPermission = useCallback(() => {
    setPermission("requesting")
    setError(null)
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: true })
      .then((mediaStream) => {
        setStream(mediaStream)
        setPermission("granted")
        const negotiated = negotiateMimeType()
        if (!negotiated) {
          setError("This browser cannot record in a supported media format.")
        }
        setMimeType(negotiated)
      })
      .catch((cause: unknown) => {
        const name = (cause as { name?: string }).name
        setPermission(
          name === "NotFoundError" || name === "OverconstrainedError" ? "unavailable" : "denied",
        )
      })
  }, [])

  const start = useCallback(() => {
    if (!stream || recording || !mimeType) return
    chunksRef.current = []

    // Flip baking: when a flip is active, record a rotated canvas render of
    // the camera (plus the original audio) instead of the raw stream, so the
    // SAVED file — and therefore the YouTube upload — is already upright.
    let recordStream = stream
    if (flipH || flipV) {
      const source = document.createElement("video")
      source.srcObject = stream
      source.muted = true
      source.playsInline = true
      void source.play().catch(() => undefined)
      const track = stream.getVideoTracks()[0]
      const settings = track?.getSettings() ?? {}
      const width = Number(settings.width) || 640
      const height = Number(settings.height) || 480
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (ctx) {
        let running = true
        const draw = () => {
          if (!running) return
          if (source.readyState >= 2) {
            ctx.save()
            ctx.translate(flipH ? width : 0, flipV ? height : 0)
            ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
            ctx.drawImage(source, 0, 0, width, height)
            ctx.restore()
          }
          requestAnimationFrame(draw)
        }
        requestAnimationFrame(draw)
        const canvasStream = canvas.captureStream(30)
        recordStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...stream.getAudioTracks(),
        ])
        pipelineRef.current = {
          stop() {
            running = false
            canvasStream.getTracks().forEach((canvasTrack) => canvasTrack.stop())
            source.srcObject = null
          },
        }
      }
    }

    const recorder = new MediaRecorder(recordStream, { mimeType })
    recorder.addEventListener("dataavailable", (event: BlobEvent) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    })
    recorder.addEventListener("error", () => {
      setError("Recording stopped unexpectedly. Try again.")
      teardownRecorder()
      setRecording(false)
    })
    recorder.start(1000)
    recorderRef.current = recorder
    startedAtRef.current = performance.now()
    setRecording(true)
    setElapsedMs(0)
    timerRef.current = setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsedMs(performance.now() - startedAtRef.current)
      }
    }, 250)
  }, [stream, recording, mimeType, flipH, flipV, teardownRecorder])

  const stop = useCallback(() => {
    return new Promise<RecordingCapture | null>((resolve) => {
      const recorder = recorderRef.current
      if (!recorder || recorder.state === "inactive") {
        resolve(null)
        return
      }
      const startedAt = startedAtRef.current ?? performance.now()
      recorder.addEventListener(
        "stop",
        () => {
          teardownRecorder()
          releaseStream()
          const type = mimeType ?? "video/webm"
          const blob = new Blob(chunksRef.current, { type })
          chunksRef.current = []
          const durationMs = Math.max(1, Math.round(performance.now() - startedAt))
          durationRef.current = durationMs
          releaseLocalUrl()
          localUrlRef.current = URL.createObjectURL(blob)
          setPreviewUrl(localUrlRef.current)
          setRecording(false)
          setStream(null)
          startedAtRef.current = null
          resolve({
            blob,
            mimeType: mimeType ?? ("video/webm" as SupportedRecordingMimeType),
            durationMs,
          })
        },
        { once: true },
      )
      recorder.stop()
    })
  }, [mimeType, releaseStream, teardownRecorder, releaseLocalUrl])

  const reset = useCallback(() => {
    // Discard: local-only cleanup; never creates or mutates server rows.
    teardownRecorder()
    releaseStream()
    releaseLocalUrl()
    setPreviewUrl(null)
    setStream(null)
    setRecording(false)
    setElapsedMs(0)
    setPermission("idle")
    setError(null)
  }, [releaseStream, releaseLocalUrl, teardownRecorder])

  return {
    permission,
    stream,
    previewUrl,
    recording,
    elapsedMs,
    mimeType,
    error,
    requestPermission,
    flipH,
    flipV,
    toggleFlipH: () => setFlipH((current) => !current),
    toggleFlipV: () => setFlipV((current) => !current),
    start,
    stop,
    reset,
  }
}
