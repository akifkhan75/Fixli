# Fixli — Production Release Checklist

> **Status after F8 (2026-10-12), engineering side. The boxes below stay for the owner's sign-off.**
> Verified by tests or by running it: auth hardened (two-factor, rate limits, deny-by-default routes, every route swept), RBAC tested, file-upload security, dependency audit (blocking in CI), no secrets or placeholder DSNs in the app, offline sync, localization (drafts), emergency flow tested, incident console, deep links, load test (targets met), Redis outage, restore drill, health checks and release-tagged crash reports.
> Needs people, accounts or devices: secrets in a secret manager, penetration test, support escalation and staffing, safety copy review (counsel), iOS and Android production builds (O14), push (O14), accessibility device checks (doc 28), local legal review (docs/legal), emergency numbers verified by Ops (D-F6), launch city and pricing rules, alerts with named owners, staging, first emulator run of the Maestro flows.
> Payments: Fixli is **cash only** at launch (D13); the card/wallet items below do not apply until a provider is added.
> Details: [doc 29](29_REAUDIT_PHASES_7_13.md), [ops runbooks](ops/README.md), [store answers](store/data-safety.md).

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
- [ ] auth hardened
- [ ] RBAC tested
- [ ] rate limits
- [ ] webhook signatures
- [ ] file upload security
- [ ] dependency audit
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
- [ ] emergency flow tested
- [ ] trusted contact flow
- [ ] incident console
- [ ] support escalation
- [ ] safety copy reviewed
- [ ] dangerous AI advice blocked

## Marketplace
- [ ] professional supply
- [ ] verification capacity
- [ ] category demand
- [ ] support staffing
- [ ] dispute process
- [ ] cancellation policy

## Mobile
- [ ] iOS production build
- [ ] Android production build
- [ ] background location review
- [ ] push notifications
- [ ] deep links
- [ ] camera/media
- [ ] offline sync
- [ ] accessibility
- [ ] localization

## Backend
- [ ] migrations
- [ ] backups
- [ ] restore drill
- [ ] monitoring
- [ ] alerts
- [ ] error tracking
- [ ] queues
- [ ] cron/scheduled jobs
- [ ] autoscaling
- [ ] staging parity

## App stores
- [ ] privacy policy
- [ ] terms
- [ ] support URL
- [ ] account deletion
- [ ] data safety declarations
- [ ] permission descriptions
- [ ] age rating
- [ ] screenshots
- [ ] localized metadata

## Launch
- [ ] soft launch
- [ ] feature flags
- [ ] rollback plan
- [ ] on-call owner
- [ ] incident response
- [ ] daily launch dashboard
