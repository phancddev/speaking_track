# Shared contracts

This document fixes cross-task names and behavior. Task 02 implements these contracts before parallel feature work begins.

## Database model

Use UUID primary keys and timezone-aware UTC timestamps. Better Auth owns its required auth tables and fields; application tables use the names below.

### Authentication

Better Auth user records include a role constrained by application validation to:

```ts
type Role = "admin" | "user"
```

Default role is `user`. At least one admin must remain active; operations that would remove/demote/ban the final active admin return `LAST_ADMIN_REQUIRED`.

Public sign-up must be rejected server-side, not merely hidden. User creation is performed through an authenticated admin service using Better Auth's admin API/plugin.

### `tags`

| Column | Contract |
|---|---|
| `id` | UUID PK |
| `ownerId` | FK to user; indexed |
| `name` | trimmed display value, 1–50 chars |
| `normalizedName` | lowercase, whitespace-collapsed value |
| `color` | nullable controlled semantic color key, not arbitrary CSS |
| timestamps | `createdAt`, `updatedAt` |

Unique: `(ownerId, normalizedName)`. Names are otherwise unrestricted; `Part 1` has no special meaning.

### `topics`

| Column | Contract |
|---|---|
| `id` | UUID PK |
| `ownerId` | FK to user; indexed |
| `title` | trimmed, 1–160 chars |
| `description` | nullable text, max 5,000 chars |
| `deletedAt` | nullable soft-delete timestamp |
| timestamps | `createdAt`, `updatedAt` |

### `topicTags`

Composite uniqueness `(topicId, tagId)`. Service validation requires topic and tag to have the same owner. Topic update accepts the full intended `tagIds` set and synchronizes atomically.

### `questions`

| Column | Contract |
|---|---|
| `id` | UUID PK |
| `topicId` | FK; indexed |
| `prompt` | trimmed, 1–5,000 chars |
| `position` | non-negative integer used for stable ordering |
| `deletedAt` | nullable soft-delete timestamp |
| timestamps | `createdAt`, `updatedAt` |

Ownership derives from the topic but service queries must join/filter ownership in the database query rather than load then trust a URL ID. Reordering updates all affected positions transactionally.

### `drafts`

| Column | Contract |
|---|---|
| `questionId` | PK and FK |
| `content` | text, max 100,000 chars; empty string is valid |
| `updatedAt` | UTC timestamp |

One explicit `PUT` upserts the complete draft. Initial scope has no draft revisions or autosave.

### `recordings`

| Column | Contract |
|---|---|
| `id` | UUID PK |
| `questionId` | FK; indexed |
| `ownerId` | FK to user; indexed and immutable |
| `status` | recording state constant |
| `storageKey` | unique private object key; nullable after cleanup |
| `mimeType` | validated recorded media type |
| `sizeBytes` | non-negative bigint after init/verification |
| `durationMs` | positive integer supplied by client and bounded by config |
| `youtubeVideoId` | unique nullable string |
| `youtubePrivacyStatus` | nullable returned/effective privacy status |
| `youtubeUploadSessionUriEncrypted` | nullable; encrypted resumable session URI if persistence is implemented |
| `attemptCount` | non-negative integer |
| `failureCode` | nullable stable application error code |
| `failureMessage` | nullable user-safe summary; no tokens/provider response bodies |
| timestamps | `createdAt`, `updatedAt`, `stagedAt`, `youtubeCreatedAt`, `readyAt`, `deletedAt` as applicable |

`ownerId` is copied from the owning topic at recording creation to make authorization and storage prefixing direct. A database constraint/service invariant prevents a mismatch.

### `youtubeConnections`

Single logical row for the installation:

| Column | Contract |
|---|---|
| `id` | fixed singleton identifier |
| `channelId`, `channelTitle` | verified through YouTube API |
| `encryptedRefreshToken` | AES-256-GCM envelope; never plaintext at rest |
| `scope` | granted scopes |
| `status` | `CONNECTED`, `REAUTH_REQUIRED`, `DISCONNECTED` |
| `connectedByUserId` | admin FK |
| timestamps | `createdAt`, `updatedAt`, `lastVerifiedAt` |

### `outboxEvents`

Durable intents bridging PostgreSQL and Redis:

| Column | Contract |
|---|---|
| `id` | UUID PK |
| `type` | queue job name |
| `aggregateId` | recording ID or relevant aggregate ID |
| `payload` | JSON validated by shared payload schema |
| `availableAt` | dispatch time |
| `publishedAt` | nullable successful Redis enqueue time |
| `attempts`, `lastError` | dispatch bookkeeping |
| `createdAt` | UTC timestamp |

A transaction changes domain state and inserts the outbox row. A dispatcher uses `FOR UPDATE SKIP LOCKED`, enqueues with deterministic BullMQ `jobId`, and marks the event published. Duplicate dispatch is safe because job IDs and workers are idempotent.

## Recording state machine

```text
STAGING
  -> QUEUED
  -> YOUTUBE_UPLOADING
  -> YOUTUBE_PROCESSING
  -> READY

STAGING -> EXPIRED
QUEUED | YOUTUBE_UPLOADING | YOUTUBE_PROCESSING -> FAILED
YOUTUBE_UPLOADING -> QUEUED             (quota exhaustion; deferred re-scan)
FAILED -> QUEUED                       (manual retry when source exists)
any non-DELETED state -> DELETE_PENDING -> DELETED
```

Rules:

- `STAGING`: row and presigned PUT exist; object has not yet been verified.
- `QUEUED`: object metadata was verified. The upload intent may arrive from completion directly or from the periodic deferred-upload scanner (initial delivery plus quota-reset retries); at most one unpublished `youtube.upload` outbox event exists per recording.
- `YOUTUBE_UPLOADING`: worker owns the attempt. A stale lock may be recovered.
- `YOUTUBE_PROCESSING`: `youtubeVideoId` exists; no second `videos.insert` is allowed.
- `READY`: YouTube reports successful processing, effective visibility is `unlisted`, and embed is allowed. The source object is RETAINED in storage so the app can stream playback locally; source cleanup happens only via user delete.
- Quota deferral: on `YOUTUBE_QUOTA_EXCEEDED` the recording returns to `QUEUED` with `uploadDeferredUntil` set past the next midnight Pacific reset. The worker's periodic scanner re-emits the `youtube.upload` intent once the deferral lapses; the recording stays playable from storage the whole time.
- `FAILED`: terminal/retry-exhausted application failure with a stable code. If the YouTube ID already exists, retry resumes status handling rather than inserting again. `YOUTUBE_UPLOAD_AMBIGUOUS` blocks ordinary retry to avoid creating a duplicate after an unknowable provider outcome.
- `EXPIRED`: staging completion was never confirmed before retention deadline.
- `DELETE_PENDING`: hidden from normal lists while cleanup is performed.
- `DELETED`: tombstone contains no playable URL or storage key.

Every transition uses a compare-and-set update on expected current state. Invalid transitions return `INVALID_RECORDING_STATE` and perform no side effect.

## Queue contract

Queue names:

```ts
const QUEUES = {
  youtube: "youtube",
  maintenance: "maintenance",
} as const
```

Job names and payloads:

```ts
type RecordingJob = { recordingId: string }

"youtube.upload"             // youtube queue; RecordingJob
"youtube.poll-processing"    // youtube queue; RecordingJob
"youtube.delete"             // youtube queue; RecordingJob
"storage.cleanup"            // maintenance queue; RecordingJob
"storage.expire-staging"     // maintenance queue; no user payload
"outbox.dispatch"            // maintenance loop/job; no arbitrary payload
```

Deterministic job IDs:

```text
youtube-upload:<recordingId>
youtube-poll:<recordingId>
youtube-delete:<recordingId>
storage-cleanup:<recordingId>
```

Upload and delete handlers use exponential backoff with jitter for transient failures. `quotaExceeded` manually rate-limits/delays the upload queue until the next Pacific-time reset boundary. Authentication failures mark the YouTube connection `REAUTH_REQUIRED` and fail affected recordings with `YOUTUBE_REAUTH_REQUIRED`; they are not hot-loop retried.

## Storage contract

Bucket is private. Object key:

```text
recordings/<ownerId>/<recordingId>/source.<validated-extension>
```

Public package operations:

```ts
type CreateUploadInput = {
  ownerId: string
  recordingId: string
  mimeType: SupportedRecordingMimeType
  sizeBytes: number
}

type PresignedUpload = {
  objectKey: string
  url: string
  method: "PUT"
  headers: Record<string, string>
  expiresAt: string
}

createPresignedUpload(input): Promise<PresignedUpload>
statPrivateObject(objectKey): Promise<{ sizeBytes: number; contentType: string; etag: string }>
getPrivateObjectStream(objectKey): Promise<NodeJS.ReadableStream>
deletePrivateObject(objectKey): Promise<void>
```

Presigned URLs are short-lived and returned only to the owning user/admin. Completion verifies exact object key, byte count, and content type against the row. A client can never nominate an arbitrary bucket key.

Initial delivery uses one presigned PUT after recording stops. Multipart/live chunk upload is explicitly deferred; `MAX_RECORDING_BYTES` bounds browser memory and object size.

## Media contract

The recorder selects the first supported candidate using `MediaRecorder.isTypeSupported()` from a centrally ordered list, for example WebM/VP9+Opus, WebM/VP8+Opus, then MP4 where supported. The selected value, Blob type, request metadata, stored object content type, and YouTube upload content type must agree.

Client supplies duration for display and initial validation. Server trusts neither duration nor size for authorization; it validates configured bounds and verifies stored size before queueing. Initial scope does not run FFmpeg.

## Custom HTTP API contract

Custom endpoints return JSON:

```ts
type Success<T> = { data: T }
type Failure = {
  error: {
    code: string
    message: string
    fieldErrors?: Record<string, string[]>
    requestId: string
  }
}
```

Better Auth endpoints keep Better Auth's native response contract.

Status mapping:

- `400`: schema/validation error.
- `401`: no valid session.
- `403`: authenticated but insufficient role/ownership.
- `404`: missing resource or resource hidden by ownership filter.
- `409`: uniqueness/state transition conflict.
- `413`: recording exceeds configured size.
- `429`: storage/quota/backpressure prevents new upload.
- `500`: unexpected server error with safe message and request ID.

### Tags

```text
GET    /api/tags
POST   /api/tags
PATCH  /api/tags/:tagId
DELETE /api/tags/:tagId
```

Deleting a tag removes topic associations but not topics.

### Topics and questions

```text
GET    /api/topics?q=&tagIds=&ownerId=          # ownerId accepted only for admin
POST   /api/topics
GET    /api/topics/:topicId
PATCH  /api/topics/:topicId                    # includes full tagIds set when supplied
DELETE /api/topics/:topicId
GET    /api/topics/:topicId/questions
POST   /api/topics/:topicId/questions
PATCH  /api/questions/:questionId
DELETE /api/questions/:questionId
PUT    /api/topics/:topicId/questions/reorder
PUT    /api/questions/:questionId/draft
```

Normal-user list APIs bind owner from the session. Admin data browsing supplies an explicit `ownerId`; absence means the admin's own data, not all users merged together.

### Recordings

```text
GET    /api/questions/:questionId/recordings
POST   /api/questions/:questionId/recordings/uploads
POST   /api/recordings/:recordingId/complete
POST   /api/recordings/:recordingId/retry
DELETE /api/recordings/:recordingId
```

Create-upload input includes `mimeType`, `sizeBytes`, and `durationMs` after local recording has stopped. Response contains recording summary plus `PresignedUpload`. Completion is idempotent: repeating it after `QUEUED` returns the current recording without adding a second outbox intent.

### Admin users

```text
GET    /api/admin/users
POST   /api/admin/users
PATCH  /api/admin/users/:userId
POST   /api/admin/users/:userId/set-password
DELETE /api/admin/users/:userId
```

These wrap supported Better Auth admin operations and enforce final-admin protection.

### YouTube administration

```text
GET    /api/admin/youtube/status
GET    /api/admin/youtube/connect
GET    /api/admin/youtube/callback
POST   /api/admin/youtube/disconnect
GET    /api/admin/queue/summary
GET    /api/admin/queue/failures
```

OAuth callback validates state, requires the initiating admin session, requests offline access, verifies the selected channel, encrypts the refresh token, and redirects to a safe fixed admin route. No arbitrary callback URL is accepted.

## Authorization helpers

Task 03 exposes and all services reuse:

```ts
requireSession(requestHeaders): Promise<AppSession>
requireAdmin(requestHeaders): Promise<AppSession & { user: { role: "admin" } }>
resolveOwnerScope(session, requestedOwnerId?): string
assertOwnerOrAdmin(session, ownerId): void
```

Route-level optimistic redirects are not authorization. Database-backed session and ownership checks remain mandatory in route handlers/server actions/services.

## Stable application error codes

At minimum:

```text
AUTH_REQUIRED
ADMIN_REQUIRED
RESOURCE_NOT_FOUND
DUPLICATE_TAG
LAST_ADMIN_REQUIRED
VALIDATION_FAILED
RECORDING_TOO_LARGE
UNSUPPORTED_MEDIA_TYPE
STORAGE_CAPACITY_LOW
UPLOAD_NOT_FOUND
UPLOAD_METADATA_MISMATCH
INVALID_RECORDING_STATE
YOUTUBE_NOT_CONNECTED
YOUTUBE_REAUTH_REQUIRED
YOUTUBE_QUOTA_EXCEEDED
YOUTUBE_PRIVATE_RESTRICTION
YOUTUBE_UPLOAD_AMBIGUOUS
YOUTUBE_PROCESSING_FAILED
EXTERNAL_SERVICE_UNAVAILABLE
```
