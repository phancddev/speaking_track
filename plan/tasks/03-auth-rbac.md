# Task 03: Authentication, RBAC, and app shell

## Objective

Deliver real email/password login, admin-created account foundations, database-backed authorization helpers, and the protected shadcn application shell.

## Dependencies

Tasks 01 and 02 merged. May run in parallel with tasks 04–06.

## Required reading

- All shared plan documents, especially authorization helpers in [`../02-shared-contracts.md`](../02-shared-contracts.md).
- [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next)
- [Better Auth admin plugin](https://better-auth.com/docs/plugins/admin)

## Ownership

- `apps/web` Better Auth server/client configuration and `/api/auth/[...all]` handler.
- Server authorization/session helpers and final-admin guard shared within the web app.
- `/login`, protected route layout, sidebar/header/account menu/theme handling.
- Admin bootstrap command implementation.

Do not implement library CRUD, recording APIs, YouTube APIs, or admin management pages.

## Deliverables

1. Configure Better Auth with the shared Drizzle/PostgreSQL schema, email/password, sessions, admin plugin, secure cookie behavior, and the Next.js integration.
2. Reject public email sign-up server-side while retaining authenticated admin user creation through the admin plugin. Hiding the UI is insufficient; prove the underlying public endpoint cannot create a user.
3. Implement `requireSession`, `requireAdmin`, `resolveOwnerScope`, and `assertOwnerOrAdmin` with the exact shared signatures/semantics or compatible inferred types.
4. Use a lightweight optimistic redirect only as UX; every protected page/API must still perform a database-backed session check.
5. Implement an idempotent admin bootstrap command. It creates the first admin only when none exists, reads credentials from environment, validates password requirements, and never logs the password. It must not overwrite an existing account silently.
6. Implement final-active-admin protection as a reusable service guard for task 08.
7. Build `/login` with shadcn Form/Card/Input/Button/Alert, correct autocomplete attributes, generic credential errors, pending state, and redirect to the intended same-origin protected route.
8. Build the responsive protected shell: sidebar on desktop, Sheet navigation on mobile, header/breadcrumb slot, theme toggle, account menu, sign out, and admin-only navigation items.
9. Prevent open redirects. Return paths must resolve to same-origin application paths.
10. Add server-safe request IDs/custom error mapping integration for later custom endpoints without wrapping Better Auth's native responses.

## Required behavioral tests

- Valid account logs in and receives a usable session.
- Invalid credentials reveal neither account existence nor password correctness.
- Unauthenticated custom protected access is rejected.
- A normal user fails `requireAdmin`.
- Public sign-up cannot create an account even when calling the Better Auth endpoint directly.
- Bootstrap creates the first admin once and does not reset it on a second run.
- Final-active-admin guard rejects removal/demotion/ban.
- External/open redirect return URL is rejected.

## Acceptance

- No public registration page/link/API path can create a user.
- Admin and user navigation differ only by authorized admin entries.
- Refreshing a protected route preserves a valid session.
- Signing out invalidates access to protected content.
- Mobile/desktop shell uses only shadcn primitives and Lucide icons.
- Authorization helpers are server-only and cannot be imported into client bundles.
- Passwords, session tokens, cookies, and auth provider responses are absent from logs.

## Focused verification

Run focused auth tests, then use a real browser to:

1. Bootstrap an admin.
2. Log in with wrong and correct credentials.
3. Navigate protected routes and refresh.
4. Inspect desktop and 375 px navigation.
5. Sign out and verify access is gone.
6. Call the public sign-up endpoint directly and confirm no user is created.

## Non-goals

- No password-reset email, verification email, social login, OAuth login, or public registration.
- No admin users table/page; task 08 owns that UI/API wrapper.
- No impersonation feature.

## Handoff

Report auth route, server helper imports, bootstrap command, protected layout slots, role typing, and any Better Auth version-specific behavior task 08 must consume.
