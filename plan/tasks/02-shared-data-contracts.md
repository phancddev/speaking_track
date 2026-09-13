# Task 02: Shared data and service contracts

## Objective

Implement the database schema, migrations, runtime contracts, durable outbox, queue producers, and private storage adapter needed by all parallel feature agents.

## Dependencies

Task 01 merged. Run this task alone before tasks 03–06.

## Required reading

- [`../00-product-scope.md`](../00-product-scope.md)
- [`../01-architecture.md`](../01-architecture.md)
- [`../02-shared-contracts.md`](../02-shared-contracts.md)

## Ownership

- Full implementation of `packages/contracts`, `packages/db`, `packages/queue`, and `packages/storage`.
- Schema/migrations for Better Auth-compatible auth tables and every application table in the shared contract.
- Scaffold/package exports only for `packages/youtube`; task 06 owns its implementation.

Do not add Next.js pages, route handlers, Better Auth application configuration, or BullMQ worker processors.

## Deliverables

1. Implement all Zod schemas, constants, DTOs, error codes, recording-state definitions, queue payloads, and success/failure response types specified in the shared contract.
2. Implement the Drizzle PostgreSQL schema, relations, indexes, uniqueness/check constraints, soft-delete fields, and the first migration.
3. Include Better Auth adapter tables/columns required for email/password sessions and the admin role/plugin. Keep table exports compatible with task 03's adapter configuration.
4. Implement database connection factories for web/worker/CLI processes without opening connections as import side effects.
5. Implement transaction-safe repository/service primitives for recording compare-and-set transitions and outbox creation. Invalid transitions must not create outbox rows.
6. Implement the PostgreSQL outbox claim/publish bookkeeping using `FOR UPDATE SKIP LOCKED` or an equivalent safe Drizzle SQL transaction. Publishing twice must resolve to the same deterministic BullMQ job ID.
7. Implement queue names, job names, payload validation, job-ID helpers, queue producer factories, and explicit close methods. Do not create a queue at module import.
8. Implement private S3-compatible operations: deterministic object key, presigned PUT, stat, stream, delete, and safe not-found mapping. Use configuration that works with MinIO path-style endpoints and production S3-compatible endpoints.
9. Enforce `MAX_RECORDING_BYTES` and `MAX_STAGING_BYTES`. Staging capacity is the sum of active, not-yet-cleaned recording bytes in PostgreSQL; do not depend on a provider-specific free-disk API.
10. Provide explicit migration and database reset commands. Reset must be development-only and require an unmistakable environment guard.
11. Add factories/fixtures only where needed by behavior tests; no broad mock framework.

## Required behavioral tests

Use a real disposable PostgreSQL database and, for storage behavior, the Compose MinIO instance or an equivalent real S3-compatible test endpoint.

Protect at least:

- Tag normalized uniqueness is scoped per owner.
- Topic/tag ownership mismatch is rejected.
- Recording owner matches the owning topic/user invariant.
- One draft per question with empty content accepted.
- Recording state compare-and-set rejects an invalid or stale transition.
- State transition and outbox intent commit or roll back together.
- Reclaiming/publishing an outbox event yields the same deterministic job ID.
- Presigned upload uses the exact generated private object key and expected content type/size metadata.
- Active staging-byte calculation excludes cleaned/deleted/expired objects.

Do not test Drizzle field copying or source text. Test the database-observable invariants.

## Acceptance

- A fresh database migrates from zero without manual SQL.
- Reapplying migrations is safe.
- Package public exports are sufficient for tasks 03–06; no internal imports are required.
- All contract schemas reject unknown/invalid role, state, queue payload, media type, and unsafe object key values.
- No package opens sockets or reads all environment variables at import time.
- No queue payload contains a media buffer, OAuth credential, or complete mutable recording snapshot.
- Storage methods never make the bucket/object public.

## Focused verification

Run package typechecks and the specific database/storage integration tests added by this task. Exercise one real sequence:

1. Migrate an empty PostgreSQL database.
2. Insert owner/topic/question/recording.
3. Create a presigned PUT and upload a small generated media-like byte fixture.
4. Verify metadata.
5. Transition `STAGING` to `QUEUED` with an outbox event.
6. Dispatch twice and observe one BullMQ job identity.
7. Delete the object and close all clients.

## Non-goals

- No HTTP endpoints.
- No browser recording.
- No Better Auth route/config/session UI.
- No worker processor or YouTube calls.

## Handoff

Report migration identifiers, all public package exports, factory lifecycles, outbox dispatch invocation, supported MIME list, and exact environment schema consumed by these packages.
