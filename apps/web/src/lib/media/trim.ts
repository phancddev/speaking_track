"use client"

import { FFmpeg } from "@ffmpeg/ffmpeg"

/**
 * Client-side video trimming with ffmpeg.wasm (keyframe-accurate stream
 * copy — instant, no re-encode). The core files are served from
 * /public/ffmpeg so the app stays fully self-hosted.
 */

let ffmpegInstance: FFmpeg | null = null
let loading: Promise<FFmpeg> | null = null

function loadFfmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return Promise.resolve(ffmpegInstance)
  if (loading) return loading
  const ffmpeg = new FFmpeg()
  loading = ffmpeg
    .load({
      coreURL: new URL("/ffmpeg/ffmpeg-core.js", window.location.origin).href,
      wasmURL: new URL("/ffmpeg/ffmpeg-core.wasm", window.location.origin).href,
    })
    .then(() => {
      ffmpegInstance = ffmpeg
      return ffmpeg
    })
    .catch((error: unknown) => {
      loading = null
      throw error
    })
  return loading
}

export type TrimResult = {
  blob: Blob
  /** True keyframe-snapped duration of the trimmed output, in ms. */
  durationMs: number
}

/** Cuts [startSec, endSec) out of a webm/mp4 blob without re-encoding. */
export async function trimRecording(
  blob: Blob,
  startSec: number,
  endSec: number,
  onProgress?: (ratio: number) => void,
): Promise<TrimResult> {
  const ffmpeg = await loadFfmpeg()
  const input = "input.rec"
  const output = "output.rec"
  const progressHandler = (event: { progress: number }) => onProgress?.(event.progress)
  ffmpeg.on("progress", progressHandler)
  await ffmpeg.writeFile(input, new Uint8Array(await blob.arrayBuffer()))
  try {
    // Keyframe-accurate stream copy with INPUT-side seeking: the output
    // then starts at a real keyframe and -avoid_negative_ts resets packet
    // timestamps to zero. (Output-side -ss with -c copy produced files that
    // started mid-GOP with offset timestamps, which YouTube rejects with
    // "processing abandoned".)
    const duration = Math.max(0.1, endSec - startSec)
    await ffmpeg.exec([
      "-ss",
      startSec.toFixed(3),
      "-i",
      input,
      "-t",
      duration.toFixed(3),
      "-c",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
      output,
    ])
    const data = (await ffmpeg.readFile(output)) as Uint8Array
    const type = blob.type || "video/webm"
    const trimmed = new Blob([data.buffer as ArrayBuffer], { type })
    return { blob: trimmed, durationMs: await measureDurationMs(trimmed) }
  } finally {
    ffmpeg.off("progress", progressHandler)
    void ffmpeg.deleteFile(input).catch(() => undefined)
    void ffmpeg.deleteFile(output).catch(() => undefined)
  }
}

function measureDurationMs(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const probe = document.createElement("video")
    probe.preload = "metadata"
    const done = (ms: number) => {
      URL.revokeObjectURL(url)
      resolve(Math.max(1, ms))
    }
    probe.onloadedmetadata = () =>
      done(Number.isFinite(probe.duration) ? Math.round(probe.duration * 1000) : 0)
    probe.onerror = () => done(0)
    probe.src = url
  })
}
