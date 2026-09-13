# UI/UX contract

## Direction

A focused study workspace: calm neutral surfaces, indigo primary actions, green success/progress, restrained motion, and dense enough information hierarchy for repeated daily use. Avoid playful claymorphism, decorative gradients, glass effects, and dashboard clutter.

Use shadcn/ui open-code components and semantic Tailwind tokens. Composite feature components are expected; recreating primitive buttons, dialogs, fields, tabs, badges, tables, dropdowns, or toasts outside shadcn is not.

## Foundation

- shadcn/ui with one base primitive system selected during task 01 and used consistently.
- Tailwind CSS through the shadcn-supported setup.
- Lucide icons only; no emoji as structural icons and no second icon family.
- System/Geist-style sans typography; no external decorative font requirement.
- Light and dark themes using semantic CSS variables.
- 4/8 px spacing rhythm and maximum readable content widths.
- Visible keyboard focus and text contrast meeting WCAG AA.
- Motion respects `prefers-reduced-motion`.

## Route map

```text
/login
/library
/library/topics/:topicId
/practice/questions/:questionId
/admin/users
/admin/users/:userId
/admin/youtube
/admin/queue
```

`/` redirects authenticated users to `/library` and unauthenticated users to `/login`.

## App shell

Desktop:

- Left sidebar: Library; admin-only Users, YouTube, Queue.
- Header: page title/breadcrumb, theme toggle, account dropdown/sign out.
- Main content scrolls independently without being hidden under fixed UI.

Mobile:

- Header with navigation Sheet trigger.
- Same information architecture; do not create a separate mobile feature set.
- All pointer targets at least 44 by 44 CSS pixels.

Use optimistic cookie presence only for fast redirects if desired. Protected layouts and APIs must load the database-backed session.

## Screens

### Login

Use shadcn Card, Form, Input, Button, Alert. Support password manager/autocomplete and paste. Show a generic invalid-credentials message without revealing account existence. No sign-up link.

### Library

- Header with Create topic and Manage tags actions.
- Search field and multi-select tag filter.
- Active filters rendered as removable Badge controls.
- Topics shown as accessible cards/list rows with title, description excerpt, tags, question count, and update time.
- Empty state explains the first action; it does not use illustrations as a substitute for text.
- Tag management uses Dialog on desktop and may use Drawer on narrow screens, using shadcn primitives.

### Topic detail

- Topic title/description/tag editor.
- Ordered questions with prompt excerpt and actions.
- Add/edit question in Dialog or Sheet.
- Reordering must include keyboard-accessible up/down controls even if drag-and-drop is later added.
- Delete confirmations state consequences clearly.

### Practice workspace

Desktop two-column layout:

- Main column: full question, draft Textarea, explicit Save button and saved/error timestamp.
- Side/secondary column: recorder panel and attempts.

Mobile stacks question, draft, recorder, then attempts.

Recorder states:

1. Permission not requested: explanatory text and Enable camera button.
2. Permission denied/unavailable: actionable browser/security guidance.
3. Preview ready: live muted preview, camera/mic labels, Start recording.
4. Recording: red semantic status, elapsed time, Stop button; prevent accidental navigation with a confirmation.
5. Local review: playback, Upload attempt, Discard.
6. Uploading: byte progress where available and Cancel only when cancellation is safe.
7. Uploaded/queued: local object no longer exposed to the browser; durable server status takes over.

Attempts use cards/list rows containing creation time, duration, status badge, retry/delete actions as applicable, and a 16:9 player only in `READY`. Do not initialize every YouTube iframe in a long list; use a thumbnail/player placeholder and load the iframe on user intent.

### Admin users

- shadcn Data Table with server pagination/search.
- Create user Dialog with name, email, password, role.
- User detail shows account controls and a link/selector to browse that owner's data.
- Destructive actions require confirmation; final-admin protection errors remain visible.

### YouTube settings

- Connection status, channel title/ID, last verified time.
- Connect/Reconnect and Disconnect actions.
- Warning that unlisted links are accessible to anyone who obtains them.
- Distinct blocking notices for disconnected OAuth, reauthorization required, API project private restriction, and quota exhaustion.

### Queue

- Aggregate counts by recording state.
- Recent failed records with owner, question, stable failure code, safe message, attempts, and retry link/action.
- Never expose BullMQ payload internals, OAuth/provider response bodies, tokens, presigned URLs, or raw stack traces.

## shadcn component map

Use the appropriate standard component rather than styling generic elements to imitate it:

- Navigation: Sidebar, Breadcrumb, Sheet, Dropdown Menu.
- Content: Card, Badge, Separator, Tabs where semantically useful.
- Forms: Form, Field/FormField, Input, Textarea, Select, Checkbox, Label.
- Overlays: Dialog, Alert Dialog, Sheet/Drawer, Popover, Tooltip.
- Feedback: Alert, Progress, Skeleton, Sonner/Toast.
- Data: Table/Data Table, Pagination.
- Loading actions: Button disabled state plus Spinner; no layout-shifting label widths.

Native `<video>` is required for camera/local preview. Standard YouTube iframe/player UI must not be hidden or replaced.

## Error and loading behavior

- Keep user-entered form/draft content after failures.
- Field errors appear next to fields; multi-field submission also provides an error summary focused after submit.
- Skeletons mirror final layout. Do not use full-page spinners for routine data loads.
- Disable duplicate mutations while a request is active.
- Display user-safe error codes/messages returned by the custom API contract.
- Recording and queue status must survive reload; never rely solely on client state.

## Responsive/accessibility verification

Every web-owning task verifies relevant surfaces with a real browser at:

- 1440 px desktop.
- 768 px tablet.
- 375 px mobile.

Also verify:

- Keyboard-only navigation and visible focus.
- Labels and error relationships for forms.
- Screen-reader names for icon-only controls.
- Color is not the sole state indicator.
- Reduced motion.
- Camera stream tracks stop on discard, route change, and component unmount.
- No sticky header/sidebar obscures focused elements.
- YouTube player remains at least 200 by 200 pixels and preserves 16:9 where possible.
