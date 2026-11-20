# Fixli: Re-audit of Phases 7–13 (after F0–F8)

> Date: 2026-10-12. This re-runs doc 26 against the code as it is now. Every item in doc 26 is listed below with what changed and where the proof is. **Method:** the same checks as doc 26 were run (type checks, unit tests, end-to-end tests on a real Postgres and Redis, starting the API, building every app, comparing the database to the migrations), plus direct searches for each removed defect (for example `parseTokenSimulated`, `[Simulated]`, `OfflineQueueService`, a placeholder Sentry DSN: all gone), the F8 load, resilience and browser tests, and a restore drill.

## 1. Verdict

| Phase | Doc 26 estimate | Now (code) | What is left, and why |
|---|---|---|---|
| 7 Chat | ~35 % | **~95 %** | system lines in the reader's language are done (F7); nothing open in code |
| 8 On-site job | ~40 % | **~90 %** | the app flow has never run on a phone; masked calling (O7, needs a provider); location is foreground only |
| 9 Money and reputation | ~30 % | **~95 %** | printable receipt not built; card/wallet providers are a legal decision (L5), not a gap |
| 10 Safety and SOS | ~15 % | **~85 %** | **texts to trusted contacts are not sent** until an SMS provider is chosen (D-F5); safety wording needs counsel (L10) and native review |
| 11 Admin | ~30 % | **~95 %** | doc 22 visual alignment is partial |
| 12 Languages, offline, analytics | ~15 % | **~90 %** | device checks (screen readers, largest text, Urdu/Arabic screenshots, cold start) and the usability round are open; analytics has no provider yet (D-F7) |
| 13 Hardening and release | ~20 % | **~80 %** | needs real infrastructure and accounts: staging, alerts, store accounts (O14), counsel, first emulator run, penetration test |

**Target (doc 27 F8.4): at least 90 % with no P0 or P1 open.** In **code**: no P0 open, and no P1 open **except the two that cannot be closed by engineering**: 10.1 (trusted-contact texts need a provider, D-F5) and 13.2 (the legal text is rewritten to match the product but needs a lawyer's sign-off). Phase 13's 80 % is the part that is infrastructure, not code. **Overall: about 90 % in code, about 75 % ready to launch**, and the gap between those is the "Open" list in section 4.

## 2. Every doc 26 finding

**Status key:** ✅ fixed and tested · 🟡 fixed in code, something outside the code is still open · ⬜ not done (reason given).

### P0

| # | Status | What changed | Proof |
|---|---|---|---|
| P0-1 API does not start | ✅ F0 | cycle removed (global `RealtimeModule`) | every end-to-end suite boots the real `AppModule` (15 suites, 206 tests) |
| P0-2 schema without migrations | ✅ F0, plus 4 more migrations since | hand-checked migrations, data-safe copy and drops | CI: migrate on an empty database + `prisma migrate diff --exit-code` (drift check) |
| P0-3 CI weakened | ✅ F0, extended in F8 | Postgres + Redis, e2e, drift, builds, mobile tests, blocking audit restored; added Semgrep, admin browser test, weekly load test | `.github/workflows/` (6 files). ⬜ **make CI a required check on `main` in GitHub settings** |
| P0-4 admin does not build | ✅ F0 | `import type`; `tsc -b` | `pnpm --filter admin build` in CI |

### Phase 7 chat

| # | Status | Fixed in | Note |
|---|---|---|---|
| 7.1 not real-time | ✅ | F4 | two-instance chat e2e tests (messages, read ticks, typing, list updates) |
| 7.2 fake system messages | ✅ | F1 | `isSystem` removed from every input; system lines stored as key + parameters |
| 7.3 image paths | ✅ | F1 | uploads consumed once, caller's own, real file type; signed links only |
| 7.4 message text in pushes | ✅ | F1 | test blocks it |
| 7.5 blocking does little | ✅ | F4 | enforced in chat, matching (SQL), requests, prices, booking |
| 7.6 reports go nowhere | ✅ | F4 | become safety incidents, shown in the staff feed (F6 console) |
| 7.7 chat links open nothing | ✅ | F4 | one `routes` list; test fails on hand-written paths; app test maps every route to a screen |
| 7.8 failed send ignored | ✅ | F4 | sending/sent/read ticks; "Not sent · Tap to retry" |
| 7.9 offline messages lost | ✅ | F4, F7 | persisted outbox; fixed a lost-wake race in F7 |
| 7.10 missing chat features | ✅ | F4 | typing, date separators, photos, Message buttons, live read ticks; sends are rate-limited |
| 7.11 contact detector false alarms | ✅ | F4 | new detector; doesn't fire on prices or times; only the sender sees the hint |
| 7.12 tidiness | ✅ | F4 | rebuilt screens; safe-area padding not rechecked on a device |

### Phase 8 on-site job

| # | Status | Fixed in | Note |
|---|---|---|---|
| 8.1 photo keys | ✅ | F1 | as 7.3 |
| 8.2 confirmation skippable | ✅ | F2 | only the customer, admin, or the 24 h auto-confirm completes |
| 8.3 double booking | ✅ | F2 | one list of busy statuses used everywhere |
| 8.4 change orders don't change price | ✅ | F2 | approval sets the agreed total; job's currency; notifications |
| 8.5 prices 100× off | ✅ | F2 | shared money helpers (string maths) |
| 8.6 no photo step | 🟡 | F2 | camera-first step exists; **never run on a real phone**; Maestro flow written (not yet run) |
| 8.7 no notifications for steps | ✅ | F2 | every step notified and shown as a chat line |
| 8.8 "on the way" line missing | ✅ | F2 | |
| 8.9 live location | 🟡 | F2 | ETA behind a routing interface, stored sparsely, deleted after 30 days, customer not tracked; **foreground only** (background needs the store disclosure) |
| 8.10 masked calling | ⬜ | | needs a telephony provider (O7); reveal-number while booked is built and audited |
| 8.11 cancel rule | ✅ | F2 | cancel until "arrived"; late cancel recorded |

### Phase 9 money and reputation

| # | Status | Fixed in | Note |
|---|---|---|---|
| 9.1 any amount | ✅ | F3 | amount is always the agreed total; requests with an amount are rejected |
| 9.2 double commission | ✅ | F3 | one payment per job (database), race-safe; 5 simultaneous confirms book once |
| 9.3 hard-coded 10 % | ✅ | F3, F6 | country configuration, versioned, editable by Super Admin only; limits pause workers; settlements |
| 9.4 Earnings crash | ✅ | F3 | new shape, new screen |
| 9.5 deletion | ✅ | F3, **F8** | F3: signs out, cancels open work, anonymises. **F8 found and fixed:** ID photos, selfie, avatar, portfolio photos and the ID number were left behind; now erased (e2e test). Web deletion page added |
| 9.6 unvalidated input | ✅ | F3 | |
| 9.7 nobody hears about payments | ✅ | F3 | notifications for cash marked / confirmed / auto-confirmed / disputed, settlements |
| 9.8 missing app screens | ✅ | F3 | favourites, book again, report a problem, earnings week/month and owed card. A printable receipt is not built |
| 9.9 reviews and moderation | ✅ | F3, F6 | published-only rating; report, auto-flag, hide/restore in the portal |
| 9.10 PKR | ✅ | F3 | root cause: Node 22 vs 24 `Intl` differences; fixed decimals table; tested on both |

### Phase 10 safety

| # | Status | Fixed in | Note |
|---|---|---|---|
| 10.1 trusted contacts not told | 🟡 | F5 | no more fake log line, numbers never logged; sending goes through an `SmsProvider` interface and **nothing is sent until a provider is chosen (D-F5)**; the app says plainly that contacts were not told |
| 10.2 property emergencies | ✅ | F5 | nearest free verified worker, 180 s to accept, then everyone nearby; sweeper with a lease |
| 10.3 hard-coded numbers | ✅ | F5 | from country configuration; cached on the phone for offline |
| 10.4 no SOS screen | ✅ | F5 | 5 s cancellable countdown; call buttons; no professional is sent to a life-threatening case |
| 10.5 incident validation | ✅ | F5 | |
| 10.6 safety wording | 🟡 | F5, F7 | one file per side, tests block "we called the police"-type claims and hard-coded numbers, in all three languages; **legal (L10) and native-speaker review still needed** |

### Phase 11 admin

| # | Status | Fixed in | Note |
|---|---|---|---|
| 11.1 fake admin token | ✅ | F1 | the socket is deleted; staff use the authenticated `/rt` connection |
| 11.2 no two-factor | ✅ | F1, F6 | own RFC 6238 implementation, secrets encrypted, recovery codes; **F6 added replay protection** |
| 11.3 no admin roles | ✅ | F1 | roles API, first Super Admin script |
| 11.4 routes without permission | ✅ | F1, **F8** | deny by default; F8's sweep checks **every route**, for every staff role (see section 3) |
| 11.5 admin cancel skips rules | ✅ | F6 | cancel and reassign through the job rules; suspend releases open jobs |
| 11.6 phone numbers shown | ✅ | F1 | masked without `pii.view`; full view audited |
| 11.7 fake moderation / empty config | ✅ | F6 | reports + auto-flags; versioned country settings; price bands; flags |
| 11.8 dashboard | ✅ | F6 | real figures with date range |
| 11.9 missing pages | ✅ | F6 | safety, finance, reviews, settings, staff, audit log, live feed. **F8:** a browser test drives approve → dispute → audit |
| 11.10 audit and visual alignment | 🟡 | F6 | a test fails if any staff change route writes no audit row; doc 22 token pass partial |

### Phase 12 languages, accessibility, offline, analytics

| # | Status | Fixed in | Note |
|---|---|---|---|
| 12.1 offline queue only wrote | ✅ | F7 | general outbox for job steps and requests; chat outbox; persists; backoff; emergencies never queued |
| 12.2 analytics not built | 🟡 | F7 | typed events, allow-list, opt-in switch **off by default**; no provider until D-F7 |
| 12.3 hard-coded English | 🟡 | F7 | all 692 sentences through `t()`, a build test blocks any new one; arrows flip in RTL. **Urdu/Arabic are machine drafts (O13); the screenshot pass needs a phone** |
| 12.4 fake verification screen | ✅ | F7 | deleted; test blocks the pattern |
| 12.5 accessibility and performance | 🟡 | F7 | contrast, button sizes, labels, reduce motion, cached images, bundle budget are tested. **Screen-reader, largest-text and cold-start checks need a phone** (doc 28) |

### Phase 13 hardening and release

| # | Status | Fixed in | Note |
|---|---|---|---|
| 13.1 CI regressions | ✅ | F0, F8 | see P0-3 |
| 13.2 legal text overclaims | 🟡 | **F8** | rewritten to what the product does (cash only, people check IDs, no escrow); one terms file; Urdu versions; web pages; in-app links; a test blocks the old claims. **Needs counsel** (everything in [brackets]) |
| 13.3 junk files | ✅ | F0 | untracked (history not rewritten, D-F1) |
| 13.4 load / resilience / restore | ✅ | **F8** | see section 3 |
| 13.5 Maestro flows | 🟡 | **F8** | one folder, five flows matching the screens, helper actions proven against a real API; admin flow runs in a real browser in CI. **The phone steps have not run on an emulator yet** |
| 13.6 store readiness | 🟡 | **F8** | placeholder DSN gone (test), EAS profiles, version auto-increment, update channels, permissions trimmed, data-safety answers written. ⬜ **EAS `projectId` and credentials (O14), screenshots, store listings** |
| 13.7 operations | 🟡 | **F8** | Sentry first, release-tagged, personal data removed; health checks that tell the truth; Docker on Node 22 with cached installs; runbooks. ⬜ **create staging, alerts and backups (people and accounts)** |
| 13.8 re-audit | ✅ | F8 | this document; doc 24 table updated |

## 3. New in F8: what was tested, and what it found

| Check | Result |
|---|---|
| **Every route, every staff role** (`test/route-sweep.e2e-spec.ts`): 150+ routes found by reading the code; not signed in → 401; wrong kind of account → 403; each staff role without the permission → 403; the list of public routes is a snapshot | passes. A new route cannot ship without a rule |
| **Redis outage** (starts and kills a real Redis) | found a real fault: **the rate limiter crashed every request when Redis was down**. Now falls back to per-server counts, readiness says "degraded" (not down), recovers by itself |
| **Load, 2 API instances + Redis, 200 customers, 400 professionals** (`pnpm --filter @fixli/api load`) | found a real fault: **password hashing blocked the whole server** (a pure-JavaScript hasher): 1.3 sign-ins a second pushed the request p95 from 72 ms to 383 ms. Switched to the native bcrypt (same hashes). Also matching now notifies professionals in parallel. **Result: create-request p95 54–63 ms (target 300), every other call ≤ 20 ms, sign-in p95 ~300 ms (a deliberate password cost), sockets across instances p95 7–13 ms (target 1000), 0 dropped** |
| **Admin portal in a real browser** (Playwright) | found a real fault: **the dev server rendered a blank page** (two copies of React in the monorepo). Fixed in admin and web. 3 tests pass |
| **Restore drill** (`apps/api/scripts/restore-drill.sh`) | dump → restore → row counts identical (52 tables, 280 rows) → migration history matches → API healthy on the copy: PASS in 4 s. Run it against a production snapshot before launch |
| Account deletion | found: **a professional's ID photos and number were left behind**. Now erased; test |
| Website | found: **the site still said "Triply"** and claimed "background-checked" and "instantly". Fixed |
| Health | `/health` only said "ok". New `/health/ready`: database (503 if down), Redis, background-job heartbeats (stale = degraded) |
| Totals | 307 API unit + 206 API e2e + 34 shared + 134 mobile + 4 website tests, 3 browser tests; full local CI passes |

## 4. Open: what is left, and who has to do it

**Owner decisions (doc 25)**
- **D-F5** SMS/WhatsApp provider: until chosen, trusted contacts are not texted (the P1 above).
- **D-F7** analytics provider, and whether the switch starts on.
- **O13 / L10** native-speaker review of Arabic and Urdu; counsel review of the safety sentences.
- **O14** Expo/EAS project, Firebase and Apple keys.
- **D-F4** how long chats and job photos may be kept after a deletion (the policy has a placeholder).
- O1 price bands to show, O7 masked calling, D-F1 whether to rewrite git history.

**Legal:** counsel reviews `docs/legal/` (company details, retention, liability, venue, fee wording).

**Infrastructure and people**
- Staging environment; uptime monitor and the alerts in `docs/ops/monitoring-and-alerts.md` with named owners; automated database backups switched on, then the restore drill against a real snapshot; Sentry projects and DSNs.
- Make CI a required check on `main`.
- First run of the Maestro flows on an emulator (`e2e-mobile.yml`), expect a few text/timing fixes.
- Device checks in `docs/28_ACCESSIBILITY_AND_PERFORMANCE_CHECKLIST.md`; the usability round with real users in Pakistan.
- An external penetration test before launch.
- Run the load test against staging at the real infrastructure size.
- Store screenshots (English and Urdu), listings, and the data-safety forms from `docs/store/data-safety.md`.
- Dev builds must be rebuilt (the new connectivity library is native).
