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
  requestPermission: () => void
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

  const recorderRef = useRef<MediaRecorder | null>(null)
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
    const recorder = new MediaRecorder(stream, { mimeType })
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
  }, [stream, recording, mimeType, teardownRecorder])

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
    start,
    stop,
    reset,
  }
}
