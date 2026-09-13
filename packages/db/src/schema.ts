import { relations, sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import {
  APP_ERROR_CODES,
  RECORDING_STATES,
  SINGLETON_YOUTUBE_CONNECTION_ID,
  TAG_COLOR_KEYS,
  YOUTUBE_PRIVACY_STATUSES,
  type JobName,
  type OutboxPayload,
  type RecordingState,
  type Role,
  type SupportedRecordingMimeType,
  type YoutubeConnectionStatus,
  type YoutubePrivacyStatus,
} from "@speaking-track/contracts"

/**
 * Drizzle PostgreSQL schema for Speaking Track.
 *
 * - UUID primary keys and timezone-aware UTC timestamps on application
 *   tables (plan/02 § Database model).
 * - Better Auth owns the auth tables; column names follow the Better Auth
 *   1.7.4 drizzle generator output (core + admin plugin: role, banned,
 *   banReason, banExpires, session.impersonatedBy) so task 03's adapter
 *   configuration validates without remapping.
 * - Values are constrained with CHECK constraints where the shared contract
 *   names a closed set or bound. Check values are compile-time constants.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}

/**
 * CHECK-constraint helpers. Constraint SQL must carry literal values (no
 * bound parameters — DDL is executed verbatim by the migrator) and must not
 * contain a literal `;` (drizzle-kit's serializer truncates check SQL at
 * semicolons). All values below are compile-time constants.
 */

/** `col in ('a', 'b')` for semicolon-free value lists. */
function inList(columnName: string, values: readonly string[]) {
  return sql.raw(`${columnName} in (${values.map((value) => `'${value}'`).join(", ")})`)
}

/** SQL fragment building the `;` separator without a literal semicolon. */
const SQL_SEMICOLON = sql.raw("chr(59)")

/** `video/webm;codecs=<codec>,opus` assembled in SQL. */
function webmMime(codec: "vp9" | "vp8") {
  return sql`concat('video/webm', ${SQL_SEMICOLON}, 'codecs=${sql.raw(codec)},opus')`
}

const charLengthBetween = (columnName: string, min: number, max: number) =>
  sql.raw(`char_length(${columnName}) between ${min} and ${max}`)

const charLengthAtMost = (columnName: string, max: number) =>
  sql.raw(`char_length(${columnName}) <= ${max}`)

// ---------------------------------------------------------------------------
// Better Auth tables (email/password core + admin plugin)
// ---------------------------------------------------------------------------

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    ...timestamps,
    // Application validation constrains writes to exactly "admin" | "user"
    // (Better Auth may store comma-joined multi-role strings; this app never
    // writes them). DB default guarantees a role for every row.
    role: text("role").$type<Role>().notNull().default("user"),
    banned: boolean("banned").default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
  },
  (table) => [index("user_email_idx").on(table.email)],
)

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
)

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
)

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
)

/** Tables Better Auth's drizzle adapter expects, keyed by model name. */
export const authTables = { user, session, account, verification }

// ---------------------------------------------------------------------------
// Application tables
// ---------------------------------------------------------------------------

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Trimmed display value, 1–50 chars. */
    name: text("name").notNull(),
    /** Lowercase, whitespace-collapsed; unique per owner. */
    normalizedName: text("normalized_name").notNull(),
    /** Controlled semantic color key, never arbitrary CSS. */
    color: text("color"),
    ...timestamps,
  },
  (table) => [
    index("tags_owner_id_idx").on(table.ownerId),
    unique("tags_owner_normalized_name_unique").on(table.ownerId, table.normalizedName),
    check("tags_name_length_check", charLengthBetween("name", 1, 50)),
    check("tags_color_key_check", inList("color", TAG_COLOR_KEYS)),
  ],
)

export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("topics_owner_id_idx").on(table.ownerId),
    check("topics_title_length_check", charLengthBetween("title", 1, 160)),
    check("topics_description_length_check", charLengthAtMost("description", 5000)),
  ],
)

export const topicTags = pgTable(
  "topic_tags",
  {
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ name: "topic_tags_pk", columns: [table.topicId, table.tagId] })],
)

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    /** Non-negative integer for stable ordering. */
    position: integer("position").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("questions_topic_id_idx").on(table.topicId),
    index("questions_topic_position_idx").on(table.topicId, table.position),
    check("questions_prompt_length_check", charLengthBetween("prompt", 1, 5000)),
    check("questions_position_nonnegative_check", sql.raw("position >= 0")),
  ],
)

export const drafts = pgTable(
  "drafts",
  {
    /** PK and FK: exactly one draft per question. */
    questionId: uuid("question_id")
      .primaryKey()
      .references(() => questions.id, { onDelete: "cascade" }),
    /** Max 100,000 chars; empty string is valid. */
    content: text("content").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (_table) => [check("drafts_content_length_check", charLengthAtMost("content", 100000))],
)

export const recordings = pgTable(
  "recordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    /** Copied from the owning topic at creation; immutable afterwards. */
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").$type<RecordingState>().notNull(),
    /** Unique private object key; nullable after cleanup. */
    storageKey: text("storage_key").unique(),
    mimeType: text("mime_type").$type<SupportedRecordingMimeType>().notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    youtubeVideoId: text("youtube_video_id").unique(),
    youtubePrivacyStatus: text("youtube_privacy_status").$type<YoutubePrivacyStatus>(),
    youtubeUploadSessionUriEncrypted: text("youtube_upload_session_uri_encrypted"),
    attemptCount: integer("attempt_count").notNull().default(0),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    /** Quota backoff: earliest time the scanner may re-attempt upload. */
    uploadDeferredUntil: timestamp("upload_deferred_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** When the row entered STAGING. */
    stagedAt: timestamp("staged_at", { withTimezone: true }),
    youtubeCreatedAt: timestamp("youtube_created_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Staging retention deadline (createdAt + TEMP_UPLOAD_RETENTION_HOURS). */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    index("recordings_question_id_idx").on(table.questionId),
    index("recordings_owner_id_idx").on(table.ownerId),
    index("recordings_active_staging_idx")
      .on(table.status)
      .where(sql`${table.storageKey} is not null`),
    check("recordings_status_check", inList("status", RECORDING_STATES)),
    check("recordings_size_bytes_nonnegative_check", sql.raw("size_bytes >= 0")),
    check("recordings_duration_ms_positive_check", sql.raw("duration_ms > 0")),
    check("recordings_attempt_count_nonnegative_check", sql.raw("attempt_count >= 0")),
    check(
      "recordings_mime_type_check",
      sql`${table.mimeType} in (${webmMime("vp9")}, ${webmMime("vp8")}, 'video/mp4')`,
    ),
    check("recordings_failure_code_check", inList("failure_code", APP_ERROR_CODES)),
    check(
      "recordings_youtube_privacy_status_check",
      inList("youtube_privacy_status", YOUTUBE_PRIVACY_STATUSES),
    ),
  ],
)

/**
 * Single logical row for the installation's YouTube channel connection.
 * `id` is always {@link SINGLETON_YOUTUBE_CONNECTION_ID}.
 */
export const youtubeConnections = pgTable("youtube_connections", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  channelTitle: text("channel_title").notNull(),
  /** AES-256-GCM envelope (JSON); never plaintext at rest. */
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  scope: text("scope").notNull(),
  status: text("status").$type<YoutubeConnectionStatus>().notNull(),
  connectedByUserId: text("connected_by_user_id")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
})

/** Durable intents bridging PostgreSQL and Redis. */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Queue job name this intent dispatches as. */
    type: text("type").$type<JobName>().notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    payload: jsonb("payload")
      .$type<OutboxPayload>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("outbox_events_pending_idx")
      .on(table.availableAt)
      .where(sql`${table.publishedAt} is null`),
    check("outbox_events_type_check", inList("type", OUTBOX_JOB_NAMES)),
    check("outbox_events_attempts_nonnegative_check", sql.raw("attempts >= 0")),
  ],
)

/**
 * Job names an outbox row may dispatch as. `outbox.dispatch` is the
 * dispatcher itself, never an intent payload.
 */
const OUTBOX_JOB_NAMES: readonly JobName[] = [
  "youtube.upload",
  "youtube.poll-processing",
  "youtube.delete",
  "storage.cleanup",
  "storage.expire-staging",
]

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  tags: many(tags),
  topics: many(topics),
  recordings: many(recordings),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}))

export const tagsRelations = relations(tags, ({ one, many }) => ({
  owner: one(user, { fields: [tags.ownerId], references: [user.id] }),
  topicTags: many(topicTags),
}))

export const topicsRelations = relations(topics, ({ one, many }) => ({
  owner: one(user, { fields: [topics.ownerId], references: [user.id] }),
  questions: many(questions),
  topicTags: many(topicTags),
}))

export const topicTagsRelations = relations(topicTags, ({ one }) => ({
  topic: one(topics, { fields: [topicTags.topicId], references: [topics.id] }),
  tag: one(tags, { fields: [topicTags.tagId], references: [tags.id] }),
}))

export const questionsRelations = relations(questions, ({ one, many }) => ({
  topic: one(topics, { fields: [questions.topicId], references: [topics.id] }),
  recordings: many(recordings),
  draft: one(drafts),
}))

export const recordingsRelations = relations(recordings, ({ one }) => ({
  question: one(questions, { fields: [recordings.questionId], references: [questions.id] }),
  owner: one(user, { fields: [recordings.ownerId], references: [user.id] }),
}))

export const draftsRelations = relations(drafts, ({ one }) => ({
  question: one(questions, { fields: [drafts.questionId], references: [questions.id] }),
}))

export const youtubeConnectionsRelations = relations(youtubeConnections, ({ one }) => ({
  connectedBy: one(user, {
    fields: [youtubeConnections.connectedByUserId],
    references: [user.id],
  }),
}))

/** Full schema object for drizzle(client, { schema }) and adapters. */
export const schema = {
  user,
  session,
  account,
  verification,
  tags,
  topics,
  topicTags,
  questions,
  drafts,
  recordings,
  youtubeConnections,
  outboxEvents,
}

export const schemaRelations = {
  userRelations,
  sessionRelations,
  accountRelations,
  tagsRelations,
  topicsRelations,
  topicTagsRelations,
  questionsRelations,
  recordingsRelations,
  draftsRelations,
  youtubeConnectionsRelations,
}

// Row types -----------------------------------------------------------------

export type User = typeof user.$inferSelect
export type Session = typeof session.$inferSelect
export type Account = typeof account.$inferSelect
export type Verification = typeof verification.$inferSelect
export type Tag = typeof tags.$inferSelect
export type Topic = typeof topics.$inferSelect
export type TopicTag = typeof topicTags.$inferSelect
export type Question = typeof questions.$inferSelect
export type Draft = typeof drafts.$inferSelect
export type Recording = typeof recordings.$inferSelect
export type NewRecording = typeof recordings.$inferInsert
export type YoutubeConnection = typeof youtubeConnections.$inferSelect
export type OutboxEvent = typeof outboxEvents.$inferSelect
export type NewOutboxEvent = typeof outboxEvents.$inferInsert

export { SINGLETON_YOUTUBE_CONNECTION_ID }
