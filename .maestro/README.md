# Phone flows (Maestro)

One folder, five flows, all in English on an Android emulator:

| Flow | What it proves |
|---|---|
| `signup_customer` / `signup_worker` | a new person can create an account and lands in the right place |
| `customer_journey` | ask for help → price arrives live → book → chat → finished → confirm cash → review |
| `worker_journey` | go online → request arrives → send price → booked → every job step → cash received |
| `worker_offline` | a job step done with no signal is saved, shown as waiting, and sent when the signal returns |

**The other person** is played by `helpers/api.js`, which calls the real API at the right moments (a worker sends a price, a customer books). `helpers/check.mjs` runs those same actions with no phone, so the backend half is checked on its own (`API=http://127.0.0.1:3002/api node .maestro/helpers/check.mjs`).

**Not covered here on purpose:** uploading ID documents (needs a camera; the verification flow is covered by the API end-to-end tests and `apps/admin/e2e`), and Urdu/Arabic screens (see doc 28).

## Run it

```bash
pnpm --filter @fixli/api db:seed:catalog && pnpm --filter @fixli/api seed:e2e   # test accounts, never in production
# API running with ADMIN_TOTP_REQUIRED=false, app built with EXPO_PUBLIC_API_URL=http://10.0.2.2:3002/api
maestro test .maestro
```

## Status

**Written against the current screens and the helper actions are proven against a real API, but the phone steps have not been run on an emulator yet** (no emulator or Maestro in the environment they were written in). The first run in CI (`.github/workflows/e2e-mobile.yml`, started by hand) will probably need a few text or timing fixes. Fix the flow, not the app, unless the app is really wrong.
