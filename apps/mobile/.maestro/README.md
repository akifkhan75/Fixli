# Maestro flows

Run against a **dev build** (EAS development client or a local `expo run`) pointed at an API with
`pnpm --filter @fixli/api db:seed` applied (demo accounts, password `password123`):

```
maestro test apps/mobile/.maestro
```

| Flow | Covers |
|---|---|
| `customer_flow.yaml` | sign in, Account menu (saved workers, reports), sign out |
| `worker_flow.yaml` | sign in, Today / Earnings / Account tabs, sign out |
| `signup_otp_flow.yaml` | signup form up to the code screen |
| `forgot_password_flow.yaml` | forgot-password up to the code screen |

Not yet running in CI: it needs an EAS dev build artifact (owner decision O14: EAS project and
signing accounts). These flows were written against the current screens but have **not been run on a
device**; expect to adjust selectors on first run.
