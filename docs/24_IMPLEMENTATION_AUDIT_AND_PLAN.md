# Fixli — Implementation Audit & Phase-wise Build Plan

> Status: **audit + plan only; nothing in this document has been implemented.**
> Audited: 2026-10-07, branch `fix-mobile-app`, all of `apps/` and `packages/`, against docs 00–23.
> Supersedes the "current-state inventory" in `22_UX_UI_AUDIT_AND_REDESIGN_PLAN.md` §12, which is out of date.
> Read with `19_AGENT_ENGINEERING_RULES.md` (still binding) and `21_PRODUCTION_AUDIT_HARDENING.md` (severity scale).

---

## Part A — Audit

### A.1 Verdict

The repository is a **UI prototype on top of an insecure CRUD API**. The design system, light/dark theming and the new tab structure from doc 22 exist, but the core marketplace loop (request → match → book → work → pay → review) does not work end to end. Almost every screen after "create a request" renders hard-coded data with "DEV TOOLS" buttons to fake state changes. The API has twelve P0 issues (data leaks, mass assignment, unauthenticated WebSocket identity).

**Production readiness (doc 21 §31): ≈ 16 / 115 (14 %) — not production ready.**

### A.2 Things to know first

| # | Issue | Impact |
|---|-------|--------|
| K1 | Root `.gitignore` "Legacy files" block ignores every `App.tsx`, `index.tsx`, `app.json`, `babel.config.js`. Untracked today: `apps/mobile/app.json`, `apps/mobile/app/index.tsx`, `apps/mobile/app/(customer)/(home)/index.tsx`, `apps/mobile/babel.config.js`, `apps/admin/src/App.tsx`, `apps/web/src/App.tsx`. | A fresh clone cannot build mobile, admin or web. |
| K2 | `apps/mobile/tsconfig.json` sets `moduleResolution: node`, which conflicts with `expo/tsconfig.base` (`customConditions`). `tsc` aborts on the config and checks nothing. With it fixed there are **32 type errors** (e.g. `theme.colors.onPrimary` used 9× but not defined). | Type safety is currently fictional for mobile. |
| K3 | Brand conflict: doc 23 renames the product to **Triply**; `src/i18n/index.ts` `app.name` and `apps/web` say Triply; docs 00–22, `app.json`, logos and splash say **Fixli**. | Owner decision needed (see B.1). |
| K4 | `Prolivo_Product_Documentation.zip` (repo root, untracked) is an older copy of docs 00–20 under a previous name. | Do not use as a source. |
| K5 | API tests: 85 tests, **18 failing** (jobs, auth, workers, ai suites). Some passing tests assert insecure behaviour (e.g. "should not filter by customerId for worker users"). Mobile: 2 of 6 suites fail (`ReactCurrentOwner`, test-renderer/React 19 mismatch). No CI (`.github/` absent). | No safety net for any of the work below. |
| K6 | Only one Prisma migration exists (8 tables); the schema has 22 models (added via `db push`). `apps/api/Dockerfile` runs `prisma migrate deploy` and uses `npm ci` inside a pnpm workspace with `workspace:*`. | Production DB would be missing most tables; Docker build fails. |

### A.3 P0 findings (must fix before anything ships)

| ID | Finding | Evidence |
|----|---------|----------|
| S1 | `GET /api/users` is unauthenticated and returns every user's name, email and role. | `apps/api/src/users/users.controller.ts:13` |
| S2 | WebSocket identity comes from `?userId=` in the handshake query. Anyone can impersonate any user, receive their `newMessage` events, send as them, spoof `locationUpdate`. CORS `*`. | `apps/api/src/chat/gateways/chat.gateway.ts:17,28,46` |
| S3 | Emergency jobs are broadcast with `server.emit('emergencyAlert', job)` to **every** connected socket, including customer email, description and location. | `apps/api/src/jobs/jobs.service.ts:33` |
| S4 | `PATCH/PUT /job-requests/:id` writes `dto as any`: customers can set `status`, `paymentAmount`, `assignedWorkerId`; workers can self-assign any open job and set `COMPLETED`. No state machine. Two workers can "accept" the same job (no conditional update). | `jobs.service.ts:96-118` |
| S5 | Workers see **all** jobs of all customers in `GET /job-requests` and any unassigned job's customer email in `GET /job-requests/:id`. | `jobs.service.ts:42-47, 66-70` |
| S6 | `@Body() data: any` bypasses `ValidationPipe` in quotes, change-orders, addresses, reviews, properties, recurring-jobs → mass assignment (e.g. worker creates a quote with `status: 'APPROVED'`; change orders on jobs nobody is assigned to). | `quotes.service.ts:20`, `change-orders.service.ts:20`, `addresses.service.ts:15`, `properties.service.ts:9` |
| S7 | IDOR: `GET /quotes/job/:id`, `GET /change-orders/job/:id`, `GET /disputes/:id` (read); `POST /properties/:id/assets`, `POST /properties/assets/:id/warranties` (write); all of `/recurring-jobs/*` (read/write). | respective controllers |
| S8 | Reviews: anyone can review anyone, no completed-job requirement, `rating` unbounded → one review can set any worker's average to any number. | `reviews.service.ts` |
| S9 | Mobile login returns a **logged-in mock user on any error**, including wrong password; any `@example.com` email is auto-logged-in with `mock-token`. OTP screen: `0000` → customer, `1111` → worker, anything else → role picker that logs in as a demo account. | `apps/mobile/src/store/authSlice.ts:29-61`, `app/(auth)/otp.tsx:31-53` |
| S10 | Rate limiting configured but inactive: `ThrottlerGuard` is never registered as `APP_GUARD`. Only per-account lockout exists, which lets anyone lock out a known account. | `apps/api/src/app.module.ts` |
| S11 | `GET /workers`, `GET /workers/:id` are public and return worker email and `homeAddress`. | `workers.service.ts:20-40` |
| S12 | Disputes can be opened on any job by any user (no participant check). | `disputes.service.ts:8` |

**P1 (high):** 7-day JWT, no refresh/logout/revocation · default JWT secret in `docker-compose.yml` · 50 MB JSON body limit with base64 media · Swagger public · `HttpExceptionFilter` never registered · AI prompts interpolate raw user text (prompt injection) · AI safety screen **fails open** (`isSafe: true` on error) · AI error strings returned as user content ("Failed to transcribe audio.") · no AI rate limit · no audit log · customer GPS watched continuously from login (`useCustomerLocationTracker` mounted globally in `app/_layout.tsx`) · worker Account shows "✓ Verified Professional" for everyone (doc 09 violation) · hard-coded LAN IP `192.168.100.66` fallback in `services/api.ts:15`, `services/socket.ts:8` · `UpdateWorkerDto.skills` is not a DB column (Prisma error on write) · `CreateJobDto` has no `serviceId`, so `forbidNonWhitelisted` rejects requests that send one.

### A.4 Placeholder / fake data inventory (every instance must go)

| File | Placeholder |
|------|-------------|
| `mobile/src/store/authSlice.ts:29-61` | Mock users `customer-1` / `worker-1`, `mock-token`, fallback on any error |
| `mobile/app/(auth)/login.tsx:79-80` | Demo account chips (`customer@example.com` / `password123`) |
| `mobile/app/(auth)/otp.tsx:31-53` | Fake OTP codes 0000/1111, fake role signup |
| `mobile/app/(customer)/request-service.tsx:51-67,104,250,263` | Hard-coded issues list, "Home (123 Main St)", "Work (456 Office Pkwy)", price "$40 - $80" |
| `mobile/app/(customer)/job/[id].tsx:13-20,48,59,65,141-179` | `MOCK_WORKER` (Ahmed K.), second offer (Samir B.), "Pay $65.00", `Alert('Calling...')`, `Alert('Opening chat...')`, DEV TOOLS block, map at lat/lng 0,0 |
| `mobile/app/(customer)/bookings.tsx:9-35` | `MOCK_JOBS`, "Ahmed is on the way" |
| `mobile/app/(customer)/chat.tsx`, `(worker)/chat.tsx` | Static "Your conversations will appear here" |
| `mobile/app/(customer)/profile.tsx` | "Saved Addresses: 2", "Appearance: Dark" static values; rows without handlers |
| `mobile/app/(customer)/(home)/categories/[id].tsx` | Sub-category tap navigates to Chat |
| `mobile/app/(customer)/(home)/index.tsx` | Categories from `@fixli/shared` constants, not the catalog API |
| `mobile/app/(worker)/today.tsx:53-101` | "$120", "2 Jobs", "Electrical Fix $45.00", "456 Oak Avenue (2.1 km)", "Pipe Burst Emergency", Online switch local-only |
| `mobile/app/(worker)/jobs.tsx:10-14` | `MOCK_JOBS`, Decline `onPress={() => {}}` |
| `mobile/app/(worker)/job/[id].tsx:13-20,82,135,153` | `MOCK_CUSTOMER` (Sarah M.), DEV TOOLS, simulated map |
| `mobile/app/(worker)/earnings.tsx:8,28` | `MOCK_TRANSACTIONS`, "$345.00", "Next automated payout on Oct 15", "Cash Out Now" no-op |
| `mobile/app/(worker)/account.tsx:17-46` | "3 Projects", "4.8", "Ending in 1234", "Verified", fallback name "Ahmed K.", "Verified Professional" |
| `mobile/src/forms/components/VoiceField.tsx:35-37` | Simulated transcription text |
| `mobile/src/components/ui/DocumentVerification.tsx:16` | Simulated OCR upload |
| `mobile/src/components/ui/WorkerPortfolio.tsx` | Static portfolio (component unused) |
| `mobile/src/store/trackingSlice.ts:48` | ETA always "15 mins" |
| `admin/src/pages/Dashboard.tsx:5-10` | "12,450 users", "$45,231" etc. |
| `admin/src/pages/{Verifications,Disputes,Services}.tsx` | `localhost:3000` (API is 3002, missing `/api`), `Bearer admin-token-stub`, dummy rows on failure, Approve only filters local state |
| `api/src/auth/auth.service.ts:34-35`, `packages/shared/src/constants` | `picsum.photos` default avatars |
| `api/prisma/seed.ts` | Demo users with `password123` (allowed **only** as a dev-only seed, see B.2) |

### A.5 New requirements from the owner (2026-10-07) — gap analysis

| # | Requirement | Current state | Gap |
|---|-------------|---------------|-----|
| R1 | **No placeholder data; all data real from DB** | See A.4: ~25 placeholder sites; categories from constants; admin always dummy | Every screen must load from the API, show loading/empty/error states, and never fall back to fake data. Dev seed data only in dev DB. |
| R2 | **All screens fully functional** | Only Login (email) and Request (create job) touch the API; every other screen is static or local-state | Every button must perform a real, server-validated action (§C.2 screen matrix). |
| R3 | **Realtime notifications and updates** | Socket.IO exists but unauthenticated; only `newMessage`, `locationUpdate`, `emergencyAlert` (leaky broadcast). No push, no notification table/centre, no job-status events | Authenticated socket, room model, event catalog, persisted notifications, Expo push, in-app notification centre, live badge counts, reconnect backfill (§C.3). |
| R4 | **Realtime chat** | REST + socket send exist; no way to **create** a conversation; no pagination; no read receipts UI; both chat screens are placeholders | Job-scoped conversations auto-created on booking, chat list + thread screens, live delivery, typing, read receipts, image messages, unread counts, push when offline. |
| R5 | **Proper user profiles for workers and customers** | User has name/email/photo only; Worker has loose strings (`availability`, `hourlyRateRange`, `homeAddress`); no customer profile editing; no public worker profile screen | Structured customer profile and worker profile (§C.4 data model), edit screens, photo upload, public worker profile with real stats/reviews/portfolio, verification status. |
| R6 | **Phone number + password login for workers and customers** | Email + password only; `User.email` required & unique; no `phone` column | `User.phone` (E.164, unique) becomes the login identifier; email optional. Admin keeps email login. **Supersedes doc 22 D-row "no password" (U1, §6.3 A)** — see B.1 D8. |
| R7 | **Proper signups for customers and workers** | `POST /auth/signup` with email; no mobile signup screen exists at all now | Separate, guided signup flows for each role (§C.5), phone verification, worker onboarding to "pending review". |
| R8 | **Phone input masked by current country** | No phone field anywhere; `react-native-masked-text` installed but unused (unmaintained) | Country detection + `libphonenumber-js` as-you-type formatting, country picker, E.164 storage, identical validation on client and server (§C.6). |
| R9 | (implied by R1–R2) **Admin needs real data** | Admin portal has no login and shows dummy data | Admin auth + RBAC and real pages, so verification/disputes actually work (otherwise workers can never be approved). |

### A.6 Feature status vs docs

Legend: ✅ built · 🟡 partial · 🎭 UI-only/mock · ❌ missing

**Customer MVP (doc 01 §9):** auth 🟡 · addresses 🟡 (API only) · discovery 🟡 · NL job creation 🟡 (dead-ends after submit) · media 🟡 (photo sent to AI, never stored) · AI analysis 🟡 · matching ❌ · pro profiles ❌ · availability ❌ · booking ❌ · quote approval 🟡 (API) · chat 🟡 (API, insecure) · push ❌ · timeline 🎭 · live ETA 🎭 · payment ❌ · completion ❌ · reviews 🟡 (API, insecure) · disputes 🟡 (API) · rebook/favourites ❌ · history 🎭 · SOS 🟡 (hold works; no emergency numbers/guidance; routes to ordinary job, contrary to docs 03/09).

**Professional MVP:** onboarding ❌ · ID verification 🟡 (status flags, no upload) · skills 🟡 · radius 🟡 · availability ❌ · pricing ❌ · job feed 🎭 · accept/decline 🎭 · navigation 🎭 · status updates 🎭 · chat 🎭 · quote/change order 🟡 (API) · evidence ❌ · checklist/sign-off ❌ · earnings 🎭 · payout ❌ · reputation 🟡 · dashboard ❌ · offline ❌ · online toggle 🎭.

**Admin (doc 12):** login ❌ · RBAC/MFA ❌ · users ❌ · verification 🎭 · catalog 🟡 (API; page not routed) · config ❌ · jobs ❌ · payments ❌ · disputes 🟡 (API; page not routed) · moderation ❌ · safety console ❌ · analytics 🎭 · flags ❌ · audit ❌.

**Cross-cutting:** modular monolith ✅ · PostGIS ❌ · Redis ❌ · object storage ❌ · queues ❌ · API versioning `/api/v1` ❌ · pagination ❌ · idempotency ❌ · state machines ❌ · structured logging/request IDs ❌ · audit log ❌ · payments ❌ · analytics ❌ · country config ❌ · i18n 🟡 (8 files use `t()`) · accessibility 🟡 (7 labels in the app) · offline ❌ · CI ❌ · money as integer minor units ✅ (schema) but currency defaults to `USD` and UI hard-codes `$`.

**Doc 22 redesign progress:** Phase 0 ≈ 40 % · Phase 1 ≈ 50 % (Button, Text, ChipChoice, CategoryTile, WorkerCard, StatusTimeline, SOSButton, BottomSheet, Avatar, EmptyState [unused], Logo) · Phase 2 ≈ 10 % · Phases 3–4 ≈ 25 % (shells) · Phase 5 ≈ 10 % (`useDraft` unused) · Phase 6 ≈ 5 % · Phase 7 0 %.

### A.7 Readiness score (doc 21 §31)

Authentication 1 · Authorization 0 · Data isolation 0 · API security 1 · Rate limiting 0 · Validation 1 · Error handling 1 · Logging 0 · Database 1 · Query performance 1 · Caching 0 · Forms 2 · UX 2 · Accessibility 1 · Mobile performance 1 · Realtime 1 · Payments 0 · AI safety 1 · Privacy 0 · Infrastructure 1 · Observability 0 · Disaster recovery 0 · Testing 1 → **16 / 115**.

---

## Part B — Decisions

### B.1 Decisions

| # | Decision | Status |
|---|----------|--------|
| D8 | **Login = phone number + password** for customers and workers (owner, 2026-10-07). Overrides doc 22 U1 / §6.3 A ("no password"). Admin staff keep email + password + MFA. | Decided |
| D9 | **Phone ownership is verified once at signup with a one-time code (SMS, WhatsApp where configured), and again for password reset.** Without it anyone can register someone else's number. Login itself does not need a code. | Recommended — owner to confirm |
| D10 | **No placeholder data in app code.** Missing data shows a real empty state. Demo data exists only in a dev-only seed script and a dev DB; release builds contain no demo accounts or DEV TOOLS. | Decided (R1) |
| D11 | Brand: **Fixli** (logos, app.json, docs 00–22) vs **Triply** (doc 23). This plan assumes **Fixli** until the owner says otherwise; the name lives in one config key so a switch is a one-line change. | **Open — owner** |
| D12 | Launch scope remains **Pakistan first** (doc 22 §11.5); every country-specific value comes from country config, never code. | Decided (doc 22) |
| D13 | Payments at launch: **cash on completion** + commission ledger (doc 22 §11.8). Card/wallet behind a provider adapter in a later phase, after legal item L5. | Decided (doc 22) |

### B.2 Rules that apply to every phase

- Every screen: loading, empty, error-with-retry, offline states; light/dark; LTR/RTL; translated strings; accessibility labels.
- Every endpoint: DTO class (never `any`), ownership check in the query, role guard, pagination for lists, standard error envelope, audit entry if sensitive.
- Every state change goes through a server-side state machine and emits a realtime event.
- Every money value: integer minor units + ISO currency from country config.
- A phase is **done** only when its exit criteria pass on a real device against a real API and DB, with tests and CI green.

---

## Part C — Target specification

### C.1 Target navigation

```
Auth:      Welcome/Language → Login | Sign up (choose role)
           Customer sign-up: Phone → Code → Name + Password → (Photo) → Home
           Worker sign-up:   Phone → Code → Name + Password → Skills → Area → Hours → ID docs → Selfie → Pending review
           Forgot password:  Phone → Code → New password
Customer tabs: Home | My Jobs | Messages | Account      (+ Notifications from bell)
Worker tabs:   Today | Jobs | Messages | Earnings | Account
```

(Doc 22 proposed 3/4 tabs with chat inside the job; R4 asks for real-time chat as a feature, so Messages is a tab that lists job conversations. Each job screen also links to its conversation.)

### C.2 Screen matrix (every screen, its data, actions and live updates)

| Screen | Data source (API) | Actions | Realtime events consumed |
|--------|-------------------|---------|--------------------------|
| **Welcome / Language** | `GET /config/countries`, `GET /config/country/:code` | pick language, confirm country | — |
| **Login** | — | `POST /auth/login {phone, password}` | — |
| **Sign-up: role** | — | choose Customer / Worker | — |
| **Sign-up: phone + code** | country config | `POST /auth/phone/start`, `POST /auth/phone/verify` | — |
| **Sign-up: name + password** | — | `POST /auth/signup` | — |
| **Forgot / reset password** | — | `POST /auth/password/forgot`, `POST /auth/password/reset` | — |
| **Customer Home** | `GET /me`, `GET /catalog/categories?country=`, `GET /jobs?status=active&limit=1`, `GET /notifications/unread-count` | open category, Photo/Voice shortcut, SOS, bell | `job.status_changed`, `notification.created` |
| **Category** | `GET /catalog/categories/:id` (services + common issues) | start request with category | — |
| **Request flow (5 steps)** | `GET /me/addresses`, catalog issues, `GET /catalog/estimate` | `POST /uploads/presign`, `POST /ai/analyze`, `POST /jobs` | — |
| **Job (customer)** | `GET /jobs/:id` (job, timeline, offers, booking, worker, change orders, payment) | choose offer, cancel, call (masked), message, approve/decline change order, confirm cash paid, review, dispute | `offer.created`, `offer.expired`, `job.status_changed`, `worker.location`, `change_order.requested`, `payment.recorded` |
| **My Jobs** | `GET /jobs?scope=active|past&cursor=` | open job, book again | `job.status_changed` |
| **Messages list** | `GET /conversations?cursor=` | open thread | `message.created`, `message.read` |
| **Chat thread** | `GET /conversations/:id/messages?cursor=` | send text/image, mark read | `message.created`, `message.read`, `typing` |
| **Notifications** | `GET /notifications?cursor=` | open target, mark read / all read | `notification.created` |
| **Customer Account** | `GET /me` | edit profile, addresses, language, appearance, notification prefs, change password, sessions, help, delete account, logout | — |
| **Edit profile (customer)** | `GET /me` | `PATCH /me`, photo upload | — |
| **Addresses list / edit** | `GET /me/addresses` | create/update/delete/default, GPS pin + reverse geocode | — |
| **Worker public profile** | `GET /professionals/:id` (public fields only) | message (only within a job), choose (from offer) | — |
| **Review** | job | `POST /jobs/:id/review` | — |
| **Dispute** | job | `POST /jobs/:id/disputes`, evidence upload | `dispute.updated` |
| **SOS** | `GET /config/country/:code` (emergency numbers) | call emergency number (OS dialer), create urgent property job, notify trusted contact | `job.status_changed` |
| **Worker Today** | `GET /professionals/me/summary` (online, next job, today's earnings, owed commission, verification) | go online/offline `POST /professionals/me/online|offline` | `job.request` (new nearby request), `job.status_changed`, `verification.updated` |
| **Worker Jobs (New / Booked / Done)** | `GET /professionals/me/requests`, `GET /professionals/me/bookings?scope=` | send price `POST /jobs/:id/offers`, decline `POST /jobs/:id/decline` | `job.request`, `offer.accepted`, `offer.expired`, `job.status_changed` |
| **Worker Job** | `GET /jobs/:id` (worker view; exact address only after booking) | on the way / arrived / start / finish, before/after photos, change order, mark cash received, navigate (opens maps), message, call | `change_order.decided`, `payment.recorded`, `job.status_changed` |
| **Earnings** | `GET /professionals/me/earnings?period=`, `GET /professionals/me/ledger?cursor=` | settle commission (when rail exists) | `payment.recorded`, `ledger.updated` |
| **Worker Account** | `GET /professionals/me` | edit profile, skills, service area, hours, pricing, portfolio, verification docs, reviews, language, appearance, password, sessions, help, logout | `verification.updated` |
| **Verification docs** | `GET /professionals/me/verification` | upload ID front/back, selfie, certificates | `verification.updated` |
| **Admin (web)** | `/admin/v1/*` | see Phase 11 | `admin.*` |

### C.3 Realtime & notification design

**Transport:** Socket.IO namespace `/rt`. Client sends `auth: { token }` (access JWT) in the handshake; server verifies, loads the user, rejects otherwise; token refresh → reconnect. No user IDs accepted from clients.

**Rooms:** `user:{id}` (joined automatically), `job:{id}` (server joins participants only), `conversation:{id}` (participants only), `admin:{role}`.

**Event envelope:** `{ id, type, version, occurredAt, data }`. `id` is the `job_events`/`notifications` row ID so clients can de-duplicate.

**Event catalog:**

| Event | Room | Trigger |
|-------|------|---------|
| `job.request` | `user:{workerId}` for each matched worker | job submitted / re-matched |
| `offer.created` / `offer.withdrawn` / `offer.expired` | `job:{id}` | worker sends price / expiry job |
| `offer.accepted` | `user:{workerId}` | customer chooses |
| `job.status_changed` | `job:{id}` + both `user:` rooms | any state-machine transition |
| `worker.location` | `job:{id}` (customer only) | only in `EN_ROUTE`, throttled ≥ 5 s, stops on `ARRIVED` |
| `change_order.requested` / `change_order.decided` | `job:{id}` | |
| `payment.recorded` | `job:{id}` | cash marked / confirmed |
| `message.created` / `message.read` / `typing` | `conversation:{id}` | |
| `notification.created` | `user:{id}` | any persisted notification |
| `verification.updated` | `user:{workerId}` | admin decision |
| `dispute.updated` | parties' `user:` rooms | |

**Persistence & push:** every user-relevant event also writes a `notifications` row (type, payload, readAt) and, if the user has no active socket or the app is backgrounded, sends an **Expo push** (`expo-notifications`; token stored per session/device). Channels: booking, job, message, payment, safety, marketing (marketing opt-in only). De-duplication by `(eventId, recipient, channel)`.

**Client:** a single `RealtimeProvider` dispatches events into Redux (RTK Query cache invalidation or slice updates). On reconnect: `GET /sync?since=<lastEventAt>` to backfill missed events. Badge counts (unread messages, unread notifications) are server-computed.

**Scale:** Socket.IO Redis adapter so multiple API instances share rooms (Redis also used for rate limits and presence).

### C.4 Data model changes (Prisma; each change is a migration)

**Identity**
- `User`: add `phone` (E.164, **unique**, required for customer/worker), `phoneVerifiedAt`, `countryCode` (ISO-3166), `locale`, `timezone`, `status` (ACTIVE / SUSPENDED / DELETED), `lastLoginAt`; `email` becomes optional (still unique when present; required for admin); `profileImageUrl` → `avatarKey` (object-storage key). Remove picsum defaults.
- `Session`: `id, userId, deviceId, deviceName, platform, pushToken, refreshTokenHash, createdAt, lastUsedAt, expiresAt, revokedAt`.
- `PhoneVerification`: `id, phone, purpose (SIGNUP|RESET|CHANGE), codeHash, attempts, expiresAt, consumedAt, ip`.
- `CountryConfig`: per doc 22 §11.3a (currency + exponent, dial code, phone rules, OTP channels, locales, payment methods, emergency numbers, ID documents, week, commission settings) — versioned JSON validated by a zod schema in `packages/shared`.

**Customer**
- `CustomerProfile`: `userId, preferredLanguage, preferredWorkerGender?, notificationPrefs (json), defaultAddressId?`.
- `Address`: add `countryCode`, `area`, `landmark`, `buildingDetail`, `geog geography(Point,4326)`, `precision`; make `postalCode` optional (not universal).
- `TrustedContact`: `id, userId, name, phone, relationship, verifiedAt`.
- `FavoriteProfessional`: `customerId, professionalId`.

**Worker** (rename `Worker` → `Professional` or keep name; fields below)
- Add: `displayName`, `businessName?`, `gender?`, `hidePhotoUntilBooked`, `bio`, `yearsExperience`, `languages[]`, `serviceCenter geography(Point)`, `serviceRadiusKm`, `pricingModel` (FIXED | HOURLY | CALLOUT_PLUS_QUOTE | QUOTE), `callOutFee` (minor units), `hourlyRate` (minor units), `currency`, `onlineAt`, stats (`jobsCompleted`, `ratingAvg`, `ratingCount`, `responseRate`, `onTimeRate`, `cancellationRate`) recomputed by jobs, not editable.
- Remove free-text `availability`, `hourlyRateRange`, `homeAddress`, `licenseDetails`.
- `ProfessionalService`: `professionalId, serviceId, skillLevel, yearsExperience, active`.
- `WorkingHours`: `professionalId, weekday, start, end, timezone`.
- `PortfolioItem`: `id, professionalId, title, mediaKeys[], serviceId?, createdAt`.
- `VerificationCase`: `id, professionalId, type (ID|SELFIE|TRADE_LICENSE|INSURANCE|REFERENCE), status (SUBMITTED|IN_REVIEW|APPROVED|REJECTED|EXPIRED|NEEDS_INFO), documentKeys[], reviewerId, reviewedAt, expiresAt, reason, metadata`. Badges derive from approved cases only.

**Catalog**
- `ServiceCategory`: add `code`, `parentId`, `riskLevel`, `iconKey`, `sortOrder`; translations table `CatalogTranslation(entity, entityId, locale, name, description)`.
- `Service`: add `code`, `pricingModel`, `priceBandMin/Max` per country (`ServicePrice(serviceId, countryCode, city?, min, max, currency)`).
- `ServiceIssue`: common problem chips per service (doc 22 §5.1 step 2).
- `ServiceQuestion` (doc 06).

**Jobs & marketplace**
- `JobRequest` → `Job`: `status` per state machine below, `serviceId` (required), `issueIds[]`, `title` (generated), `description`, `urgency` enum, `isEmergency`, `addressId`, `geog`, `scheduledFrom/To`, `whenOption`, `currency`, `estimateMin/Max`, `preferredWorkerGender?`, `cancelReason`, timestamps per phase. Remove string `location`, `requestedDate`, `priceEstimate`, `customerName`, `paymentAmount`.
- `JobMedia`: `id, jobId, kind (PHOTO|VIDEO|AUDIO), phase (REQUEST|BEFORE|AFTER|CHANGE_ORDER|DISPUTE), storageKey, thumbKey, mime, size, uploadedBy`.
- `JobAiAnalysis`: `jobId, provider, model, promptVersion, schemaVersion, output, confidence, safetyFlags, latencyMs, validationOk`.
- `JobMatch`: `jobId, professionalId, score, distanceM, reasons, notifiedAt, declinedAt`.
- `Offer` (replaces `Quote`): `id, jobId, professionalId, amount, currency, etaMinutes, note, voiceKey?, status (PENDING|ACCEPTED|REJECTED|WITHDRAWN|EXPIRED), expiresAt`; unique `(jobId, professionalId)` while pending.
- `Booking`: `id, jobId (unique), professionalId, offerId, agreedAmount, status, acceptedAt, enRouteAt, arrivedAt, startedAt, completedAt, confirmedAt, cancelledAt, cancelledBy, cancelReason`. Partial unique index to stop double-booking.
- `ChangeOrder`: add `bookingId`, `items (json)`, `oldTotal`, `newTotal`, `reason`, `mediaKeys`, `decidedAt`, `decidedBy`.
- `JobEvent`: `id, jobId, actorId, type, from, to, payload, createdAt` (timeline + realtime source).

**Money**
- `Payment`: `id, bookingId, method (CASH|CARD|WALLET), amount, currency, status (PENDING|MARKED_BY_WORKER|CONFIRMED|DISPUTED|CAPTURED|REFUNDED), provider?, providerRef? (unique), idempotencyKey (unique), timestamps`.
- `LedgerEntry` (immutable): `id, professionalId, bookingId?, type (COMMISSION_OWED|COMMISSION_SETTLED|PAYOUT|ADJUSTMENT|REFUND), amount (signed minor units), currency, balanceAfter, createdAt, createdBy`.
- `Settlement`: `id, professionalId, amount, rail, reference, status`.

**Communication**
- `Conversation` (replaces `ChatThread`): `id, jobId?, customerId, professionalId, status, lastMessageAt`; unique `(jobId)`.
- `Message`: `id, conversationId, senderId, type (TEXT|IMAGE|VOICE|SYSTEM), text?, mediaKey?, clientId (idempotency), createdAt`; drop `receiverId`; `MessageRead(conversationId, userId, lastReadMessageId, readAt)`.
- `Notification`: `id, userId, type, title, body, data, eventId, channel, sentAt, readAt`; unique `(eventId, userId, channel)`.

**Trust, safety, ops**
- `Review`: add `jobId/bookingId` (required), `revieweeRole`, unique `(bookingId, reviewerId)`, `rating` 1–5 check, `tags[]`, `status`.
- `Dispute`: add `bookingId`, `category` enum, `amountHeld`, `evidenceKeys[]`, `status` enum, `resolvedBy`, `resolvedAt`.
- `Incident`: doc 06.
- `AuditLog`: `id, actorId, action, entityType, entityId, before, after, ip, userAgent, requestId, createdAt` (append-only).
- `FeatureFlag`: `key, enabled, rules`.

**Infra:** enable PostGIS extension; GiST indexes on `geog`; indexes on all FKs and `(status, createdAt)`.

### C.5 Sign-up and login flows (R6, R7)

**Login (both roles)**
1. Country chip (pre-selected, §C.6) + masked phone field + password field (show/hide toggle).
2. `POST /auth/login { phone (E.164), password, deviceId }` → `{ accessToken (15 min), refreshToken (30 d, rotated), user }`. Tokens in `expo-secure-store`.
3. Errors: one generic message "Phone number or password is wrong" (no enumeration); after 5 failures: 15 min cooldown **per phone + IP pair**, plus global IP throttle; "Forgot password?" link always visible.
4. App start: `restoreSession` → `POST /auth/refresh` → `GET /me`; splash stays until resolved (doc 23 §B.2).
5. Role routing comes from the server `user.role`, never from client input.

**Customer sign-up**
1. Role: "I need a service".
2. Phone (masked) → code sent (`POST /auth/phone/start {phone, purpose: SIGNUP}`; WhatsApp or SMS per country config; 60 s resend cooldown; 5 attempts; 10 min expiry; `oneTimeCode` autofill) → `POST /auth/phone/verify` returns a short-lived `signupToken`.
3. Name + password (min 8 characters, strength hint, plain-language rules) → `POST /auth/signup {signupToken, name, password, role: CUSTOMER, locale}`.
4. Optional photo (camera/gallery → presigned upload). Skip allowed.
5. Language confirmed → Home. Location permission is asked **only** at the request flow's "Where?" step, with an explainer.

**Worker sign-up** (account works immediately; accepting jobs needs approval)
1. Role: "I fix things".
2. Phone + code (as above).
3. Name + password → account created with `role: WORKER`, `Professional.status: ONBOARDING`.
4. "What do you fix?" multi-select tiles from catalog (≥ 1).
5. "Where do you work?" map pin + radius chips (3 / 5 / 10 km).
6. Working hours presets (Mornings / Full day / Evenings / Weekends too) + customise.
7. Pricing model + call-out fee / hourly rate (AmountField, currency from country config).
8. ID document (type from country config, e.g. CNIC) front/back photos + selfie → `VerificationCase` rows → status `PENDING_REVIEW`.
9. Done screen: "We're checking your documents" + progress meter; Today shows the verification card until approved; Online toggle disabled until approved. Each step is resumable (server stores onboarding progress).

**Password reset:** phone → code (`purpose: RESET`) → new password → all other sessions revoked.

**Account & sessions:** change password (requires current), list/revoke devices, change phone (code to the new number), delete account (store requirement; soft-delete + anonymise per retention policy).

### C.6 Country-aware phone masking (R8)

- **Library:** `libphonenumber-js` (metadata "mobile" subset) in `packages/shared` so client and server use the same parse/validate; remove `react-native-masked-text`.
- **Country detection order:** (1) last used country stored on device; (2) `expo-localization` `getLocales()[0].regionCode`; (3) `GET /config/geo` (server IP lookup); (4) country config default (PK). The detected country is pre-selected but always changeable via a searchable picker (flag + native name + dial code), limited to **enabled** launch countries from config.
- **`PhoneField` component:** shows the dial code as a fixed prefix; formats as the user types with `AsYouType(country)` (e.g. PK `0300 1234567` → `300 1234567` with `+92`); accepts pasted numbers in any format (strips spaces/dashes, detects `+` country codes and switches the country); strips a leading national `0`; numeric keypad (`keyboardType="phone-pad"`, `textContentType="telephoneNumber"`, `autoComplete="tel"`); example placeholder from metadata (`getExampleNumber`); validation on blur and on submit ("This number looks too short for Pakistan"); outputs E.164.
- **Server:** DTO validator `IsE164Phone(allowedCountries)` using the same library; numbers stored only as E.164; uniqueness enforced by DB constraint.
- **Tests:** unit tests per launch country (valid, short, long, landline vs mobile, pasted formats, leading zero, RTL locale digits → Latin).

### C.7 Job state machine (server-owned)

```
DRAFT → SUBMITTED → MATCHING → OFFERS_READY → BOOKED → EN_ROUTE → ARRIVED → IN_PROGRESS
      → AWAITING_CONFIRMATION → COMPLETED
Any pre-ARRIVED state → CANCELLED (rules by actor/time)   |   BOOKED…COMPLETED → DISPUTED
MATCHING / OFFERS_READY → EXPIRED (no offers within TTL) → can be re-submitted
```

One service (`JobStateMachine`) owns allowed transitions, required actor role, preconditions (e.g. `IN_PROGRESS → AWAITING_CONFIRMATION` requires an after photo) and side effects (JobEvent row, notification, realtime emit, ledger entry). Updates use `UPDATE … WHERE id = ? AND status = ?` (optimistic concurrency) so double accepts/completes fail cleanly. The generic `PATCH /jobs/:id` is removed; every transition is its own endpoint.

---

## Part D — Phase-wise plan

Durations are rough single-developer estimates and assume no new scope. Each phase leaves the repository buildable, tests green and the app usable.

### Phase 0 — Repo integrity & tooling (≈ 3–4 days)

**Goal:** a repo that builds from a fresh clone, type-checks for real, and has CI.

- Remove the "Legacy files" block from root `.gitignore`; commit `apps/mobile/app.json`, `app/index.tsx`, `app/(customer)/(home)/index.tsx`, `babel.config.js`, `apps/admin/src/App.tsx`, `apps/web/src/App.tsx` (review each before committing).
- Fix `apps/mobile/tsconfig.json` (drop the `module`/`moduleResolution` overrides so `expo/tsconfig.base` applies); fix all 32 type errors (add `onPrimary` token, fix `Text` weight types, `AvatarSize`, routes, `BottomSheet` props, `UserType`, `VoiceField` import).
- Fix the 2 failing mobile test suites (align `react-test-renderer`/`@testing-library/react-native` with React 19.2) and the 18 failing API tests; rewrite tests that assert insecure behaviour so they assert the secure behaviour (they will fail until Phase 1 — mark as the Phase 1 target).
- Environment: `EXPO_PUBLIC_API_URL` required, no LAN-IP fallback; API config validated with zod on boot (fail fast); `.env.example` per app; split mobile `.env` so it holds only `EXPO_PUBLIC_*` keys (it currently duplicates the API secrets file).
- Prisma: create a baseline migration from the current schema (`migrate diff` → `0001_baseline`), delete the empty `prisma/migrations/manual_migration.sql` and fold `apps/api/manual_migration.sql` into history; `db push` forbidden outside local throwaway DBs.
- Docker: rewrite `apps/api/Dockerfile` for pnpm workspaces (`pnpm deploy --filter @fixli/api`), non-root user, healthcheck; remove the default JWT secret from `docker-compose.yml`.
- CI (GitHub Actions): install, typecheck (all packages), lint, unit tests, API e2e against a Postgres service container, Prisma migration check, `expo export` smoke build.
- Delete the stale Prolivo zip and root scratch files (`scratch_login.tsx`, `screenshot.png`) after owner OK.
- **Exit:** fresh clone → `pnpm i && pnpm typecheck && pnpm test` green in CI; `docker compose up` brings up a migrated DB.

### Phase 1 — Security foundation (≈ 1 week)

**Goal:** close S1–S12 and give every later feature a safe base. No new features.

- **Guards:** global `JwtAuthGuard` (opt-out with `@Public()`), global `RolesGuard` with `@Roles()`, global `ThrottlerGuard` (Redis store) with stricter named limits for auth, codes, AI, uploads, messages.
- **Validation:** DTO classes for every body/query/param in every controller; remove all `any` bodies; `whitelist + forbidNonWhitelisted` stays; ID params validated (`ParseCuid`/UUID pipe); body limit 1 MB (media moves to object storage in Phase 3).
- **Data isolation:** every user-owned query filters by owner in the `where` clause (customer, assigned professional, conversation participant); add a test per endpoint for horizontal access (Customer A ↛ B, Worker A ↛ B).
- Specific fixes: S1 remove/admin-gate `GET /users`; S5 worker job lists limited to matched/assigned jobs; S11 public worker endpoints return a `PublicProfessionalDto` (no email/phone/address); S3 delete the emergency broadcast; S4 remove generic job PATCH/PUT (transitions come in Phase 4/5); S7/S12 ownership/participant checks; S8 review creation disabled until Phase 9's verified version.
- **WebSocket auth:** JWT in handshake, server-side user lookup, no client-supplied IDs, CORS from config, rooms server-assigned (full event model in Phase 6).
- **Mobile:** delete the mock-login fallback and `@example.com` shortcut (S9); remove demo chips; errors shown inline.
- **Errors & logging:** register a global exception filter producing `{ success:false, error:{ code, message, details, requestId } }`; Pino logger with request ID middleware (header `x-request-id` propagated); redact secrets/OTP/password/phone; disable Swagger in production (or protect it).
- **Audit:** `AuditLog` table + `AuditService.record()`; used by admin actions, verification, role changes, refunds.
- **AI hardening (minimal):** safety screen fails **closed** (unknown → treat as needs-review), errors return error codes not fake content, user text passed as data not instructions, per-user AI rate limit.
- **Exit:** a scripted authorization test suite (every endpoint × other-user/other-role) passes; no `any` in API controllers (lint rule); security headers verified.

### Phase 2 — Identity: phone + password, sign-up, country config (≈ 1.5–2 weeks)

**Goal:** R6, R7, R8 complete. Real accounts only.

- **Backend:**
  - Migrations: `User.phone/phoneVerifiedAt/countryCode/locale/timezone/status`, optional email, `Session`, `PhoneVerification`, `CountryConfig`, `CustomerProfile`, `Professional.status (ONBOARDING|PENDING_REVIEW|ACTIVE|SUSPENDED|REJECTED)`.
  - `CountryConfigService` + `GET /config/countries`, `GET /config/country/:code`, `GET /config/geo`; seed **Pakistan** (and the other pilot countries as disabled) from doc 22 §11.5.
  - `OtpProvider` interface with `WhatsAppProvider` / `SmsProvider` adapters chosen per country config; dev adapter logs codes to the API console **only when `NODE_ENV=development`** (no hard-coded codes).
  - Endpoints: `POST /auth/phone/start`, `POST /auth/phone/verify`, `POST /auth/signup`, `POST /auth/login`, `POST /auth/refresh` (rotation + reuse detection), `POST /auth/logout`, `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `POST /auth/password/forgot`, `POST /auth/password/reset`, `POST /auth/password/change`, `GET /me`.
  - Password hashing with argon2id (or bcrypt cost 12); access token 15 min, refresh 30 days rotated, hashed at rest, bound to `deviceId`.
  - Admin login separate: `POST /admin/v1/auth/login` (email + password + TOTP).
- **Shared:** `packages/shared/src/phone.ts` (parse/format/validate via `libphonenumber-js`), zod schemas for signup/login, `CountryConfig` type.
- **Mobile:**
  - `PhoneField`, `PasswordField`, `OtpField`, `CountryPicker` components (§C.6).
  - Screens: Welcome/Language, Login, Sign-up role, customer sign-up steps, worker sign-up steps 1–3 (account creation; worker onboarding steps continue in Phase 3), Forgot/Reset password.
  - `authSlice` rewritten: real login/signup, secure token storage, refresh-on-401 interceptor in `services/api.ts`, `restoreSession` on boot (splash held until resolved), logout revokes the session server-side.
  - Remove `otp.tsx` fake logic and the email login screen.
- **Exit:** new customer and new worker can sign up on a real device with a real code, log out, log in with phone + password, reset password; country auto-detected with masking correct for PK/IN/AE/SA/BD numbers; brute-force throttled; session restore works after app kill.

### Phase 3 — Profiles, media storage, catalog from DB (≈ 2 weeks)

**Goal:** R5 complete; R1 for profile/catalog data.

- **Object storage:** S3-compatible (MinIO in docker-compose for dev, R2/S3 in prod). `POST /uploads/presign {purpose, mime, size}` → signed PUT; server validates purpose, size, MIME and magic bytes on finalize; private buckets for verification docs; signed GET URLs with short TTL; image thumbnails via a worker job.
- **Customer profile:** `GET/PATCH /me`, avatar upload, language, notification preferences, addresses CRUD with GPS pin + reverse geocode (`Geocoder` adapter: Google/Mapbox), default address, trusted contacts CRUD. Screens: Account (real values), Edit profile, Addresses list/edit, Notification settings, Appearance (Light/Dark/Auto stored on device + `uiSlice`), Language.
- **Worker profile & onboarding:** remaining worker sign-up steps (skills, area, hours, pricing, ID docs, selfie) with resumable progress; `GET/PATCH /professionals/me`, `PUT /professionals/me/services`, `PUT /professionals/me/hours`, `PUT /professionals/me/area`, portfolio CRUD, `GET/POST /professionals/me/verification`. Screens: Worker Account (real values), Edit profile, Skills, Service area, Working hours, Pricing, Portfolio, Verification docs (wire `DocumentVerification` to real uploads; OCR is a later enhancement, never auto-saves).
- **Public worker profile:** `GET /professionals/:id` → photo (or initials if hidden), name, verified badges (from approved `VerificationCase` only, each with meaning + date), skills, years, languages, rating, job count, reviews (paginated), portfolio. Screen used from offers and job screen.
- **Catalog:** migrate categories/services/issues/price bands into DB with translations; seed real Pakistan launch categories (doc 22 §11.5 top tiles) through a migration-safe seed; `GET /catalog/categories`, `/catalog/categories/:id`, `/catalog/estimate`. Home tiles and Category screen read from the API (cached, offline-capable); remove `CATEGORIES` constants from runtime use.
- **Admin minimum (unblocks workers):** admin login + Verifications page wired to `/admin/v1/verification-cases` with document viewer, approve / reject / request info → `verification.updated` + audit (full admin in Phase 11).
- **Exit:** every Account/profile screen shows only DB data; a worker completes onboarding, an admin approves them in the admin portal, and the worker's status flips to Active in the app.

### Phase 4 — Request → job, AI gateway, state machine (≈ 1.5 weeks)

**Goal:** a customer creates a real job with real address, media and AI analysis.

- **Backend:** `Job`, `JobMedia`, `JobAiAnalysis`, `JobEvent` migrations; `JobStateMachine`; `POST /jobs` (DRAFT→SUBMITTED, idempotency key), `GET /jobs?scope&cursor`, `GET /jobs/:id` (role-shaped DTOs: exact address hidden from workers until booked), `POST /jobs/:id/cancel`.
- **AI gateway:** `AIProvider` interface → `GeminiProvider`; strict JSON schema (zod) validated output; prompt/schema versions; stores `JobAiAnalysis`; timeout + retry + fallback ("we couldn't analyse; pick a category"); category returned as catalog **code**, mapped server-side; `SpeechToText` interface for `/ai/transcribe` with real recording in `VoiceField` (`expo-audio`), audio stored as `JobMedia(AUDIO)`.
- **Mobile request flow:** categories/issues from catalog; "Where?" uses saved addresses + GPS (permission explainer, denial fallback to manual pin); photos uploaded via presign (compressed ≤ 300 KB); estimate from `/catalog/estimate` in country currency (`PriceText`, minor units); submit → navigate to the **Job screen** (fixes the dead end); draft autosave via `useDraft`; offline: queue in outbox and show "Saved, will send when online".
- **Customer Job screen & My Jobs:** real data, timeline from `JobEvent`s, cancel with reason; remove all MOCK/DEV TOOLS code.
- **Exit:** request created on device appears in DB with media in storage and an analysis row; My Jobs and Job screen show it; no placeholder strings remain in the customer request path.

### Phase 5 — Matching, offers, booking, worker job feed (≈ 2 weeks)

**Goal:** customer gets real offers from real nearby workers and books one.

- **Matching:** PostGIS query — active + verified + online + offers the service + within radius of job location + working now (for ASAP) + gender preference (doc 22 §11.4) → rank (distance, rating quality, response rate, fairness) → top N `JobMatch` rows → `job.request` event + push to each; expiry job re-matches or moves to EXPIRED. Never rank on stars alone (doc 04 F).
- **Offers:** `POST /jobs/:id/offers` (worker price, ETA, note), `DELETE /offers/:id`, `POST /jobs/:id/decline`, offer TTL (config, default 10 min) with countdown; customer `POST /offers/:id/accept` → transaction: lock job row, verify status OFFERS_READY + offer pending + worker still available → create `Booking`, reject other offers, create `Conversation`, emit events. Race-tested.
- **Worker online/offline:** `POST /professionals/me/online|offline` persisted, auto-offline after inactivity; Today screen toggle real.
- **Worker screens:** Today (next booking, today's earnings, requests from API), Jobs tabs New/Booked/Done from API, request card shows area + distance only (no exact address), Send price sheet (AmountField with suggested chips from price band, soft warnings), Decline with reasons.
- **Customer:** offers section on Job screen with real `WorkerCard`s (photo/initials, verified, rating, jobs, distance, ETA, price) → public profile → Choose.
- **Exit:** two real devices (customer + worker) complete request → offer → booking; double-accept and accept-after-expiry are rejected; worker never sees the exact address before booking.

### Phase 6 — Realtime platform & notifications (≈ 1.5 weeks)

**Goal:** R3 complete.

- Implement §C.3: `/rt` namespace, JWT handshake, Redis adapter, rooms, event envelope, `EventBus` in API so every state-machine side effect publishes once.
- `Notification` table, `NotificationService` (persist → socket → push fallback), templates per locale, de-duplication, channel preferences honoured; `GET /notifications`, `POST /notifications/read`, `GET /notifications/unread-count`; `GET /sync?since=`.
- Push: `expo-notifications` (permission asked after first booking or first job request with an explainer), token registered on the session, Android channels, deep links (`fixli://jobs/:id`, `fixli://chat/:id`) open the right screen, EAS credentials.
- Mobile `RealtimeProvider`: connect on login, reconnect with backoff, backfill on reconnect/foreground, dispatch into store; Notifications screen; bell and tab badges.
- Live job updates on both Job screens and lists without pull-to-refresh.
- **Exit:** with the app foregrounded, backgrounded and killed, each event in §C.3 reaches the right user only (verified with a third unrelated account that receives nothing); duplicates are not shown.

### Phase 7 — Real-time chat (≈ 1–1.5 weeks)

**Goal:** R4 complete.

- **Backend:** `Conversation`/`Message`/`MessageRead` migrations; conversation auto-created on booking (also allowed pre-booking between customer and an offering worker if owner wants — default off); `GET /conversations?cursor`, `GET /conversations/:id/messages?cursor&before`, `POST /conversations/:id/messages` (idempotent via `clientId`), `POST /conversations/:id/read`; socket `message.created`, `message.read`, `typing` (throttled); image messages via presign; system messages for job events ("Ahmed is on the way"); phone/URL detection with a gentle warning (doc 04 L); report/block; conversation becomes read-only some days after completion (config).
- **Mobile:** Messages tab (list with last message, unread count, job title, counterpart photo), Thread screen (inverted virtualised list, optimistic send with pending/sent/read ticks, retry on failure, offline outbox, image picker, typing indicator, date separators, keyboard handling, RTL), entry from Job screen "Message" button; push opens the thread.
- **Exit:** two devices chat in real time, messages persist across reinstall, read receipts and unread badges correct, offline messages send on reconnect exactly once.

### Phase 8 — Job execution, live tracking, evidence, change orders (≈ 1.5–2 weeks)

**Goal:** the on-site part of the loop works for real.

- **Transitions:** `POST /bookings/:id/en-route|arrive|start|finish` (worker), `POST /bookings/:id/confirm` (customer) with preconditions (before photo at start, after photo at finish); "Arrived" suggested by geofence with drift tolerance.
- **Live location:** worker app sends location only in `EN_ROUTE` (foreground; background only with explicit disclosure), server forwards to `job:{id}` customer only and stores minimal history per retention policy; ETA from a `Routing` adapter (server-side), not a constant. Remove the global always-on customer location watcher.
- **Evidence:** camera-first before/after capture, background upload with retry, shown on both sides.
- **Change orders:** `POST /bookings/:id/change-orders` (items, reason, photos, new total) → customer sheet Approve/Decline → total recomputed in minor units; no silent charges.
- **Masked calling:** "Call" uses a provider number proxy where configured, else shows the number only after booking and only during the job (owner decision; default: in-app chat + dial after booking).
- **Exit:** a full on-site sequence on two devices with live map, photos and one change order; illegal transitions rejected server-side.

### Phase 9 — Payments (cash first), earnings, reviews, disputes (≈ 2 weeks)

**Goal:** money and reputation are real and consistent.

- **Cash flow (doc 22 §11.8):** worker "Mark cash received {amount}" → customer one-tap confirm (auto-confirm after timeout with flag) → `Payment CONFIRMED` → commission `LedgerEntry` (rates from country config) → balance with soft/hard limits that pause new requests; disagreements open a dispute.
- `PaymentProvider` interface ready for card/wallet (JazzCash/Easypaisa/Stripe) with webhook signature verification + idempotency — implementation gated on legal L5.
- **Earnings:** `GET /professionals/me/earnings` and ledger (paginated); Earnings screen with real week/month totals, per-job list, commission owed card, settle-up instructions; Today's earnings real.
- **Reviews:** `POST /bookings/:id/review` only after COMPLETED, one per side, rating 1–5, tags, optional text; stats recomputed in a transaction; reviews on public profile; moderation flag.
- **Disputes:** `POST /bookings/:id/disputes` with category + evidence, holds settlement, admin resolution with audit; parties see status updates live.
- **Rebook / favourites / history:** "Book again" prefills category/issue/address; favourite workers; past jobs with evidence and receipt.
- **Exit:** ledger reconciles to payments for a scripted set of jobs; duplicate confirm/mark requests are idempotent; reviews impossible without a completed booking.

### Phase 10 — Safety & SOS (≈ 1 week)

- SOS screen per doc 22 §5.1: press-and-hold → 5 s cancellable countdown → emergency type (Water/Pipe burst · Electric/Fire hazard · Gas smell · Life-threatening) → **life-threatening shows the local emergency numbers from country config with a call button and never dispatches a worker**; property emergencies create an urgent job with auto-dispatch to the nearest verified worker, then offers fallback (doc 22 D2).
- Trusted-contact notification (SMS/WhatsApp), `Incident` records, in-job SOS for both roles, "Report a problem", block user.
- Safety copy reviewed (legal L10); no claim that Fixli contacted authorities.
- **Exit:** SOS works with no payment method and no subscription; emergency numbers come from config; incidents appear in the admin safety console (Phase 11).

### Phase 11 — Admin portal on real data (≈ 2 weeks)

- Admin auth (email + password + TOTP), RBAC roles from doc 12 (Super Admin, Operations, Verification, Support, Safety, Finance, Content, Analytics, Auditor), all endpoints under `/admin/v1` with role guards and audit.
- Pages: Dashboard (real KPIs from DB: active users, online workers, jobs by status, fill rate, cancellations, disputes, GMV in PKR), Users (search by phone/name, view, suspend), Professionals & Verification queue (document viewer with signed URLs, approve/reject/request info, expiry), Jobs (live list, timeline, reassign, cancel), Disputes (evidence, chat transcript, resolution, ledger adjustment), Payments & ledger, Catalog & price bands & translations, Country config editor (versioned), Safety console, Reviews moderation, Audit log viewer, Feature flags.
- Realtime admin feed (`admin:{role}` rooms) for new verifications, disputes and incidents. Remove all dummy fallbacks; API base URL from env.
- Apply doc 22 Phase 7 visual alignment (tokens, light/dark, logo).
- **Exit:** every admin page reads/writes the DB; every admin mutation is in the audit log; a Verification-role admin cannot access Finance pages.

### Phase 12 — Localisation, accessibility, offline, analytics, performance (≈ 1.5 weeks)

- Every user-facing string through `t()` (CI check for JSX literals); Urdu + Arabic translations reviewed by native speakers; fix `app.name`; RTL pass on every screen; Intl number/date/currency per locale.
- Accessibility: labels/roles on every touchable, 48/56 pt targets, Dynamic Type to 200 %, contrast ≥ 4.5:1, reduce motion, VoiceOver/TalkBack on both full loops.
- Offline: persisted outbox for requests, status events, evidence, messages; cached catalog, today's jobs and last job states; clear sync state UI.
- Analytics (doc 16 + doc 22 §8.5) through a privacy-safe `Analytics` adapter (no addresses, phones or message text).
- Performance: virtualised lists, `expo-image` caching, thumbnails, bundle audit, cold start < 2.5 s on a low-end Android.
- **Exit:** doc 22 Phase 6 checklist passes; usability round with real users in Pakistan.

### Phase 13 — Hardening & release (≈ 1.5 weeks)

- Load tests (auth, matching, chat, socket fan-out), resilience tests (DB/Redis/AI/OTP outage, duplicate requests), backups + restore drill, monitoring/alerts/error tracking (Sentry for mobile + API), staging environment with production parity, migration rollback runbook.
- E2E: Maestro (or Detox) flows for customer signup→review, worker signup→payout, admin verification→dispute→audit, run in CI on emulators.
- Security: SAST, dependency scan, secret scan, authorization test suite, penetration test.
- Store readiness: privacy policy, terms (Urdu/English), account deletion, data-safety labels, permission strings, screenshots, EAS production builds, OTA update channel.
- Re-run this audit (doc 21 §30); target ≥ 90 % with no P0/P1 open.
- **Exit:** doc 20 release checklist complete for Pakistan; owner sign-off.

### Phase summary

| Phase | Theme | Owner requirements closed | Rough size |
|-------|-------|---------------------------|-----------|
| 0 | Repo integrity, CI | — | 3–4 d |
| 1 | Security foundation | S1–S12 | 1 w |
| 2 | Phone + password auth, sign-ups, country masking | R6, R7, R8 | 1.5–2 w |
| 3 | Profiles, storage, catalog, admin verification | R5, R1 (profiles/catalog) | 2 w |
| 4 | Real requests, AI gateway, state machine | R1, R2 (customer request) | 1.5 w |
| 5 | Matching, offers, booking, worker feed | R1, R2 (marketplace) | 2 w |
| 6 | Realtime + push + notification centre | R3 | 1.5 w |
| 7 | Real-time chat | R4 | 1–1.5 w |
| 8 | On-site execution, tracking, evidence, change orders | R2 | 1.5–2 w |
| 9 | Cash payments, ledger, earnings, reviews, disputes | R1, R2 | 2 w |
| 10 | Safety & SOS | — | 1 w |
| 11 | Admin on real data | R9 | 2 w |
| 12 | i18n, a11y, offline, analytics, performance | — | 1.5 w |
| 13 | Hardening & release | — | 1.5 w |
| | **Total** | | **≈ 20–23 weeks for one developer** |

Phases 6 and 7 can run in parallel with 8 once Phase 5 is done; Phase 11's verification page is pulled forward into Phase 3 because workers cannot be approved without it.

### Open questions for the owner

1. D11 brand: Fixli or Triply?
2. D9: confirm a one-time code at sign-up and reset (recommended), WhatsApp first for Pakistan?
3. Chat before booking (customer ↔ offering worker) — allowed or booking-only (default)?
4. Calling: provider number masking at launch, or show the number after booking?
5. Commission and cash limits for Pakistan (doc 22 §11.8 placeholders).
6. Hosting region / processors for SMS, speech-to-text, maps (legal L4).

---

## Implementation status (updated 2026-10-07)

| Phase | Status | Notes |
|-------|--------|-------|
| 0 Repo integrity & tooling | **Done, 2 checks pending** | Dockerfile image build and CI run not yet verified (Docker Desktop hung on a full disk). Typecheck, tests, baseline migration and env validation verified. API has no ESLint config yet. |
| 1 Security foundation | **Done (API + mobile)** | S1–S12 closed. 110 API unit tests + 37 e2e authorization tests (real Postgres) + 44 mobile tests pass. Not yet done from the Phase 1 list: Redis-backed rate-limit store (in-memory today, Phase 6), Pino logger (Nest logger + request IDs today), AI per-user (not per-IP) limit, lint rule banning `any` bodies. |
| 2 Phone + password identity | **Done, without the one-time code (deferred by owner)** | Phone + password login and signup for customers and workers; country-aware masked phone field (PK/IN/AE/SA/BD data, only PK open); sessions with 15-min access tokens and rotating hashed refresh tokens with reuse detection; logout/revoke/change-password; staff email login. 127 API unit + 43 e2e + 25 shared + 63 mobile tests. Not in Phase 2 (deferred): OTP/phone verification, password reset (needs the code), staff TOTP, worker onboarding steps (Phase 3), forgot-password UI. **Known gap until OTP exists:** anyone can register a number they don't own, and signup reveals whether a number is registered. |
| 3 Profiles, storage, catalog, admin verification | **Done (backend verified; mobile verified by tests + bundling, not yet by running on a device)** | Direct-to-storage uploads (local disk dev / S3 prod) with server-side size and real-file-type checks; avatars and portfolio public, ID documents private with signed, expiring, audited links. Customer profile + addresses (GPS, landmark). Worker profile, skills, area, hours, pricing, portfolio, ID + selfie, onboarding checklist, submit-for-review, admin approve/reject/ask-again, auto-activation, public profile with dated badges and hide-photo option. Real 10-category launch catalogue (en/ur/ar, drafts for native review) served from DB. Admin portal: real login, dashboard counts, verification review, disputes, catalogue; no dummy data. 162 API unit + 71 e2e + 25 shared + 72 mobile tests. **Still mock/placeholder (their own phases):** customer request flow (`request-service.tsx`: hard-coded addresses and price range, no real offers/matching: Phase 4/5), payments and earnings (Phase 9), chat (Phase 7), notifications (Phase 6). Placeholder Chat tabs were removed. |
| 4 Request → job, AI gateway, timeline | **Done (backend verified; app verified by tests + bundling, not yet on a device)** | Request flow on real data: catalogue category + common problems, hold-to-talk voice note (expo-audio) transcribed server-side and editable, up to 4 photos, Now/Today/Tomorrow/day+slot (computed in the customer's timezone), saved address. Draft autosave; idempotent send (retry-safe). AI behind an `AiProvider` interface (Gemini adapter, model via `GEMINI_MODEL`): output validated against the real catalogue, every call recorded (model, prompt/schema version, validity, latency), one retry, graceful "unavailable". Deterministic hazard rules (en/ur/Roman Urdu) show local emergency numbers even with AI down. Job stores an address snapshot; workers see area/city only until booked; job photos/voice private with signed links. Every state change writes a timeline event; cancel records a reason. 194 API unit + 89 e2e + 25 shared + 62 mobile tests. **Not in Phase 4:** price estimates (needs owner-approved price bands per city), offline outbox (the draft is kept and re-send is safe, but nothing auto-sends when the connection returns), matching/offers (Phase 5). |
| 5 Matching, offers, booking | **Done (backend verified; app verified by tests + bundling, not yet on a device)** | Matching in the database: approved, online, active account, right skill, within the worker's own radius (great-circle distance with an indexed bounding box; city fallback when the address has no GPS), working hours in the worker's timezone; ranked 60% closeness / 40% review-weighted rating. Top 10 notified (socket event; push in Phase 6), every match stored with rank, score and distance. Workers only see requests sent to them. Offers: send/revise/withdraw/"not for me", 10-minute expiry, customer sees the best 3. Accepting books the job at that price atomically; a row lock on the worker blocks double-booking for overlapping times. Background sweeper (advisory-locked, safe on many instances) expires offers, retries unmatched requests and widens the search once after 15 min. All numbers are configuration (O3). 207 API unit + 104 e2e + 25 shared + 63 mobile tests. **Not in Phase 5:** SOS auto-dispatch to the nearest worker (Phase 10), push notifications and live updates instead of 15-second refresh (Phase 6), PostGIS (current SQL is fine at pilot scale). |
| 6 Realtime & notifications | **Done (backend verified, including two API instances over Redis; app verified by tests + bundling, not yet on a device)** | One authenticated live connection per device (`/rt`): token checked against a live session, private rooms per user and per session, every event wrapped `{ id, type, occurredAt, data }` and never carrying an address or phone number. Signing out (or "sign out other devices") cuts that device's live connection at once, on any server, and stops its push. Notifications are stored once per real event (database-enforced), sent live to the open app, and pushed through Expo to every signed-in device in the user's language (en/ur/ar drafts). A dead push token is forgotten automatically; a push outage never fails the action. Sent for: new request (workers), price received, booked / not chosen, direct request, accepted, declined, started, finished, cancelled (to the other side), "still looking" after the widened search, document approved / needs fixing, account approved. Notification centre API (list with paging and catch-up, unread count, mark read) and app screen; bell with unread count on Home and Today; app-icon badge; in-app banner while the app is open; tapping a push or banner opens the right screen. Push permission is asked when it makes sense (after sending a request, when going online), never on first launch. Job, offer and feed screens update live instead of the 15-second refresh (slow fallback refresh plus reload on reconnect and on returning to the app). With `REDIS_URL` set, live events and rate limits are shared across API instances. 221 API unit + 112 e2e + 25 shared + 68 mobile tests. **Not in Phase 6:** phone push needs the EAS project and push keys (O14); per-kind notification settings (O15); chat over the same connection (Phase 7); SMS/WhatsApp fallback for critical messages (with OTP, O5). |
| 7 Chat | **Done (F4, F7; doc 29)** | Live over REST + realtime across API instances, read ticks, typing, blocks everywhere, reports as safety incidents, persisted outbox, contact-sharing detector, closing rules. Not yet tried on a phone. |
| 8 On-site job | **Done (F2; doc 29)** | Only the customer (or the 24 h timeout) completes; photos or a stated reason; change orders update the price; every step notified; live location with ETA, 30-day retention. Masked calling needs a provider (O7); background location not built. |
| 9 Money and reputation | **Done (F3, F6; doc 29)** | One cash payment per job, locked ledger, commission and limits from versioned country settings, settlements, disputes with ledger correction, reviews with moderation, favourites, book again, account deletion that erases ID files (F8). |
| 10 Safety & SOS | **Done in code; texts blocked on D-F5 (F5; doc 29)** | Country numbers, 5 s SOS, no professional to life-threatening cases, nearest free professional for property emergencies. Trusted-contact texts are not sent until an SMS provider is chosen; safety wording needs counsel and native review. |
| 11 Admin | **Done (F1, F6; doc 29)** | Permissions on every route (route sweep, F8), two-factor with replay protection, real dashboard and every page, live feed, audit on every staff change. |
| 12 Languages, offline, analytics | **Done in code; device checks open (F7; doc 28, 29)** | Outbox, cached data, 692 sentences in en/ur/ar, RTL, contrast and touch targets tested, analytics opt-in (no provider yet). Screen-reader, largest-text and cold-start checks need a phone. |
| 13 Hardening & release | **Partly done (F8; doc 29)** | Load, resilience, route sweep, browser test, restore drill, health checks, Sentry, legal drafts and web pages, store answers, runbooks. Needs staging, alerts, backups switched on, store accounts, counsel, first emulator run, penetration test.

