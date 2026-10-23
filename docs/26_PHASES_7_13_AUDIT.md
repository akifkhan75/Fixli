# Fixli: Audit of Phases 7–13

> Date: 2026-10-11. Scope: commits `f2e8b3e`…`f512f60` (everything after Phase 6, `9e0901d`), checked against the Phase 7–13 plan in doc 24 and held to the same standard as Phases 1–6.
> Method: every check was run, not assumed (type checks, unit tests, end-to-end tests on a real Postgres + Redis, starting the API, building the admin portal, bundling the app, comparing the database to the migrations), and then the code was read.
> Nothing was changed except adding this file.

**Severity.** P0 = blocks release or breaks the app. P1 = security, money or data-integrity risk, or a planned feature that doesn't actually work. P2 = missing or incomplete against the plan. P3 = quality or tidiness.

---

## 1. Verdict

| Phase | Plan | Real state | Estimate |
|---|---|---|---|
| 7 Chat | Real-time chat | Messages and the conversation list exist, but **chat is not real-time**, anyone can post fake "system" messages, and tapping a chat notification leads nowhere | ~35 % |
| 8 On-site job | Statuses, live map, photos, change orders | New statuses exist; **no photo capture**, photos can point at any stored file, the customer's "confirm" can be skipped, change orders never change the price | ~40 % |
| 9 Money and reputation | Cash, ledger, earnings, reviews, disputes | Cash mark/confirm exists but **can double-charge commission**, ignores the agreed price, and the **Earnings screen crashes**; favourites have no screen; no rebook | ~30 % |
| 10 Safety & SOS | SOS flow, emergency numbers, trusted contacts | **Mostly placeholder**: hard-coded numbers, "simulated" SMS, no property-emergency dispatch, no SOS screen in the app | ~15 % |
| 11 Admin | RBAC, 2FA, real pages, live feed | Role checks added, but **the live admin feed accepts a fake token**, no two-factor login, no admins have roles, **the admin portal doesn't build** | ~30 % |
| 12 Languages, offline, analytics | `t()` everywhere, offline outbox, analytics | Some strings moved to `t()`. The offline queue is **written to but never sent**; analytics is a `console.log` that is never called | ~15 % |
| 13 Hardening & release | Load/E2E/security tests, store readiness | Files exist (Sentry, EAS, Maestro, Artillery, legal), but **CI no longer runs the database tests or the drift check**, Maestro isn't run, and the legal text claims features that don't exist | ~20 % |

**Overall:** Phases 7–13 are not at the Phase 1–6 standard. Two P0s mean the system can't run at all today:
1. the API crashes on startup, and
2. the database changes for Phases 7–13 have no migration.

All 112 end-to-end tests now fail. Nobody saw it because the CI changes stopped running them.

---

## 2. P0: blocks everything

### P0-1 The API does not start
- `node dist/main.js` exits at once: *"Nest can't resolve dependencies of the ChatService (PrismaService, ?)"*.
- Cause: `ChatService` now needs `NotificationService`, but `NotificationsModule` imports `ChatModule`, which is a circular dependency (`chat.service.ts:10`, `notifications.module.ts:11`).
- The unit tests pass only because they mock everything. Every end-to-end suite fails with the same error: **112 of 112 failed** on a database built straight from the schema. The crash is in dependency injection, so it happens with any database.
- Fix direction: break the cycle by moving `RealtimeService` out of `ChatModule`, or by having chat publish a domain event that notifications listen to.

### P0-2 Schema changes without migrations
- `schema.prisma` gained about 240 lines with **no new migration**. The newest migration is still `20261008300000_notifications`.
- `prisma migrate diff` against a database built from the migrations reports:
  - 12 tables missing: Conversation, Message, MessageRead, Block, Payment, LedgerEntry, Settlement, Incident, TrustedContact, CountryConfig, FavoriteWorker, plus a join table;
  - 4 old tables that should be gone: ChatThread, ChatMessage, Transaction, plus a join table;
  - 3 new job statuses missing;
  - new columns missing on Dispute, Review, ChangeOrder, JobMedia and User.
- A deploy would start against a database that has none of the Phase 7–13 tables.
- Some changes **destroy data** and need a hand-written migration:
  - dropping `Transaction`, `ChatThread` and `ChatMessage`;
  - `Review.jobRequestId` becomes required and loses `onDelete: SetNull`.
- New Postgres enum values (`EN_ROUTE`, `ARRIVED`, `AWAITING_CONFIRMATION`, `CHAT_PHOTO`) must be in their own migration. Postgres can't use a new enum value inside the transaction that adds it; we hit this in Phase 3.
- `apps/api/prisma/schema.prisma.bak` (742 lines) was committed.

### P0-3 CI was weakened, so the above went unnoticed
`.github/workflows/ci.yml` was rewritten:
- the Postgres and Redis services were removed;
- the **API end-to-end step was removed**;
- the **migration-drift check was removed**.

Separately:
- `security.yml` runs Maestro as an `echo` only.
- Both dependency audits end in `|| true`, so they can never fail.

The two problems above are exactly what those checks exist to catch. Restore them before anything else.

### P0-4 The admin portal doesn't build
- `vite build` fails with `MISSING_EXPORT` for `SearchUserRow`, `AdminJobRow` and `LedgerRow` (`pages/Users.tsx`, `Jobs.tsx`, `Ledger.tsx`).
- They are TypeScript types imported as values. They need `import type`.
- The type check passes; only the production build breaks. CI only lints the admin and never builds it.

---

## 3. Phase 7: Real-time chat

**Done:**
- tables for conversations, messages, read receipts and blocks;
- list conversations (with unread counts) and messages, with paging;
- send with an idempotency `clientId`;
- mark read;
- block and report;
- a conversation is created on booking;
- the conversation becomes read-only 3 days after completion (sweeper);
- a warning when someone shares a phone number or link;
- a Messages tab and a thread screen in the app.

| # | Sev | Finding | Where |
|---|---|---|---|
| 7.1 | **P1** | **Chat isn't real-time.** The app sends through REST (`api.sendChatMessage`), and the REST path sends no live event. Only the socket `sendMessage` handler does, and the app doesn't use it. The app also listens for `newMessage` while the server now sends `message.created`. The other person sees a message only after reopening the thread. | `ChatThreadScreen.tsx`, `chat.controller.ts`, `chat.gateway.ts`, mobile `socket.ts:74` |
| 7.2 | **P1** | **Anyone can post fake "system" messages.** `isSystem` is a field the client can set in `SendMessageDto`. A user can post a grey "Fixli" message such as "Pay the advance to 03xx…". It also skips the contact-sharing check and the notification. | `dto/send-message.dto.ts`, `chat.service.ts` |
| 7.3 | **P1** | **Image messages accept any storage path.** `imageKey` is a raw string from the client, not an upload consumed through the Phase 3 upload flow (`storage.consume`), so a message can point at any stored file, including private ID documents. It's stored and returned as-is; no image is shown and there's no image picker. | `chat.service.ts`, DTO |
| 7.4 | **P1** | **Private message text in push notifications.** The `chat.message` template puts the full message text in the lock-screen notification. Phase 6 set the rule: never send private message text in a push (doc 16 privacy). | `templates.ts` |
| 7.5 | P1 | **Blocking does almost nothing.** It only makes that one conversation read-only. The blocked person can still be matched with, booked by and notified about the blocker, and `sendMessage` never checks the Block table. | `chat.service.ts`, matching |
| 7.6 | P1 | **Reports go nowhere staff can see.** A report is written only to the audit log. It doesn't create an Incident, so the admin safety console never shows it. | `chat.service.ts reportUser` |
| 7.7 | P1 | **Chat notifications open a missing screen.** They link to `/(shared)/chat/:id`, but the thread screen is `/thread/[id]`, so tapping one lands on "not found". | `chat.service.ts` |
| 7.8 | P2 | A failed send is silently ignored. The bubble stays as if it had been sent. There are no sending/sent/read ticks and no retry, and the optimistic copy is never replaced by the server's message. | `ChatThreadScreen.tsx` |
| 7.9 | P2 | **Offline messages are lost.** They go into `OfflineQueueService`, but **nothing ever reads that queue back**. Also, the screen sends through REST, so this path isn't even used. | `socket.ts`, `offline.ts` |
| 7.10 | P2 | Not built: typing indicator in the app, date separators, image picker, "Message" button on the job screen, read receipts sent live (`message.read`). Typing events aren't throttled, and socket messages have no rate limit. | — |
| 7.11 | P2 | The phone/link check gives false alarms. `[\d\s\-+()]{8,}` matches 8 spaces or a long price, and the domain pattern matches things like "1500.00". The warning is posted as a message both people see, not a hint shown only to the sender. | `chat.service.ts` |
| 7.12 | P3 | Notifications are fired without `await`, so a failure becomes an unhandled promise rejection. `receiverId` in the DTO is unused. The thread header uses a fixed `paddingTop: 50` instead of the safe area. The security comments in the gateway were deleted. | — |

---

## 4. Phase 8: On-site job

**Done:**
- statuses `EN_ROUTE`, `ARRIVED` and `AWAITING_CONFIRMATION`, with worker buttons "On my way", "Arrived", "Start" and "Finish", plus a customer "Confirm work is done";
- live location sent only while `EN_ROUTE`;
- change orders: a worker creates one and the customer approves or declines;
- system chat messages for some status changes.

| # | Sev | Finding | Where |
|---|---|---|---|
| 8.1 | **P1** | **Before/after photos can point at any stored file.** `start` and `finish` accept `beforePhotoKey` and `afterPhotoKey` as raw strings and save them as job media, which the customer then sees through a signed link. A worker could attach another job's private photo or a customer's ID document. `mime` is hard-coded to `image/jpeg`. The same problem affects change-order `mediaKeys` and dispute `evidenceKeys`. | `jobs.service.ts start/finish`, change-order and dispute DTOs |
| 8.2 | **P1** | **The customer's confirmation can be skipped.** The state machine lets the **worker** move `AWAITING_CONFIRMATION → COMPLETED`, and the old `/complete` endpoint is still there. A worker can finish and immediately "complete" without the customer, and so unlock cash and reviews. There's no auto-confirm timeout either. | `job-state-machine.ts`, `jobs.controller.ts` |
| 8.3 | **P1** | **Double-booking is possible again.** `BUSY_STATUSES` is still `['ACCEPTED','IN_PROGRESS']`. A worker who is `EN_ROUTE`, `ARRIVED` or `AWAITING_CONFIRMATION` counts as free for overlapping bookings. | `offers.service.ts:8` |
| 8.4 | **P1** | **Approving a change order doesn't change the price.** `agreedAmount` stays the same, so the cash step and commission use the old total. The currency defaults to **USD** instead of the job's currency. There's no notification, and a worker can stack several pending orders. | `change-orders.service.ts` |
| 8.5 | **P1** | **Change-order prices are 100× off.** The worker form asks for the "New Total Price (Minor units)" and uses `parseInt`. A worker who types 1500 meaning Rs 1,500 creates Rs 15. Use `PriceForm` / `parseMajorToMinor` as offers do. | `(worker)/job/[id].tsx` |
| 8.6 | P2 | Photos aren't required to start or finish, and the app has **no photo capture step at all**; it calls start and finish without photos. Photos are saved after the status change, outside its transaction. | — |
| 8.7 | P2 | **No notifications for the new steps.** `announce()` handles none of `EN_ROUTE`, `ARRIVED` or `WORK_FINISHED`, so the customer gets no "on the way", "arrived" or "please confirm". When the customer confirms, *they* receive "worker marked it done" and the worker gets nothing. | `jobs.service.ts announce` |
| 8.8 | P2 | **The "on the way" chat message never appears.** It's only written when the new status is `ACCEPTED`, `IN_PROGRESS` or `COMPLETED`, and `EN_ROUTE` isn't in that list. | `jobs.service.ts` |
| 8.9 | P2 | Live location: there's no ETA (the plan asked for a server-side routing adapter), no stored history or retention, and the always-on customer location watcher still runs (`useCustomerLocationTracker` in the root layout). The map falls back to hard-coded Karachi coordinates or `0,0`. | — |
| 8.10 | P2 | Masked calling, or showing the number during the job (O7): not done. | — |
| 8.11 | P3 | Customers can't cancel during `EN_ROUTE` or `ARRIVED` because `CANCELLABLE_BY_CUSTOMER` wasn't updated, but the state machine allows it. Pick one rule. | `jobs.service.ts:52` |

---

## 5. Phase 9: Cash, earnings, reviews, disputes

**Done:**
- `Payment`, `LedgerEntry` and `Settlement` tables;
- the worker marks cash received and the customer confirms;
- a commission ledger entry;
- earnings and ledger endpoints;
- review tags and a reviewee role;
- dispute category, evidence and resolver;
- favourites endpoints;
- account deletion endpoint.

| # | Sev | Finding | Where |
|---|---|---|---|
| 9.1 | **P1** | **The worker can type any amount and currency.** The cash body is an inline type with no validation (negative, decimal or text all accepted), it isn't checked against `agreedAmount`, and the currency defaults to USD. | `payments.controller.ts`, `payments.service.ts` |
| 9.2 | **P1** | **Commission can be charged twice.** "Mark cash" can be called repeatedly and creates a new Payment each time. `confirmPayment` reads the status, then updates without a condition, so two confirms at once both pass and both write commission. The balance is computed from "the newest ledger row" with no lock, so concurrent entries corrupt it. The plan's exit test ("duplicate confirm/mark requests are idempotent") fails. | `payments.service.ts` |
| 9.3 | **P1** | **Commission is a hard-coded 10 %.** It ignores O8 (12 %, PKR 100 min, PKR 1,500 max) and country configuration. There are no soft/hard limits that pause new requests, no auto-confirm timeout, no dispute when the customer disagrees, no settlement endpoints, and no `PaymentProvider` interface. | `payments.service.ts` |
| 9.4 | **P1** | **The Earnings screen crashes.** The app expects `{ balance, currency, history }`; the server returns `{ currentBalance, todayEarnings, totalEntries }`. `formatMoney(undefined, undefined)` throws. Also, "today's earnings" is actually the sum of **commission owed**, not income. | `workers.service.ts getEarnings`, `(worker)/earnings.tsx` |
| 9.5 | P1 | **Deleting an account doesn't sign the person out.** Sessions, push tokens and sockets stay live. Name, avatar, addresses and trusted contacts are kept, open jobs aren't cancelled, and the app has **no "Delete account" button** (an App Store and Play requirement). | `users.service.ts deleteMe` |
| 9.6 | P1 | **Unvalidated input** that will fail with server errors or let bad data in: dispute `amountHeld` (any value), `evidenceKeys` (raw paths, see 8.1), review `tags` (no size limit), favourite `workerId` (not checked, so a database error and a 500). | DTOs |
| 9.7 | P2 | **No one hears about payments.** `payment.recorded` is emitted but nothing listens, so there's no notification and no live update for cash marked or confirmed. Disputes don't hold settlement and the parties get no live status updates. | — |
| 9.8 | P2 | Not built in the app: favourites, "Book again", job history with evidence and receipt, raising a dispute. Earnings has no week or month totals and no "commission owed / how to settle" card. | — |
| 9.9 | P2 | Reviews: the worker's rating now includes reviews hidden by moderation (`status`), and there's no moderation action. | `reviews.service.ts` |
| 9.10 | P2 | **PKR stopped being tested.** Commit `ead943b` changed the API and mobile money tests from PKR to USD to make them pass, instead of fixing whatever broke PKR in CI. PKR is the launch currency. Find the cause: the Node 22 runner may format PKR differently from local Node 24 and from Hermes on the phone, which could mean a 100× price mismatch between server and app. | `cnic-money.test.ts`, `notifications.service.spec.ts` |

---

## 6. Phase 10: Safety & SOS

**Done:**
- `Incident` and `TrustedContact` tables;
- endpoints to report an incident, read emergency numbers and add/remove trusted contacts (max 5);
- the admin feed event for incidents.

| # | Sev | Finding | Where |
|---|---|---|---|
| 10.1 | **P1** | **Trusted contacts are never told.** The SMS to trusted contacts is `logger.log('[Simulated] …')`, and that line writes **contacts' names and phone numbers to the server logs**. | `safety.service.ts` |
| 10.2 | **P1** | **Property emergencies don't dispatch anyone.** The branch is a comment: "In a full implementation, we'd create an urgent job here". Doc 22 D2 wants a dispatch to the nearest verified worker, with offers as fallback. | `safety.service.ts` |
| 10.3 | P1 | **Emergency numbers are hard-coded** (15 / 115 / 16 / 1122) and the `country` argument is ignored. The plan says they come from country configuration. The `CountryConfig` table is empty and nothing reads it. | `safety.service.ts` |
| 10.4 | P1 | **The SOS screen in the app wasn't built.** The SOS button still just opens the request form with `isEmergency=true`. There's no 5-second cancellable countdown and no emergency-type choice. "Life-threatening" doesn't show call buttons, and no Incident is ever created from the app. There's no in-job SOS, no "Report a problem", and no trusted-contacts screen. | `(home)/index.tsx`, `SOSButton.tsx` |
| 10.5 | P2 | **Incidents can name jobs or people they have nothing to do with.** `jobRequestId` and `targetId` aren't checked: anyone can attach an incident to any job or user. Trusted-contact phone numbers aren't normalised or checked for the country (Phase 2 has the tools for this). | `safety.service.ts`, DTO |
| 10.6 | P2 | Safety wording review (legal L10) and the "we never claim we contacted the authorities" check: not done. | — |

---

## 7. Phase 11: Admin portal

**Done:**
- `/admin/v1` routes;
- `adminRoles` on User and an `AdminRolesGuard`;
- endpoints to search and suspend users, list and cancel jobs, list incidents, payments, catalogue, country configuration, "reported" reviews and audit logs;
- admin pages Users, Jobs and Ledger;
- an admin socket namespace.

| # | Sev | Finding | Where |
|---|---|---|---|
| 11.1 | **P0/P1** | **Anyone can connect to the admin live feed.** Its login is simulated: any token of the form `admin-<userId>` is accepted with no signature check (`parseTokenSimulated`). Anyone who learns an admin's user id joins their role rooms and receives new verification, dispute and incident events. CORS is `*`. Use the same JWT + live-session check as `/rt`. | `admin/gateways/admin.gateway.ts` |
| 11.2 | **P1** | **No two-factor login for admins.** A `totpSecret` column was added but is never used. | — |
| 11.3 | **P1** | **No admin has any role, and roles can't be given.** Nothing assigns them and no endpoint sets them, so every route marked with a role (users, jobs, payments, incidents, audit…) returns 403 for every existing admin. The new pages can't be used without editing the database by hand. | `admin-roles.guard.ts` |
| 11.4 | **P1** | **Some admin routes have no role check.** Routes without `@AdminRoles` are open to any staff role, including the **verification detail with signed links to ID documents**, the verification queue and stats. A Finance admin can view ID cards. | `admin.controller.ts` |
| 11.5 | **P1** | **An admin cancel skips the job rules.** It sets `CANCELLED` directly: it can cancel a completed job, writes no timeline event, tells no one, and returns a 500 on an unknown id. Suspending a user doesn't drop their sessions or sockets, and the audit entry has no "before" value. | `admin.service.ts` |
| 11.6 | P1 | **Customer phone numbers are shown to the Analytics role.** The job list includes customer and worker phone numbers and is open to Analytics. An invalid `status` filter crashes with a 500. | `admin.service.ts getJobsList` |
| 11.7 | P2 | **Review moderation is fake.** It shows "all 1-star reviews", with no report flag and no action. Country configuration is read-only and empty. The catalogue has no price-band or translation editing. There are no feature flags. | — |
| 11.8 | P2 | **The dashboard didn't change.** It still shows the Phase 3 verification counts; there are no active users, online workers, fill rate, cancellations or GMV. | — |
| 11.9 | P2 | Admin pages missing: Safety/incidents, Audit log, Reviews, Country configuration, Payments detail with ledger adjustment, disputes with chat transcript. **The admin web app never connects to the live feed.** | `apps/admin/src` |
| 11.10 | P2 | Not checked: "every admin mutation is audited" (cancel and suspend are; others weren't checked), and the doc 22 visual alignment. | — |

---

## 8. Phase 12: Languages, accessibility, offline, analytics

**Done:**
- about 21 new translation keys (en/ar/ur), and some components moved to `t()`;
- an `OfflineQueueService` with cache helpers;
- an `AnalyticsService` that strips personal data;
- Sentry in the app.

| # | Sev | Finding | Where |
|---|---|---|---|
| 12.1 | P1 | **The offline queue only writes.** Nothing ever reads it back or sends it, so anything queued is lost. Requests, status changes and evidence aren't queued; only socket chat messages are, and that path isn't used (7.9). Nothing in the app uses the cache helpers, and there's no "syncing" indicator. | `services/offline.ts` |
| 12.2 | P1 | **Analytics isn't built.** `AnalyticsService` only calls `console.log` and nothing calls it (zero imports). No doc 16 / doc 22 §8.5 events exist. | `services/analytics.ts` |
| 12.3 | P2 | Most screens still have hard-coded English. There's no CI check for text written directly in the JSX (literal strings). Phase 7–10 screens are English only ("Change Order", "Mark Cash Received", "Confirm Work is Done", "Type a message…"). The RTL pass wasn't done. Translations still need a native-speaker review (O13). | — |
| 12.4 | P2 | **A fake verification screen was translated and is still there.** `DocumentVerification` says "Our AI verification system will process it instantly", runs a timer and shows "Documents Verified". It never uploads anything. Nothing uses it; delete it. | `components/ui/DocumentVerification.tsx` |
| 12.5 | P2 | Accessibility checks (targets, Dynamic Type at 200 %, contrast, VoiceOver/TalkBack), performance (`expo-image`, cold start under 2.5 s) and the doc 22 Phase 6 checklist: nothing shows they were done. | — |

---

## 9. Phase 13: Hardening & release

**Done:**
- Sentry initialised in the API and app;
- `eas.json` with a production channel;
- Maestro flow files;
- an Artillery file;
- gitleaks and trufflehog scanning;
- privacy policy and terms drafts;
- Docker Compose services for admin and web.

| # | Sev | Finding | Where |
|---|---|---|---|
| 13.1 | **P0** | CI regressions; see P0-3. | `.github/workflows/*` |
| 13.2 | **P1** | **The legal pages promise things the product doesn't do.** The privacy policy claims "OCR and human review", "hold funds in escrow", and payments via "PCI-compliant payment gateways". Fixli has none of these; it's cash only. There's no Urdu version. There are two overlapping terms files (`terms.md` and `terms-of-service.md`). They need counsel (legal L-items) before publishing. | `docs/legal/*` |
| 13.3 | P1 | **Junk files committed against O11:** `Prolivo_Product_Documentation.zip`, `scratch_login.tsx`, `screenshot.png`, `schema.prisma.bak`. Remove them from git; the zip may also contain internal documents. | repo root |
| 13.4 | P2 | **The load test only hits the health check and the countries config.** Nothing for login, matching, chat or socket fan-out. There are no resilience tests and no backup/restore drill or runbook. | `tests/load/artillery.yml` |
| 13.5 | P2 | **The Maestro flows don't match the app.** For example, the customer flow starts by tapping "I need a service" at launch, but the app opens on sign-in. They have never run in CI. There's no admin flow. | `.maestro/*`, `apps/mobile/.maestro/*` (two folders) |
| 13.6 | P2 | **Store builds aren't ready:** no `projectId` (O14), and the production Sentry DSN is the literal `"YOUR_SENTRY_DSN"`. There are no screenshots or data-safety labels, and no "Delete account" in the app (9.5). | `eas.json`, `app.json` |
| 13.7 | P2 | **Some API startup errors won't reach Sentry.** It's initialised *after* the Nest app is created. There's no staging environment. The new Docker Compose services run `pnpm install` on every start, use Node 20 while CI uses Node 22, and mount the whole repo. | `main.ts`, `docker-compose.yml` |
| 13.8 | P2 | The re-audit target (≥ 90 % with no P0/P1 open) isn't met; this report is that re-audit. The doc 24 status table has no rows for Phases 7–13. | `docs/24` |

---

## 10. What was verified, and the numbers

| Check | Result |
|---|---|
| API type check | passes |
| API unit tests | 229 pass (they mock the dependency injection, so the startup crash doesn't show) |
| **API starts** | **fails** (P0-1) |
| **API end-to-end** (real Postgres + Redis) | **0 / 112**; every suite fails at startup |
| **Migrations vs schema** | **drift**: 12 tables and 3 statuses missing (P0-2) |
| New end-to-end tests for Phases 7–13 | **none** (only one line changed in the test folder) |
| Mobile type check / tests | pass / 59 pass (was 68; `chatSlice` tests deleted, PKR tests changed to USD) |
| Mobile Android bundle | builds |
| Admin type check / **build** | passes / **fails** (P0-4) |
| Lint | 0 errors (3 admin warnings) |

---

## 11. Suggested fix order (for later)

1. **Make it run.** Fix the circular dependency (P0-1). Write the migrations by hand, with a separate migration for the new enum values and a data plan for the dropped tables (P0-2). Fix the admin build (P0-4). Restore CI's Postgres + Redis, end-to-end tests and drift check (P0-3).
2. **Close the security holes.** Admin socket authentication (11.1). Client-set `isSystem` (7.2). Raw storage paths in chat, start/finish, change orders and disputes; route everything through `storage.consume` (7.3, 8.1). Admin roles: seed, assign, guard every route, two-factor login (11.2–11.4). No message text in pushes (7.4).
3. **Make money correct.** Validated, idempotent cash with a single payment per job tied to the agreed total (and to approved change orders). A locked ledger. Commission from configuration (O8). Only the customer, or a timeout, completes a job. The busy statuses (8.3). Change-order units (8.5). Earnings shape (9.4). Find the PKR problem (9.10).
4. **Finish the features that look done but aren't.** Live chat (7.1), deep links (7.7), new-status notifications (8.7), sending the offline queue (12.1), the SOS flow (10.1–10.4), account deletion (9.5).
5. Then the P2 items, and end-to-end tests for each of Phases 7–11 to the Phase 5/6 standard (scripted two-party flows on a real database).

New owner decisions raised by this audit (to add to doc 25):
- How long before a finished job auto-confirms if the customer doesn't respond (suggest 24 h).
- How long to keep live-location history (suggest 30 days, then delete).
- Which SMS/WhatsApp provider sends trusted-contact alerts (the same one as OTP, O5).
- What deleting an account keeps (anonymise the profile; keep financial records for the legally required period).
