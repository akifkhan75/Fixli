# Fixli — Production Release Checklist

> Status key: `[x]` verified (evidence given), `[~]` partly done or verified only in tests, `[n/a]` not applicable to the cash-only launch, `[ ]` not done. Last reviewed 2026-11-18 (doc 27 R7). Nothing here has been verified on a physical device or against production. Projects, code sign-in, SMS and card payments (2026-11-27) and the owner actions they need are in [doc 30](30_PROJECTS_AND_GO_LIVE.md).

## Product
- [ ] PRD approved
- [ ] launch city selected
- [ ] service categories approved
- [ ] local pricing rules configured
- [ ] local emergency numbers verified
- [ ] local legal review complete

## Security
- [ ] secrets in secret manager
- [ ] no secrets in mobile bundle
- [x] auth hardened — lockout, rotating refresh tokens, authenticated admin socket, phone OTP + reset (R1/R5); unit + e2e; OTP needs an SMS provider (O5)
- [x] RBAC tested — authorization e2e + AdminRolesGuard/FeatureGuard unit tests
- [x] rate limits — per-IP throttler, OTP 5 tries / 60 s / 3 per hour; Redis storage when REDIS_URL set
- [~] webhook signatures — Stripe webhook verifies signature and age; unit + e2e with test secret; not tested against Stripe (doc 30)
- [x] file upload security — signed expiring URLs, key allow-list, size cap, magic-byte check, private docs <= 15 min links (unit-tested)
- [~] dependency audit — CI runs pnpm audit (R1); results not reviewed in this pass
- [ ] penetration test

## Payments
- [ ] provider account verified
- [ ] KYC/KYB configured
- [ ] payout accounts tested
- [ ] webhooks tested
- [ ] refund tested
- [ ] partial refund tested
- [ ] chargeback workflow
- [ ] reconciliation tested
- [ ] duplicate webhook tested
- [ ] duplicate payment tested

## Safety
- [~] emergency flow tested — API e2e (SOS, cascade, hazard checklist); not tested on a device
- [~] trusted contact flow — screens + API done; contacts are NOT texted until an SMS provider exists (O5)
- [ ] incident console
- [ ] support escalation
- [ ] safety copy reviewed
- [ ] dangerous AI advice blocked

## Marketplace
- [ ] professional supply
- [ ] verification capacity
- [ ] category demand
- [ ] support staffing
- [~] dispute process — in-app report + admin console resolution, including project stages (release / refund / resume); no SLA defined
- [ ] cancellation policy

## Mobile
- [ ] iOS production build
- [ ] Android production build
- [ ] background location review
- [~] push notifications — Expo push provider unit-tested; needs EAS/FCM/APNs accounts (O14)
- [ ] deep links
- [ ] camera/media
- [~] offline sync — outbox unit-tested (10 tests); not run in airplane mode on a device
- [~] accessibility — roles/labels guard test, Urdu line height, RTL icons; no screen-reader pass on a device
- [~] localization — en done; ur/ar strings are drafts pending native review (O13); new screens English only

## Backend
- [x] migrations — migrate deploy on a clean Postgres 14 + migrate diff against schema = empty
- [ ] backups
- [x] restore drill — scripts/backup-restore-drill.sh run against a staging-shaped DB: row counts match; re-run on real staging
- [ ] monitoring
- [ ] alerts
- [~] error tracking — Sentry wired in API and mobile, enabled only when a DSN is set
- [ ] queues
- [x] cron/scheduled jobs — sweeper (offer expiry, re-match, SOS cascade, cash reminders) unit-tested, advisory-locked
- [ ] autoscaling
- [ ] staging parity

## App stores
- [x] privacy policy — apps/web/public/privacy.html (legal review L1-L12 pending)
- [x] terms — apps/web/public/terms.html (legal review pending)
- [ ] support URL
- [x] account deletion — in-app flow + API + e2e; public how-to at /delete-account.html
- [ ] data safety declarations
- [ ] permission descriptions
- [ ] age rating
- [ ] screenshots
- [ ] localized metadata

## Launch
- [ ] soft launch
- [~] feature flags — ENABLED_FEATURES hides roadmap APIs (R6); no runtime flag service
- [ ] rollback plan
- [ ] on-call owner
- [ ] incident response
- [ ] daily launch dashboard
