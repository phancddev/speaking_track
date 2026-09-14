import { describe, expect, it } from "vitest"
import {
  APP_ERROR_CODES,
  AppError,
  ConfigurationError,
  DraftCreateSchema,
  DraftUpdateSchema,
  EmptyJobSchema,
  JOB_NAMES,
  JOB_PAYLOAD_SCHEMAS,
  QUEUES,
  QuestionCreateSchema,
  RECORDING_MIME_EXTENSION,
  RECORDING_OBJECT_KEY_PATTERN,
  RECORDING_TRANSITIONS,
  RecordingJobSchema,
  RecordingObjectKeySchema,
  RecordingStateSchema,
  RoleSchema,
  SUPPORTED_RECORDING_MIME_TYPES,
  SupportedRecordingMimeTypeSchema,
  TagCreateSchema,
  TagUpdateSchema,
  TopicCreateSchema,
  YoutubeConnectionStatusSchema,
  canTransitionRecording,
  createRecordingUploadRequestSchema,
  failure,
  isAppErrorCode,
  normalizeTagName,
} from "../src/index"

describe("role contract", () => {
  it("accepts exactly admin and user and rejects anything else", () => {
    expect(RoleSchema.parse("admin")).toBe("admin")
    expect(RoleSchema.parse("user")).toBe("user")
    expect(RoleSchema.safeParse("superuser").success).toBe(false)
    expect(RoleSchema.safeParse("").success).toBe(false)
    expect(RoleSchema.safeParse(1).success).toBe(false)
  })
})

describe("recording state contract", () => {
  it("rejects unknown recording states", () => {
    expect(RecordingStateSchema.safeParse("UPLOADING").success).toBe(false)
    expect(RecordingStateSchema.safeParse("queued").success).toBe(false)
    expect(RecordingStateSchema.safeParse(null).success).toBe(false)
  })

  it("allows exactly the shared transition table", () => {
    expect(canTransitionRecording("STAGING", "QUEUED")).toBe(true)
    expect(canTransitionRecording("STAGING", "EXPIRED")).toBe(true)
    expect(canTransitionRecording("QUEUED", "YOUTUBE_UPLOADING")).toBe(true)
    expect(canTransitionRecording("FAILED", "QUEUED")).toBe(true)
    expect(canTransitionRecording("DELETE_PENDING", "DELETED")).toBe(true)

    // Invalid transitions from the contract.
    expect(canTransitionRecording("STAGING", "READY")).toBe(false)
    expect(canTransitionRecording("DELETED", "QUEUED")).toBe(false)
    expect(canTransitionRecording("READY", "QUEUED")).toBe(false)
    expect(canTransitionRecording("QUEUED", "QUEUED")).toBe(false)
    expect(canTransitionRecording("EXPIRED", "QUEUED")).toBe(false)

    // Every non-DELETED state can enter DELETE_PENDING; only DELETE_PENDING
    // may enter DELETED, which is terminal.
    for (const from of Object.keys(
      RECORDING_TRANSITIONS,
    ) as (keyof typeof RECORDING_TRANSITIONS)[]) {
      if (from !== "DELETE_PENDING" && from !== "DELETED") {
        expect(canTransitionRecording(from, "DELETE_PENDING")).toBe(true)
      }
      if (from !== "DELETE_PENDING" && from !== "DELETED") {
        expect(canTransitionRecording(from, "DELETED")).toBe(false)
      }
    }
  })
})

describe("queue contract", () => {
  it("exposes exactly two queues and six job names", () => {
    expect(QUEUES).toEqual({ youtube: "youtube", maintenance: "maintenance" })
    expect(JOB_NAMES).toHaveLength(6)
  })

  it("RecordingJob carries recordingId only and rejects extra payload", () => {
    expect(
      RecordingJobSchema.parse({ recordingId: "00000000-0000-4000-8000-000000000001" }),
    ).toEqual({
      recordingId: "00000000-0000-4000-8000-000000000001",
    })
    expect(
      RecordingJobSchema.safeParse({
        recordingId: "00000000-0000-4000-8000-000000000001",
        oauthToken: "leak",
      }).success,
    ).toBe(false)
    expect(RecordingJobSchema.safeParse({ recordingId: "not-a-uuid" }).success).toBe(false)
  })

  it("maintenance jobs accept no arbitrary payload", () => {
    expect(EmptyJobSchema.parse({})).toEqual({})
    expect(
      EmptyJobSchema.safeParse({ recordingId: "00000000-0000-4000-8000-000000000001" }).success,
    ).toBe(false)
    expect(JOB_PAYLOAD_SCHEMAS["storage.expire-staging"].safeParse({ anything: 1 }).success).toBe(
      false,
    )
    expect(JOB_PAYLOAD_SCHEMAS["outbox.dispatch"].safeParse({ anything: 1 }).success).toBe(false)
  })

  it("rejects unknown job payload schemas for recording jobs", () => {
    expect(JOB_PAYLOAD_SCHEMAS["youtube.upload"].safeParse({}).success).toBe(false)
    expect(JOB_PAYLOAD_SCHEMAS["storage.cleanup"].safeParse({ recordingId: 42 }).success).toBe(
      false,
    )
  })
})

describe("media contract", () => {
  it("keeps the ordered WebM/VP9, WebM/VP8, MP4 list with extension mapping", () => {
    expect(SUPPORTED_RECORDING_MIME_TYPES).toEqual([
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/mp4",
    ])
    expect(RECORDING_MIME_EXTENSION["video/webm;codecs=vp9,opus"]).toBe("webm")
    expect(RECORDING_MIME_EXTENSION["video/mp4"]).toBe("mp4")
  })

  it("rejects unsupported media types", () => {
    expect(SupportedRecordingMimeTypeSchema.safeParse("video/avi").success).toBe(false)
    expect(SupportedRecordingMimeTypeSchema.safeParse("video/webm").success).toBe(false)
    expect(SupportedRecordingMimeTypeSchema.safeParse("audio/webm;codecs=opus").success).toBe(false)
    expect(SupportedRecordingMimeTypeSchema.safeParse("video/webm;codecs=vp9,opus").success).toBe(
      true,
    )
  })
})

describe("object key contract", () => {
  it("accepts only the exact generated key format", () => {
    expect(
      RecordingObjectKeySchema.safeParse(
        "recordings/00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-00000000000b/source.webm",
      ).success,
    ).toBe(true)
    expect(
      RecordingObjectKeySchema.safeParse(
        "recordings/00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-00000000000b/source.mp4",
      ).success,
    ).toBe(true)
  })

  it("rejects unsafe object keys", () => {
    const owner = "00000000-0000-4000-8000-00000000000a"
    const rec = "00000000-0000-4000-8000-00000000000b"
    expect(
      RecordingObjectKeySchema.safeParse(`recordings/${owner}/${rec}/source.exe`).success,
    ).toBe(false)
    expect(
      RecordingObjectKeySchema.safeParse(`recordings/${owner}/${rec}/../source.webm`).success,
    ).toBe(false)
    expect(
      RecordingObjectKeySchema.safeParse(`other-prefix/${owner}/${rec}/source.webm`).success,
    ).toBe(false)
    expect(RecordingObjectKeySchema.safeParse("recordings/*/*/source.webm").success).toBe(false)
    expect(RecordingObjectKeySchema.safeParse("").success).toBe(false)
    expect(RECORDING_OBJECT_KEY_PATTERN.test(`recordings/${owner}/${rec}/source.webm`)).toBe(true)
  })
})

describe("DTO bounds", () => {
  it("tag name is 1-50 after trim; color is a controlled key", () => {
    expect(TagCreateSchema.safeParse({ name: "  Part 1  " }).success).toBe(true)
    expect(TagCreateSchema.parse({ name: "  Part 1  " }).name).toBe("Part 1")
    expect(TagCreateSchema.safeParse({ name: "" }).success).toBe(false)
    expect(TagCreateSchema.safeParse({ name: " ".repeat(51) }).success).toBe(false)
    expect(TagCreateSchema.safeParse({ name: "ok", color: "background:red" }).success).toBe(false)
    expect(TagCreateSchema.safeParse({ name: "ok", color: "teal" }).success).toBe(true)
    expect(TagCreateSchema.safeParse({ name: "ok", color: null }).success).toBe(true)
    expect(TagUpdateSchema.safeParse({}).success).toBe(false)
    expect(TagCreateSchema.safeParse({ name: "ok", oops: true }).success).toBe(false)
  })

  it("normalizes tag names to lowercase with collapsed whitespace", () => {
    expect(normalizeTagName("  Part   ONE \n two ")).toBe("part one two")
  })

  it("topic title 1-160 and description max 5000", () => {
    expect(TopicCreateSchema.safeParse({ title: "Work" }).success).toBe(true)
    expect(TopicCreateSchema.safeParse({ title: "x".repeat(161) }).success).toBe(false)
    expect(TopicCreateSchema.safeParse({ title: "t", description: "d".repeat(5001) }).success).toBe(
      false,
    )
    expect(TopicCreateSchema.safeParse({ title: "t", description: null }).success).toBe(true)
  })

  it("question prompt 1-5000 and position non-negative integer", () => {
    expect(QuestionCreateSchema.safeParse({ prompt: "Describe a city" }).success).toBe(true)
    expect(QuestionCreateSchema.safeParse({ prompt: "" }).success).toBe(false)
    expect(QuestionCreateSchema.safeParse({ prompt: "p".repeat(5001) }).success).toBe(false)
    expect(QuestionCreateSchema.safeParse({ prompt: "p", position: 0 }).success).toBe(true)
    expect(QuestionCreateSchema.safeParse({ prompt: "p", position: -1 }).success).toBe(false)
    expect(QuestionCreateSchema.safeParse({ prompt: "p", position: 1.5 }).success).toBe(false)
  })

  it("draft create: content max 100000, blank titles normalize to null", () => {
    expect(DraftCreateSchema.safeParse({ content: "" }).success).toBe(true)
    expect(DraftCreateSchema.safeParse({ title: "  ", content: "x" }).data?.title).toBeNull()
    expect(
      DraftCreateSchema.safeParse({ title: "t".repeat(200), content: "x".repeat(100000) }).success,
    ).toBe(true)
    expect(DraftCreateSchema.safeParse({ title: "t".repeat(201), content: "x" }).success).toBe(
      false,
    )
    expect(DraftCreateSchema.safeParse({ content: "x".repeat(100001) }).success).toBe(false)
  })

  it("draft update: null clears title, omitted fields stay, at least one field", () => {
    expect(DraftUpdateSchema.safeParse({ title: null }).success).toBe(true)
    expect(DraftUpdateSchema.safeParse({ content: "v2" }).success).toBe(true)
    expect(DraftUpdateSchema.safeParse({}).success).toBe(false)
    expect(DraftUpdateSchema.safeParse({ title: "  " }).data?.title).toBeNull()
  })

  it("recording upload request enforces supported mime, size, and duration bounds", () => {
    const schema = createRecordingUploadRequestSchema({
      maxRecordingBytes: 1000,
      maxDurationMs: 60000,
    })
    expect(
      schema.safeParse({ mimeType: "video/webm;codecs=vp9,opus", sizeBytes: 1000, durationMs: 1 })
        .success,
    ).toBe(true)
    expect(schema.safeParse({ mimeType: "video/avi", sizeBytes: 10, durationMs: 1 }).success).toBe(
      false,
    )
    expect(
      schema.safeParse({ mimeType: "video/mp4", sizeBytes: 1001, durationMs: 1 }).success,
    ).toBe(false)
    expect(schema.safeParse({ mimeType: "video/mp4", sizeBytes: 10, durationMs: 0 }).success).toBe(
      false,
    )
    expect(
      schema.safeParse({ mimeType: "video/mp4", sizeBytes: 10, durationMs: 61000 }).success,
    ).toBe(false)
  })
})

describe("error and envelope contract", () => {
  it("keeps the stable error code list verbatim", () => {
    expect(APP_ERROR_CODES).toHaveLength(19)
    expect(APP_ERROR_CODES).toContain("INVALID_RECORDING_STATE")
    expect(APP_ERROR_CODES).toContain("YOUTUBE_UPLOAD_AMBIGUOUS")
    expect(APP_ERROR_CODES).toContain("EXTERNAL_SERVICE_UNAVAILABLE")
    expect(isAppErrorCode("NOPE")).toBe(false)
    expect(isAppErrorCode("STORAGE_CAPACITY_LOW")).toBe(true)
  })

  it("AppError and failure envelope carry code, message, and request id", () => {
    const error = new AppError("INVALID_RECORDING_STATE", "not in STAGING", {
      fieldErrors: { status: ["cannot transition"] },
    })
    expect(error.code).toBe("INVALID_RECORDING_STATE")
    expect(error.fieldErrors?.status).toEqual(["cannot transition"])
    const envelope = failure("RESOURCE_NOT_FOUND", "missing", "req-1")
    expect(envelope).toEqual({
      error: { code: "RESOURCE_NOT_FOUND", message: "missing", requestId: "req-1" },
    })
  })

  it("youtube connection statuses are the closed three-value set", () => {
    expect(YoutubeConnectionStatusSchema.parse("CONNECTED")).toBe("CONNECTED")
    expect(YoutubeConnectionStatusSchema.safeParse("PENDING").success).toBe(false)
  })
})

describe("configuration helpers", () => {
  it("aggregates every problem into one ConfigurationError", () => {
    const error = new ConfigurationError(["S3_BUCKET: must not be empty", "REDIS_URL: required"])
    expect(error.name).toBe("ConfigurationError")
    expect(error.problems).toHaveLength(2)
    expect(error.message).toContain("S3_BUCKET")
  })
})
