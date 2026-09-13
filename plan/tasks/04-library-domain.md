# Task 04: Tags, topics, and questions library

## Objective

Implement owner-safe library services/APIs and the shadcn UI for free-form tags, topics, and ordered questions.

## Dependencies

Tasks 01 and 02 merged. May run in parallel with tasks 03, 05, and 06. Use the authorization helper contract; if task 03 is not yet present, import only from its documented target module and coordinate the exact path before editing shared files.

## Ownership

- Library feature services/repositories inside `apps/web`.
- Custom APIs for tags, topics, questions, and question reorder, excluding draft and recording endpoints.
- `/library` and `/library/topics/:topicId` pages and their feature components.

Do not edit shared database/contracts packages unless task 02 has a confirmed defect. Do not implement the practice page or draft endpoint.

## Deliverables

1. Implement every Tags and Topics/Questions endpoint from the shared API contract with Zod validation and common response/error envelopes.
2. Scope normal-user queries by session owner in SQL. Admin `ownerId` browsing must be explicit; an admin request without `ownerId` operates on the admin's own library.
3. Normalize tag names through the shared contract and map uniqueness races to `DUPLICATE_TAG`/409.
4. Create/update topic and full tag association set atomically. Reject cross-owner tag IDs as not found/forbidden without leaking another user's resource.
5. Implement case-insensitive topic search and multi-tag intersection semantics: selecting A and B returns topics carrying both A and B.
6. Implement stable question ordering. Create at the end; reorder validates the complete owned set and updates positions transactionally.
7. Implement safe soft-delete orchestration for topics/questions. If descendant recordings require asynchronous cleanup, hide the domain row immediately and create the defined deletion intents rather than database-cascading remote media away.
8. Build `/library`: search, multi-tag filter, active filter badges, tag management, topic create/edit/delete, meaningful empty/loading/error states.
9. Build topic detail: metadata/tags, ordered questions, add/edit/reorder/delete, and link to each practice route.
10. Provide keyboard up/down reorder controls. Drag-and-drop is optional and must not be the only mechanism.
11. Keep URL search parameters for query/tag filters so refresh/back navigation preserves the current view.

## Required behavioral tests

- User A cannot list/read/update/delete User B's tags/topics/questions by guessed ID.
- Admin can explicitly operate on User B's library while ownership remains User B.
- Duplicate normalized tag for one owner returns 409; same normalized name for another owner succeeds.
- Topic cannot attach another owner's tag.
- Multi-tag filtering uses intersection, not union.
- Reordering rejects duplicates, missing questions, and foreign questions without partial position updates.
- Deleting a tag removes associations but preserves topics.
- Deleted topics/questions no longer appear in normal reads.

## Acceptance

- No hard-coded `Part` values or reserved tag names exist anywhere.
- A topic supports zero or many tags.
- Every mutation has pending/disabled UI and retains form values on failure.
- Filters and CRUD work at 375 px and desktop widths.
- Library APIs return shared envelopes and stable errors.
- No library route trusts a client-supplied `ownerId` for normal users.

## Focused verification

Run only library tests. In a real browser with two users plus admin:

1. Create `Part 1`, `Travel`, and `Work` tags.
2. Create topics with overlapping tag sets.
3. Verify A+B filtering.
4. Add/edit/reorder questions with keyboard controls.
5. Attempt cross-user URL/API access.
6. Use admin owner selection/API to modify another user's topic and verify ownership did not change.

## Non-goals

- No draft editor or practice page.
- No recorder/video list.
- No global admin users UI.
- No IELTS-specific behavior inferred from tag names.

## Handoff

Report API route paths, service entry points, URL filter encoding, soft-delete behavior, and practice links consumed by task 07.
