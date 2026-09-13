# Product scope

## Goal

Speaking Track is a private, multi-user study application for organizing speaking prompts, saving draft ideas, recording webcam practice, and reviewing each attempt after it is transferred to YouTube.

## Actors

### User

- Logs in with an account created by an administrator.
- Creates and manages only their own tags, topics, questions, drafts, and recordings.
- Can attach any number of tags to a topic.
- Can create multiple recordings for a question.
- Can see recording upload/processing status and retry recoverable failures.

### Admin

- Has every user capability for the admin's own study data.
- Creates, updates, disables/bans, resets access for, and deletes system users through Better Auth-supported operations.
- Can select a user and inspect/manage that user's tags, topics, questions, drafts, and recordings.
- Connects the single YouTube channel used by the system.
- Observes queue health and failed jobs, then retries supported failures.

Admin access never changes ownership implicitly. An admin editing another user's resource keeps that resource owned by the original user.

## Core information model

- **Tag:** Free-form user-owned label such as `Part 1`, `Travel`, or `Work`. No reserved names and no IELTS-specific enum.
- **Topic:** User-owned collection with a title, optional description, and zero or more tags.
- **Question:** Ordered prompt inside one topic.
- **Draft:** One persisted free-form text document per question.
- **Recording:** One webcam/microphone attempt for a question. A question may have any number of recording rows.
- **YouTube connection:** One admin-managed channel authorization for the whole installation.

## Required journeys

### Account bootstrap and login

1. Deployment creates the first admin through an explicit seed/bootstrap command using environment-supplied credentials.
2. No public registration page or usable public sign-up endpoint exists.
3. The admin creates user accounts.
4. A user logs in with email and password and reaches their library.

### Organize study material

1. User creates tags freely.
2. User creates a topic and assigns any subset of their tags.
3. User creates, edits, reorders, and deletes questions inside the topic.
4. Filtering by multiple tags returns topics that match all selected tags.

### Save a draft

1. User opens a question practice page.
2. User edits the draft text and explicitly saves it.
3. Refreshing or reopening the question restores the saved text.
4. A save failure leaves the editor content intact and provides a retryable error.

### Record and review

1. User explicitly starts camera/microphone access.
2. User previews the stream, starts recording, sees elapsed time, and stops recording.
3. User reviews the local capture and chooses upload or discard.
4. Upload sends the media directly to private MinIO/S3-compatible storage.
5. Completion verification queues a YouTube upload.
6. The UI shows durable states until YouTube reports success or a real failure.
7. Once ready, the attempt is played with the standard YouTube embedded player.

## Privacy semantics

- YouTube `private` does not mean "anyone with a link." It requires the owning/invited Google account and is not the playback target for normal application users.
- YouTube `unlisted` permits link/iframe playback. Anyone who obtains the video ID or link can view it; application RBAC cannot revoke a leaked YouTube URL.
- Every UI location that exposes an unlisted video requires application authorization, but this is access control around the app, not DRM around YouTube.
- Staging buckets are private. Only short-lived presigned operations may access an object.
- The product must clearly disclose camera/microphone use and YouTube transfer.

## Initial scope

Included:

- Responsive web application.
- Email/password login, sessions, two roles, admin-created accounts.
- User-owned tags/topics/questions/drafts/recordings.
- Camera and microphone recording through browser APIs.
- Direct presigned upload to MinIO-compatible object storage.
- Durable Redis queue, YouTube OAuth, resumable upload, processing polling, retry, cleanup.
- Admin user/data/YouTube/queue surfaces.
- Docker Compose local and production-shaped deployment.

Excluded unless the plan is revised:

- Public registration, social login, email verification, password-reset email delivery.
- AI scoring, transcription, pronunciation analysis, or automatic feedback.
- Live classes, collaboration, comments, sharing, or public profiles.
- Native mobile applications.
- Custom video transcoding, HLS, captions, thumbnails, or permanent MinIO playback.
- Per-user YouTube channels.
- Importing question banks or scraping IELTS content.
- Hard-coded Part tags or IELTS-specific assessment logic.

## Operational constraints

- `getUserMedia()` requires HTTPS outside localhost.
- Number of recording rows per question is unlimited at the product layer, but individual file size/duration and available staging capacity are configurable operational limits.
- The default YouTube API upload bucket currently allows 100 `videos.insert` calls per day. Queued work may therefore remain staged until quota is available.
- API projects not approved by YouTube can have uploads forced to `private`; such a recording is not `READY` for ordinary embedded playback.
- An OAuth consent screen in external `Testing` status can issue refresh tokens that expire after seven days. Production must use an appropriately published/approved OAuth configuration.

## Success criteria

- No cross-user read or write path exists for a normal user.
- A successful recording journey does not proxy the media body through Next.js.
- A worker restart or job retry does not create duplicate YouTube uploads.
- Source media remains recoverable while upload/processing can still fail and is removed after successful terminal processing.
- The interface always distinguishes local upload, queued, YouTube upload, YouTube processing, ready, and failed states.
