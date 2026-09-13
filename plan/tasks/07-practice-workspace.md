# Task 07: Practice workspace and draft experience

## Objective

Assemble the complete user-facing question practice page: prompt, explicit draft persistence, camera recorder, direct upload, durable attempt statuses, and on-demand YouTube playback.

## Dependencies

Tasks 03, 04, and 05 merged. Task 06 may still be finishing, but its recording states/view model must match the shared contract.

## Ownership

- `/practice/questions/:questionId` page.
- Draft `PUT` endpoint/service and draft editor components.
- Final visual recorder controls using task 05's headless media/upload utilities.
- Attempts list/status refresh/on-demand YouTube player.

Do not modify library CRUD, worker processors, shared schema, or admin pages.

## Deliverables

1. Load the question/topic/draft/recordings with one owner-authorized server composition. Missing/foreign resources resolve to the same safe not-found behavior.
2. Implement draft `PUT` with complete-content upsert, max length validation, common response envelope, and owner/admin authorization.
3. Build an explicit-save draft editor. Track clean/dirty/saving/saved/error states, preserve text after failure, display last successful save time, and warn before navigation only while dirty or recording.
4. Compose recorder states from the UI contract: permission request, denial/unavailable, preview, active recording with monotonic timer, local review, upload progress, queued status, and error.
5. Do not request camera/microphone on page load. Stop every media track and revoke every Blob URL on discard, successful handoff, route navigation, and unmount.
6. Allow local playback before upload. Discard removes only local state; it must not create a recording row.
7. Upload via task 05's direct storage transport and complete endpoint. Disable duplicate upload/complete actions.
8. Render all server recording states with shadcn status badges, safe explanation, applicable retry/delete actions, duration, and created time.
9. Refresh non-terminal states with bounded polling that pauses when the page is hidden and resumes on visibility. Avoid one timer per attempt; fetch the question's attempt list as a group.
10. Load YouTube iframe/player only after user activates a ready attempt. Preserve standard controls and minimum player dimensions. Do not expose storage playback.
11. Handle a YouTube result forced to private with a blocking explanation; never show an endlessly broken player as ready.
12. Ensure multiple attempts are usable without loading many iframes or causing layout shift.
13. Provide responsive two-column desktop and stacked mobile layout using only shadcn primitives plus native video/YouTube elements.

## Required behavioral tests

- Draft persists across refresh and empty draft is valid.
- Draft save failure retains editor text and remains retryable.
- Foreign question cannot be loaded or draft-updated.
- Starting recording does not create a server row; upload initiation does.
- Double-clicking upload/complete cannot create duplicate attempts/jobs.
- Permission denial and missing device become actionable UI states.
- Track cleanup runs on each terminal/unmount path.
- Polling pauses when hidden and stops after all attempts are terminal.
- Iframe is absent before play intent and present only for `READY`.

## Acceptance

- Full journey works with a real camera/microphone in a browser through HTTPS/localhost.
- User can save a draft and create multiple attempts for one question.
- Reload during queue/processing restores server status.
- Mobile at 375 px has no horizontal overflow and controls remain at least 44 px targets.
- Keyboard user can save, record/stop, upload/discard, retry/delete, and play.
- No camera stream remains active after leaving the page.

## Focused verification

Use a real browser at desktop and 375 px:

1. Save/reload/edit an empty and non-empty draft.
2. Grant camera/mic, record, review, discard.
3. Record again, upload to real MinIO, and observe queued status.
4. Simulate worker status progression and verify grouped polling/terminal stop.
5. Deny permission and test missing device messaging.
6. Navigate away while dirty and while recording.
7. Activate a ready YouTube attempt and verify on-demand iframe/playback.

Run only practice/draft component/API tests plus the real surface checks.

## Non-goals

- No autosave, draft version history, AI feedback, transcript, waveform, or teleprompter.
- No library management UI beyond navigation context.
- No queue/admin controls.

## Handoff

Report page route, draft API, recorder state mapping, polling interval/backoff, accessible labels, and any integration expectation for task 09.
