# Task 09: Integration, hardening, and release proof

## Objective

Own the final cross-feature integration boundary, remove inconsistencies, prove the full system in Docker, and leave a deployable first release with no fake paths or orphaned scaffolding.

## Dependencies

Tasks 01–08 merged. Run this task alone.

## Ownership

All repository files only for cross-feature fixes, final configuration, operator-facing setup documentation explicitly required to run the system, end-to-end tests, and cleanup. Preserve feature contracts unless a verified defect requires coordinated migration of every caller.

## Deliverables

1. Reconcile imports, package exports, route paths, DTOs, environment schemas, and recording states across every task. Delete obsolete aliases/stubs; do not add compatibility shims.
2. Apply all migrations from a clean database and verify Better Auth/admin bootstrap against the final schema.
3. Verify custom API error envelopes and authorization on every route. Better Auth routes retain native responses.
4. Verify outbox dispatch under web/worker restarts, Redis downtime/recovery, duplicate deliveries, and concurrent completion.
5. Verify full media lifecycle against real MinIO and controlled YouTube transport, then optionally one real YouTube disposable clip when operator credentials are explicitly provided.
6. Exercise and fix cleanup semantics for abandoned staging, failed upload, ready upload, recording delete, question/topic delete, missing object, and missing remote YouTube video.
7. Add only high-value Playwright scenarios covering end-to-end contracts that would plausibly regress:
   - Bootstrap/login/public-signup rejection and role gate.
   - Cross-user library isolation plus admin explicit owner access.
   - Tag/topic/question/draft persistence.
   - Recording direct upload/complete/queue status using deterministic media and controlled external transport.
8. Browser-verify real UI at 1440, 768, and 375 px; keyboard navigation; light/dark; reduced motion; camera permission denial; focus in dialogs/sheets; no horizontal overflow.
9. Validate security headers, HTTPS camera access, cookie flags, MinIO private bucket/CORS, upload bounds, open-redirect prevention, OAuth state, token/log redaction, and absence of committed secrets/media.
10. Validate resource behavior: final Blob bounded by configured maximum, direct upload does not buffer in Next.js, list pages paginate, YouTube iframes load on demand, worker streams rather than buffers objects.
11. Make startup ordering honest. Provide explicit commands for migration, admin bootstrap, bucket initialization, normal start, worker start, and backup-sensitive volumes.
12. Add concise operator documentation under the existing plan or root README only as needed for actual setup: Google Cloud OAuth/YouTube Data API configuration, audit/private restriction, redirect URI, quota, MinIO/S3 endpoints, secrets, deployment, backup, and recovery. Do not create speculative product docs.
13. Remove temporary scripts, captured recordings, test buckets/objects, OAuth fixtures containing secrets, screenshots not required by the project, stale comments, and placeholder pages.

## Acceptance

### Clean install

- From a clean checkout and environment file, build images, start dependencies, migrate, initialize bucket, bootstrap admin, and start web/worker.
- Health/readiness accurately report state.
- No manual database edit is required.

### Roles and isolation

- Admin creates User A and User B.
- Each user manages their own identically named tags without collision.
- User A cannot observe User B via lists, direct URLs, IDs, draft endpoint, recording endpoints, or presigned operations.
- Admin explicitly selects User B, edits data, and ownership remains User B.

### Study flow

- User creates free tags, a topic with multiple tags, ordered questions, and a draft.
- Refresh preserves filters, order, and draft.
- User records two attempts for one question and sees both independently.

### Video success

- Browser sends media to MinIO public endpoint through a presigned PUT, not to Next.js.
- Completion verifies the object and produces one durable queue intent.
- Worker uploads once, polls processing, marks ready only when unlisted/embeddable, cleans source, and on-demand iframe plays.

### Failure recovery

- Permission denial leaves no stream.
- Aborted/direct upload mismatch never queues.
- Redis outage leaves a publishable outbox intent.
- Worker restart does not duplicate YouTube insert after video ID persistence.
- Quota delays work; revoked OAuth requires reconnect; forced private is not ready.
- Processing failure retains source and supports eligible retry.
- Delete handles already-missing object/remote video idempotently.

## Focused verification

Run, in this order:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config
# clean Docker smoke scenario using documented commands
pnpm e2e
```

Then perform manual real-browser camera/local-review/upload and responsive/accessibility checks. If no approved YouTube credentials are available, clearly report that the provider boundary used a controlled transport and that real API/audit status remains an external deployment prerequisite; do not claim a real YouTube upload occurred.

## Non-goals

- No new product feature during integration.
- No AI/transcription, multipart upload, public signup, per-user channels, analytics, or deployment platform expansion.
- No suppressing failing checks or weakening contracts to obtain green output.

## Handoff

Final report must list delivered journeys, migrations, deployment commands, verified scenarios with exact evidence, external YouTube prerequisites, any intentionally unverified real-provider action, and zero remaining actionable TODOs.
