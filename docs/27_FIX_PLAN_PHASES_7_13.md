# Fixli: Plan to Fix Phases 7–13

> Date: 2026-10-11. Input: doc 26 (the audit). Every finding number below (e.g. **7.2**, **P0-1**) refers to doc 26.
> Rule for every fix phase: done means it is **verified**: type checks pass, unit tests pass, **end-to-end tests on a real Postgres (+ Redis) pass in CI**, and the migrations match the schema. The Phase 1–6 standard.
> Order matters. F0 must land first; nothing else can be tested until the API starts and the database matches the code.

## Progress

| Fix phase | Status | Notes |
|---|---|---|
| F0 | **Done (2026-10-11)** | API starts; 3 hand-written migrations (enum values / new tables / legacy chat+payment copy and drops), tested on a fresh database and on a Phase 6 database holding old rows; no drift. Circular dependency removed (new global `RealtimeModule`; the `/rt` gateway attaches its server). Sweeper: the advisory lock (broken behind Prisma's connection pool, a latent Phase 5 bug) replaced by a `SchedulerLease` row plus an in-process overlap guard, with end-to-end tests. Existing admins get `Super Admin` until roles are managed (F1.4). CI restored: Postgres + Redis, migrations on an empty database, drift check, e2e, admin/web build, mobile tests and Android bundle, a blocking production audit. Admin/web `typecheck` now uses `tsc -b`, because `tsc -p` on a references-only tsconfig checked nothing. Dependency fixes: multer 2.4, lodash 4.18, js-yaml 4.3.2 via overrides; unused `react-native-masked-text` removed; 2 advisories with no fix (node-forge in Expo CLI, braces in dev tooling) ignored with ids in `package.json`. Node pinned to 22 (`.nvmrc`). Junk files untracked (history not rewritten, D-F1). 229 API unit + 114 e2e + 25 shared + 59 mobile tests; all CI steps pass locally. Still to do on GitHub: make CI a required check on `main`. |
| F1 | **Done (2026-10-11)** | **Staff live feed:** the fake-token `/admin` socket is deleted; staff join permission rooms on the authenticated `/rt` connection; events are sent after the database commits. **Permissions:** one map (`common/auth/permissions.ts`) and a global guard that denies by default; every admin route names a permission, and an end-to-end test fails if any admin-only route doesn't. Shared routes (job and dispute detail, private file links) also check staff permissions, so ID documents need `documents.view`. Phones and emails are masked without `pii.view`; the full-detail view is audited. Staff roles API (Super Admin; signs the person out); suspend signs out at once and audits before/after; admin query parameters validated. **Two-factor sign-in:** own RFC 6238 implementation (checked against the RFC test values), secret AES-256-GCM encrypted at rest, enrolment with a 10-minute setup token that can't be used as an access token, 10 single-use recovery codes, Super Admin reset; admin portal sign-in and QR setup screens. `pnpm admin:create` creates the first Super Admin; the dev seed admin is Super Admin. **No fake system messages:** `isSystem` removed from every input; system messages stored as a key plus parameters. **Files:** chat images, start/finish photos, change-order photos and dispute evidence accept only the caller's own uploads (`storage.consumeFiles`, real MIME type, used once); responses carry signed links, never keys. **Privacy:** chat pushes no longer include the message text; contacts' numbers removed from logs, with a test that fails on log lines carrying phone/password/token/text fields. New env: `ADMIN_TOTP_REQUIRED`, `TOTP_ENCRYPTION_KEY` (required in production). 242 API unit + 135 e2e (21 new security tests) + 25 shared + 59 mobile tests; full CI passes locally. Left for later: the admin portal has no change-password page (F6); no replay protection for a TOTP code within its 90-second window (low risk with the login rate limit; add with F6). |
| F2 | **Done (2026-10-11)** | **Confirmation:** only the customer (or admin) can complete a job; the worker's `/complete` is gone. A finished job auto-completes after `AUTO_CONFIRM_HOURS` (24) unless a dispute is open; it's flagged `autoConfirmed` and both sides are told. Customers can cancel up to "arrived"; cancelling after the worker set off is recorded as late. One status list for "busy" and "on a job now": a worker on the way, on site or working can't be booked for anything starting within 3 h; booked windows block overlaps (including jobs awaiting confirmation). **Photos:** Start needs a before photo and Finish an after photo (the worker's own uploads, saved in the same transaction), or a stated reason; the app has a camera-first step. **Change orders:** one at a time, under a lock on the job; currency always the job's; approval sets the agreed price to the new total (recorded from → to), decline keeps it; both sides told live; the app takes the new total in rupees. **Every step notified** (on the way, arrived, started, finished/please confirm, confirmed to the worker, auto-confirmed) and shown as a chat line. **Live location:** only the assigned worker, only while on the way; forwarded at most every 5 s with an approximate ETA (straight line × 1.3 at `AVG_TRAVEL_SPEED_KMH`, behind a `RoutingProvider` interface); stored at most every 30 s and deleted after `LOCATION_RETENTION_DAYS` (30). The customer's own location is no longer tracked, and the map has no made-up coordinates. **Calling:** each side can reveal the other's number while booked (audited), hidden afterwards. Shared `LeaseService` for background jobs. Job lists understand the new statuses (they returned 400 before) plus an `active`/`past` group used by Today and Jobs. 254 API unit + 145 e2e (10 new lifecycle tests) + 25 shared + 63 mobile tests; full CI passes locally. Not done: sending location in the background (foreground only; needs the Play disclosure screen); masked calling via a provider; the app flow is not yet tried on a phone. |
| F3 | **Done (2026-10-11)** | **PKR root cause found:** Node 22 (ICU 78, what CI runs) reports PKR with 0 decimals and Node 24 (ICU 77) with 2, so asking `Intl` turned the same "1500" into Rs 1,500 on one machine and Rs 15 on another. Decimals now come from one fixed table in `@fixli/shared` (`money.ts`, with string arithmetic, no float rounding), used by server, app and price form; PKR tests restored and run on Node 22 as well as 24. **Cash:** one payment per job (database-enforced); the amount is always the agreed total (requests with an amount are rejected); confirmation is race-safe, so five simultaneous confirms book the commission once; "I didn't pay that" opens a payment dispute with no fee; unanswered cash auto-confirms after `CASH_AUTO_CONFIRM_HOURS` (48). **Ledger:** + = owed to Fixli; every entry is written under a lock on the worker row, has a unique key per real event, and keeps an exact running balance. **Commission and limits (O8 placeholders, as configuration):** `CountryConfig` per country (12 %, Rs 100 min, Rs 1,500 max; soft Rs 3,000, hard Rs 5,000, 7 days; JazzCash / Easypaisa / bank). Over the hard limit or owing too long, the worker is paused: no matching, no direct requests, no offers, and told why. **Settlements:** the worker reports amount, rail and reference; Finance (`finance.settle`) confirms or rejects; audited; the balance and the pause update. `PaymentProvider` interface with a cash implementation. **Earnings:** income (confirmed cash) vs Fixli fee vs net, week or month in the worker's own timezone, today, owed, limits, rails, pending settlement; cursor ledger; new Earnings screen and Today card. **Disputes:** fixed categories, one open per job, amount at most the price, other party told; resolving can confirm or void a disputed payment and post a ledger correction (`finance.adjust`). **Reviews:** tags from a fixed list per role (the app's review form was always rejected before: it sent `targetId`); ratings count published reviews only; customer ratings private. **Favourites** validated, with a heart on profiles and a Favourites list; **Book again** asks the same professional first. **Account deletion** (password; refused during a job or with money owed): signs out everywhere, cancels open requests and prices, anonymises the profile, keeps money history; screen in both apps. Migration fixes old data: removes duplicate cash payments, flips the old negative-debt convention, reverses double-charged commission with a visible adjustment, recomputes balances. 266 API unit + 160 e2e (15 new money tests) + 29 shared + 64 mobile tests; full CI passes locally. Not done: admin pages for settlements and disputes (F6); card/wallet providers (legal L5); the account numbers for the settlement rails are not configured (ops). |
| F4 | **Done (2026-10-12)** | **Live delivery:** messages are sent over REST (idempotent by `clientId`, rate-limited) and the server pushes `message.created` to everyone in the chat, the sender's other phones included, plus `message.read` (read ticks), `conversation.updated` (list and badges) and `chat.typing` (one signal per 3 s), across API instances. The old socket send path and the `newMessage` event the app listened for are gone. **Links:** one `routes` list in `@fixli/shared`; the server builds every notification link from it (a test fails on hand-written paths), and an app test checks each route has a screen. Fixed on the way: "dispute updated" sent the customer's link to the worker. **Blocking everywhere:** a block in either direction stops messages, matching (SQL), direct requests, sending prices, booking a blocked worker's price, and hides their prices; Profile → Blocked people to unblock. **Reports** become `REPORT_USER` safety incidents with a reason from a fixed list, sent to the staff safety feed. **Contact-sharing:** a new detector (Urdu and Arabic digits, phone runs, links, emails, WhatsApp and the like) that doesn't fire on prices or times; the message is sent as written and flagged for review, and only the sender sees a reminder (no chat line both people see). **Closing:** chats close some days after the job ends (`closedAt` shown in the app); an open dispute keeps or reopens the chat. **App:** a persisted chat outbox (sent in order, once, after going offline or restarting; "Not sent · Tap to retry" when the server refuses); a rebuilt thread screen (sending/sent/read ticks, photos via CHAT_PHOTO uploads, typing, date separators, block and report, closed or blocked state, link to the job); a rebuilt Messages list; "Message" buttons on both job screens. 287 API unit + 169 e2e (9 new two-instance chat tests) + 29 shared + 75 mobile tests; full CI passes locally. Seen once and not reproduced in five reruns: the realtime suite failed with a database error on its first run after the new chat suite was added (full suite, fresh database, realtime alone). Watch for it in CI. Not done: system lines in the reader's language (F7); RTL check of the chat screens (F7). |
| F5 | **Done (2026-10-12)** | **Emergency numbers** come from `CountryConfig` for the user's country (PK today: Police 15, Rescue 1122, the Phase 2 reference list; nothing new invented, D-F6); the app caches them, so they still show with no signal. **SOS screen:** 5-second cancellable countdown, then "Someone is in danger" / water / electric / gas. **Life-threatening** (and in-job SOS for either side): big call buttons, the safety team is told live, trusted contacts are texted; **no professional is ever sent**; the wording never claims Fixli contacted anyone. **Water / electric / gas:** safety steps first, then an urgent job offered to the **nearest free, verified worker** (skips anyone on a job right now) with `SOS_ACCEPT_SECONDS` (180) to accept; a decline moves on at once, a timeout within 15 s (sweeper with a lease); after `SOS_DIRECT_TRIES` (3), or nobody near, normal offers to everyone nearby and the customer is told. Each step is on the job timeline; a cancelled job stops the dispatch; a booked job ends it whatever order events arrive in; a double tap is one emergency (unique key). **Trusted contacts:** numbers normalised for the country (Phase 2 rules), at most 5 (locked), not your own number. Alerts go through an `SmsProvider` interface; with no provider chosen (D-F5) the app says plainly that contacts were **not** told. Never logged. **Reports** must be about your own job and the other person on it; non-urgent reports are rate-limited (life-threatening never). Every safety sentence sits in one file per side for legal review (`safety/safety-copy.ts`, `src/safety/copy.ts`), with an app test that blocks "we called the police"-style claims and hard-coded numbers. 293 API unit + 180 e2e (11 new SOS tests) + 29 shared + 77 mobile tests; full CI passes locally. Assumption to confirm: a gas smell goes to plumbers (there's no gas category). Not done: real SMS (provider, D-F5); Urdu/Arabic safety text (F7, O13); the admin safety console page (F6). |
| F6 | **Done (2026-10-12)** | **Admin actions use the job rules:** cancel goes through `JobsService.cancel` as admin (event, both sides told, finished jobs refused); new **reassign** takes a booked job back from a worker who won't come (accepted, on the way or arrived), tells both, and re-runs matching without them. **Suspend** signs out everywhere, cancels the person's open requests, withdraws their pending prices, and flags live bookings for Ops (timeline note plus a list in the portal; D-F8). **Reactivate** added. **Dashboard** on real data, with a date range: users, workers online, jobs by status, fill rate, median time to first offer, cancellations by reason, open disputes and incidents, GMV (confirmed cash), commission owed and settled. **New pages:** job detail (timeline, payments, extra work, problems; chat transcript needs `chat.read` and is audited); Safety console (incidents, detail, notes, status); Disputes (signed evidence, payment, resolve with cash outcome and ledger change); Finance (settlements to confirm or reject, what each worker owes with their ledger and corrections booked once per click, job payments); Reviews (queue, hidden, hide / show again / it's fine); Catalogue (names in en/ur/ar, common problems by code, hidden items still visible to staff, price ranges); Settings (country money settings, payment accounts and emergency numbers, **versioned**, no silent overwrite; feature switches); Staff (create with a one-time password, roles, reset two-step); Audit log (filters, paging); My account (change password). **Review moderation:** users can report a review (fixed reasons); insults or a bare one-star review are flagged automatically (the old "every 1-star" rule is gone); hiding recomputes the rating from published reviews. **Feature flags:** database value, then env, then default (`REQUIRE_JOB_PHOTOS`, `SHOW_PRICE_BANDS`), cached 30 s. **TOTP replay protection:** a code works once (last step stored). **Portal:** menu and routes follow your permissions (from `GET /admin/v1/me`); live feed over `/rt` with badges, toasts, a live indicator, and pages reload after a reconnect. New permissions `jobs.manage`, `chat.read`, `safety.manage`, `config.edit` (Super Admin only, D-F9). Catalogue staff changes (category and service create/edit) are now audited; an e2e test finds every staff-only change route and fails if one was not called or wrote no audit row. One migration (`20261012200000_admin_console`); a duplicate migration made by another tool in the working tree was deleted. 297 API unit + e2e (17 admin console tests) + 29 shared + 77 mobile tests; full CI passes locally. Limits: the portal's money input assumes 2 decimals (fine for PKR; revisit with a second currency); price ranges are not shown in the app until O1 (`SHOW_PRICE_BANDS` off); the portal has no automated UI tests; doc 22 visual alignment (F6.6) only partly done (the portal already has light and dark themes; no full token pass). |
| F7 | **Done in code (2026-10-12); the device checks and user testing are open** | **Offline (F7.1):** a general outbox on the phone (kept across restarts; each item has a stable key; sent in order per job; waits 2 s, 4 s … up to 1 min; sent at once when the connection returns, the app opens or the live link resyncs; a server "no" is shown to the person to retry or remove, never retried forever). It carries **job steps** (accept, decline, on my way, arrived, start/finish **with photos taken offline**, uploaded first) and **new requests** (with "book again"); chat already had its own outbox (F4). The server now treats a repeated step from the same person as done (no second event or notification). Emergencies are never held back: offline, the screen shows the emergency numbers (O2 decided). A bar at the top says "Offline / N waiting / N couldn't be sent / request sent", with a list to retry or remove. The last good answer is shown for the catalogue, addresses, bookings, today's jobs and an open job, labelled "Last updated …", and wiped at sign-out. The old `request()` message "Action saved" (which saved nothing) is gone. **Analytics (F7.2):** typed events in `@fixli/shared` with an allow-list of properties (no free text, so no phone, address, location or message can pass; tested), a random id on the phone, an on/off switch that starts **off**, nothing sent until a provider is set (D-F7). **Languages (F7.3):** all 692 sentences, including error messages, status and timeline lines, and the safety text, now go through `t()` in English, Arabic and Urdu (counts, e.g. "1 job / 2 jobs"; server error codes shown translated); the language is remembered and the screens redraw when it changes; arrows and chevrons flip; a build test fails on any sentence written straight into a screen, on a missing or mismatched translation, and on `t()` called before the language is known. Found and fixed on the way: a tab title showed the raw text `nav.messages`. **Fakes (F7.4):** `DocumentVerification` deleted; a test blocks "AI verified"-style code. **Accessibility and speed (F7.5):** text colours are at least 4.5 : 1 in light and dark (new `…Text` colours; tested), buttons 48/52/56 pt, every button has a role and a label (tested), "Reduce motion" respected, remote photos cached (`expo-image`), bundle size checked in CI (7.3 MB of a 9 MB budget). 297 API unit + 197 e2e + 34 shared + 130 mobile tests (53 new); full CI passes locally. **Not done:** VoiceOver/TalkBack passes, largest-text pass, Urdu/Arabic screenshot pass and the cold-start measurement need real phones (checklist in doc 28); the usability round with real users (owner); Arabic/Urdu are machine drafts for native review (O13) and the safety sentences also for counsel (L10); the Maestro offline test is F8; the native `netinfo` module means development builds must be rebuilt. |
| F8 | Not started | |

## Overview

| Fix phase | What it fixes | Findings | Estimate | Depends on |
|---|---|---|---|---|
| **F0** Make it run | API startup, migrations, CI, admin build, repo cleanup | P0-1…P0-4, 13.3 | 2–3 days | — |
| **F1** Security holes | Admin socket, fake system messages, raw storage paths, admin roles + two-factor login, private data in pushes and logs | 7.2–7.4, 8.1, 10.1 (logging), 11.1–11.4, 11.6 | 4–5 days | F0 |
| **F2** Job lifecycle (Phase 8) | Confirmation, busy statuses, photos, change orders, notifications, live location | 8.2–8.11 | 5–6 days | F0, F1 (uploads) |
| **F3** Money (Phase 9) | Cash, ledger, commission, earnings, PKR, disputes, reviews, account deletion | 9.1–9.10 | 6–8 days | F2 (final price) |
| **F4** Chat (Phase 7) | Live delivery, links, blocking, reports, offline sending, chat features | 7.1, 7.5–7.12 | 5–6 days | F0, F1 |
| **F5** Safety & SOS (Phase 10) | Country config, SOS flow, trusted-contact alerts, property dispatch | 10.1–10.6 | 5–6 days | F2, F4 (incidents, blocks) |
| **F6** Admin portal (Phase 11) | Admin actions through the job rules, real dashboard, missing pages, moderation, live feed in the portal | 11.5, 11.7–11.10 | 6–8 days | F1, F3, F5 |
| **F7** Languages, offline, analytics (Phase 12) | Offline outbox, analytics, translations, RTL, accessibility, performance | 12.1–12.5 | 6–8 days | F2–F6 (screens final) |
| **F8** Release (Phase 13) | Load and resilience tests, Maestro in CI, legal text, store readiness, staging, Sentry | 13.2, 13.4–13.8 | 5–7 days | all |

**Total ≈ 9–11 weeks** for one developer. F2 and F4 can run in parallel, and so can F5 and F6.

Owner decisions are listed in §10; each phase notes which one it waits on. Where a decision is still open we build the recommended default behind configuration, as in Phase 5.

---

## F0: Make it run (2–3 days)

**Goal:** the API starts, a fresh database built from migrations matches the code, and CI would have caught all of this.

### F0.1 Break the ChatModule ↔ NotificationsModule cycle (P0-1)
- Move `RealtimeService` (and the `/rt` server reference) out of `ChatModule` into its own `RealtimeModule`, global and exported.
- `NotificationsModule` imports `RealtimeModule`, not `ChatModule`.
- `ChatService` keeps depending on `NotificationService`. With the cycle gone no `forwardRef` is needed.
- Add an end-to-end smoke test: the app boots and `GET /api/health` returns 200. This is the test that would have caught P0-1.

### F0.2 Write the missing migrations (P0-2)
Three hand-reviewed migrations, in this order:
1. **`…_job_statuses_enum`**: only `ALTER TYPE "JobStatus" ADD VALUE` for `EN_ROUTE`, `ARRIVED` and `AWAITING_CONFIRMATION`, plus `UploadPurpose` `CHAT_PHOTO`. These go alone because Postgres can't use a new enum value inside the transaction that adds it.
2. **`…_phase7_13_tables`**:
   - add the `MediaPhase` enum;
   - create Conversation, Message, MessageRead, Block, Payment, LedgerEntry, Settlement, Incident, TrustedContact, CountryConfig, FavoriteWorker and the `_ConversationToUser` join table;
   - add the new columns on User, JobMedia, ChangeOrder, Review and Dispute;
   - add indexes and foreign keys.
3. **`…_drop_legacy_chat_payments`**: the data step.
   - Copy `ChatThread`/`ChatMessage` rows into `Conversation`/`Message` (`receiverId` becomes a participant). Copy `Transaction` rows into `Payment` with `method='CARD'` and the status mapped.
   - Turn `Review.jobRequestId` into required: delete or archive reviews that have no job first, and keep the old `ON DELETE` behaviour or document the change.
   - Only then drop the old tables.
   - Dev databases hold no real data today, but write the copy anyway: it's cheap, and a staging database may exist by then.

Then:
- run `prisma migrate diff --exit-code`, which must report no difference;
- delete `schema.prisma.bak`;
- add a CI step that runs `migrate deploy` on an empty database, then the diff check.

### F0.3 Restore CI (P0-3)
- `ci.yml`:
  - bring back the Postgres 16 and Redis 7 services and `E2E_REDIS_URL`;
  - bring back the **API end-to-end** step and the **migration drift** check;
  - add `pnpm --filter @fixli/admin build` (this is how P0-4 would have been caught);
  - keep Node 22, the version CI runs on, and pin it in `.nvmrc` so local and CI match.
- Dependency audits: replace `|| true` with a real gate (`--audit-level high`) plus an allow-list file for known, accepted advisories.
- `security.yml`: delete the Maestro step that only does `echo`. Maestro moves to F8, where it really runs.
- Make the GitHub branch rule on `main` require CI to pass.

### F0.4 Admin build (P0-4)
- Use `import type` for `SearchUserRow`, `AdminJobRow` and `LedgerRow`.
- Turn on `verbatimModuleSyntax` in the admin tsconfig so the type check catches this next time.

### F0.5 Repo cleanup (13.3, O11)
- Remove `Prolivo_Product_Documentation.zip`, `scratch_login.tsx`, `screenshot.png` and `schema.prisma.bak` from git, and add them to `.gitignore`.
- History: the zip stays in the history. If it contains anything confidential, decide whether to rewrite history (§10, D-F1).

**F0 is done when:**
- `node dist/main.js` starts;
- the 112 existing end-to-end tests pass in CI;
- a fresh database from the migrations shows no drift;
- the admin portal builds;
- all of this runs on every PR.

---

## F1: Security holes (4–5 days)

### F1.1 Admin socket authentication (11.1)
- Delete `parseTokenSimulated`. The admin gateway uses the same check as `/rt`: a verified JWT, a live session, `type === 'admin'` and an ACTIVE status.
- Read the roles from the database on connect and join `admin:{role}` rooms. Re-check when roles change: when an admin's roles are edited, emit `sessions.revoked`-style events that disconnect that admin's sockets.
- CORS comes from `ADMIN_URL`, not `*`.
- Better: drop the separate `/admin` namespace and put staff in admin rooms on `/rt`. That gives one authentication path and the Redis fan-out for free.
- **Tests (end-to-end):**
  - a forged `admin-<id>` token is refused;
  - a customer's real token is refused;
  - a Safety admin receives incidents but not verifications;
  - logging out drops the socket.

### F1.2 Fake "system" messages (7.2)
- Remove `isSystem` from `SendMessageDto` and from the socket payload. Only server code creates system messages, through a private `postSystemMessage(conversationId, key, params)` helper.
- Store system messages as a **template key plus parameters**, not finished text, so they can be translated (feeds F7).
- **Test:** a client sending `isSystem: true` gets a 400 (the field is forbidden).

### F1.3 One way to attach a file: `storage.consume` (7.3, 8.1, 9.6)
- Replace every raw key from the client with **upload ids** that go through `StorageService.consume(userId, uploadIds, purpose, tx)`. That checks the uploader is the owner, the purpose, and that the upload is complete and sniffed (Phase 3).

| Place | Field today → new field | Purpose |
|---|---|---|
| Chat image | `imageKey` → `imageUploadId` | `CHAT_PHOTO` (private; signed link only to participants) |
| Start / finish photos | `beforePhotoKey` / `afterPhotoKey` → `photoUploadIds[]` | `JOB_PHOTO`, phase `BEFORE` / `AFTER` |
| Change-order photos | `mediaKeys` → `photoUploadIds[]` | `JOB_PHOTO`, phase `CHANGE_ORDER` |
| Dispute evidence | `evidenceKeys` → `uploadIds[]` | `JOB_PHOTO`, phase `DISPUTE` |

- Store the real MIME type from the sniff, not a hard-coded `image/jpeg`.
- Media is always returned as short-lived signed links, never as keys (as in Phase 4 `present()`).
- **Tests:** passing someone else's upload id, an ID-document upload, or a made-up key gives 400/404.

### F1.4 Admin roles that work, and two-factor login (11.2–11.4, 11.6)
- Write roles down as a **permission map**, not ad-hoc lists. For example:
  - `verification.read` / `verification.decide` → Verification, Super Admin;
  - `documents.view` → Verification;
  - `finance.*` → Finance;
  - `users.suspend` → Operations, Safety;
  - `audit.read` → Auditor, Super Admin;
  - and so on.
- Every admin route declares one permission. A unit test lists all `/admin/v1` routes and **fails if any route has no permission**. The guard **denies by default**.
- **Assigning roles:**
  - a seed/CLI command `pnpm admin:create --email --roles` for the first Super Admin;
  - `PATCH /admin/v1/staff/:id/roles` for Super Admin only, audited;
  - an existing admin with no roles is migrated to `['Super Admin']` once, so nobody is locked out.
- **Two-factor login (TOTP):**
  - setup endpoints `POST /auth/admin/totp/setup` (returns an otpauth URI and QR code) and `POST /auth/admin/totp/verify`;
  - admin login becomes password, then a 6-digit code;
  - the TOTP secret is encrypted at rest;
  - 10 one-time recovery codes (stored hashed);
  - required for every staff account (`ADMIN_TOTP_REQUIRED`, default true; false only in tests);
  - library: `otplib`.
- Mask phone numbers in staff lists (`03xx •••• 567`) for roles without `pii.view`. Show the full number only on a detail view, and audit that view.
- Validate admin query parameters with DTOs; an invalid `status` gets a 400, not a 500.
- **Tests (end-to-end):**
  - a Verification admin gets 403 on `/payments`;
  - a Finance admin gets 403 on verification documents;
  - login without a code fails;
  - every admin mutation writes an audit row.

### F1.5 Private data in pushes and logs (7.4, 10.1)
- The `chat.message` push becomes "New message from {first name}" / "Open Fixli to read it". The in-app list shows the same: no message text stored in `Notification.body`.
- Remove contact names and phone numbers from all logs. Add a log redaction helper for `phone`, `token` and `password`, and a unit test that greps the source for `logger.*phone`.

**F1 is done when** every test above passes and a written review checks each new route against the Phase 1 rules: identity from the token, ownership checked, the DTO validated, and private data neither logged nor pushed.

---

## F2: Job lifecycle, Phase 8 done properly (5–6 days)

### F2.1 State machine and confirmation (8.2, 8.11)
- Remove the worker from `AWAITING_CONFIRMATION → COMPLETED`; allow only the customer and admin.
- Delete `POST /job-requests/:id/complete`, or make it admin-only.
- **Auto-confirm:** the sweeper completes jobs still `AWAITING_CONFIRMATION` after `AUTO_CONFIRM_HOURS` (default 24, see D-F2). It records the event `AUTO_CONFIRMED` with flag `autoConfirmed: true` and notifies both sides.
- "Report a problem" during the wait (opens a dispute, F3) stops auto-confirm.
- One customer-cancellation rule shared by the state machine and `CANCELLABLE_BY_CUSTOMER`: allowed up to `ARRIVED`. After `EN_ROUTE`, a cancellation records a "late cancel" event, to feed fees later; no fee now.
- Keep the job state machine spec in sync: a table test covering every `(from, to, actor)` pair.

### F2.2 Busy statuses (8.3)
- `BUSY_STATUSES = ['ACCEPTED','EN_ROUTE','ARRIVED','IN_PROGRESS','AWAITING_CONFIRMATION']`, exported from the state machine (one source of truth).
- An `EN_ROUTE`/`ARRIVED`/`IN_PROGRESS` job blocks the worker regardless of time window. That is today's `IN_PROGRESS` rule, extended.
- **End-to-end test:** a worker on the way to job A can't be booked for an overlapping job B.

### F2.3 Before/after photos (8.6)
- `start` requires at least one `BEFORE` photo and `finish` at least one `AFTER` photo (`REQUIRE_JOB_PHOTOS`, default true). Photos are consumed **inside the same transaction** as the status change.
- App:
  - a camera-first "Take a before photo" step on Start and an "after photo" step on Finish;
  - upload with retry (reuse `usePhotoUpload`);
  - both sides see the before/after in `JobMedia`, grouped by phase;
  - if the camera isn't allowed, a "Skip with reason" path that records the reason (rule from doc 22).

### F2.4 Change orders that change the price (8.4, 8.5)
- `ChangeOrder` stores `newTotal` and `currency`, the latter **taken from the job**, never from the client or USD.
- At most one pending change order per job; a second one gets 409.
- Approving runs in one transaction:
  - the order becomes `APPROVED`;
  - `JobRequest.agreedAmount` becomes `newTotal`;
  - a `JobEvent` `CHANGE_ORDER_APPROVED` records `{ from, to }`.
  Declining leaves the price as it is.
- Notifications plus `job.updated` to the other side for created, approved and declined.
- App: the worker form uses `PriceForm` (major units, `parseMajorToMinor`) showing "current total → new total". The customer gets an approve/decline sheet with the reason, photos and new total.
- **Tests:** a unit test for minor-unit conversion; an end-to-end test that approval changes `agreedAmount` and the cash step then expects the new total.

### F2.5 Notifications and system messages for every step (8.7, 8.8)
- `announce()` covers:

| Event | To | Type |
|---|---|---|
| `EN_ROUTE` | customer | `job.en_route` (push + chat system message "on the way") |
| `ARRIVED` | customer | `job.arrived` |
| `WORK_STARTED` | customer | `job.started` (exists) |
| `WORK_FINISHED` | customer | `job.awaiting_confirmation` ("please confirm and pay") |
| `WORK_COMPLETED` by customer | **worker** | `job.confirmed` |
| `AUTO_CONFIRMED` | both | `job.auto_confirmed` |

- Add the templates in en/ur/ar.
- Fix the system-message condition: write it from the event type, not from `to`.
- **End-to-end test:** the full on-site sequence produces exactly these notifications for exactly these people.

### F2.6 Live location (8.9)
- Remove `useCustomerLocationTracker` from the root layout. Customers' location is read only when filling an address.
- The worker sends location only while `EN_ROUTE`, in the foreground. Background sending only after a clear disclosure screen (Play policy), behind a setting.
- The server:
  - forwards locations to the job's customer;
  - throttles them to one per 5 seconds per job;
  - stores **at most** one point every 30 seconds in `JobLocationPoint (jobId, lat, lng, at)`;
  - deletes stored points after `LOCATION_RETENTION_DAYS` (D-F3) through the sweeper.
- **ETA:** a `RoutingProvider` interface. The first adapter is straight-line distance ÷ an average city speed (configurable), labelled "about". A real routing adapter comes later.
- Map: no hard-coded Karachi or `0,0`. If there are no coordinates, show "Waiting for location…".

### F2.7 Calling (8.10, O7 default)
- After booking and until the job ends, show the other side's number behind a "Call" button (the `tel:` link). Audit the reveal; hide it after completion.
- A masked-call provider is a later adapter.

**F2 is done when** an end-to-end test runs two parties through accept → en-route → arrived → start (with a photo) → change order approved → finish (with a photo) → customer confirms, and also the auto-confirm path. Illegal transitions are rejected and double-booking is blocked.

---

## F3: Money, Phase 9 done properly (6–8 days)

> Waits on **O8** (commission and cash rules). We build with the O8 placeholders as configuration: 12 %, PKR 100 minimum, PKR 1,500 maximum, soft limit PKR 3,000, hard limit PKR 5,000, 7 days.

### F3.1 Money configuration from the country
- Populate `CountryConfig`, seeded from `packages/shared` countries so there's one source:
  - currency;
  - `commission { rateBps, minMinor, maxMinor }`;
  - `cashLimits { softMinor, hardMinor, maxDaysOwed }`;
  - `emergencyNumbers` (used by F5);
  - `settlementRails` (for example `["JAZZCASH","EASYPAISA","BANK"]`).
- A `CountryConfigService` with a cache; admin editing comes in F6.

### F3.2 Cash, done safely (9.1, 9.2, 9.3)
- **One Payment per job** (`@@unique([jobRequestId])` for the CASH method).
- `POST /job-requests/:id/payments/cash` (worker):
  - the amount isn't sent at all; it is always the job's `agreedAmount` and `agreedCurrency` (including approved change orders);
  - idempotent: calling it again returns the same payment;
  - allowed in `AWAITING_CONFIRMATION` or `COMPLETED`.
- `POST /payments/:id/confirm` (customer): a conditional `updateMany where status = MARKED_BY_WORKER`, then the ledger write **in the same transaction**. The loser of a race gets the already-confirmed payment, with no second commission.
- `POST /payments/:id/dispute` (customer: "I didn't pay that"): the payment becomes `DISPUTED`, a Dispute opens (F3.5), and no commission is charged until it's resolved.
- Auto-confirm cash after `CASH_AUTO_CONFIRM_HOURS` (default 48) with the flag `autoConfirmed`.
- **The ledger:**
  - lock the worker row first (`SELECT … FOR UPDATE`), as in Phase 5 booking, then read the balance and write;
  - add a `Worker.ledgerBalance` column, updated in the same transaction (no "newest row" read);
  - `LedgerEntry` gets `@@unique([jobRequestId, type])` so commission can never be charged twice for one job.
- Commission is `clamp(round(amount × rateBps / 10 000), min, max)` in minor units, in an integer-only helper with tests.
- **Limits:**
  - if the amount owed is over the soft limit, the worker sees a warning card;
  - over the hard limit or the day limit, matching skips the worker, Today shows "Settle your balance to get new jobs", and offers are refused (`COMMISSION_LIMIT`).
- **Settlement:**
  - `POST /workers/me/settlements` (worker reports a payment: rail and reference);
  - Finance confirms in admin (F6), which writes a `COMMISSION_SETTLED` entry;
  - the rails and instructions come from country configuration.
- A `PaymentProvider` interface (`createIntent`, `verifyWebhook`, `refund`) with only a `CashProvider`. No card or wallet until legal L5.
- Notifications plus live updates for cash marked, cash confirmed and payment disputed (9.7). Remove the dead `payment.recorded` event or wire it.

### F3.3 Earnings that are correct (9.4, 9.8)
- `GET /workers/me/earnings?period=week|month` returns:
  - `{ currency, periodStart, gross, commission, net, jobs, owed, owedSince, limits }`;
  - the periods are computed **in the worker's timezone** (Worker has `timezone`);
  - gross means the confirmed cash amounts, not commission.
- `GET /workers/me/ledger?cursor` uses cursor paging, as notifications do.
- One response shape, written in `packages/shared` and imported by both the API and the app, so the app and the server can't drift apart again (the cause of 9.4).
- Earnings screen:
  - week/month totals and a per-job list;
  - an "owed to Fixli" card with settle-up instructions;
  - "Today" earnings on the Today tab.

### F3.4 Reviews (9.9)
- `tags`: at most 5 from a fixed list per role (validated), each at most 30 characters.
- The rating counts only `PUBLISHED` reviews. Recompute when moderation hides one (F6).
- Customer ratings are stored as well, but not shown publicly (doc 22).

### F3.5 Disputes (9.6, 9.7)
- A validated DTO: category from a fixed list, `amountHeldMinor` an integer between 0 and the job total, evidence through `storage.consume` (F1.3).
- One open dispute per job.
- Opening one stops payment auto-confirm and blocks settlement for that job.
- Both parties get notifications and live updates on status changes.
- Resolving one (F6) can write a ledger `ADJUSTMENT` or `REFUND` entry in the same transaction, with an audit row.

### F3.6 Favourites, rebook, history (9.8)
- Favourites: check that the worker exists and is ACTIVE; unknown ids get 404, not 500. A heart on the worker profile and on the completed job, plus a Favourites list in Profile.
- **Book again:** opens the request flow prefilled with the category, issues and address, and offers to send it to that worker first (direct request).
- Bookings → Past: the job, before/after photos, the price including change orders, and a receipt (a simple view, shareable as text or a PDF image later).

### F3.7 Account deletion (9.5, store requirement)
- `DELETE /users/me` with password re-entry. In one transaction:
  - revoke every session, which also drops sockets and push tokens (the Phase 6 path);
  - cancel open requests and offers;
  - refuse while there is an active booking ("finish or cancel your job first") or a worker balance is owed;
  - anonymise: name "Deleted user", remove avatar, addresses, trusted contacts, portfolio and favourites; the phone becomes a hash so it can be registered again;
  - keep the financial and audit records (D-F4).
- App: Profile → "Delete account" with a confirmation that explains the consequences.
- **End-to-end test:** after deletion the old token gets 401, the socket drops, and the phone can sign up again.

### F3.8 PKR (9.10)
- Restore the PKR tests (API and app). Run them on **Node 22 (CI), Node 24 (local) and Hermes**. For Hermes, add a jest-expo test plus a one-off check on a device.
- If the platforms disagree about PKR decimals, stop asking `Intl` how many decimals a currency has. Keep a **fixed currency table in `packages/shared`** (`PKR: 2, SAR: 2, AED: 2, KWD: 3, JPY: 0…`) used by both server and app for the conversion. Use `Intl` only for display.
- Add a test that the server and the app turn the same input into the same minor units.

**F3 is done when** an end-to-end script with a set of scripted jobs gives a ledger total equal to the sum of the payments. Duplicate or concurrent mark/confirm requests charge commission once. The hard limit stops new offers. Earnings match the ledger. Deletion works as above.

---

## F4: Chat, Phase 7 done properly (5–6 days)

### F4.1 Live delivery, one path (7.1)
- **REST is the path for sending.** It's idempotent through `clientId`, works offline through the outbox, and is rate-limited by the throttler.
- The service, not the gateway, emits through `RealtimeService`:
  - `message.created` to all participants, other devices of the sender included;
  - `message.read` when someone reads;
  - `conversation.updated` for the list.
  Use the Phase 6 envelope.
- The socket `sendMessage` handler is removed, or kept as a thin call to the same service with a per-user rate limit.
- App:
  - `socket.ts` listens for `message.created`, `message.read`, `typing` and `conversation.updated` (remove `newMessage`);
  - the thread swaps the optimistic bubble for the server's message by `clientId`;
  - the Messages tab uses `useLiveReload`.
- **End-to-end test (two instances over Redis):** A sends by REST on server 1, and B's socket on server 2 receives `message.created` once. A reconnecting device resyncs.

### F4.2 Notification links (7.7)
- One route helper in `packages/shared` (`routes.thread(id)`, `routes.customerJob(id)`…) used by server templates and app links.
- Thread route: `/thread/[id]` → `/(shared)/thread/[id]`, or keep `/thread/` and use it everywhere.
- A test that every `data.url` the server produces matches an existing app route file.

### F4.3 Blocking and reporting (7.5, 7.6)
- Block applies across the whole product:
  - matching skips workers the customer blocked, and customers who blocked or were blocked by the worker;
  - no direct requests or offers between the two;
  - `sendMessage` refuses with `BLOCKED`.
  Unblock comes from Profile → Blocked.
- Report creates an **Incident** (`type REPORT_USER`, the reason from a fixed list plus text, the conversation and job linked). It shows up in the admin safety console (F6) and the admin feed. The audit row is kept as well.

### F4.4 Sending reliability and features (7.8–7.11)
- Messages show pending, sent and read ticks. A failed send shows "Not sent · Tap to retry".
- Messages go into the persisted outbox (F7.1) and are sent when back online, exactly once thanks to `clientId`.
- Image messages: pick or take a photo → upload (`CHAT_PHOTO`) → send `imageUploadId`; the image is shown through a signed link.
- Typing indicator: sending is throttled to one event every 3 seconds; it shows "typing…" and stops after 5 seconds.
- Date separators; safe-area header; RTL.
- A "Message" button on both job screens opens the job's conversation.
- **Contact-sharing warning:**
  - a better detector: normalise digits, including Urdu and Arabic numerals, and match phone-number patterns from the country; link pattern `https?://` or `www.` or known domains;
  - a test list of false positives ("Rs 1500.00", "3.5 hours");
  - the warning is shown **only to the sender** as a hint, plus an `isFlagged` field for admin review, instead of a message both people see.
- Socket rate limit: at most 20 messages per minute per user.

### F4.5 Read-only after completion
- Keep `CONVERSATION_READONLY_DAYS` (default 3). The thread shows "This chat closed on {date}". A dispute reopens it for that job.

**F4 is done when** the doc 24 Phase 7 test passes: two devices chat live; messages survive reinstalling; read ticks and unread badges are right; offline messages send once on reconnect; a blocked person can't message, match or offer; a report appears in admin.

---

## F5: Safety & SOS, Phase 10 done properly (5–6 days)

> Waits on **O5/D-F5** (SMS/WhatsApp provider) for real trusted-contact alerts. Until then we build the provider adapter plus an in-app notification fallback. No "simulated" logging.

### F5.1 Emergency numbers from configuration (10.3)
- `CountryConfig.emergencyNumbers` (PK: Rescue 1122, Police 15, Ambulance 115, Fire 16, Gas emergency: the SNGPL/SSGC numbers, to confirm with D-F6). `GET /safety/emergency-numbers` reads the **signed-in user's country**.
- The app caches them for use offline (an SOS must work without a connection).
- The Phase 4 hazard rules show the same numbers (one source).

### F5.2 SOS flow in the app (10.4)
- The SOS button opens a full-screen **SOS screen**:
  - press and hold, then a **5-second cancellable countdown**;
  - choose one: Water / pipe burst · Electrical / fire hazard · Gas smell · Life-threatening.
- **Life-threatening:**
  - large call buttons for the emergency numbers;
  - **never dispatches a worker**;
  - creates an `Incident` (severity `LIFE_THREATENING`) and alerts trusted contacts;
  - the wording never claims Fixli contacted the authorities.
- **Property emergency** (water, electric, gas): safety steps first (for gas: no switches, open windows, leave, call the gas emergency number), then creates the urgent job (F5.3) and shows the live job screen.
- Works with no payment method and no subscription.
- **In-job SOS** for both roles on the job screen, linking the job and the other person to the incident.
- "Report a problem" (non-urgent) on the job and profile.

### F5.3 Property emergency dispatch (10.2, O3e)
- `POST /safety/sos` with `{ kind, addressId | location }` creates an emergency `JobRequest`, idempotently, through `JobsService.create`. Then **auto-dispatch**:
  - offer the job to the **nearest verified, online, available** worker with an `SOS_ACCEPT_SECONDS` window (default 180);
  - if they refuse or time out, try the next one, up to `SOS_DIRECT_TRIES` (default 3);
  - then fall back to normal matching and offers.
  - The sweeper or a timer drives the windows, using the advisory lock.
- The worker sees a full-screen "Emergency nearby" with accept or decline.
- **End-to-end test:** the nearest worker gets it first; a timeout moves to the next; no one accepting leads to normal offers.

### F5.4 Trusted contacts (10.1, 10.5)
- Phone numbers normalised with the Phase 2 phone tools (country-aware, stored E.164). Maximum 5, enforced with a lock or a unique-count check.
- An `SmsProvider` interface (`send(to, templateKey, params, locale)`), using the same provider as OTP (O5). The message: "{name} used the SOS button in Fixli at {time}. Approximate area: {area}. They may need help." No exact address unless the user turns that on.
- Until a provider is configured, the incident is marked "trusted contacts not notified (no SMS provider)" and the user is told so honestly.
- Management screen: Profile → Safety → Trusted contacts.

### F5.5 Incident integrity (10.5)
- `jobRequestId` must be a job the reporter is part of, and `targetId` must be the other party on that job (or a conversation partner). Otherwise 404.
- Incidents are rate-limited, at most 5 per hour per user, without ever blocking a life-threatening one: that is always saved.

### F5.6 Legal review of safety wording (10.6, L10)
- Collect every safety string in one file for counsel. The checklist: no claim that Fixli contacted the authorities, no medical advice beyond basic steps.

**F5 is done when** the doc 24 Phase 10 test passes: SOS works without payment; the numbers come from configuration; life-threatening never dispatches; property dispatch works as tested; incidents appear in the admin safety console (F6).

---

## F6: Admin portal, Phase 11 done properly (6–8 days)

> Builds on F1.4 (permissions and two-factor login).

### F6.1 Admin actions go through the same rules (11.5)
- Admin cancel calls `JobsService.cancel` with an admin actor. That applies the state machine, writes a `JobEvent` (with the reason), notifies both sides, expires offers and returns 404 on unknown ids.
- Admin reassign: a new endpoint that releases the worker, writes an event and re-runs matching.
- Suspend:
  - set the status, **revoke all sessions** (drops sockets and push);
  - cancel open requests; flag active bookings for Ops;
  - audit with before and after.
  Unsuspend too.

### F6.2 Dashboard on real data (11.8)
`GET /admin/v1/dashboard?from&to`:
- users by role;
- workers online now;
- jobs by status;
- **fill rate** (requests that got a booking ÷ requests);
- median time to first offer;
- cancellations by reason;
- open disputes and incidents;
- **GMV** (confirmed cash, PKR);
- commission owed and settled.

Each figure is a tested SQL query on indexed columns. The page shows them with date filters.

### F6.3 Missing pages (11.9)
| Page | Contents | Permission |
|---|---|---|
| Safety console | incidents (live), detail, link to job, chat transcript and parties, status changes, notes | `safety.*` |
| Disputes | evidence (signed), chat transcript, payment, resolution with ledger adjustment | `disputes.*`, `finance.adjust` |
| Payments & ledger | payments, worker balances, settlements to confirm, adjustments | `finance.*` |
| Reviews | flagged reviews, hide / restore (recomputes rating) | `content.reviews` |
| Catalogue | categories, issues, translations, **price bands (O1)** | `content.catalog` |
| Country config | money, limits, emergency numbers; **versioned** (every save is a new version and audited) | `config.edit` |
| Staff | admins, roles, two-factor status, reset 2FA | Super Admin |
| Audit log | filter by actor, entity, action and date | `audit.read` |
| Feature flags | a simple key/value table with an audit trail (for example `REQUIRE_JOB_PHOTOS`) | `config.edit` |

### F6.4 Review moderation (11.7)
- Users can report a review (reason). A review with reports, or the automatic flags (a very short 1-star review, banned words), goes to the moderation queue. Remove the "all 1-star reviews" rule.

### F6.5 Live feed in the portal (11.9)
- The admin web app connects to the authenticated feed (F1.1). It shows badges on Verifications, Disputes and Safety and a toast for new items, with reconnect and resync as in the mobile Phase 6 client.

### F6.6 Visual alignment (11.10)
- Doc 22 tokens, light and dark, logo. API base URL from env only, with no dummy fallbacks (check with a grep test).

**F6 is done when:**
- every admin page reads and writes the database;
- a test lists all admin mutations and checks that each writes an audit row;
- a Verification admin gets 403 on finance pages and Finance gets 403 on documents;
- the dashboard figures match a scripted set of data.

---

## F7: Languages, offline, analytics, accessibility (6–8 days)

### F7.1 Offline outbox that actually sends (12.1, 7.9, O2)
- Replace `OfflineQueueService` with an **outbox**:
  - persisted in AsyncStorage;
  - every item has a stable idempotency key (`clientId`, `idempotencyKey`);
  - one sender processes items in order per kind;
  - triggered by connection status (`@react-native-community/netinfo`), app foreground, and the socket `resync`;
  - exponential backoff;
  - permanent errors (4xx other than 408/429) are shown to the user, not retried forever.
- Kinds:
  - chat messages;
  - job status actions (en route, arrived, start/finish with photos);
  - evidence uploads (background upload with retry);
  - the request send. This is O2; the recommendation was auto-send with a banner and cancel.
- Sync state in the interface: "Saved, will send when you're online" on each item, and a small "Offline" bar while offline.
- Cache: catalogue, today's jobs and the last state of open jobs, with "last updated" labels.
- **Tests:** unit tests for the sender (order, backoff, idempotency); a Maestro offline test in F8.

### F7.2 Analytics (12.2)
- Pick the provider (D-F7; recommend PostHog with EU hosting).
- The `Analytics` adapter sends the events from doc 16 and doc 22 §8.5, with a typed event list in `packages/shared`.
- The privacy filter is an **allow-list** of properties per event, not a block-list. A test ensures no event can carry a phone number, address, coordinates or message text.
- Ask for consent where needed. Turned off in tests.

### F7.3 Every string through `t()` (12.3)
- Move all literal strings to `t()` keys, Phase 7–10 screens included. Server-side system messages use template keys (F1.2).
- A CI lint rule (`i18next/no-literal-string` or a small custom ESLint rule) fails the build on literal strings in JSX.
- An RTL pass on every screen (icons mirrored, `start`/`end` styles), with screenshots in ur and ar.
- Format numbers, dates and currency with `Intl` per locale everywhere (through the shared money helpers).
- Translations go to native-speaker review (O13) as one export file.

### F7.4 Remove fakes (12.4)
- Delete `DocumentVerification` and any other component with fake timers or "AI verified" claims. A grep test fails on `setTimeout(...setIsVerified` style fakes.

### F7.5 Accessibility and performance (12.5)
- Touch targets at least 48 pt (56 for primary), labels and roles on every touchable (lint rule), Dynamic Type at 200 % with no clipped text, contrast at least 4.5:1, reduce-motion respected.
- A VoiceOver and TalkBack pass on both full flows, recorded as a checklist.
- Performance:
  - `expo-image` with caching and thumbnails;
  - virtualised lists everywhere;
  - a bundle size report in CI;
  - cold start under 2.5 s on a low-end Android, measured and recorded.

**F7 is done when** the doc 22 Phase 6 checklist passes and a usability round with real users in Pakistan happens (owner organises it).

---

## F8: Release, Phase 13 done properly (5–7 days)

### F8.1 Tests
- **Load (Artillery or k6):**
  - login;
  - creating a request with matching;
  - offers and booking;
  - chat send and receive over sockets (two API instances + Redis);
  - notification fan-out.
  - Targets: p95 under 300 ms for the API and under 1 s for socket delivery at pilot scale × 10.
- **Resilience:**
  - Redis down (single instance keeps working, multi degrades clearly);
  - Postgres failover;
  - AI and SMS outages (graceful);
  - duplicate requests (idempotency).
- **Maestro, really running in CI** on an Android emulator against a seeded staging API:
  - customer: sign up → request → offer → book → chat → confirm → pay → review;
  - worker: sign up → documents → (admin approves) → online → offer → job steps → cash;
  - admin web (Playwright): approve verification → dispute → audit entry.
  - One `.maestro/` folder (remove the duplicate).
- **Security:** keep gitleaks and trufflehog; gate on dependency audits (F0.3); add Semgrep SAST; extend the authorization end-to-end suite to every Phase 7–11 route (owner, other user, other role, admin roles); plan an external penetration test before launch.

### F8.2 Operations
- Sentry:
  - `Sentry.init` before creating the Nest app, with an exception-filter integration;
  - release and environment tags;
  - personal-data scrubbing;
  - real DSNs through EAS secrets (no `"YOUR_SENTRY_DSN"`).
- Uptime and alerting on health, error rate, socket count and a sweeper heartbeat.
- **Staging** environment with production parity (Postgres, Redis, S3, push).
- Backups with a **restore drill** written down.
- A migration rollback runbook (doc in `docs/ops/`).
- Docker Compose dev services: pin Node 22, install once (named volume), use a production Dockerfile for deploys.

### F8.3 Store readiness
- **Legal (13.2):**
  - rewrite the privacy policy and terms to describe **what the product actually does** (cash only, human verification, no OCR, no escrow) — counsel reviews;
  - one terms file;
  - Urdu versions;
  - in-app links.
- Account deletion in the app (F3.7) plus a web deletion page (Play requirement).
- Data-safety and privacy labels, filled in from the real data flows (location, photos, phone, messages, analytics).
- Permission strings reviewed.
- Store screenshots in en and ur.
- EAS: `projectId` (O14), production build, OTA update channel, version and build numbers bumped by CI.

### F8.4 Re-audit (13.8)
- Re-run doc 26 against the code. The target is ≥ 90 % with **no P0/P1 open**.
- Update the doc 24 status table with rows for Phases 7–13.
- Go through the doc 20 release checklist and get owner sign-off.

---

## 9. Testing standard for every fix phase

The Phase 5/6 standard, written down so it isn't skipped again:
1. **Unit tests** for rules and calculations: state machine table, commission maths, money conversion, contact-sharing detector, permission map.
2. **End-to-end tests on a real Postgres** (and Redis where there are sockets) for each user-visible flow, with **two parties and a third unrelated account** that must see nothing.
3. **Authorization tests** for every new route: the owner works; another user, another role and a wrong admin role get 403/404.
4. **The migration check** passes and the API **starts** in CI.
5. **App**: type check, jest, Android bundle; Maestro from F8 onwards.
6. Tests aren't loosened to pass (as happened with PKR → USD). A failing test means fix the code or record a decision.

---

## 10. Decisions needed (to add to doc 25)

| # | Decision | Needed by | Recommendation |
|---|---|---|---|
| D-F1 | Rewrite git history to remove the committed zip and screenshots? | F0 | Only if the zip has confidential content; otherwise just remove them from now on |
| D-F2 | Auto-confirm timeout for finished jobs, and for cash | F2, F3 | Job 24 h; cash 48 h |
| D-F3 | Live-location history retention | F2 | 30 days, then delete |
| D-F4 | What account deletion keeps | F3 | Anonymise the profile; keep payments, ledger and audit for the legal period (counsel) |
| D-F5 | SMS/WhatsApp provider (trusted contacts + OTP) | F5 | One provider for both (with O5) |
| D-F6 | Gas-emergency numbers per city and the exact SOS wording | F5 | Ops team confirms; counsel reviews (L10) |
| D-F7 | Analytics provider and hosting region | F7 | PostHog (EU), no personal data, with O9 |
| O1, O2, O7, O8, O13, O14 | Already open in doc 25 | F6, F7, F2, F3, F7, F8 | As in doc 25 |
