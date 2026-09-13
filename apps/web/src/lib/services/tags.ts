import "server-only"
import { and, asc, eq } from "drizzle-orm"
import {
  AppError,
  normalizeTagName,
  type TagCreateInput,
  type TagUpdateInput,
} from "@speaking-track/contracts"
import type { Db, DbExecutor } from "@speaking-track/db"
import { tags, topicTags, type Tag } from "@speaking-track/db"

/**
 * Tag services (plan/02 § tags): owner-scoped CRUD with per-owner
 * normalized-name uniqueness mapped to DUPLICATE_TAG/409.
 */

export type TagView = {
  id: string
  name: string
  color: string | null
  createdAt: Date
  updatedAt: Date
}

/** Unique-violation error code PostgreSQL reports for the composite index. */
const UNIQUE_VIOLATION = "23505"

export async function listTags(db: DbExecutor, ownerId: string): Promise<TagView[]> {
  const rows = await db
    .select()
    .from(tags)
    .where(eq(tags.ownerId, ownerId))
    .orderBy(asc(tags.normalizedName))
  return rows.map(toTagView)
}

export async function createTag(db: Db, ownerId: string, input: TagCreateInput): Promise<TagView> {
  const normalizedName = normalizeTagName(input.name)
  try {
    const [row] = await db
      .insert(tags)
      .values({
        ownerId,
        name: input.name.trim(),
        normalizedName,
        color: input.color ?? null,
      })
      .returning()
    if (!row) throw new Error("tag insert returned no row")
    return toTagView(row)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("DUPLICATE_TAG", "A tag with this name already exists.")
    }
    throw error
  }
}

export async function updateTag(
  db: Db,
  ownerId: string,
  tagId: string,
  input: TagUpdateInput,
): Promise<TagView> {
  const existing = await loadOwnedTag(db, ownerId, tagId)
  const name = input.name === undefined ? existing.name : input.name.trim()
  const normalizedName =
    input.name === undefined ? existing.normalizedName : normalizeTagName(input.name)
  const color = input.color === undefined ? existing.color : input.color
  try {
    const [row] = await db
      .update(tags)
      .set({ name, normalizedName, color, updatedAt: new Date() })
      .where(and(eq(tags.id, tagId), eq(tags.ownerId, ownerId)))
      .returning()
    if (!row) throw new Error("tag update returned no row")
    return toTagView(row)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("DUPLICATE_TAG", "A tag with this name already exists.")
    }
    throw error
  }
}

export async function deleteTag(db: Db, ownerId: string, tagId: string): Promise<void> {
  const existing = await loadOwnedTag(db, ownerId, tagId)
  void existing
  await db.transaction(async (tx) => {
    // Topic associations disappear with the tag; topics themselves remain.
    await tx.delete(topicTags).where(eq(topicTags.tagId, tagId))
    await tx.delete(tags).where(and(eq(tags.id, tagId), eq(tags.ownerId, ownerId)))
  })
}

async function loadOwnedTag(db: DbExecutor, ownerId: string, tagId: string): Promise<Tag> {
  const [row] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.ownerId, ownerId)))
    .limit(1)
  if (!row) {
    throw new AppError("RESOURCE_NOT_FOUND", "Tag not found.")
  }
  return row
}

function isUniqueViolation(error: unknown): boolean {
  for (let candidate = error; candidate instanceof Error;) {
    if ((candidate as { code?: string }).code === UNIQUE_VIOLATION) {
      return true
    }
    // drizzle-orm wraps driver errors; the real code rides on .cause.
    candidate = candidate.cause
  }
  return false
}

function toTagView(row: Tag): TagView {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
