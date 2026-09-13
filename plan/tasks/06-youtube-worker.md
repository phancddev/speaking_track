# Task 06: YouTube OAuth and worker pipeline

## Objective

Implement the single-channel YouTube connection, idempotent resumable upload/processing/deletion workers, outbox dispatch, retry/rate-limit behavior, and storage cleanup.

## Dependencies

Tasks 01 and 02 merged. May run in parallel with tasks 03–05 using the documented auth/storage/recording contracts.

## Ownership

- Full implementation of `packages/youtube`.
- `apps/worker` queue processors, dispatcher, scheduling, graceful shutdown, and readiness.
- Admin YouTube OAuth/status APIs and admin queue summary/failure APIs in `apps/web`.

Task 08 owns the visual admin pages consuming these APIs.

## Deliverables

1. Implement OAuth server flow with the minimal YouTube upload/manage scopes required by upload, status, and deletion behavior. Service accounts are prohibited.
2. Generate authorization URLs with cryptographically strong state tied to the initiating admin session, offline access, and fixed same-origin callback. Validate state and admin session in callback.
3. Exchange the code, require/preserve a refresh token safely, verify the selected YouTube channel, and store an AES-256-GCM encrypted token envelope. Store key version/nonce/tag/ciphertext; never deterministic encryption or plaintext.
4. Implement reconnect/disconnect/status. Disconnect removes usable local token material and marks connection status; it does not silently delete existing YouTube videos.
5. Implement typed YouTube client creation and classify provider errors into stable application codes: reauth, quota, transient network/5xx, invalid media/metadata, private restriction, and processing rejection.
6. Implement the outbox dispatcher with safe concurrent claims and deterministic BullMQ job IDs.
7. Implement `youtube.upload`:
   - Load/lock current recording by ID.
   - No-op or redirect behavior when terminal/deleting/already has `youtubeVideoId`.
   - Compare-and-set to `YOUTUBE_UPLOADING`.
   - Stream the private object through YouTube's documented resumable upload protocol, authorized by the official Google OAuth client. Persist the encrypted resumable session URI before sending media bytes.
   - Set title/description without leaking draft text; include a stable recording reference only if policy-safe.
   - Set `privacyStatus=unlisted`, `notifySubscribers=false`, configured category, embeddable true, and correct made-for-kids declaration.
   - Persist a returned video ID immediately, then transactionally transition/schedule polling.
8. Resume interrupted media transfer by querying the persisted session URI and continuing from YouTube's acknowledged byte range. If a final upload response is lost, query that same session before any retry. If the session expires while completion remains unknowable, fail closed with `YOUTUBE_UPLOAD_AMBIGUOUS`, retain the source, and block ordinary retry; never start a second insert with an ambiguous first outcome.
9. Implement `youtube.poll-processing` with delayed jobs and bounded backoff. `READY` requires successful processing, effective `unlisted` visibility, and embeddable status. A forced `private` result becomes `FAILED/YOUTUBE_PRIVATE_RESTRICTION`, not ready.
10. On `READY`, insert `storage.cleanup`; delete source only after state/video persistence is committed.
11. Implement `youtube.delete` and `storage.cleanup` idempotently. Treat provider/object already-not-found as success when deletion was intended.
12. Implement manual queue rate limiting for `quotaExceeded` until next Pacific reset boundary and configurable concurrency. Reauth errors mark the connection `REAUTH_REQUIRED` and stop hot retries.
13. Implement worker startup recovery for stale `YOUTUBE_UPLOADING` records, unpublished outbox events, due processing polls, abandoned staging expiry, and pending deletions.
14. Implement safe admin queue APIs based on aggregate database states/recent failures; expose BullMQ counts only as supplemental operations data.
15. Add structured logs with recording/job/request correlation and redaction.

## Required behavioral tests

Use a fake HTTP YouTube transport only at the provider boundary; test observable worker/database/storage behavior, not request object copying.

- Duplicate delivery with existing `youtubeVideoId` never calls `videos.insert` again.
- Successful insert persists video ID before poll scheduling.
- Lost final response is reconciled through the persisted session URI; an expired/unresolvable session fails ambiguous without a second insert.
- Transient failure retries with backoff while permanent media failure becomes `FAILED`.
- `quotaExceeded` rate-limits rather than hot loops.
- Invalid/revoked refresh token marks connection and recording actionable.
- Forced `private`/non-embeddable result is not `READY`.
- Processing success queues source cleanup; processing failure retains source for retry.
- Delete and cleanup are idempotent when remote/object already vanished.
- Worker restart recovers unpublished/due work without duplicate terminal effects.
- Encryption round-trip succeeds and tampering/wrong key fails closed without logging secrets.

A real YouTube upload is an optional operator smoke test because it consumes quota and requires credentials; never make it part of the default suite.

## Acceptance

- Worker can run independently from Next.js and shuts down gracefully.
- Queue jobs contain IDs only.
- No OAuth token/session URI/presigned URL appears in logs or APIs.
- `READY` always has a valid YouTube video ID and no staged storage key after cleanup completes.
- Source remains available for retry whenever no usable YouTube result exists.
- Admin status clearly distinguishes disconnected, connected, reauth required, quota delayed, and private restriction.

## Focused verification

Run worker/package tests against real PostgreSQL, Redis, and MinIO with a controlled fake YouTube HTTP endpoint. Execute success, duplicate-delivery, quota, reauth, forced-private, processing-failure, and delete scenarios. If real credentials are explicitly available, upload one disposable non-personal clip, observe processing, play it, then delete it from YouTube and MinIO.

## Non-goals

- No per-user channel connection.
- No public videos, search, analytics, captions, comments, or thumbnails.
- No custom video player or YouTube UI modification.
- No permanent fallback to MinIO when YouTube is private.

## Handoff

Report OAuth scopes/redirect, encryption envelope/key requirements, worker commands, processor concurrency, retry classifications, queue summary response, and whether durable resumable-session recovery has any provider-library limitation.
