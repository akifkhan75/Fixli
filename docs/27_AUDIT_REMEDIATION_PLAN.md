# 27 — Audit Remediation Plan (phase-wise)

> Created 2026-11-13 from the full audit of branch `fix/audit-remediation-and-pending-plan` @ 306c986. Supersedes the "Done" claims in doc 24 Phases 7–13 where they conflict; see Appendix A for the evidence.

## Context
The 2026-11-13 full audit (branch `fix/audit-remediation-and-pending-plan` @ 306c986) found the core marketplace solid (229 API + 59 mobile tests green, clean typecheck), but docs 24/26 overstate completion. Real gaps: an admin WebSocket auth bypass, a non-launch-grade cash/commission path, SOS that is a stub, incomplete account deletion, no CNIC encryption, no OTP/password reset, always-on customer GPS, cosmetic CI gates, 45% coverage, brand/doc/repo inconsistencies. This plan closes every audit finding in priority order, each phase shippable with tests green.

**Deliverable on approval (step 0):** save this plan as `docs/27_AUDIT_REMEDIATION_PLAN.md` (with the audit findings matrix as an appendix from the scratchpad report), add it to the index in `docs/00_README.md`, and add a pointer from the top of docs 24 and 26. No code changes in step 0.

Rules for every phase: DTO classes only (no inline body types), ownership in `where`, audit entry for sensitive actions, money in minor units with currency from country config, unit + e2e tests, doc 24/26 status updated honestly (claim only what was verified, state how).

---

## Phase R0 — Truth & hygiene (≈1 day)
- `git rm` tracked junk: `Prolivo_Product_Documentation.zip`, `scratch_login.tsx`, `screenshot.png`, `metadata.json`, `apps/api/prisma/schema.prisma.bak`; add to `.gitignore`.
- Brand: replace "Triply" in `apps/web/src/App.tsx`, `apps/web/index.html`, `apps/admin/index.html`; mark doc 23 superseded (O4 default Fixli).
- Docs: rewrite doc 24 Part A header as historical; change Phases 7–13 rows to accurate status (Done / Partial / Stub) using the audit matrix; fix doc 25 O11 ("tracked"), doc 26 §3.3 (DELETE /me) and "65 items" → 71; README coverage claim → real number.
- **Exit:** no false "Done" claims in docs; `git ls-files` clean of junk.

## Phase R1 — Security P0s (≈2–3 days)
1. **Admin gateway bypass** — `apps/api/src/admin/gateways/admin.gateway.ts`: delete `parseTokenSimulated`; reuse the exact handshake pattern from `chat/gateways/chat.gateway.ts:71-97` (`JwtService.verify` → live `Session` lookup with `revokedAt: null`, `expiresAt > now`, `user.status ACTIVE`) and require `user.type === 'admin'` + non-empty `adminRoles`; join `session:{sid}` and subscribe to `sessions.revoked` to disconnect. Resolve the circular-dep comment by importing `JwtModule` into `AdminModule` (same as ChatModule). Spec: forged `admin-<id>` token rejected; non-admin JWT rejected; revoked session disconnected. Update `apps/admin/src` socket client to send the real access token.
2. ~~Global location tracker~~ — **Audit finding withdrawn (verified 2026-11-13):** `useCustomerLocationTracker` is mounted globally but only collects/subscribes while `tracking.isTracking` is true (set by the job screens during an active tracked job). No change needed; a test asserting no `watchPositionAsync` call when `isTracking` is false is optional.
3. **CI gates real** — `.github/workflows/security.yml` + `sast.yml`: drop `|| true` (add `pnpm audit --audit-level high` with a reviewed allowlist), pin `trufflehog` to a version tag; add API e2e job with Postgres service container running `scripts/run-e2e.sh`; remove the echo-only Maestro job until build artifacts exist (track in R7).
4. **Dependency backlog (found while making the audit gate real):** `pnpm audit --prod` has 0 critical but 26 high advisories in production deps (multer DoS ×6, lodash `_.template`, js-yaml ×3, date-and-time ReDoS, node-forge via expo tooling). CI now blocks on prod *critical* and reports prod *high*; upgrade `@nestjs/platform-express`/multer, lodash, js-yaml, date-and-time, then flip the high gate to blocking (remove `continue-on-error` in `security.yml`). Dev-only (ts-jest > handlebars critical) does not ship.
- **Exit:** authorization e2e + new gateway specs green in CI; audit job can fail the build.
- **Status (2026-11-13):** items 1 and 3 done and verified locally (unit 6 new gateway tests; API e2e 104 passed / 8 skipped (Redis) against a temp Postgres 14 after `migrate deploy` + `db:generate`; `prisma migrate diff` migrations vs schema = empty). Item 2 withdrawn. Item 4 open. The new `e2e.yml` workflow has not yet run on GitHub.

## Phase R2 — Money path rewrite (≈1 week)
Files: `apps/api/src/payments/*`, `apps/api/src/workers/workers.service.ts`, `apps/api/prisma/schema.prisma`, `packages/shared/src/countries.ts`, `CountryConfig`.
- **Config:** extend `packages/shared/src/countries.ts` country type with `commission: { rateBps, minMinor, maxMinor, softLimitMinor, hardLimitMinor, settleDays }` (PK placeholders from doc 25 O8: 1200 bps, 10000, 150000, 300000, 500000, 7) — owner can change without code.
- **DTOs:** `MarkCashDto { amount: Int ≥1 ≤ cap, idempotencyKey: UUID }`; currency always derived from the job/country, never client-supplied. Fix schema defaults `currency @default("USD")` (Payment, LedgerEntry) via migration.
- **Idempotency & uniqueness:** one active cash Payment per job (partial unique index on `jobRequestId` where status in MARKED/CONFIRMED/DISPUTED); `idempotencyKey` stored; repeat calls return the existing row.
- **Ledger integrity:** compute balance inside a `SERIALIZABLE` transaction (or `SELECT … FOR UPDATE` on the Worker row); `idempotencyKey` unique on LedgerEntry (`commission:{paymentId}`); DB trigger forbidding UPDATE/DELETE on `LedgerEntry`. Commission = clamp(floor(amount×rateBps/10000), min, max) in integers.
- **Caps:** after each ledger write, if owed > hard limit → set `isOnline=false`, emit event + notification; `workers.service` online toggle (line ~138) rejects with `COMMISSION_CAP_EXCEEDED`; soft limit → warning banner data in `GET /workers/me/earnings`. Never block in-progress bookings.
- **Disputes & timeout:** customer `POST /payments/:id/dispute {claimedAmount}` → `DISPUTED`, opens Dispute, commission on the undisputed minimum; add auto-confirm to the existing advisory-locked sweeper (`matching/sweeper.service.ts`) at +24h with reminder notifications at +2/+12/+23h, `metadata.autoConfirmed`.
- **Mobile:** customer job screen confirm/dispute sheet; worker earnings cap banner; `formatMoney` (`apps/api/src/common/money.ts`, mobile `utils/money.ts`) everywhere.
- **Tests:** ≥15 unit (clamp, caps, idempotency, double-confirm, race via concurrent promises) + e2e ledger reconciliation over 50 scripted jobs (doc 26 Week 4 gate).
- **Exit:** ledger reconciles to payments; duplicate/concurrent calls produce one entry; hard cap forces offline.
- **Status (2026-11-13): implemented and verified locally** (API unit 262 pass; e2e 113 pass / 8 Redis-skipped on a temp Postgres; mobile typecheck + 59 tests pass; not run on a device).
  - Done: `commission` in `packages/shared` country config; `common/commission.ts`; DTOs (`MarkCashDto`, `DisputePaymentDto`; client currency rejected, taken from the job); one live payment per job (partial unique index) + idempotent mark/confirm/dispute; worker-row `FOR UPDATE` lock and balance = SUM of entries (not "latest row", which could race on `now()` ordering); append-only `LedgerEntry` trigger; `idempotencyKey` per commission; currency defaults removed from `Payment`/`LedgerEntry`; soft-limit warning, hard-limit forced offline + `COMMISSION_CAP_EXCEEDED` on go-online; payment dispute (commission only on the undisputed minimum, Dispute row `PAYMENT_AMOUNT`); sweeper-driven reminders (+2/+12/+23h) and 24h auto-confirm; en/ur/ar notification drafts (O13 review); 21 payments unit tests + 9-case e2e incl. concurrency and a 50-job reconciliation.
  - Also fixed: mobile earnings screen read `balance`/`history`, which the API never returned (it would have crashed on an empty/undefined list) - API now returns `balance`, `history`, `owed`, `status`, limits; mobile sent a client `currency` that the new DTO rejects - removed.
  - Mobile: customer confirm / "that is not what I paid" flow, worker earnings cap banner.
  - Known remaining (not R2 scope or needs owner): `minMinor/maxMinor/limits/rate` are the O8 *placeholders*; no settlement flow yet (a worker cannot reduce owed balance in-app - needs the payment rail, O8/L5); the `settleDays` (7) rule is displayed but not enforced; admin resolution of `PAYMENT_AMOUNT` disputes and the held difference is manual (no ledger adjustment endpoint yet); `todayEarnings` still reports commission charged, not income (name kept for old clients).

## Phase R3 — Safety & SOS made real (≈1 week)
Files: `apps/api/src/safety/*`, `apps/api/src/jobs/jobs.service.ts`, `apps/api/src/matching/matching.service.ts`, mobile `SOSButton.tsx`, `(customer)/(home)/index.tsx`, new `app/(customer)/sos.tsx`.
- Emergency numbers from `packages/shared` `COUNTRIES[cc].emergencyNumbers` (already defined) via `CountryConfig`, not the hard-coded map in `safety.service.ts:18`.
- **Mobile SOS screen:** hold 5s (currently 2s) → 10s cancellable countdown → type picker (Water / Electric-fire / Gas / Life-threatening). Life-threatening: show numbers with `Linking.openURL('tel:')`, call `POST /safety/incidents`, never dispatch. Property: `POST /safety/incidents` with PROPERTY_DAMAGE. Offline: show dialer screen immediately. Disclaimer copy (doc 26 §2.4) en/ur.
- **Auto-dispatch:** in `reportIncident` PROPERTY_DAMAGE, create an emergency job via `JobsService.create` (reuse the existing hazard/emergency path) and a matching mode: nearest verified online worker, 180s window, then cascade to top 5 / normal offers (config keys alongside `MATCH_NOTIFY_LIMIT`).
- **Trusted contacts:** `SmsProvider` interface (shared with R5 OTP) with a dev logger adapter; mobile Trusted Contacts screen under `(shared)`.
- **Worker hazard checklist:** before `start` transition on emergency jobs, require checklist acknowledgement (job-state-machine precondition).
- **Exit:** SOS never routes to the normal request form; life-threatening never creates a job; incident visible in admin with realtime feed (now authenticated from R1).
- **Status (2026-11-13): backend + mobile implemented and verified locally** (API unit 275 pass; e2e 122 pass / 8 Redis-skipped, run twice on a reused temp Postgres; mobile typecheck + 65 tests; not run on a device).
  - Done: emergency numbers from shared country config (the old hard-coded 115/16 map is gone); `ReportIncidentDto` hardened (hazard kind, address, idempotency key, coordinates); LIFE_THREATENING never creates a job and returns numbers + disclaimer; PROPERTY_DAMAGE creates an urgent job through `JobsService.create` (trade by hazard: water/gas -> PLUMBING, electrical -> ELECTRICAL) with a retry-safe key; SOS matching tells ONLY the nearest worker first (`SOS_FIRST_NOTIFY`, default 1), sweeper cascades to the top `SOS_CASCADE_LIMIT` (5) after `SOS_ESCALATE_SECONDS` (180) with no price; `job.emergency_request` notifications (en/ur/ar drafts); mandatory worker hazard checklist (`HAZARD_CHECKLIST_REQUIRED`) before an emergency job starts; `SmsProvider` interface + logging adapter (reused by R5 OTP); honest response (`trustedContacts.notified` counts only real deliveries, `smsConfigured` flag); trusted contacts require E.164. Mobile: SOS hold 2s -> 5s, new `/sos` screen (emergency numbers always on top and dial offline from a cached copy, 10 s cancel window, hazard advice, honest contact summary), trusted-contacts screen, worker checklist UI. SOS no longer routes to the ordinary request form.
  - Known remaining: no SMS gateway yet, so contacts are NOT actually texted (owner decision O5; the app says so); admin has no Incidents page (realtime event is emitted and now authenticated, UI is R-later); no audible alert, no in-job SOS for workers, no worker-header emergency-call button; SOS screen strings are English only (ur/ar pending O13); gas -> PLUMBING mapping and the SMS text need ops/legal review; the SMS location link uses a Google Maps URL (vendor decision O9).

## Phase R4 — Privacy & compliance controls (≈4–5 days)
- **Account deletion** (`users.service.ts:43`): one transaction — revoke all sessions (`SessionService.revokeAllExcept(userId)` → emits `sessions.revoked`), cancel open jobs via the state machine with reason `ACCOUNT_DELETED`, withdraw pending offers/go offline (workers), anonymise name/avatar/email/phone, delete addresses + trusted contacts, delete avatar/portfolio objects through `StorageService`, keep ledger/payments with anonymised actor, `AuditService.record`. Block deletion while a worker owes commission or a job is IN_PROGRESS (clear message). Mobile delete-account flow confirm.
- **CNIC vault:** `apps/api/src/common/crypto/field-crypto.ts` AES-256-GCM with key from env (`FIELD_ENCRYPTION_KEY`, validated in `config/env.validation.ts`); encrypt `VerificationCase` ID number at rest (migration + backfill); API returns masked `42101-*******-3`; admin unmask endpoint gated to new `Compliance` admin role, writes AuditLog. Signed URL TTL for private docs ≤15 min (check `storage.service.ts`).
- **Exit:** e2e: deleted user's refresh/socket fail, jobs cancelled, PII gone; DB dump shows no plaintext CNIC.
- **Status (2026-11-13): implemented and verified locally** (API unit 295 pass; e2e 130 pass / 8 Redis-skipped, run twice on a reused temp Postgres; mobile + admin typecheck, mobile 65 tests; not run on a device).
  - Account deletion (`users/account-deletion.service.ts`, `DELETE /users/me`): requires the password; staff accounts refused; blocked (409 `DELETION_BLOCKED`, plain reason in `details`) while a job is EN_ROUTE/ARRIVED/IN_PROGRESS/AWAITING_CONFIRMATION, a cash payment is pending/disputed, a dispute is open, or a worker owes commission; not-started jobs are cancelled through the normal job path (other side notified); sessions revoked (live sockets and push cut); one transaction erases/anonymises: addresses, trusted contacts, notifications, favourites, blocks, sessions, uploads + job media + AI analyses, message text (-> "[removed]"), job description/location/coordinates (customer name -> "Deleted user"), review comments, incident description/coordinates, and for workers portfolio, verification cases (incl. encrypted ID number), hours, skills, bio and service location (offline, INACTIVE); the user row is anonymised with an unusable password; stored files are deleted after commit; audit entry without personal data. Payments and the ledger are kept (anonymous actor). Old `deleteMe` (status flag only) removed. Mobile: Delete-account screen on both account screens.
  - ID numbers: `common/crypto/field-crypto.ts` (AES-256-GCM, random IV, authenticated, `v1:` format for rotation); `FIELD_ENCRYPTION_KEY` validated (required in production); `VerificationCase.reference` encrypted on write; admin queue and detail show only `42101-*******-1`; new `Compliance` admin role reveals the full number via `POST /admin/v1/verification-cases/:id/reveal-reference`, always audited (admin UI button added); idempotent backfill `pnpm --filter @fixli/api db:encrypt-ids` (run once after deploy); signed GET links capped at 15 minutes (`MAX_SIGNED_URL_TTL_SECONDS = 900`).
  - Known remaining / owner decisions: **Super Admin can also reveal** (the role guard lets Super Admin pass everything): remove that bypass for this route if you want strict separation; the encryption key must be backed up in a secrets manager (losing it loses the numbers) and there is no key-rotation tool yet (format supports it); messages are redacted, not deleted (counterparty conversation shape is kept); resolved-dispute evidence of the deleted user is erased with their uploads and the retention period is a legal question (L1/L2); phone numbers inside free-text job descriptions of other users are not scanned; no data-export (access request) endpoint yet; the 30-day deletion grace period some stores/laws allow is not implemented (deletion is immediate).
  - Worth knowing: the JWT strategy already rejected non-ACTIVE users, and deletion now also removes the session rows, so a deleted user's token is dead on the next request (covered by e2e).

## Phase R5 — Identity: OTP & password reset (≈1–1.5 weeks; provider needs owner decision O5)
- Prisma: use existing `PhoneVerification` migration or add (`phone, purpose, codeHash, attempts, expiresAt, consumedAt, ip`, partial unique on unconsumed).
- `OtpProvider` (`WhatsApp`, `Sms`, `DevLogger` only when `NODE_ENV=development`) — same adapter family as R3 `SmsProvider`.
- Endpoints: `POST /auth/phone/start`, `/auth/phone/verify` (→ 15-min `signupToken`), `/auth/signup` requires `signupToken`, `/auth/password/forgot`, `/auth/password/reset` (revokes all sessions). `crypto.randomInt`, bcrypt hash, 5 attempts, 60s cooldown, Redis limit 3/hour/phone, constant-time compare.
- Fix enumeration: signup "phone taken" only revealed after OTP verification.
- Mobile: OTP step in `(auth)/signup.tsx`, new `(auth)/forgot-password.tsx`, `oneTimeCode` autofill, resume after process death (AsyncStorage draft).
- **Exit:** sign up + reset on a real device with a real code (once provider exists); unit tests for limits/expiry/reuse.
- **Status (2026-11-18): code implemented and verified locally; NOT usable in production until an SMS provider exists (O5)** (API unit 308 pass; e2e 136 pass / 8 Redis-skipped on a temp Postgres, migrations match schema; mobile typecheck + 65 tests; not run on a device; no real SMS ever sent).
  - API: `PhoneVerification` table (migration `20261114000000`, partial unique index = one live code per phone+purpose); `auth/otp.service.ts`: `crypto.randomInt` 6-digit code, bcrypt-hashed, 10-min expiry, 5 wrong tries then locked, 60 s resend cooldown, 3 codes/hour/phone (counted in Postgres, so no Redis needed), new code invalidates the old one. Endpoints: `POST /auth/phone/start`, `/auth/phone/verify` (-> 15-min single-use `signupToken`, signed with a separate secret and bound to the phone), `/auth/password/forgot`, `/auth/password/reset` (code + new password in one call; clears lockout; revokes every session). `OTP_REQUIRED` (default true in production, false in dev/tests) makes `/auth/signup` demand the token; "phone already registered" is now only revealed after the number is verified. `start`/`forgot` answer identically (same limits, same body) for known and unknown numbers and send nothing for the ones that should not get a code. Production with no SMS provider returns 503 `SMS_UNAVAILABLE`. SMS adapter moved to a global `SmsModule` shared with SOS.
  - Mobile: signup now Details -> code -> account (`OtpCodeStep`, `oneTimeCode` autofill, resend countdown, name/phone/role draft kept in AsyncStorage, password never stored); new `(auth)/forgot-password.tsx`; "Forgot password?" link on login.
  - Known remaining: no real SMS/WhatsApp adapter (O5; only `LoggingSmsProvider`, so in dev the code is in the API log); new strings are English only (ur/ar pending O13; the app falls back to English); the signup draft does not resume at the code step (the user taps Continue and the server's cooldown error drops them straight onto the code screen); no per-IP daily cap beyond the existing throttler; the exit criterion "sign up + reset on a real device with a real code" is open.

## Phase R6 — Missing UI for existing APIs + offline/analytics (≈1–1.5 weeks)
- Mobile screens: Disputes (open + status) from customer & worker job screens; Favourites; Trusted contacts (R3); cash dispute (R2). Decide recurring jobs/properties/subscription/service-packages: hide API routes behind a feature flag until the roadmap phase (doc 26 Track 4) rather than shipping half features.
- **Offline outbox** (`apps/mobile/src/services/offline.ts`): items with `idempotencyKey`, `validUntil` (20 min ASAP/emergency, 24h scheduled), retry backoff 5/15/45s, NetInfo trigger, expired → "Still want to send?" prompt, dependency ordering (uploads → job → message). Server: generic `IdempotencyInterceptor` (Redis, 24h, `idempotency:{userId}:{key}`) applied to job create, offers, messages, payments.
- **Analytics:** replace `console.log` adapter with PostHog (or keep adapter + provider), keep `stripPII`; events from doc 16.
- **Exit:** airplane-mode request syncs once; every API feature in scope has a reachable screen or is flagged off.
- **Status (2026-11-18): implemented and verified locally; partial vs the plan** (API unit 312 pass; e2e 142 pass / 8 Redis-skipped on a temp Postgres; mobile typecheck + 80 tests; admin typecheck; not run on a device).
  - **Disputes / "My reports":** mobile Report-a-problem screen (opened from the customer and worker job screens once the worker has arrived) and a My-reports list with status and our answer. API hardened: category is an enum; the client can no longer set the held amount or name storage keys (both were unvalidated); one open report per person per job (409 `DISPUTE_EXISTS`, the app treats it as "already received"). Resolving is still admin-only through the existing endpoint; no in-app evidence upload and no admin Disputes UI changes.
  - **Favourites:** Saved-workers screen, a save/unsave button on the completed-job screen; the API no longer 500s on an unknown worker id.
  - **Cash dispute (R2):** already on the job screen, unchanged.
  - **Trusted contacts (R3):** screen already existed; now linked from the customer profile (it was before too).
  - **Roadmap APIs hidden, not half-shipped:** recurring jobs, properties, service packages and subscription plans return 404 unless listed in `ENABLED_FEATURES` (validated; empty by default). The app never called them.
  - **Offline outbox** (`services/offline.ts`, runner in `outboxRunner.ts`, banner `OutboxBanner`): items keyed by their idempotency key (dedupe on re-queue), persisted, sent in order (upload -> job -> offer -> message), 5/15/45 s backoff, `@react-native-community/netinfo` + app-foreground + 15 s timer triggers, 20 min validity for ASAP/emergency and 24 h otherwise, stale items ask "Still want to send?" (send now / discard), a server rejection drops the item, cleared on logout so one person's queued text is never sent as another. Wired for service requests (offline -> "saved on your phone" screen) and chat messages (the old queue was never drained and is gone). 10 unit tests on the queue.
  - **Server idempotency: no generic interceptor was added, deliberately.** Job create (`idempotencyKey`), chat messages (`clientId`), cash payments and SOS incidents already dedupe on a client key (R2/R3), and submitting an offer is an upsert, so a replayed outbox item is already safe. An extra Redis/DB interceptor would add a second source of truth for no gain.
  - **Analytics:** the console adapter is replaced by a PostHog-over-HTTP adapter (no native SDK): batches, pseudonymous user id, `stripPII` allow-by-shape (plain values, strings <= 64 chars, personal-looking keys removed), opt-out switch, silent on failure, sends nothing without `EXPO_PUBLIC_POSTHOG_KEY`. Wired: `app_open`, `job_submitted`, `dispute_opened`. 5 unit tests.
  - Known remaining: offers are not queued offline (the worker sees the error and retries; an upload cannot be queued because file bytes are not persisted); no consent screen yet (needs legal L-items; `setEnabled(false)` is ready); most funnel events from doc 16 are not instrumented yet (only three); the PostHog project key is an owner decision; Urdu/Arabic strings for all new screens pending O13; the airplane-mode exit test (request syncs once) has only been run as unit tests, not on a device.

## Phase R7 — Quality, design & release gates (≈1.5 weeks)
- Coverage: raise API to ≥70% (payments, safety, admin, offers, matching first) and set `coverageThreshold` in `apps/api/package.json` + mobile; CI enforces.
- Maestro flows (`apps/mobile/.maestro/*`) run on an EAS dev build in CI; delete duplicate root `.maestro/`.
- Load test: extend `tests/load/artillery.yml` beyond health/config to login, job create, offers, socket fan-out; record P95/P99 vs doc 26 SLOs.
- i18n/RTL/a11y: load Noto Nastaliq Urdu via `expo-font`, line-height ×1.7 for `ur`, `minHeight` instead of fixed heights, RTL chevron flip, LTR phone numbers; a11y labels on every touchable (lint rule); native-speaker review (O13).
- Web: real Fixli landing (store links, privacy/terms already in `apps/web/public`), no dead buttons. Fresh screenshots for store.
- Ops: EAS project + push keys (O14), staging env, backup/restore drill, Sentry mobile.
- Re-run audit against doc 21 §31; tick doc 20 checklist items with evidence.
- **Exit:** doc 20 checklist verified green for the Pakistan pilot; no P0/P1 open.
- **Status (2026-11-18): engineering parts done and verified locally; the owner-blocked parts are open** (API unit 450 pass; e2e unchanged; mobile typecheck + 83 tests; not run on a device).
  - **Coverage:** API 52% -> 70.6% lines (450 tests; new specs for offers, matching, sweeper, disputes, addresses, admin verification/service, guards, job transitions, worker earnings, notification templates in all three languages, push provider, storage driver, files controller). `coverageThreshold` enforced in `apps/api` (70 lines) and CI now runs `jest --coverage`. Mobile is 32% lines (mostly untested screens): its threshold is a no-regression floor at 31%, not the 70% target. Two real fixes came out of it: admin `cancelJob` threw a 500 for an unknown job and could rewrite COMPLETED/CANCELLED jobs.
  - **Load test** (`tests/load`): sign-up, catalog, address, job create (+ idempotent repeat), offers, lists, worker feed/earnings, each virtual user on its own IP. First run was invalid (the per-IP header was not applied, so 88% of requests were 429s: it measured the rate limiter); fixed and re-run. Result, local single machine, API + Postgres 14 on one laptop: 5,280 users, 35,865 requests, 0 failures, overall p95 7.9 ms / p99 12.1 ms (targets 250 / 750); worst endpoint job-requests p95 10 ms. **Caveats:** test mode uses bcrypt cost 4 (production uses 12, so signup/login will be slower), no network latency, no workers to match against, no socket fan-out, no Redis. Treat it as a regression baseline, not a capacity claim; re-run against staging (`-e staging`).
  - **RTL / Urdu / a11y:** Urdu text uses Noto Nastaliq Urdu at 1.7x line height; text alignment follows reading direction (it was hard-coded `left`, wrong for Urdu/Arabic everywhere); forward/back icons mirror in RTL; CategoryTile grows instead of clipping; phone inputs were already LTR. Every touchable now has an `accessibilityRole` and icon-only ones a label, enforced by a jest guard. Not checked: the look of any screen in Urdu on a device, screen-reader behaviour, remaining fixed-size elements beyond the ones found.
  - **Lint was fake:** the API and mobile `lint` scripts were `echo`s, so CI's Lint step checked nothing. Now `oxlint` (errors fail; ~dozens of unused-variable warnings remain).
  - **Maestro:** flows rewritten against the current screens and seeded accounts (customer, worker, signup-to-code, forgot-password); duplicate root `.maestro/` removed. Not run (no device/EAS build, O14) and not in CI.
  - **Landing page:** rewritten with no dead links and no claims the product cannot back ("background-checked" and "no hidden fees" removed; Fixli does charge a commission). The call to action says the app is coming soon because there are no store links yet. No new store screenshots (needs the finished builds).
  - **Ops:** `scripts/backup-restore-drill.sh` (dump, restore to a throwaway DB, compare every table's row count, check migration history) run against the local database: matches. Not yet run against staging because there is none. Sentry is wired in API and mobile and does nothing until a DSN is set.
  - **Doc 20 checklist** re-reviewed with evidence: 12 items ticked `[x]`, 10 `[~]` partial, 1 `[n/a]`, the rest honestly still open (payments provider, penetration test, monitoring/alerts, staging, store builds, legal).
  - **Exit criteria not met:** doc 20 is not green and the audit's P0/P1 list is not empty. Still open: SMS provider (OTP and SOS contact texts), EAS/store accounts and real builds, staging environment and monitoring, native-speaker review of Urdu/Arabic, legal review, a device pass of everything above, penetration test, and the Super-Admin-can-reveal-ID-number decision.

## After R7: follow-ups (2026-11-18)
Found or closed after the phase work, same standard (claim only what was verified):
- **Money display bug (found by CI):** the API and mobile formatted amounts using the runtime's `Intl` decimals. On Node 22 PKR is zero-decimal, so a 1,500-rupee price was announced as "PKR 150,000" in push text, and the mobile price parser would have stored a typed "1500" as Rs 15 on such a runtime. Both now use `currencyExponent()` from `@fixli/shared` (the country config). Regression tests fake the bad ICU. The admin Ledger page still divides by 100 (correct for PKR/INR/AED/SAR/BDT; revisit before a zero-decimal currency).
- **Safety incidents console:** `PATCH /admin/v1/incidents/:id` (OPEN, INVESTIGATING, RESOLVED; a note is required to resolve; conditional update so two staff cannot overwrite each other; audited) and an admin Incidents page (severity first, reporter phone, location link, refreshes every 15 s; no push to staff yet). Disputes page now shows category and the amount in question.
- **Doc 16 funnel:** 11 events instrumented from the API layer (signup, offer sent, booking, payment marked/confirmed, review, verification submitted, went online/offline, SOS opened, incident created). No personal data in any of them.
- **Dev seed was broken:** `db:seed` referenced models deleted long ago, so the demo accounts (and the Maestro flows that use them) could not be created. Now truncates generically; the demo worker is online and matchable; the dev admin has the Super Admin role.
- **ID-number key rotation:** `pnpm --filter @fixli/api db:rotate-key` (dry run by default, `--apply` to write; idempotent; verifies a round trip before writing; conditional updates). Procedure is in the script header. Not run against real data (there is none yet).
- **Data export (access request):** `GET /users/me/export`, 3 per hour, audited. Own data only; no password hash, no other person's contact details, ID number masked.
- Still open from the earlier list: offers cannot be queued offline; no 30-day deletion grace period; mobile coverage floor only; device pass (below).

---

## Owner-blocked items (tracked, not engineering-blocking until R5/R7)
O1 price bands · O5 OTP/SMS provider · O8 commission confirmation (placeholders used) · O9 hosting region/processors · O13 native review · O14 EAS/Firebase/APNs accounts · legal L1–L12 (SBP, provincial tax receipts deferred to post-pilot unless counsel says otherwise).

## Sequencing
R0 → R1 → R2 ∥ R3 → R4 → R5 (when provider chosen; can start adapter work earlier) → R6 → R7. Roughly 6–7 weeks for one developer.

## Verification (each phase)
- `pnpm --filter @fixli/api exec tsc --noEmit`, `pnpm --filter @fixli/api exec jest --coverage`, `scripts/run-e2e.sh` (Postgres), `pnpm --filter @fixli/mobile exec tsc --noEmit && jest`, admin `tsc -b`.
- Phase-specific e2e: R1 forged admin token rejected; R2 50-job ledger reconciliation + concurrency test; R3 SOS life-threatening creates no job, property creates emergency job with cascade; R4 deleted user cannot refresh/connect, no plaintext CNIC; R5 OTP limits; R6 airplane-mode request de-duplicated.
- Device run (customer + worker + admin) for R2/R3/R5/R6 flows before marking a phase Done in doc 24.

---

# Appendix A — Audit findings (2026-11-13)


Method: static read of code + docs, plus ran API tsc/jest(+coverage), mobile tsc/jest, admin tsc. NOT run: API e2e (needs Postgres), lint, builds, any app on a device. Docs read in full: 00_README, 00_EXEC, 24, 25, 26, README. Docs only grepped/spot-checked: 01–23 (esp. 09 trust, 10 payments, 21 rubric, 22 UX). Unchecked in depth: 01–08, 11–19, 23.

## Ground truth
| Check | Result |
|---|---|
| API typecheck | clean |
| API unit tests | 229/229 pass; coverage 44.7% stmts / 34% funcs (README claims ">70%"; no threshold configured) |
| Mobile typecheck / tests | clean / 59/59 |
| Admin typecheck | clean |
| CI | typecheck+lint+test+expo export. `pnpm audit ... || true` (never fails); secret scan uses unpinned trufflehog@main; Maestro job only echoes; e2e not in CI |
| Release checklist (doc 20) | 0 of 71 boxes ticked (doc 26 says "65 items") |
| 40+ Prisma models | all have CREATE TABLE in migrations (K6 resolved) |

## Doc-vs-reality matrix (key claims)
| Doc claim | Reality | Status |
|---|---|---|
| 24: "Phases 0–13 implemented" | Phases 0–6 have detailed, plausible evidence; 7–13 are one-liners with commit hashes only. Several contradicted below. Header of doc 24 Part A still says "UI prototype / 16/115" (stale) | Partly true; doc internally contradictory |
| 24 Ph2/25 O5: OTP deferred | No OTP, no password reset, no PhoneVerification code (table exists in migration only). Anyone can register any number; signup reveals registered numbers (PHONE_TAKEN). Doc 26 plans it | Open launch blocker |
| 24 Ph10: SOS "Done" | API: `reportIncident` for PROPERTY_DAMAGE only logs "would create urgent job"; trusted-contact SMS is `[Simulated]`; emergency numbers hard-coded in service not CountryConfig. Mobile: SOSButton → `router.push('request-service?isEmergency=true')` (an ordinary job); zero mobile calls to safety/incidents, trusted-contacts, emergency-numbers. Docs 03/09 explicitly forbid this routing | Not implemented (API stub + UI contradicts spec) |
| 24 Ph11: admin realtime w/ RBAC | `admin.gateway.ts:83-89` `parseTokenSimulated`: token `admin-<userId>` accepted without signature → anyone knowing an admin user id joins admin:Verification/Operations/Safety rooms and receives live verification/dispute/incident events | **Security vulnerability** |
| 24 Ph9 / 25 O8: commission per config (12%, PKR, min100/max1500, soft 3000/hard 5000, 7-day) | `payments.service.ts`: hard-coded `Math.floor(amount*0.10)`; currency default 'USD' (also schema default); controller body is inline type `{amount,currency}` (not a DTO class → ValidationPipe doesn't validate; negative/huge/NaN amounts possible); no idempotency (repeat mark-cash creates multiple Payments; markCashReceived doesn't check existing payment); ledger balance is read-then-write with no lock/serialization (race); no cap enforcement anywhere (workers.service only reads balance); no auto-confirm cron; no PAYMENT_DISPUTED flow; no min/max fee; 1 unit test | Core money path unfit for launch |
| 26 §3.3: "DELETE /me fully implemented: revokes sessions, cancels jobs, anonymizes name/avatar" | `users.service.deleteMe`: sets status DELETED, phone→`deleted-id`, email null only. Name/avatar/addresses kept; sessions not revoked (JWT strategy does reject non-ACTIVE users, which partially mitigates); open jobs not cancelled; comment admits it | Claim false; store-compliance risk |
| 26 §2.1: CNIC AES-256-GCM, masked, audit on unmask | No encryption code (`createCipheriv` absent); masking only a mobile formatter | Not implemented |
| 26 §2.3 provincial tax, receipts | Absent | Not implemented (planned) |
| 26 §1.2 Idempotency-Key interceptor (Redis) | Job create has clientId-based idempotency only; no generic interceptor; payments none | Partial |
| 24 Ph12 offline outbox + TTL | `offline.ts` = 58 lines AsyncStorage queue; no TTL/validUntil, no idempotency key, no dependency order | Skeleton only |
| 24 Ph12 analytics | `analytics.ts` is `console.log` only; no provider (PostHog available) | Stub |
| 24 Ph6/O14 push | no EAS projectId in app.json/eas.json | Blocked on accounts (documented) |
| 24 Ph12 a11y/i18n/RTL | 45 a11y labels, 12 RTL references, no Nastaliq/Noto font loaded; en/ur/ar all machine-drafted (O13). (Earlier draft also claimed an always-on customer GPS tracker — withdrawn: the hook is gated on `tracking.isTracking`.) | Partial |
| Mobile feature reach | No mobile screens or callers for disputes, trusted contacts, favourites, recurring jobs, properties, incidents, forgot-password, OTP. Customer job screen has reviews/cash/change-orders callers | Several API features have no UI |
| Doc 05 PostGIS | Postgres 16-alpine, haversine + bounding box SQL; migration comment defers PostGIS | Deviation, documented, acceptable at pilot |
| Doc 07/24 `/api/v1`, pagination | global prefix `api` only, no versioning; worker ledger uses skip/take | Deviation |
| 25 O11: stray files "untracked" | `Prolivo_Product_Documentation.zip`, `scratch_login.tsx`, `screenshot.png`, `metadata.json`, `schema.prisma.bak` are TRACKED in git | Doc wrong; repo hygiene |
| Brand | Fixli everywhere in mobile/docs/logos; `apps/web` (App.tsx, index.html) and `apps/admin/index.html` still say "Triply"; doc 23 still Triply; O4 unresolved | Inconsistent |
| `apps/web` | 82-line static marketing page with dead "Log in"/"Get the App" links | Placeholder |
| Rate limiting | Global 100/min, auth 5–10/min, AI 10/min (doc 26 says 15). Redis store only if REDIS_URL set | Done (minor drift) |
| Core marketplace (request→match→offer→book→work→review, chat, realtime, notifications, uploads, admin verification, catalog, auth sessions w/ refresh rotation) | Present with state machine, ownership checks, 229 tests, request-id, env validation, Sentry hook, Swagger off in prod, helmet, CORS from env | Genuinely solid |

## Ranked blockers
1. Admin websocket auth bypass (admin.gateway.ts).
2. No phone verification / password reset (account squatting, enumeration, no recovery).
3. Money path: validation, idempotency, race, config-driven commission, caps, disputes, auto-confirm, currency default USD.
4. SOS/safety not real (UI contradicts own spec; SMS simulated; no life-threatening flow).
5. Account deletion incomplete (store 5.1.1(v), privacy law).
6. CNIC at rest unencrypted; no unmask audit.
7. ~~Customer location tracker always-on~~ (withdrawn — gated on active tracking).
8. CI gates are cosmetic (audit `|| true`, no e2e, Maestro echo, floating trufflehog@main); coverage 45%.
9. Repo hygiene + brand (Triply) + doc contradictions.
10. Release checklist 0/71; legal L1–L12, price bands, native-speaker review, EAS accounts, hosting region all open.

---

## PR #3 reconciliation (fix-mobile-app merged with main, 2026-11-20)

PR #3 (F0–F8) and main (R0–R7) were two independent rewrites of the same ground, started from the
same October commit. Merging them was a design exercise, not a text merge: 96 files conflicted and
the two sides disagreed on the database itself. **This section says exactly what was kept, what was
dropped and what is now untested**, so nobody reads "merged" as "everything from both survived".

### Rules used
1. **The PR's backend is the base** (its schema, migrations, money/ledger, admin console, staff 2FA, SOS
   dispatch, live tracking, feature flags, price bands, disputes). Its code depends on its own columns
   all the way through (`Worker.ledgerBalance`, `User.totp*`, `Message.isFlagged`, …), so keeping main's
   versions of those files would have left two payment systems in one app.
2. **Main's additions that do not overlap are kept**: phone OTP + password reset, `FeatureGuard`
   (`ENABLED_FEATURES`), `GET /users/me/export`, field-key rotation tool, ID-number masking + audited reveal,
   the mobile outbox/OTP/analytics/RTL work, load test, backup drill, the currency-decimals fix.
3. **One migration chain**: the PR's `20261011…20261012…` migrations plus one new migration
   (`20261120000000_otp_and_payment_reminders`: `PhoneVerification`, `Payment.claimedAmount/reminderStage`,
   `Incident.latitude/longitude`). Main's own `20261106…20261114` migrations were removed (they created
   tables the PR's chain already creates). The chain applies to an empty database and `prisma migrate diff`
   reports no drift. **A database that already ran main's old migrations cannot be upgraded in place; it
   must be recreated** (no environment holds real data yet).

### What main had that is now gone (replaced by the PR's equivalent)
| Main feature | Now |
|---|---|
| Cash auto-confirm reminders (`Payment.reminderStage` stages at +2h/+12h/+23h) | Column exists, **nothing writes it**. The PR's own cash flow and sweeper run instead. |
| `claimedAmount` on "I paid less" | Column exists, **not used**. |
| Main's disputes (per-person open report, `DISPUTE_EXISTS`, `AMOUNT_TOO_HIGH`) | The PR's disputes (money-linked). The mobile "Report a problem" screen posts the fields both accept. |
| Main's SOS service (kinds, trusted-contact SMS result, `SosDto`) | The PR's SOS (dispatch to nearest worker, `SosDispatch`). Main's SOS e2e spec removed. |
| Main's `AccountDeletionService` | The PR's `users.deleteMe`. Main's service and spec removed. |
| Main's admin Incidents page + `PATCH /admin/incidents/:id` | The PR's Safety page and `safety.manage` permission. |
| Main's `sms/sms.module.ts` provider interface | Merged into the PR's `SmsProvider` (`LoggingSmsProvider` added; OTP uses it). |
| Main's mobile SOS screens/helper, push-template and sweeper specs | Removed with the code they tested. |

### Tests that no longer exist (coverage honestly lower)
Specs for code that was replaced were deleted rather than rewritten: `sweeper.service.spec`,
`admin-roles.guard.spec`, `jobs.transitions.spec`, `admin-verification.service.spec` (the masking behaviour
is covered by `profiles.e2e` and `privacy.e2e`), `admin.service.spec`, `rules.sos.spec` and
`templates.spec` (both were already failing on the PR), main's `safety`/`payments` e2e, the mobile SOS tests.
**API unit coverage fell from 70 % to about 53 % lines** because the PR's large modules (money, admin
console, SOS, tracking) were covered only by e2e. **Fixed with real tests, not a lower bar**: the thresholds are
unchanged (statements 69, branches 73, functions 62, lines 70) and are now met (about 74 / 75 / 67 / 75). New
unit specs: admin console, admin and verification services, staff 2FA, settlements, ledger, country config,
earnings, disputes, SOS dispatch, both sweepers, live location, catalogue, notification templates (every type
in en/ur/ar), the permissions guard, lease, request-shape (DTO) validation and the thin controllers.
Still thin: `jobs.service` (about 65 % of branches), `chat.service`, `s3.driver`, `main.ts`/`app.module.ts`
(bootstrap) and the admin/disputes controllers (covered by e2e and the route sweep).

### Changed on purpose while merging
* ID numbers: lists/details show `referenceMasked`; the full value needs the new `verification.reveal`
  permission and is audited. Only Super Admin holds it (open question: should it?).
* Mobile: both analytics pipelines remain (`services/analytics.ts` consent-first allow-list;
  `services/productAnalytics.ts` funnel events). The funnel events only flow while the person has
  agreed (consent gate). Two pipelines is a smell; merge them later.
* Mobile Urdu/Arabic for the new OTP, reports, saved-workers and outbox text was written by the assistant
  and is **not native-reviewed** (O13).
* A pre-existing type error in `chat/contact-detector.ts` (the PR's) was fixed.
* CI: the PR's workflow is the base (audit, migration-drift check, bundle budget, Redis, TruffleHog,
  semgrep, admin/mobile e2e) with main's two coverage gates added; main's separate `e2e.yml` was dropped
  because the PR's CI already runs the API e2e.

### Verified locally
API typecheck clean; unit 422 pass; mobile typecheck clean, 124 tests pass; shared 36 pass; admin and web
build. API e2e on a clean Postgres 14: see the PR description for the run. **Not run**: Redis outage e2e
(no Redis here), Maestro/device flows, admin Playwright, mobile Android bundle.
