import { z } from "zod"
import { SupportedRecordingMimeTypeSchema } from "./media"

/**
 * Request DTO schemas for tags, topics, questions, drafts, and recording
 * upload creation. Column bounds come verbatim from plan/02 § Database
 * model. All schemas are strict: unknown keys are rejected.
 */

/**
 * Controlled semantic color keys for tags — a fixed vocabulary, never
 * arbitrary CSS (which would be an injection channel).
 */
export const TAG_COLOR_KEYS = [
  "neutral",
  "red",
  "orange",
  "amber",
  "yellow",
  "green",
  "teal",
  "cyan",
  "blue",
  "violet",
  "purple",
  "pink",
] as const

export type TagColorKey = (typeof TAG_COLOR_KEYS)[number]

export const TagColorKeySchema = z.enum(TAG_COLOR_KEYS)

/** Lowercases and collapses all whitespace runs to single spaces. */
export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ")
}

const tagNameField = z
  .string()
  .trim()
  .min(1, "tag name must not be empty")
  .max(50, "tag name must be at most 50 characters")

export const TagCreateSchema = z.strictObject({
  name: tagNameField,
  color: TagColorKeySchema.nullable().optional(),
})

export const TagUpdateSchema = z
  .strictObject({
    name: tagNameField.optional(),
    color: TagColorKeySchema.nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.color !== undefined, {
    message: "at least one of name or color must be supplied",
  })

export type TagCreateInput = z.infer<typeof TagCreateSchema>
export type TagUpdateInput = z.infer<typeof TagUpdateSchema>

const tagIdsField = z.array(z.uuid()).max(100).optional()

export const TopicCreateSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(5000).nullable().optional(),
  tagIds: tagIdsField,
})

export const TopicUpdateSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().max(5000).nullable().optional(),
    /** Full intended tag set; applied atomically by the service. */
    tagIds: tagIdsField,
  })
  .refine(
    (value) =>
      value.title !== undefined || value.description !== undefined || value.tagIds !== undefined,
    {
      message: "at least one field must be supplied",
    },
  )

export type TopicCreateInput = z.infer<typeof TopicCreateSchema>
export type TopicUpdateInput = z.infer<typeof TopicUpdateSchema>

export const QuestionCreateSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(5000),
  position: z.number().int().min(0).optional(),
})

export const QuestionUpdateSchema = z
  .strictObject({
    prompt: z.string().trim().min(1).max(5000).optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((value) => value.prompt !== undefined || value.position !== undefined, {
    message: "at least one of prompt or position must be supplied",
  })

export type QuestionCreateInput = z.infer<typeof QuestionCreateSchema>
export type QuestionUpdateInput = z.infer<typeof QuestionUpdateSchema>

/** Optional draft label; empty strings normalize to null. */
const draftTitle = z
  .string()
  .max(200)
  .transform((value) => (value.trim() === "" ? null : value))

/** Draft create: a question may hold many drafts; content max 100,000 chars. */
export const DraftCreateSchema = z.strictObject({
  title: draftTitle.optional(),
  content: z.string().max(100000),
})

/**
 * Draft update: partial by field. `title: null` clears the label while
 * omitting it leaves the label untouched.
 */
export const DraftUpdateSchema = z
  .strictObject({
    title: draftTitle.nullable().optional(),
    content: z.string().max(100000).optional(),
  })
  .refine((value) => value.title !== undefined || value.content !== undefined, {
    message: "Provide at least one field to update.",
  })

export type DraftCreateInput = z.infer<typeof DraftCreateSchema>
export type DraftUpdateInput = z.infer<typeof DraftUpdateSchema>

/**
 * Create-upload request after local recording stops. `sizeBytes` is bounded
 * by the configured `MAX_RECORDING_BYTES` and `durationMs` by the
 * configured duration limit (both supplied by the caller — no package reads
 * process.env implicitly).
 */
export function createRecordingUploadRequestSchema(limits: {
  maxRecordingBytes: number
  maxDurationMs?: number
}) {
  return z.strictObject({
    mimeType: SupportedRecordingMimeTypeSchema,
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(limits.maxRecordingBytes, "recording exceeds configured size limit"),
    durationMs:
      limits.maxDurationMs === undefined
        ? z.number().int().positive()
        : z
            .number()
            .int()
            .positive()
            .max(limits.maxDurationMs, "recording exceeds configured duration limit"),
  })
}

export type RecordingUploadRequest = {
  mimeType: z.infer<typeof SupportedRecordingMimeTypeSchema>
  sizeBytes: number
  durationMs: number
}
