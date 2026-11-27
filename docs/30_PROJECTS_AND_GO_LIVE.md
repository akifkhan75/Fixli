# Projects module, easy onboarding, and the go-live checklist

Written 2026-11-27. Status of what that round added, what it deliberately left out, and what only
the owner can finish before publishing.

## 1. Projects (larger work)

Customers post work (new build, renovation, installation, upkeep); professionals and companies
price it with a total, a duration and payment stages; the hired one works through the stages in order.

| State | Meaning |
|-------|---------|
| `DRAFT → OPEN → AWARDED → IN_PROGRESS → COMPLETED / CANCELLED` | project |
| `PENDING → FUNDED* → IN_PROGRESS → SUBMITTED → APPROVED → RELEASED`, `DISPUTED`, `CANCELLED` | stage (`*` card only) |

The only definition of allowed stage changes is `apps/api/src/projects/project-state.ts`.

**Money**

- **Card (escrow):** customer pays a stage on the provider's page → held → approval writes
  `ESCROW_CREDIT` (−amount) and `COMMISSION_OWED` (+fee) to the professional's ledger. A negative
  balance means Fixli owes the professional.
- **Direct:** customer approves, pays the professional, professional confirms → only the fee is booked.
- Silence: a submitted stage is approved after `PROJECT_AUTO_APPROVE_DAYS` (7); a direct payment
  approved that long ago is treated as received. A dispute stops both.
- Cancelling is refused while a stage is being worked on, awaiting approval or payment, or disputed.
  Held money for stages not started is refunded.
- A stage dispute is resolved in the admin console (needs `finance.adjust`): release, refund, or resume.

**Local testing of card payments**

```
PAYMENTS_PROVIDER=stripe STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_…
stripe listen --forward-to localhost:3002/api/payments/stripe/webhook
```

## 2. Known limits (decide before launch)

| Limit | Detail |
|-------|--------|
| No card payments for quick jobs | Cards cover project stages only. Quick jobs remain cash. |
| No automatic payouts | Money owed to a professional is paid by Finance (any local rail) and recorded as a ledger adjustment. Stripe Connect was not built: it is unavailable in Pakistan and holding funds needs the L5 answer. The ledger screen has no dedicated "payout" action. |
| Project size | One project totals at most 2,000,000,000 minor units (PKR 20,000,000): money columns are 32-bit. Raising it means moving money columns to `BIGINT`. |
| Changing scope | An awarded project's stages cannot be edited or added. Agree changes in chat, then cancel remaining stages (dispute/support) or post a new project. |
| One trade per project | A whole house needs one project per trade. |
| One company, one login | A company has a name and team size on one professional account; no separate staff logins. |
| Evidence retention | Stage photos uploaded by a professional are kept after account deletion with the payment record; set a retention period (L-items). |
| No staff view of projects | The admin console resolves stage disputes but cannot list, moderate or cancel projects. |
| Project screens have no call or SOS button | Chat only. Project chats also never become read-only on their own. |
| Android Expo Go | The app fails to start there because `expo-notifications` no longer works in Expo Go. Use a development build. |
| Translations | Urdu and Arabic strings added in this round are drafts: native review (O13) required. |
| Read-aloud | Uses the phone's own voices. The button is hidden where a phone reports no voice for the language; many Android phones need the Urdu voice installed. |
| ID number reading | Built but **off** (`AI_ID_OCR_ENABLED=false`): it sends the ID photo to the AI provider. Needs the data-processor decision (O9). |

## 3. Before publishing: owner actions

Nothing below can be done from the code.

### Accounts and keys
- [ ] SMS: Twilio (or another gateway) account that delivers to Pakistan; set `SMS_PROVIDER=twilio`, `TWILIO_*`. Test a real code on each major network. **Without this, production sign-up and sign-in codes do not work.**
- [ ] Card payments: choose a provider that works in the launch country. Stripe does not onboard Pakistani businesses; a JazzCash/Easypaisa/bank gateway implements `CardGateway` (`apps/api/src/payments/card.gateway.ts`). Launching direct/cash-only (`PAYMENTS_PROVIDER=none`) is supported.
- [ ] EAS, Apple Developer, Google Play, Firebase/APNs accounts (O14); push notifications.
- [ ] Gemini API key with billing; Sentry projects and DSNs.
- [ ] Production Postgres, Redis, S3-compatible storage; secrets in a secret manager.

### Business and legal
- [ ] Confirm commission and cash-limit numbers (O8): current values are placeholders.
- [ ] Price bands per city (O1); launch city; category list (including the new building trades).
- [ ] Legal review (L1–L12), in particular **holding customer money** for card escrow (L5), tax, data residency, terms covering projects, stages, auto-approval and refunds. Update the privacy page for projects.
- [ ] Support process and response times for stage disputes.
- [ ] Native Urdu and Arabic review (O13).

### Engineering gates still open
- [ ] Staging environment; monitoring, alerts and backups switched on (`docs/ops`).
- [ ] Load test on staging-sized infrastructure. The laptop run is a regression baseline, not a capacity claim.
- [ ] Device testing on a low-end Android phone and an iPhone: cold start, offline, camera, microphone, location, push, deep links.
- [ ] Screen-reader pass (TalkBack, VoiceOver), 200 % text, Urdu and Arabic right-to-left review.
- [ ] Maestro flows on an emulator (sign-in and sign-up flows were updated for the new screens and need a run).
- [ ] Usability test with at least 5 customers and 5 workers in Urdu, including people who read with difficulty.
- [ ] External penetration test (include the payment webhook and code sign-in).
- [ ] Revisit the accepted dependency risks below and remove each ignore once an upgrade is possible.
- [ ] Store listings, screenshots (the new design), data-safety forms (`docs/store/data-safety.md` needs SMS, card provider and any ID reading added).

### Accepted dependency risks

Ignored in `package.json` → `pnpm.auditConfig.ignoreGhsas` (accepted by the owner, 2026-11-27).

| Advisory | Package | Why accepted |
|----------|---------|--------------|
| GHSA-mrhx-c7xc-m3w5 | `zod` 3 | Reached only through Expo's command-line build tool; not in the app or API runtime. The fix exists only in zod 4, which Expo does not use yet. |
| GHSA-qr28-fpjm-wq7f | `decode-uri-component` 0.2 | Used by `query-string` to parse link addresses in the app: a crafted link could freeze that one phone's app. The fixed version is ESM-only and would break `query-string` 7. |

### Deploying this round
1. Apply migrations `20261127000000_projects` and `20261127010000_hot_path_indexes` (additive; no database rebuild).
2. Seed the catalog again (`pnpm --filter @fixli/api db:seed:catalog`) for the building trades.
3. Set the new variables (see `.env.example`).
4. Ship a new native app build: this round adds `expo-speech` and `react-native-worklets`.
