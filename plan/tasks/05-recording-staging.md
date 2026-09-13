# Task 05: Recording capture contract and staging storage

## Objective

Implement the owner-safe recording upload lifecycle from a completed browser Blob to verified private object storage and durable queue intent.

## Dependencies

Tasks 01 and 02 merged. May run in parallel with tasks 03, 04, and 06.

## Ownership

- Recording application services and custom endpoints for create-upload, completion, retry, deletion, and recording lists.
- Client-side media capability utilities and direct presigned PUT transport with progress/cancellation.
- Reusable headless recorder/upload state utilities under the recording feature.

Task 07 owns the final practice-page recorder UI. Task 06 owns YouTube processors and remote deletion.

## Deliverables

1. Implement the recording endpoints exactly as defined in the shared contract.
2. Create-upload runs after recording stops and receives actual Blob MIME, bytes, and measured duration. Validate owner/question, supported MIME, per-file size/duration bounds, and aggregate active staging capacity before creating a `STAGING` row.
3. Generate an immutable storage key through `@speaking-track/storage` and a short-lived presigned PUT. Do not accept a client object key.
4. Implement direct browser PUT with upload progress using an API that exposes upload progress, abort support, exact content type, and required signed headers. Media bytes must not pass through Next.js.
5. Completion calls storage `stat`, verifies key/size/content type against the row, then atomically transitions to `QUEUED` and inserts one `youtube.upload` outbox intent.
6. Make completion idempotent. Repeated completion after success returns current data and never creates another upload job.
7. Implement retry rules: only `FAILED` with a still-present verified source can return to `QUEUED`, except `YOUTUBE_UPLOAD_AMBIGUOUS`, which is blocked from ordinary retry. A recording with `youtubeVideoId` queues processing polling instead of a second insertion.
8. Implement delete orchestration for every state. Hide with `DELETE_PENDING`; enqueue YouTube deletion when a remote ID exists and storage cleanup when a source exists. A staging row with no external side effect may be cleaned synchronously.
9. Implement list serialization that exposes only user-safe status/failure data and derived embed eligibility, never storage keys, presigned URLs, upload session URI, queue payloads, or tokens.
10. Implement expiration of abandoned `STAGING` rows after configured retention and orphan-safe object cleanup.
11. Implement browser media helpers:
    - `getUserMedia({audio:true, video:true})` only after explicit user action.
    - MIME negotiation via the centralized candidate list and `isTypeSupported`.
    - MediaRecorder event/error handling and monotonic elapsed timing.
    - Track cleanup on stop/discard/error/unmount.
    - Local object URL creation/revocation.
12. Initial upload is one final Blob/presigned PUT. Do not introduce multipart/tus in this task.

## Required behavioral tests

- Cross-user recording list/create/complete/retry/delete access is denied/not found.
- Unsupported MIME and oversized file fail before a presigned URL is created.
- Aggregate staging cap prevents new staging rows with `STORAGE_CAPACITY_LOW`.
- Completion rejects absent object, byte mismatch, and content-type mismatch.
- Two concurrent completion requests produce one state transition/outbox intent.
- Retry never inserts another upload intent when `youtubeVideoId` exists.
- Delete chooses correct cleanup intents by current state.
- Abandoned staging expiry does not delete active/queued media.

## Acceptance

- Browser media body goes directly to the configured public S3/MinIO endpoint.
- Bucket and objects remain private.
- A successful complete response is durable across reload and worker downtime.
- Client abort does not claim upload completion.
- Server errors contain request IDs and no storage key/presigned URL after initialization.
- Camera/microphone tracks and Blob URLs are always released.

## Focused verification

With real browser + MinIO:

1. Grant camera/mic, record a short clip, stop, and review locally.
2. Upload and observe byte progress.
3. Verify object metadata privately with the storage adapter.
4. Complete twice and observe one outbox/job identity.
5. Deny permission and verify actionable state plus no lingering track.
6. Abort upload and verify it never becomes `QUEUED`.
7. Attempt a foreign question/recording ID as another user.

Use a generated small Blob only for server integration tests; do not commit captured personal media.

## Non-goals

- No YouTube API calls or worker processors.
- No final visual practice-page composition.
- No multipart/live streaming upload or FFmpeg.
- No permanent MinIO playback.

## Handoff

Report supported MIME order, media limits, client transport API, recording endpoint imports, returned recording view model, and queue/outbox behavior consumed by tasks 06 and 07.
