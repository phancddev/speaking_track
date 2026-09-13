# Task 01: Foundation and Docker

## Objective

Create the runnable TypeScript workspace and production-shaped Docker baseline that every later task extends.

## Dependencies

None. Run this task alone before all others.

## Required reading

- [`../00-product-scope.md`](../00-product-scope.md)
- [`../01-architecture.md`](../01-architecture.md)
- [`../02-shared-contracts.md`](../02-shared-contracts.md)
- [`../03-ui-ux.md`](../03-ui-ux.md)

## Ownership

This task owns:

- Root workspace manifests, lockfile, TypeScript/ESLint/format/test base configuration.
- Initial directory/package scaffolds under `apps/*` and `packages/*`.
- `compose.yaml`, Dockerfiles, `.dockerignore`, `Caddyfile`, root `.gitignore`, `.env.example`.
- Initial shadcn/ui configuration and only the primitives required for the shell/login baseline.

Do not implement database tables, auth behavior, domain APIs, recording behavior, or YouTube behavior.

## Deliverables

1. Create a plain pnpm workspace with package names:
   - `@speaking-track/web`
   - `@speaking-track/worker`
   - `@speaking-track/contracts`
   - `@speaking-track/db`
   - `@speaking-track/queue`
   - `@speaking-track/storage`
   - `@speaking-track/youtube`
2. Configure one strict TypeScript baseline and package references/exports. Apps may consume packages only through package exports.
3. Scaffold Next.js App Router in `apps/web`, using the current stable Node-compatible release, Tailwind, and shadcn/ui. Select one shadcn primitive base and record it in `components.json`; later tasks must not mix bases.
4. Scaffold a long-running TypeScript worker process with graceful SIGTERM/SIGINT handling and a minimal liveness log. It must not process fake jobs.
5. Add Vitest support for packages/apps and Playwright configuration for later end-to-end work. Do not add placeholder tests.
6. Add root scripts for development, build, typecheck, lint, formatting check, focused test execution, migrations, and explicit admin bootstrap. Scripts may point to task-02/task-03 implementations that do not exist yet only when clearly named and unable to pretend success.
7. Build Docker images with dependency-aware multi-stage builds and non-root runtime users.
8. Define Compose services for web, worker, PostgreSQL, Redis, MinIO, and Caddy with durable named volumes and health checks. Web/worker may remain dependency-waiting until task 02 supplies migrations, but containers must fail honestly rather than loop silently.
9. Configure separate S3 internal/public endpoint variables. A presigned URL must eventually contain a browser-reachable hostname; never sign `minio:9000` for browser use.
10. Configure Caddy routing/HTTPS suitable for localhost development and document environment-only production host substitution in `.env.example` comments. Restrict `Permissions-Policy` camera/microphone to self.
11. Keep MinIO bucket private. Add an explicit one-shot bucket-initialization command/service; do not expose anonymous reads.
12. Add safe ignores for `.env*` except `.env.example`, credentials, uploads, MinIO data, coverage, build output, and Playwright artifacts.

## Acceptance

- Workspace installation produces a committed lockfile and resolves every package through workspace links.
- `apps/web` renders a minimal shadcn-styled page; no business placeholder claims functionality exists.
- Worker starts, reports readiness only for dependencies it actually checks, and shuts down cleanly.
- Compose configuration contains no embedded production secret or default admin password.
- PostgreSQL, Redis, MinIO, and Caddy health checks test their actual service endpoint/process.
- MinIO data and PostgreSQL data survive a container restart.
- Web image contains no development-only server and runs as a non-root user.
- There is one UI component convention and one TypeScript/import convention.

## Focused verification

Run and report:

```text
pnpm install
pnpm typecheck
pnpm build
docker compose config
docker compose up --build
```

Observe the actual web page through Caddy, verify HTTPS/localhost access, inspect service health, and stop the stack cleanly. Project-wide checks are appropriate here because this task owns the whole initial scaffold.

## Non-goals

- No authentication screens beyond installed primitives.
- No migrations/domain schema.
- No fake storage upload or YouTube implementation.
- No CI/CD provider configuration.
- No Kubernetes, Terraform, Turborepo, or service mesh.

## Handoff

Report selected versions, shadcn base, package script names, container URLs/ports, health behavior, and any platform-specific Docker requirement Task 02 must know.
