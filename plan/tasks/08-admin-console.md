# Task 08: Admin console

## Objective

Deliver admin-only user management, explicit browsing of another user's application data, YouTube connection controls, and safe queue/failure operations.

## Dependencies

Tasks 03, 04, and 06 merged. May run in parallel with task 07.

## Ownership

- `/admin/users`, `/admin/users/:userId`, `/admin/youtube`, and `/admin/queue` pages.
- Admin user API wrappers defined in the shared contract.
- Admin-only presentation/adapters around library owner-scoped APIs and task 06's YouTube/queue APIs.

Do not modify Better Auth core setup, worker processors, library service semantics, or shared database schema.

## Deliverables

1. Implement admin user list/create/update-role/ban-or-disable/set-password/delete APIs through Better Auth-supported admin operations plus the reusable final-admin guard.
2. Enforce `requireAdmin` inside every endpoint and server-rendered admin page. Hiding navigation is not authorization.
3. Use server pagination/search for user list. Never return password hashes, sessions, OAuth tokens, or internal auth fields to the Data Table.
4. Validate role as exactly `admin`/`user`. Protect the final active admin from demotion, disable/ban, and deletion.
5. Build Users Data Table with shadcn components, meaningful empty/error states, create user Dialog, row actions, and destructive Alert Dialogs.
6. Build user detail with safe account metadata/actions and an explicit "Browse this user's library" path that passes the target `ownerId` to admin-scoped library APIs. Do not impersonate or rewrite resource ownership.
7. Build YouTube settings from task 06 APIs: connection/channel/last verified status; connect/reconnect/disconnect; unlisted-link disclosure; reauth/quota/private-restriction warnings.
8. OAuth connect must use normal navigation to the server-generated authorization URL. Callback errors return a stable safe notice on the settings page.
9. Build Queue page showing aggregate recording states and recent actionable failures. Retry calls the recording retry endpoint; do not expose raw BullMQ job mutation controls.
10. Make admin actions auditable through structured server logs containing actor ID, target ID, action, and result, but no secrets/password values.
11. Admin's normal Library navigation continues to show the admin's own data. Cross-user browsing is always visibly labeled with the selected owner to avoid accidental edits.

## Required behavioral tests

- User role cannot access any admin page/API by direct URL.
- Admin can create a user who can log in; public user creation remains blocked.
- Role mutation accepts only two roles.
- Final active admin cannot be demoted, disabled/banned, or deleted.
- Admin can browse/edit another user's library without ownership transfer.
- Admin password reset never returns/logs the new password after the mutation response contract permits initial handling.
- OAuth/queue pages reveal no encrypted tokens, storage keys, session URIs, provider bodies, or stack traces.
- Queue retry respects recording-state eligibility.

## Acceptance

- All requested admin operations function through real Better Auth/database services.
- User table pagination/search remains usable with more rows than one page.
- Target owner is obvious on every cross-user data screen.
- YouTube connection states and remediation actions are accurate.
- Queue view distinguishes queued/uploading/processing/ready/failed and does not treat Redis as the domain source of truth.
- Desktop and 375 px admin layouts remain navigable and accessible.

## Focused verification

With one admin and two users:

1. Prove direct admin URL/API rejection for a normal user.
2. Create a user, log in as that user, then return as admin.
3. Change a non-final role and exercise final-admin protection.
4. Browse/edit one user's topic and confirm ownership.
5. Open YouTube connect/callback error/success states using a controlled OAuth transport where real credentials are unavailable.
6. Display failed queue records and retry an eligible one.
7. Verify Data Table and dialogs at desktop and 375 px.

## Non-goals

- No impersonation, bulk import, invitation email, audit-log UI, or advanced analytics.
- No direct arbitrary BullMQ retry/delete/promote controls.
- No per-user YouTube connection.

## Handoff

Report admin API routes, final-admin behavior, owner-browsing URL shape, YouTube state presentation, queue actions, and task-09 integration risks.
