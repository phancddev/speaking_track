# Speaking Track

Private, multi-user speaking-practice workspace: organize prompts, save drafts, record
webcam practice, and review attempts after they transfer to one admin-managed YouTube
channel as unlisted videos.

The implementation source of truth lives in [`plan/`](./plan/). This README covers
operating the system.

## Stack

| Service    | Purpose                                                                         |
| ---------- | ------------------------------------------------------------------------------- |
| `web`      | Next.js App Router UI + HTTP APIs (Better Auth handler, custom JSON APIs)       |
| `worker`   | BullMQ processors: outbox dispatch, YouTube upload/poll/delete, storage cleanup |
| `postgres` | Source of truth: users, library, recordings, YouTube connection, outbox         |
| `redis`    | BullMQ transport (operational, never user-facing state)                         |
| `minio`    | Private S3-compatible staging bucket for raw recordings                         |
| `caddy`    | HTTPS termination for the app and the public presigned-storage endpoint         |

Recording media never passes through Next.js: the browser PUTs directly to MinIO
through a short-lived presigned URL on `S3_PUBLIC_DOMAIN`.

## Quick start (local, production-shaped)

Prerequisites: Docker, Node ≥ 22.12, pnpm ≥ 10.

```bash
cp .env.example .env          # then fill every empty value
pnpm install
docker compose up -d postgres redis minio minio-bucket-init
pnpm db:migrate               # applies packages/db/drizzle migrations via DATABASE_URL
pnpm bootstrap:admin          # idempotent first-admin seed from BOOTSTRAP_* values
docker compose up -d          # web, worker, caddy
```

Then open **https://localhost** (Caddy's internal CA issues the certificate; import
`root.crt` from the `caddy_data` volume into your trust store for non-curl clients).

Useful one-liners:

```bash
docker compose config                          # validate the stack definition
docker compose logs -f web worker              # structured JSON logs
docker compose restart worker                  # graceful stop + recovery pass
docker compose exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup.sql
```

Host port overrides: set `CADDY_HTTP_PORT`/`CADDY_HTTPS_PORT` in `.env` when 80/443
are taken; HTTPS verification via `https://localhost` is unaffected.

## Daily operations

- **Create users:** sign in as the admin → Users → Create user. There is no public
  sign-up; the endpoint rejects account creation server-side.
- **Connect YouTube:** admin → YouTube → Connect (requires the OAuth setup below).
  Disconnect removes the stored authorization but never deletes existing videos.
- **Queue health:** admin → Queue shows recording-state counts from PostgreSQL and
  recent failures with stable codes; eligible failures are retryable in place.
- **Backups:** the durable state is the `postgres_data` volume (plus un-cleanup-up
  staging objects in `minio_data`). Back up both volumes together.

## Google Cloud / YouTube setup (operator prerequisite)

1. Create a Google Cloud project and enable the **YouTube Data API v3**.
2. Configure the OAuth consent screen (External). Add the admin's Google account as a
   test user, or publish the app for production use.
3. Create an OAuth 2.0 **Web application** client; set the redirect URI to
   `https://<WEB_DOMAIN>/api/admin/youtube/callback`.
4. Put the client ID/secret into `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_REDIRECT_URI`) and generate `YOUTUBE_TOKEN_ENCRYPTION_KEY`
   (`openssl rand -base64 32`), then restart `web` and `worker`.
5. Admin → YouTube → Connect, choose the channel, and verify the status card.

Operational caveats (also surfaced in the admin UI):

- **Quota:** the default project gets 100 `videos.insert` calls/day. When exhausted,
  recordings stay queued and upload automatically after the Pacific-time reset.
- **Unverified API projects** may force uploads to `private`. Such recordings are
  marked failed with `YOUTUBE_PRIVATE_RESTRICTION` and are **not** playable until the
  project passes YouTube's audit — `private` is not playable for normal users.
- **Testing-mode consent screens** issue refresh tokens that expire after 7 days; the
  connection then reports reauthorization required. Production deployments should use
  a published/approved consent screen.

## Commands

| Command                                       | Meaning                                                           |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:worker`                | Development servers (web / worker)                                |
| `pnpm build` / `pnpm typecheck` / `pnpm lint` | Production build and static checks                                |
| `pnpm format:check` / `pnpm format`           | Prettier check / write                                            |
| `pnpm test`                                   | Vitest behavioral suites (needs the compose dependencies running) |
| `pnpm e2e`                                    | Playwright end-to-end suite against the running compose stack     |
| `pnpm db:migrate`                             | Apply migrations (`pnpm db:generate` after schema edits)          |
| `pnpm db:reset`                               | Drop + recreate the dev database (guarded, development only)      |
| `pnpm bootstrap:admin`                        | Idempotent first-admin seed                                       |

E2E notes: `pnpm exec playwright install` once per machine; the suite reads admin
credentials and the base URL (`https://localhost`) from `.env`. Recording scenarios use
deterministic generated media and the controlled provider boundary — no real YouTube
upload happens in tests.

## Verification performed

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (125 behavioral
  tests across 9 suites), `pnpm build`, `docker compose config`.
- Playwright e2e: login/role gate/public-signup rejection, cross-user isolation with
  admin owner browsing, tag/topic/question/draft persistence, direct-to-MinIO
  presigned upload → completion → durable queue → controlled
  `YOUTUBE_NOT_CONNECTED` failure, aborted-upload rejection.
- Browser checks at 1440/768/375 px: login, library, topic detail, practice workspace,
  admin users/user detail/YouTube/queue.

Real YouTube upload/processing playback requires operator credentials and an
API-approved project (see above); with credentials absent, the provider boundary is
exercised through the controlled failure path only.
